const express = require('express');
const {
  uploadProfilePhoto,
  uploadAadhar,
  uploadPortfolio,
} = require('../controllers/user.controller');
const { uploadImage, upload } = require('../middlewares/upload');

const router = express.Router();

// Public upload routes for registration
router.post('/profile-photo', uploadImage.single('photo'), uploadProfilePhoto);
router.post(
  '/aadhar',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 }, // Optional
  ]),
  uploadAadhar
);
router.post('/portfolio', uploadImage.single('photo'), uploadPortfolio);

// Test route
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Upload routes working' });
});

module.exports = router;