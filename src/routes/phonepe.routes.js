const phonePeController=require("../controllers/phonepe.controller");
const express=require('express');
const router=express.Router();
const { protect, adminOnly } = require('../middlewares/auth');

router.post("/addpaymentphonepay",phonePeController.addPaymentPhone);
router.post("/makepayment",phonePeController.makepayment);
router.put("/updateStatuspayment/:id",phonePeController.updateStatuspayment);

// SECURITY: this lists EVERY PhonePe payment (payer names, mobile numbers,
// amounts, order/transaction ids) and had no auth middleware at all, so it was
// readable by anyone who knew the URL. The admin page that consumes it already
// sends an Authorization header, so requiring admin auth here does not change the
// client at all — it just stops everyone else from reading it.
router.get("/getallpayment", protect, adminOnly, phonePeController.getallpayment);
// CSV export of the same set (all pages, not just the visible one)
router.get("/exportallpayment", protect, adminOnly, phonePeController.exportallpayment);
router.post("/payment-callback",phonePeController.paymentcallback);
router.post("/test-callback",phonePeController.testCallback); // Test endpoint
router.get("/checkPayment/:id/:userId",phonePeController.checkPayment);
module.exports=router;