const mongoose = require("mongoose");

const phonepaytransaction = new mongoose.Schema(
    {
       userId: {
        type: String,
       },
       userType: {
        type: String,
        default: "User", // "User" or "Guest"
       },
       username:{
           type:String
       },
       Mobile: {
        type: String,
      },
      orderId:{
          type:String
      },
      amount:{
          type:Number,
          default:0
      },
      transactionid: {
        type: String,
      },
      transactionStatus:{
        type:String,
        default:"CR"
      },
      config:{
        type:String  
      },
      status: {type: String, 
        default: "InProgress", 
      },     
    },
    { timestamps: true }
);

const phonePeTransactionModel = mongoose.model("phonepaytransaction", phonepaytransaction);
module.exports = phonePeTransactionModel;