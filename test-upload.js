const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  console.log('✅ Created uploads directory');
} else {
  console.log('✅ Uploads directory exists');
}

// Configure multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    console.log('📁 Setting destination to uploads/');
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const filename = file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname);
    console.log('📝 Generated filename:', filename);
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
  },
  fileFilter: (req, file, cb) => {
    console.log('🔍 File filter - mimetype:', file.mimetype);
    console.log('🔍 File filter - originalname:', file.originalname);
    
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
      console.log('✅ File type allowed');
      return cb(null, true);
    } else {
      console.log('❌ File type not allowed');
      cb(new Error('Invalid file type. Only images are allowed.'));
    }
  }
});

// Test route
app.post('/test-upload', upload.single('photo'), (req, res) => {
  try {
    console.log('📤 Upload request received');
    console.log('📁 Request file:', req.file);
    console.log('📝 Request body:', req.body);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const fileUrl = `http://localhost:5001/uploads/${req.file.filename}`;
    
    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        filename: req.file.filename,
        originalname: req.file.originalname,
        path: req.file.path,
        url: fileUrl,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('❌ Upload error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Serve static files
app.use('/uploads', express.static('uploads'));

// Error handler
app.use((error, req, res, next) => {
  console.error('❌ Global error handler:', error);
  res.status(500).json({
    success: false,
    error: error.message || 'Internal server error'
  });
});

const PORT = 5002;
app.listen(PORT, () => {
  console.log(`🚀 Test upload server running on port ${PORT}`);
  console.log(`📁 Uploads directory: ${uploadsDir}`);
  console.log(`🔗 Test endpoint: http://localhost:${PORT}/test-upload`);
});