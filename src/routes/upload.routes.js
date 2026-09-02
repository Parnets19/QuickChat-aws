const express = require('express');
const {
  uploadProfilePhoto,
  uploadAadhar,
  uploadProfessionalCertificate,
  uploadPortfolio,
} = require('../controllers/user.controller');
const { uploadImage, uploadMedia, upload } = require('../middlewares/upload');

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
// Optional professional certificate (doctors, lawyers, ...). Uses `upload` rather
// than `uploadImage` so PDFs and DOC/DOCX are accepted alongside images.
router.post(
  '/professional-certificate',
  upload.single('certificate'),
  uploadProfessionalCertificate
);
router.post('/portfolio', uploadMedia.single('photo'), uploadPortfolio);

// Test route
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Upload routes working' });
});

module.exports = router;