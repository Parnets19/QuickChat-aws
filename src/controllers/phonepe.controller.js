const phonePeTransactionModel = require("../models/phonepe.model");
const axios = require("axios");

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const PHONEPE_ENV   = (process.env.PHONEPE_ENV || "test").trim().toLowerCase();
const IS_PROD       = PHONEPE_ENV === "production";

const CLIENT_ID     = process.env.PHONEPE_CLIENT_ID     || "SU2602271710223361427734";
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "a0755144-e7c6-4e0d-a71f-42681b4faf0b";
const CLIENT_VER    = process.env.PHONEPE_CLIENT_VERSION || "1";

const CALLBACK_URL  = process.env.PHONEPE_CALLBACK_URL  || "http://localhost:3000";
const BACKEND_URL   = process.env.BACKEND_URL           || "http://localhost:5001";

// ─────────────────────────────────────────────────────────────────────────────
// CORRECT API URLs (verified from official PhonePe docs June 2025)
// ─────────────────────────────────────────────────────────────────────────────
const AUTH_URL = IS_PROD
  ? `https://api.phonepe.com/apis/identity-manager/v1/oauth/token?client_id=${CLIENT_ID}&client_version=${CLIENT_VER}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`
  : `https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token?client_id=${CLIENT_ID}&client_version=${CLIENT_VER}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`;

const PAY_URL = IS_PROD
  ? "https://api.phonepe.com/apis/pg/checkout/v2/pay"
  : "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay";

console.log("🔧 PhonePe Config →", {
  env        : PHONEPE_ENV,
  isProd     : IS_PROD,
  clientId   : CLIENT_ID,
  payUrl     : PAY_URL,
  callbackUrl: `${BACKEND_URL}/api/phonepe/payment-callback`,
  backendUrl : BACKEND_URL,
});

// ─────────────────────────────────────────────────────────────────────────────
// OAuth2 token cache
// ─────────────────────────────────────────────────────────────────────────────
let _token     = null;
let _expiresAt = 0;

