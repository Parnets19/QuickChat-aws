const phonePeTransactionModel = require("../models/phonepe.model");
const axios = require("axios");
const mongoose = require("mongoose");

// PhonePe Official Node.js SDK
const { StandardCheckoutClient, Env, CreateSdkOrderRequest } = require('pg-sdk-node');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG — all values come from ecosystem.config.js env block
// ─────────────────────────────────────────────────────────────────────────────
const PHONEPE_ENV   = (process.env.PHONEPE_ENV || "production").trim().toLowerCase();
const IS_PROD       = PHONEPE_ENV === "production";

const CLIENT_ID     = process.env.PHONEPE_CLIENT_ID     || "SU2602271710223361427734";
const CLIENT_SECRET = process.env.PHONEPE_CLIENT_SECRET || "a0755144-e7c6-4e0d-a71f-42681b4faf0b";
const CLIENT_VER    = process.env.PHONEPE_CLIENT_VERSION || "1";

const CALLBACK_URL  = process.env.PHONEPE_CALLBACK_URL  || "https://quickchatindia.com";
const BACKEND_URL   = process.env.BACKEND_URL           || "https://quickchatindia.com";
const MERCHANT_ID   = process.env.PHONEPE_MERCHANT_ID   || "M2352B2GR2M1V";

const PAY_URL = IS_PROD
  ? "https://api.phonepe.com/apis/pg/checkout/v2/pay"
  : "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay";

const AUTH_ENDPOINT = IS_PROD
  ? "https://api.phonepe.com/apis/identity-manager/v1/oauth/token"
  : "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token";

const ORDER_STATUS_URL = IS_PROD
  ? "https://api.phonepe.com/apis/pg/checkout/v2/order"
  : "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/order";

// Initialize PhonePe SDK Client (singleton)
const phonePeClient = StandardCheckoutClient.getInstance(
  CLIENT_ID,
  CLIENT_SECRET,
  Number(CLIENT_VER),
  IS_PROD ? Env.PRODUCTION : Env.SANDBOX
);

console.log("🔧 PhonePe Config →", {
  PHONEPE_ENV, IS_PROD, CLIENT_ID, MERCHANT_ID,
  PAY_URL, CALLBACK_URL, BACKEND_URL
});
console.log("✅ PhonePe Node.js SDK client initialized");

// ─────────────────────────────────────────────────────────────────────────────
// OAuth2 token cache (for web checkout fallback)
// ─────────────────────────────────────────────────────────────────────────────
let _token = null;
let _expiresAt = 0;

async function getToken() {
  if (_token && Date.now() < _expiresAt - 60000) return _token;

  console.log("🔑 Fetching PhonePe OAuth token from:", AUTH_ENDPOINT);

  const body = new URLSearchParams();
  body.append("client_id",      CLIENT_ID);
  body.append("client_secret",  CLIENT_SECRET);
  body.append("client_version", String(CLIENT_VER));
  body.append("grant_type",     "client_credentials");

  const { data } = await axios.post(AUTH_ENDPOINT, body, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });

  _token     = data.access_token;
  _expiresAt = Date.now() + (data.expires_in || 3600) * 1000;

  console.log("✅ PhonePe token OK, expires in", data.expires_in, "s");
  return _token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credit wallet DIRECTLY in DB — no HTTP call, no JWT dependency
