const express = require('express');
const {
  getUserProfile,
  updateProfile,
  uploadProfilePhoto,
  uploadAadhar,
  uploadPortfolio,
  becomeProvider,
  updateProviderSettings,
  toggleProfileVisibility,
  getDashboard,
  updateBankDetails,
  searchProviders,
  getUserDocuments,
  updateDocument,
  deleteDocument,
  updateConsultationStatus,
  getVerificationStatus,
} = require('../controllers/user.controller');
const { protect, isServiceProvider } = require('../middlewares/auth');
const { uploadImage, upload } = require('../middlewares/upload');

const router = express.Router();

// Public routes
router.get('/profile/:id', getUserProfile);
router.get('/search', searchProviders);

// Test route to verify public access
router.get('/test-public', (req, res) => {
  res.json({ success: true, message: 'Public route working' });
});

// File upload routes (public for registration)
router.post('/upload-profile-photo', uploadImage.single('photo'), uploadProfilePhoto);
router.post(
  '/upload-aadhar',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 }, // Optional
  ]),
  uploadAadhar
);

// Private routes
router.use(protect);

// Authenticated file upload routes
router.post('/profile-photo', uploadImage.single('photo'), uploadProfilePhoto);
router.post('/portfolio', uploadImage.single('photo'), uploadPortfolio);
router.post(
  '/aadhar-upload',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 }, // Optional
  ]),
  uploadAadhar
);
router.get('/dashboard', getDashboard);

// Test endpoint to check current user
router.get('/test-auth', (req, res) => {
  res.json({
    success: true,
    user: req.user,
    message: 'Current authenticated user',
    consultationStatus: req.user?.consultationStatus,
    isServiceProvider: req.user?.isServiceProvider
  });
});
router.put('/profile', updateProfile);
router.post('/become-provider', becomeProvider);
router.put('/provider-settings', isServiceProvider, updateProviderSettings);
router.put('/toggle-visibility', toggleProfileVisibility);
router.put('/bank-details', updateBankDetails);

// Document management routes
router.get('/documents', getUserDocuments);
router.put('/documents/:documentId', uploadImage.single('file'), updateDocument);
router.delete('/documents/:documentId', deleteDocument);

router.put('/consultation-status', isServiceProvider, updateConsultationStatus);

// Provider verification status
router.get('/verification-status', isServiceProvider, getVerificationStatus);

module.exports = router;

