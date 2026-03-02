const phonePeTransactionModel = require("../models/phonepe.model");
const MERCHANT_ID = process.env.PHONEPE_MERCHANT_ID || "M2352B2GR2M1V";
const SECRET_KEY = process.env.PHONEPE_SECRET_KEY || "a0755144-e7c6-4e0d-a71f-42681b4faf0b";
const CALLBACK_URL = process.env.PHONEPE_CALLBACK_URL || "http://localhost:3000";
const axios = require("axios");
const crypto = require('crypto');

class PhonePeController{
      async addPaymentPhone(req, res) {
    try {
      let { userId, username, Mobile, orderId, amount, transactionid,config } =
        req.body;
      let data = await phonePeTransactionModel.create({
        userId,
        username,
        Mobile,
        orderId,
        amount,
        config
      });
      if (!data) return res.status(400).json({ error: "Something went worng" });

      function generateSignature(payload, saltKey, saltIndex) {
        const encodedPayload = Buffer.from(payload).toString("base64");
        const concatenatedString = encodedPayload + "/pg/v1/pay" + saltKey;
        const hashedValue = crypto
          .createHash("sha256")
          .update(concatenatedString)
          .digest("hex");

        const signature = hashedValue + "###" + saltIndex;
        return signature;
      }

      const paymentDetails = {
        merchantId: MERCHANT_ID,
        merchantTransactionId: data._id,
        merchantUserId: userId,
        amount: amount*100,
        redirectUrl:  `${CALLBACK_URL}/provider/earnings?transactionId=${data._id}&userID=${userId}`,
        redirectMode: "POST",
        callbackUrl: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/phonepe/payment-callback`,
        mobileNumber: Mobile,
        paymentInstrument: {
          type: "PAY_PAGE",
        },
      };

      const payload = JSON.stringify(paymentDetails);
      let objJsonB64 = Buffer.from(payload).toString("base64");
      const saltKey = SECRET_KEY; //test key
      const saltIndex = 1;
      const signature = generateSignature(payload, saltKey, saltIndex);

      const response = await axios.post(
        "https://api.phonepe.com/apis/hermes/pg/v1/pay",
        {
          request: objJsonB64,
        },
        {
          headers: {
            "X-VERIFY": signature,
          },
        }
      );

         console.log(
           "Payment Response:",
           response.data,
           response.data?.data.instrumentResponse?.redirectInfo?.url
         );
      return res.status(200).json({id:data._id,
        url: response.data?.data.instrumentResponse?.redirectInfo,
      });
    } catch (error) {
      console.log(error);
    }
  }
  
  async updateStatuspayment(req,res){
      try{
          let id=req.params.id;
          let data=await phonePeTransactionModel.findById(id);
          if(!data) return res.status(400).json({error:"Data not found"});
          data.status="Completed";
          data.save();
          return res.status(200).json({success:"Successfully Completed"});
      }catch(error){
          console.log(error);
      }
  }
  
  async checkPayment(req,res){
      try{
       
           let id=req.params.id;
           let userId=req.params.userId
            let check= await phonePeTransactionModel.findOne({_id:id,userId:userId});
            if(!check) return res.status(400).json({error:"Payment is not completed"});
            return res.status(200).json({success:check})

      }catch(error){
          console.log(error)
          return res.status(400).json({error:error.message})
      }
  }
  
async paymentcallback(req, res) {
     const { response } = req.body;

const decodedStr = Buffer.from(response, 'base64').toString('utf-8');

// Parse JSON
const responseJson = JSON.parse(decodedStr);
console.log(responseJson?.data);
    const { merchantTransactionId, state } = responseJson?.data;

    // Log the callback data for debugging
    console.log(`Callback received: Transaction ${merchantTransactionId}, Status: ${state}`);
 let data=await phonePeTransactionModel.findById(merchantTransactionId);
 if(data){
     data.status=state;
       if (state === 'COMPLETED') {
           await axios(JSON.parse(data.config))
       }
    await data.save()
 }
    // Update transaction status in your database
    if (state === 'COMPLETED') {
        
        
        // Mark the transaction as successful
        // Update relevant database records
        console.log(`Transaction ${merchantTransactionId} was successful.`);
    } else {
        // Handle failure or pending status
        console.log(`Transaction ${merchantTransactionId} failed or is pending.`);
    }

    // Send a response back to the payment gateway
    res.status(200).send('Callback processed');
}

  
  
  async getallpayment(req,res){
      try{
          let data=await phonePeTransactionModel.find({}).sort({_id:-1});
          return res.status(200).json({success:data});
      }catch(error){
          console.log(error)
      }
  }
  
async makepayment(req, res) {
    let {
      amount,
      merchantTransactionId,
      merchantUserId,
      redirectUrl,
      callbackUrl,
      mobileNumber,
    } = req.body;

    function generateSignature(payload, saltKey, saltIndex) {
      const encodedPayload = Buffer.from(payload).toString("base64");
      const concatenatedString = encodedPayload + "/pg/v1/pay" + saltKey;
      const hashedValue = crypto
        .createHash("sha256")
        .update(concatenatedString)
        .digest("hex");

      const signature = hashedValue + "###" + saltIndex;
      return signature;
    }

    const paymentDetails = {
      merchantId: MERCHANT_ID,
      merchantTransactionId: merchantTransactionId,
      merchantUserId: merchantUserId,
      amount: amount,
      redirectUrl: CALLBACK_URL,
      redirectMode: "POST",
      callbackUrl: callbackUrl,
      mobileNumber: mobileNumber,
      paymentInstrument: {
        type: "PAY_PAGE",
      },
    };

    const payload = JSON.stringify(paymentDetails);
    let objJsonB64 = Buffer.from(payload).toString("base64");
    const saltKey = SECRET_KEY; //test key
    const saltIndex = 1;
    const signature = generateSignature(payload, saltKey, saltIndex);

    try {
      const response = await axios.post(
        "https://api.phonepe.com/apis/hermes/pg/v1/pay",
        {
          request: objJsonB64,
        },
        {
          headers: {
            "X-VERIFY": signature,
          },
        }
      );

      //   console.log(
      //     "Payment Response:",
      //     response.data,
      //     response.data?.data.instrumentResponse?.redirectInfo?.url
      //   );
      return res.status(200).json({
        url: response.data?.data.instrumentResponse?.redirectInfo,
      });
    } catch (error) {
      console.error("Payment Error:", error);
    }
  }
}

module.exports = new PhonePeController();