// This is called from the PhonePe callback and status-check poll.
// ─────────────────────────────────────────────────────────────────────────────
async function creditWalletViaConfig(txn) {
  try {
    const { User, Transaction } = require("../models");

    const userId = txn.userId;
    const amount  = parseFloat(txn.amount);

    if (!userId || !amount || amount <= 0) {
      console.warn("⚠️ creditWallet: invalid userId or amount", { userId, amount });
      return false;
    }

    console.log("💰 Crediting wallet directly for userId:", userId, "amount:", amount);

    const user = await User.findById(userId);
    if (!user) {
      console.error("❌ creditWallet: User not found:", userId);
      return false;
    }

    const previousBalance = user.wallet || 0;
    user.wallet = previousBalance + amount;
    await user.save();

    // Record the transaction
    await Transaction.create({
      user:           userId,
      userType:       "User",
      type:           "deposit",
      category:       "deposit",
      amount:         amount,
      balance:        user.wallet,
      description:    "Wallet Recharge via PhonePe",
      status:         "completed",
      paymentMethod:  "upi",
      paymentGateway: "phonepe",
      transactionId:  `PHONEPE_${txn._id}`,
      metadata: {
        phonePeTxnId:    txn._id.toString(),
        merchantOrderId: txn._id.toString(),
        previousBalance,
        newBalance:      user.wallet,
      },
    });

    console.log("✅ Wallet credited:", { userId, amount, previousBalance, newBalance: user.wallet });
    return true;
  } catch (e) {
    console.error("❌ creditWallet error:", e.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
class PhonePeController {

  // ── Initiate Payment ──────────────────────────────────────────────────────
  async addPaymentPhone(req, res) {
    try {
      const { userId, username, Mobile, orderId, amount, config, platform } = req.body;

      const txn = await phonePeTransactionModel.create({
        userId, username, Mobile, orderId, amount, config,
      });

      console.log("💳 Transaction created:", { id: txn._id, amount, userId, platform });

      let token;
      try {
        token = await getToken();
      } catch (e) {
        console.error("❌ PhonePe auth failed:", e.response?.data || e.message);
        return res.status(500).json({ error: "PhonePe auth failed", details: e.response?.data });
      }

      // Detect if request is from mobile app
      const isMobile = platform === 'mobile' || req.headers['x-platform'] === 'mobile';
      
      // For mobile: use the PhonePe Node.js SDK
      if (isMobile) {
        console.log("📱 Mobile payment - using official pg-sdk-node");
        
        const request = CreateSdkOrderRequest.StandardCheckoutBuilder()
          .merchantOrderId(txn._id.toString())
          .amount(Math.round(amount * 100)) // paise
          .redirectUrl(`${CALLBACK_URL}/payment-success?transactionId=${txn._id}&userID=${userId}&platform=mobile`)
          .build();

        try {
          const response = await phonePeClient.createSdkOrder(request);
          console.log("✅ SDK Order created:", response);

          return res.status(200).json({
            id: txn._id,
            orderToken: response.token,
            orderId: response.orderId,
            merchantId: MERCHANT_ID,
            isMobile: true
          });
        } catch (sdkErr) {
          console.error("❌ SDK createSdkOrder error:", sdkErr);
          // fall through to web checkout below
        }
      }

      // Web checkout flow (original code)
      const redirectUrl = isMobile
        ? `${CALLBACK_URL}/payment-success?transactionId=${txn._id}&userID=${userId}&platform=mobile`
        : `${CALLBACK_URL}/provider/earnings?transactionId=${txn._id}&userID=${userId}`;

      console.log("🔗 Redirect URL:", redirectUrl, "(mobile:", isMobile, ")");

      const payload = {
        merchantOrderId : txn._id.toString(),
        amount          : Math.round(amount * 100), // paise
        expireAfter     : 1200,
        metaInfo        : { udf1: userId, udf2: username || "", udf3: Mobile || "" },
        paymentFlow: {
          type    : "PG_CHECKOUT",
          message : "Wallet Recharge",
          merchantUrls: {
            redirectUrl : redirectUrl,
            callbackUrl : `${BACKEND_URL}/api/phonepe/payment-callback`,
          },
        },
      };

      console.log("📤 PhonePe payload →", JSON.stringify(payload, null, 2));

      const { data: ppResp } = await axios.post(PAY_URL, payload, {
        headers: {
          "Content-Type"  : "application/json",
          "accept"        : "application/json",
          "Authorization" : `O-Bearer ${token}`,
          "X-Merchant-Id" : MERCHANT_ID,
        },
      });

      console.log("✅ PhonePe Pay response →", ppResp);

      const checkoutUrl = ppResp?.redirectUrl;
      if (!checkoutUrl) {
        return res.status(500).json({ error: "No redirect URL from PhonePe", raw: ppResp });
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

  // ── Payment Callback (PhonePe webhook POST) ───────────────────────────────
  async paymentcallback(req, res) {
    try {
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
      console.log("📩 PhonePe CALLBACK at", new Date().toISOString());
      console.log("📦 Body:", JSON.stringify(req.body, null, 2));
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

      let txnId, state;

      // PhonePe v2 new API format
      if (req.body?.merchantOrderId) {
        txnId = req.body.merchantOrderId;
        // pg.order.completed event always means success
        state = req.body.state || "COMPLETED";
        console.log(`📋 v2 format → txn=${txnId}, state=${state}`);
      }
      // Old base64 format
      else if (req.body?.response) {
        const decoded = Buffer.from(req.body.response, "base64").toString("utf-8");
        const parsed  = JSON.parse(decoded);
        console.log("📋 Decoded:", JSON.stringify(parsed, null, 2));
        txnId = parsed?.data?.merchantTransactionId || parsed?.data?.merchantOrderId;
        state = parsed?.data?.state;
      }
      // Fallback
      else {
        txnId = req.body?.merchantOrderId || req.body?.merchantTransactionId;
        state = req.body?.state || (req.body?.code === "PAYMENT_SUCCESS" ? "COMPLETED" : "FAILED");
        console.log(`📋 Fallback → txn=${txnId}, state=${state}`);
      }

      if (!txnId) {
        console.error("❌ Could not extract txnId from callback body:", req.body);
        return res.status(200).send("OK");
      }

      const txn = await phonePeTransactionModel.findById(txnId);
      if (!txn) {
        console.warn(`⚠️ Transaction not found: ${txnId}`);
        return res.status(200).send("OK");
      }

      console.log(`📋 Current txn status: ${txn.status}, new state: ${state}`);

      // Only process if not already completed (prevent double credit)
      if (state === "COMPLETED" && txn.status !== "COMPLETED") {
        txn.status = "COMPLETED";
        await txn.save();
        await creditWalletViaConfig(txn);
        console.log(`✅ Transaction ${txnId} completed and wallet credited`);
      } else if (state !== "COMPLETED") {
        txn.status = state;
        await txn.save();
        console.log(`✅ Transaction ${txnId} saved as ${state}`);
      } else {
        console.log(`⚠️ Transaction ${txnId} already COMPLETED, skipping`);
      }

      return res.status(200).send("OK"); // Always 200 to PhonePe
    } catch (err) {
      console.error("❌ Callback error:", err.message);
      return res.status(200).send("OK");
    }
  }

  // ── Check Payment — also queries PhonePe directly ─────────────────────────
  async checkPayment(req, res) {
    try {
      const { id, userId } = req.params;
      const txn = await phonePeTransactionModel.findOne({ _id: id, userId });
      if (!txn) return res.status(400).json({ error: "Payment not found" });

      // If already completed, return immediately
      if (txn.status === "COMPLETED") {
        return res.status(200).json({ success: txn });
      }

      // Query PhonePe directly for real status
      try {
        const token = await getToken();
        const { data: statusResp } = await axios.get(`${ORDER_STATUS_URL}/${id}/status`, {
          headers: {
            "Authorization" : `O-Bearer ${token}`,
            "X-Merchant-Id" : MERCHANT_ID,
            "Content-Type"  : "application/json",
          },
        });

        console.log("📊 PhonePe order status response:", JSON.stringify(statusResp, null, 2));

        const phonepeState = statusResp?.state;
        if (phonepeState === "COMPLETED" && txn.status !== "COMPLETED") {
          txn.status = "COMPLETED";
          await txn.save();
          await creditWalletViaConfig(txn);
          console.log(`✅ Transaction ${id} marked COMPLETED via status poll`);
        } else if (phonepeState === "FAILED") {
          txn.status = "FAILED";
          await txn.save();
        }
      } catch (phonepeErr) {
        console.error("❌ PhonePe status check error:", phonepeErr.response?.data || phonepeErr.message);
        // Don't fail — return DB status
      }

      // Return the updated txn
      return res.status(200).json({ success: txn });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  // ── Update Status Manually ────────────────────────────────────────────────
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

  // ── Get All Payments (Admin) ──────────────────────────────────────────────
  async getallpayment(req, res) {
    try {
      // Extract pagination and filter parameters
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const status = req.query.status; // 'all', 'COMPLETED', 'FAILED', 'PENDING', 'InProgress'
      const search = req.query.search;

      // Build filter query
      const filter = {};
      
      if (status && status !== 'all') {
        if (status === 'InProgress') {
          // InProgress means transaction exists but status is not set yet
          filter.$or = [
            { status: { $exists: false } },
            { status: null },
            { status: '' }
          ];
        } else {
          filter.status = status;
        }
      }

      // Add search filter
      if (search) {
        filter.$or = [
          { username: { $regex: search, $options: 'i' } },
          { Mobile: { $regex: search, $options: 'i' } },
          { orderId: { $regex: search, $options: 'i' } },
          { transactionId: { $regex: search, $options: 'i' } }
        ];
      }

      // Get total count for pagination
      const total = await phonePeTransactionModel.countDocuments(filter);

      // Get paginated data
      const data = await phonePeTransactionModel
        .find(filter)
        .sort({ _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit);

      return res.status(200).json({
        success: data,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── Legacy makepayment ────────────────────────────────────────────────────
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
          "X-Merchant-Id" : MERCHANT_ID,
        },
      });

      return res.status(200).json({ url: { url: data?.redirectUrl } });
    } catch (err) {
      return res.status(500).json({ error: err.response?.data || err.message });
    }
  }

  // ── Test Callback (manual trigger for stuck transactions) ─────────────────
  async testCallback(req, res) {
    try {
      const { transactionId } = req.body;
      if (!transactionId) return res.status(400).json({ error: "transactionId required" });

      const txn = await phonePeTransactionModel.findById(transactionId);
      if (!txn) return res.status(404).json({ error: "Transaction not found" });

      if (txn.status === "COMPLETED") {
        return res.status(200).json({ success: true, message: "Already completed", txn });
      }

      txn.status = "COMPLETED";
      await txn.save();

      const credited = await creditWalletViaConfig(txn);

      return res.status(200).json({
        success: true,
        message: credited ? "Wallet credited successfully" : "Status updated but wallet credit failed",
        txn
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new PhonePeController();
