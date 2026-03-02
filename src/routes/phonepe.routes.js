const phonePeController=require("../controllers/phonepe.controller");
const express=require('express');
const router=express.Router();

router.post("/addpaymentphonepay",phonePeController.addPaymentPhone);
router.post("/makepayment",phonePeController.makepayment);
router.put("/updateStatuspayment/:id",phonePeController.updateStatuspayment);
router.get("/getallpayment",phonePeController.getallpayment);
router.post("/payment-callback",phonePeController.paymentcallback);
router.get("/checkPayment/:id/:userId",phonePeController.checkPayment);
module.exports=router;