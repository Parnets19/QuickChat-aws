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
  env     : PHONEPE_ENV,
  clientId: CLIENT_ID,
  payUrl  : PAY_URL,
});

// ─────────────────────────────────────────────────────────────────────────────
// OAuth2 token cache
// ─────────────────────────────────────────────────────────────────────────────
let _token     = null;
let _expiresAt = 0;

async function getToken() {
  if (_token && Date.now() < _expiresAt - 60_000) return _token;

  console.log("🔑 Fetching PhonePe OAuth token...");

  const body = new URLSearchParams();
  body.append("client_id",      CLIENT_ID);
  body.append("client_secret",  CLIENT_SECRET);
  body.append("client_version", String(CLIENT_VER));
  body.append("grant_type",     "client_credentials");

  const { data } = await axios.post(
    "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
    body,
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
  );

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
      console.log("📩 PhonePe callback:", JSON.stringify(req.body));

      let txnId, state;

      if (req.body.response) {
        // Old-style base64
        const decoded = Buffer.from(req.body.response, "base64").toString("utf-8");
        const parsed  = JSON.parse(decoded);
        txnId = parsed?.data?.merchantTransactionId || parsed?.data?.merchantOrderId;
        state = parsed?.data?.state;
      } else {
        // New-style direct JSON
        txnId = req.body.merchantOrderId || req.body.merchantTransactionId;
        state = req.body.state
          || (req.body.code === "PAYMENT_SUCCESS" ? "COMPLETED" : "FAILED");
      }

      console.log(`📋 Callback → txn=${txnId}, state=${state}`);

      const txn = await phonePeTransactionModel.findById(txnId);
      if (txn) {
        txn.status = state;
        if (state === "COMPLETED" && txn.config) {
          try {
            await axios(JSON.parse(txn.config));
            console.log("✅ Wallet credited via config callback");
          } catch (e) {
            console.error("❌ Config callback error:", e.message);
          }
        }
        await txn.save();
        console.log(`✅ Transaction ${txnId} saved as ${state}`);
      } else {
        console.warn(`⚠️ Transaction not found: ${txnId}`);
      }

      return res.status(200).send("OK"); // Always 200 to PhonePe
    } catch (err) {
      console.error("❌ Callback error:", err.message);
      return res.status(200).send("OK");
    }
  }

  // ── Check Payment ─────────────────────────────────────────────────────────────
  async checkPayment(req, res) {
    try {
      const { id, userId } = req.params;
      const txn = await phonePeTransactionModel.findOne({ _id: id, userId });
      if (!txn) return res.status(400).json({ error: "Payment not found" });
      return res.status(200).json({ success: txn });
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
}

module.exports = new PhonePeController();