async function getToken() {
  if (_token && Date.now() < _expiresAt - 60_000) return _token;

  console.log("🔑 Fetching PhonePe OAuth token...");
  console.log("🔧 Auth URL:", IS_PROD ? "Production" : "Sandbox");

  const authUrl = IS_PROD
    ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
    : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

  const body = new URLSearchParams();
  body.append("client_id",      CLIENT_ID);
  body.append("client_secret",  CLIENT_SECRET);
  body.append("client_version", String(CLIENT_VER));
  body.append("grant_type",     "client_credentials");

  console.log("📤 Token request:", { clientId: CLIENT_ID, url: authUrl });

  const { data } = await axios.post(authUrl, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  _token     = data.access_token;
  _expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  console.log("✅ PhonePe token OK, expires in", data.expires_in, "s");
  return _token;
}

// ─────────────────────────────────────────────────────────────────────────────
class PhonePeController {

  // ── Initiate Payment ────────────────────────────────────────────────────────
  async addPaymentPhone(req, res) {
    try {
      const { userId, username, Mobile, orderId, amount, config } = req.body;

      // 1. Save transaction record
      const txn = await phonePeTransactionModel.create({
        userId, username, Mobile, orderId, amount, config,
      });

      console.log("💳 PhonePe transaction created:", { id: txn._id, amount, userId });

      // 2. Get OAuth token
      let token;
      try {
        token = await getToken();
      } catch (e) {
        console.error("❌ PhonePe auth failed:", e.response?.data || e.message);
        return res.status(500).json({ error: "PhonePe auth failed", details: e.response?.data });
      }

      // 3. Build payload (v2 format)
      const payload = {
        merchantOrderId : txn._id.toString(),
        amount          : Math.round(amount * 100), // paise
        expireAfter     : 1200,
        metaInfo: {
          udf1: userId,
          udf2: username || "",
          udf3: Mobile   || "",
        },
        paymentFlow: {
          type    : "PG_CHECKOUT",
          message : "Wallet Recharge",
          merchantUrls: {
            redirectUrl : `${CALLBACK_URL}/provider/earnings?transactionId=${txn._id}&userID=${userId}`,
            callbackUrl : `${BACKEND_URL}/api/phonepe/payment-callback`,
          },
        },
      };

      console.log("📤 PhonePe payload →", JSON.stringify(payload, null, 2));

      // 4. Call PhonePe Pay API
     const { data: ppResp } = await axios.post(PAY_URL, payload, {
  headers: {
    "Content-Type"  : "application/json",
    "accept"        : "application/json",
    "Authorization" : `O-Bearer ${token}`,
    "X-Merchant-Id" : process.env.PHONEPE_MERCHANT_ID || "M2352B2GR2M1V",
  },
});

      console.log("✅ PhonePe Pay response →", ppResp);

      const checkoutUrl = ppResp?.redirectUrl;

      if (!checkoutUrl) {
        console.error("❌ No redirectUrl in PhonePe response:", ppResp);
        return res.status(500).json({ error: "No payment URL from PhonePe", raw: ppResp });
      }

      return res.status(200).json({ id: txn._id, url: { url: checkoutUrl } });

    } catch (err) {
      console.error("❌ addPaymentPhone error:", err.response?.data || err.message);
      return res.status(500).json({
        error   : "Payment initiation failed",
        details : err.response?.data || err.message,
      });
    }
  }

  // ── Payment Callback (webhook) ───────────────────────────────────────────────
  async paymentcallback(req, res) {
    try {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📩 PhonePe CALLBACK RECEIVED at", new Date().toISOString());
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📋 Headers:", JSON.stringify(req.headers, null, 2));
      console.log("📦 Body:", JSON.stringify(req.body, null, 2));
      console.log("🔗 URL:", req.url);
      console.log("🔗 Method:", req.method);

      let txnId, state, phonePeTransactionId;

      // PhonePe v2 API sends direct JSON in body
      if (req.body.merchantOrderId) {
        // New v2 format
        txnId = req.body.merchantOrderId;
        phonePeTransactionId = req.body.transactionId;
        
        // Map PhonePe status codes to our status
        if (req.body.code === "PAYMENT_SUCCESS") {
          state = "COMPLETED";
        } else if (req.body.code === "PAYMENT_PENDING") {
          state = "PENDING";
        } else {
          state = "FAILED";
        }
      } else if (req.body.response) {
        // Old-style base64 (fallback)
        const decoded = Buffer.from(req.body.response, "base64").toString("utf-8");
        const parsed  = JSON.parse(decoded);
        txnId = parsed?.data?.merchantTransactionId || parsed?.data?.merchantOrderId;
        phonePeTransactionId = parsed?.data?.transactionId;
        state = parsed?.data?.state;
      } else {
        console.error("❌ Unknown callback format:", req.body);
        return res.status(200).send("OK");
      }

      console.log(`📋 Callback → txn=${txnId}, phonePeTxn=${phonePeTransactionId}, state=${state}`);

      const txn = await phonePeTransactionModel.findById(txnId);
      if (!txn) {
        console.warn(`⚠️ Transaction not found: ${txnId}`);
        return res.status(200).send("OK");
      }

      // Update transaction status
      txn.status = state;
      if (phonePeTransactionId) {
        txn.phonePeTransactionId = phonePeTransactionId;
      }
      await txn.save();
      console.log(`✅ Transaction ${txnId} saved as ${state}`);

      // Credit wallet if payment successful
      if (state === "COMPLETED") {
        try {
          const User = require("../models/User.model");
          const Transaction = require("../models/Transaction.model");
          
          const user = await User.findById(txn.userId);
          if (!user) {
            console.error(`❌ User not found: ${txn.userId}`);
            return res.status(200).send("OK");
          }

          // Check if already credited (prevent double credit)
          const existingCredit = await Transaction.findOne({
            'metadata.phonePeTransactionId': txnId,
            type: 'deposit',
            status: 'completed'
          });

          if (existingCredit) {
            console.log(`⚠️ Wallet already credited for transaction ${txnId}`);
            return res.status(200).send("OK");
          }

          // Credit wallet
          const previousBalance = user.wallet || 0;
          user.wallet = previousBalance + txn.amount;
          await user.save();

          console.log(`💰 Wallet credited: User ${txn.userId}, Amount: ₹${txn.amount}, New Balance: ₹${user.wallet}`);

          // Create transaction record
          await Transaction.create({
            user: txn.userId,
            userType: "User",
            type: "deposit",
            category: "wallet_credit",
            amount: txn.amount,
            balance: user.wallet,
            description: `Wallet Recharge via PhonePe - ${txnId}`,
            status: "completed",
            paymentMethod: "phonepe",
            paymentGateway: "phonepe",
            metadata: {
              phonePeTransactionId: txnId,
              phonePeReferenceId: phonePeTransactionId,
              merchantOrderId: txnId,
              previousBalance: previousBalance,
              creditedAmount: txn.amount
            }
          });

          console.log(`✅ Transaction record created for wallet credit`);

          // Execute config callback if exists
          if (txn.config) {
            try {
              await axios(JSON.parse(txn.config));
              console.log("✅ Config callback executed");
            } catch (e) {
              console.error("❌ Config callback error:", e.message);
            }
          }

        } catch (walletError) {
          console.error("❌ Wallet credit error:", walletError.message, walletError.stack);
        }
      }

      return res.status(200).send("OK"); // Always 200 to PhonePe
    } catch (err) {
      console.error("❌ Callback error:", err.message, err.stack);
      return res.status(200).send("OK");
    }
  }

  // ── Check Payment ─────────────────────────────────────────────────────────────
  async checkPayment(req, res) {
    try {
      const { id, userId } = req.params;
      const txn = await phonePeTransactionModel.findOne({ _id: id, userId });
      if (!txn) return res.status(400).json({ error: "Payment not found" });
      
      // Return detailed status
      return res.status(200).json({ 
        success: true,
        transaction: {
          id: txn._id,
          status: txn.status,
          amount: txn.amount,
          userId: txn.userId,
          username: txn.username,
          phonePeTransactionId: txn.phonePeTransactionId,
          createdAt: txn.createdAt,
          updatedAt: txn.updatedAt
        }
      });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // ── Update Status Manually ────────────────────────────────────────────────────
  async updateStatuspayment(req, res) {
    try {
      const txn = await phonePeTransactionModel.findById(req.params.id);
      if (!txn) return res.status(400).json({ error: "Not found" });
      txn.status = "Completed";
      await txn.save();
      return res.status(200).json({ success: "Completed" });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Get All Payments (Admin) ───────────────────────────────────────────────────
  async getallpayment(req, res) {
    try {
      const data = await phonePeTransactionModel.find({}).sort({ _id: -1 });
      return res.status(200).json({ success: data });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Legacy makepayment ─────────────────────────────────────────────────────────
  async makepayment(req, res) {
    try {
      const { amount, merchantTransactionId } = req.body;
      const token = await getToken();

      const payload = {
        merchantOrderId : merchantTransactionId,
        amount          : Math.round(amount),
        expireAfter     : 1200,
        paymentFlow: {
          type    : "PG_CHECKOUT",
          message : "Payment",
          merchantUrls: {
            redirectUrl : CALLBACK_URL,
            callbackUrl : `${BACKEND_URL}/api/phonepe/payment-callback`,
          },
        },
      };

      const { data } = await axios.post(PAY_URL, payload, {
        headers: {
          "Content-Type"  : "application/json",
          "accept"        : "application/json",
          "Authorization" : `O-Bearer ${token}`,
        },
      });

      return res.status(200).json({ url: { url: data?.redirectUrl } });
    } catch (err) {
      console.error("makepayment error:", err.response?.data || err.message);
      return res.status(500).json({ error: err.response?.data || err.message });
    }
  }

  // ── Test Callback (for debugging) ──────────────────────────────────────────────
  async testCallback(req, res) {
    try {
      const { transactionId } = req.body;
      
      if (!transactionId) {
        return res.status(400).json({ error: "transactionId required" });
      }

      console.log("🧪 Testing callback for transaction:", transactionId);

      // Find the transaction
      const txn = await phonePeTransactionModel.findById(transactionId);
      if (!txn) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      console.log("📋 Transaction found:", {
        id: txn._id,
        userId: txn.userId,
        amount: txn.amount,
        currentStatus: txn.status
      });

      // Simulate PhonePe v2 callback
      const mockCallback = {
        merchantOrderId: transactionId,
        transactionId: `PP_TEST_${Date.now()}`,
        code: "PAYMENT_SUCCESS",
        message: "Payment successful (TEST)",
        amount: txn.amount * 100
      };

      console.log("🧪 Simulating callback with:", mockCallback);

      // Process the callback directly
      const User = require("../models/User.model");
      const Transaction = require("../models/Transaction.model");

      // Update transaction status
      txn.status = "COMPLETED";
      txn.phonePeTransactionId = mockCallback.transactionId;
      await txn.save();
      console.log(`✅ Transaction ${transactionId} updated to COMPLETED`);

      // Credit wallet
      const user = await User.findById(txn.userId);
      if (!user) {
        return res.status(404).json({ error: `User not found: ${txn.userId}` });
      }

      // Check if already credited
      const existingCredit = await Transaction.findOne({
        'metadata.phonePeTransactionId': transactionId,
        type: 'deposit',
        status: 'completed'
      });

      if (existingCredit) {
        console.log(`⚠️ Wallet already credited for transaction ${transactionId}`);
        return res.status(200).json({ 
          success: true, 
          message: "Already credited",
          transaction: txn
        });
      }

      // Credit wallet
      const previousBalance = user.wallet || 0;
      user.wallet = previousBalance + txn.amount;
      await user.save();

      console.log(`💰 Wallet credited: User ${txn.userId}, Amount: ₹${txn.amount}, New Balance: ₹${user.wallet}`);

      // Create transaction record
      await Transaction.create({
        user: txn.userId,
        userType: "User",
        type: "deposit",
        category: "wallet_credit",
        amount: txn.amount,
        balance: user.wallet,
        description: `Wallet Recharge via PhonePe (TEST) - ${transactionId}`,
        status: "completed",
        paymentMethod: "phonepe",
        paymentGateway: "phonepe",
        metadata: {
          phonePeTransactionId: transactionId,
          phonePeReferenceId: mockCallback.transactionId,
          merchantOrderId: transactionId,
          previousBalance: previousBalance,
          creditedAmount: txn.amount,
          testMode: true
        }
      });

      console.log(`✅ Transaction record created`);

      return res.status(200).json({ 
        success: true, 
        message: "Wallet credited successfully",
        transaction: txn,
        walletBalance: user.wallet,
        credited: txn.amount
      });

    } catch (err) {
      console.error("❌ Test callback error:", err.message, err.stack);
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new PhonePeController();