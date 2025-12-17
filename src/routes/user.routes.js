const express = require('express');
const {
  getUserProfile,
  updateProfile,
  uploadProfilePhoto,
  uploadAadhar,
  becomeProvider,
  updateProviderSettings,
  toggleProfileVisibility,
  getDashboard,
  updateBankDetails,
  searchProviders,
  updateConsultationStatus,
} = require('../controllers/user.controller');
const { protect, isServiceProvider } = require('../middlewares/auth');
const { uploadImage, upload } = require('../middlewares/upload');

const router = express.Router();

// Public routes
router.get('/profile/:id', getUserProfile);
router.get('/search', searchProviders);

// Private routes
router.use(protect);
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
router.post('/profile-photo', uploadImage.single('photo'), uploadProfilePhoto);
router.post(
  '/aadhar',
  upload.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
  ]),
  uploadAadhar
);
router.post('/become-provider', becomeProvider);
router.put('/provider-settings', isServiceProvider, updateProviderSettings);
router.put('/toggle-visibility', toggleProfileVisibility);
router.put('/bank-details', updateBankDetails);
router.put('/consultation-status', isServiceProvider, updateConsultationStatus);

module.exports = router;

