// const phonePeTransactionModel = require("../models/phonepe.model");
// const axios = require("axios");
// const crypto = require('crypto');

// // PhonePe New API Configuration (OAuth2 based)
// const PHONEPE_ENV = process.env.PHONEPE_ENV || "test";
// const CLIENT_ID = process.env.PHONEPE_CLIENT_ID || "M2352B2GR2M1V_2603031102";
// const CLIENT_SECRET_BASE64 = process.env.PHONEPE_CLIENT_SECRET || "MjA2NmQ0ZTMtNGZiNC00YjEyLTllZTAtY2JkODE1YWI4YWQ4";
// const CLIENT_SECRET = Buffer.from(CLIENT_SECRET_BASE64, 'base64').toString('utf-8');
// const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "M2352B2GR2M1V";
// const CALLBACK_URL = process.env.PHONEPE_CALLBACK_URL || "http://localhost:3000";

// // New PhonePe API endpoints
// const PHONEPE_API_BASE = PHONEPE_ENV === "production"
//   ? "https://api.phonepe.com"
//   : "https://api-preprod.phonepe.com";

// console.log("🔧 PhonePe New API Configuration:", {
//   environment: PHONEPE_ENV,
//   clientId: CLIENT_ID,
//   merchantId: MERCHANT_ID,
//   apiBase: PHONEPE_API_BASE
// });

// class PhonePeController{
//   async addPaymentPhone(req, res) {
//     try {
//       let { userId, username, Mobile, orderId, amount, transactionid, config } = req.body;
      
//       // Create transaction record
//       let data = await phonePeTransactionModel.create({
//         userId,
//         username,
//         Mobile,
//         orderId,
//         amount,
//         config
//       });
      
//       if (!data) return res.status(400).json({ error: "Something went wrong" });

//       console.log("💳 Creating PhonePe payment:", {
//         transactionId: data._id,
//         amount,
//         userId
//       });

//       // Generate signature using Client Secret
//       function generateSignature(payload) {
//         const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64");
//         const stringToHash = encodedPayload + "/pg/v1/pay" + CLIENT_SECRET;
//         const hash = crypto.createHash("sha256").update(stringToHash).digest("hex");
//         return hash + "###1";
//       }
      
//       // Create payment request
//       const paymentPayload = {
//         merchantId: MERCHANT_ID,
//         merchantTransactionId: data._id.toString(),
//         merchantUserId: userId,
//         amount: amount * 100, // Convert to paise
//         redirectUrl: `${CALLBACK_URL}/provider/earnings?transactionId=${data._id}&userID=${userId}`,
//         redirectMode: "POST",
//         callbackUrl: `${process.env.BACKEND_URL || 'http://localhost:5001'}/api/phonepe/payment-callback`,
//         mobileNumber: Mobile,
//         paymentInstrument: {
//           type: "PAY_PAGE"
//         }
//       };

//       const base64Payload = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
//       const signature = generateSignature(paymentPayload);

//       console.log("📤 Sending payment request to PhonePe...");

//       const response = await axios.post(
//         `${PHONEPE_API_BASE}/apis/hermes/pg/v1/pay`,
//         {
//           request: base64Payload
//         },
//         {
//           headers: {
//             'Content-Type': 'application/json',
//             'X-VERIFY': signature
//           }
//         }
//       );

//       console.log("✅ PhonePe payment response:", response.data);

//       if (response.data.success && response.data.data?.instrumentResponse?.redirectInfo) {
//         return res.status(200).json({
//           id: data._id,
//           url: response.data.data.instrumentResponse.redirectInfo
//         });
//       } else {
//         console.error("❌ Invalid PhonePe response:", response.data);
//         return res.status(400).json({ 
//           error: "Failed to initiate payment",
//           details: response.data
//         });
//       }
//     } catch (error) {
//       console.error("❌ PhonePe payment error:", error.response?.data || error.message);
//       return res.status(500).json({ 
//         error: error.response?.data?.message || error.message || "Payment initiation failed"
//       });
//     }
//   }
  
//   async updateStatuspayment(req,res){
//       try{
//           let id=req.params.id;
//           let data=await phonePeTransactionModel.findById(id);
//           if(!data) return res.status(400).json({error:"Data not found"});
//           data.status="Completed";
//           data.save();
//           return res.status(200).json({success:"Successfully Completed"});
//       }catch(error){
//           console.log(error);
//       }
//   }
  
