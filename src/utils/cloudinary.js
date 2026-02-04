const cloudinary = require('cloudinary').v2;
const { logger } = require('./logger');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadToCloudinary = async (file, folder = 'skillhub') => {
  try {
    // Helper function to extract filename from path (handles both / and \ separators)
    const getFileName = (filePath) => {
      return filePath.split(/[/\\]/).pop();
    };

    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      logger.warn('Cloudinary not configured, using local file path');
      
      // Return a local file URL for development
      const fileName = getFileName(file);
      const baseUrl = process.env.BASE_URL || 'https://quickchatindia.com';
      
      // Clean the file path to avoid double 'uploads/' in URL
      let cleanPath;
      if (file.startsWith('uploads/')) {
        // File path already includes uploads/, use as is
        cleanPath = file;
      } else if (file.includes('uploads/')) {
        // File path has uploads/ somewhere in it, extract from there
        cleanPath = file.substring(file.indexOf('uploads/'));
      } else {
        // File path doesn't include uploads/, add it
        cleanPath = `uploads/${fileName}`;
      }
      
      // Normalize path separators for URLs (use forward slashes)
      cleanPath = cleanPath.replace(/\\/g, '/');
      
      return {
        url: `${baseUrl}/${cleanPath}`,
        publicId: fileName,
      };
    }

    const result = await cloudinary.uploader.upload(file, {
      folder,
      resource_type: 'auto',
    });

    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  } catch (error) {
    logger.error('Cloudinary upload error:', error);
    // Fallback to local file path
    const getFileName = (filePath) => {
      return filePath.split(/[/\\]/).pop();
    };
    const fileName = getFileName(file);
    const baseUrl = process.env.BASE_URL || 'https://quickchatindia.com';
    
    // Clean the file path to avoid double 'uploads/' in URL
    let cleanPath;
    if (file.startsWith('uploads/')) {
      // File path already includes uploads/, use as is
      cleanPath = file;
    } else if (file.includes('uploads/')) {
      // File path has uploads/ somewhere in it, extract from there
      cleanPath = file.substring(file.indexOf('uploads/'));
    } else {
      // File path doesn't include uploads/, add it
      cleanPath = `uploads/${fileName}`;
    }
    
    // Normalize path separators for URLs (use forward slashes)
    cleanPath = cleanPath.replace(/\\/g, '/');
    
    return {
      url: `${baseUrl}/${cleanPath}`,
      publicId: fileName,
    };
  }
};

const deleteFromCloudinary = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
    return true;
  } catch (error) {
    logger.error('Cloudinary delete error:', error);
    return false;
  }
};

module.exports = {
  cloudinary,
  uploadToCloudinary,
  deleteFromCloudinary,
};

