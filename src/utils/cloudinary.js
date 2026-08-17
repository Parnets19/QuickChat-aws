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

    // Detect if file is a video based on extension
    const fileName = getFileName(file);
    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.3gp', '.webm', '.flv', '.wmv'];
    const isVideo = videoExtensions.some(ext => fileName.toLowerCase().endsWith(ext));

    // Configure upload options based on file type
    const uploadOptions = {
      folder,
      resource_type: 'auto',
    };

    // Add video-specific options if it's a video file
    if (isVideo) {
      uploadOptions.resource_type = 'video';
      uploadOptions.chunk_size = 6000000; // 6MB chunks for better upload reliability
      uploadOptions.timeout = 120000; // 2 minutes timeout for videos
      uploadOptions.eager = [
        { streaming_profile: 'hd', format: 'mp4' },
        { streaming_profile: 'sd', format: 'mp4' }
      ];
      uploadOptions.eager_async = true; // Process video transformations asynchronously
      logger.info(`Uploading video file: ${fileName} to folder: ${folder}`);
    } else {
      logger.info(`Uploading image file: ${fileName} to folder: ${folder}`);
    }

    const result = await cloudinary.uploader.upload(file, uploadOptions);

    logger.info(`Successfully uploaded to Cloudinary: ${result.secure_url}`);

    return {
      url: result.secure_url,
      publicId: result.public_id,
      resourceType: result.resource_type,
      format: result.format,
      duration: result.duration || null, // Video duration in seconds
    };
  } catch (error) {
    logger.error('Cloudinary upload error:', {
      message: error.message,
      stack: error.stack,
      code: error.error?.code || error.code,
      http_code: error.error?.http_code || error.http_code,
    });
    
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
    
    logger.warn(`Cloudinary upload failed, using fallback local URL: ${baseUrl}/${cleanPath}`);
    
    return {
      url: `${baseUrl}/${cleanPath}`,
      publicId: fileName,
      fallback: true, // Flag to indicate this is a fallback URL
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