//   async checkPayment(req,res){
//       try{
       
//            let id=req.params.id;
//            let userId=req.params.userId
//             let check= await phonePeTransactionModel.findOne({_id:id,userId:userId});
//             if(!check) return res.status(400).json({error:"Payment is not completed"});
//             return res.status(200).json({success:check})

//       }catch(error){
//           console.log(error)
//           return res.status(400).json({error:error.message})
//       }
//   }
  
// async paymentcallback(req, res) {
//      const { response } = req.body;

// const decodedStr = Buffer.from(response, 'base64').toString('utf-8');

// // Parse JSON
// const responseJson = JSON.parse(decodedStr);
// console.log(responseJson?.data);
//     const { merchantTransactionId, state } = responseJson?.data;

//     // Log the callback data for debugging
//     console.log(`Callback received: Transaction ${merchantTransactionId}, Status: ${state}`);
//  let data=await phonePeTransactionModel.findById(merchantTransactionId);
//  if(data){
//      data.status=state;
//        if (state === 'COMPLETED') {
//            await axios(JSON.parse(data.config))
//        }
//     await data.save()
//  }
//     // Update transaction status in your database
//     if (state === 'COMPLETED') {
        
        
//         // Mark the transaction as successful
//         // Update relevant database records
//         console.log(`Transaction ${merchantTransactionId} was successful.`);
//     } else {
//         // Handle failure or pending status
//         console.log(`Transaction ${merchantTransactionId} failed or is pending.`);
//     }

//     // Send a response back to the payment gateway
//     res.status(200).send('Callback processed');
// }

  
  
//   async getallpayment(req,res){
//       try{
//           let data=await phonePeTransactionModel.find({}).sort({_id:-1});
//           return res.status(200).json({success:data});
//       }catch(error){
//           console.log(error)
//       }
//   }
  
// async makepayment(req, res) {
//     let {
//       amount,
//       merchantTransactionId,
//       merchantUserId,
//       redirectUrl,
//       callbackUrl,
//       mobileNumber,
//     } = req.body;

//     function generateSignature(payload, saltKey, saltIndex) {
//       const encodedPayload = Buffer.from(payload).toString("base64");
//       const concatenatedString = encodedPayload + "/pg/v1/pay" + saltKey;
//       const hashedValue = crypto
//         .createHash("sha256")
//         .update(concatenatedString)
//         .digest("hex");

//       const signature = hashedValue + "###" + saltIndex;
//       return signature;
//     }

//     const paymentDetails = {
//       merchantId: MERCHANT_ID,
//       merchantTransactionId: merchantTransactionId,
//       merchantUserId: merchantUserId,
//       amount: amount,
//       redirectUrl: CALLBACK_URL,
//       redirectMode: "POST",
//       callbackUrl: callbackUrl,
//       mobileNumber: mobileNumber,
//       paymentInstrument: {
//         type: "PAY_PAGE",
//       },
//     };

//     const payload = JSON.stringify(paymentDetails);
//     let objJsonB64 = Buffer.from(payload).toString("base64");
//     const saltKey = SECRET_KEY; //test key
//     const saltIndex = 1;
//     const signature = generateSignature(payload, saltKey, saltIndex);

//     try {
//       const response = await axios.post(
//         "https://api-preprod.phonepe.com/apis/pg-sandbox/pg/v1/pay",
//         {
//           request: objJsonB64,
//         },
//         {
//           headers: {
//             "X-VERIFY": signature,
//           },
//         }
//       );

//       //   console.log(
//       //     "Payment Response:",
//       //     response.data,
//       //     response.data?.data.instrumentResponse?.redirectInfo?.url
//       //   );
//       return res.status(200).json({
//         url: response.data?.data.instrumentResponse?.redirectInfo,
//       });
//     } catch (error) {
//       console.error("Payment Error:", error);
//     }
//   }
// }

// module.exports = new PhonePeController();

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

  // Auth uses GET-style query params sent as POST with x-www-form-urlencoded
  const { data } = await axios.post(AUTH_URL, null, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
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