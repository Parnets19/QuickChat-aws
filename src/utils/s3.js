const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { logger } = require('./logger');

const getFileName = (filePath) => {
  return filePath.split(/[/\\]/).pop();
};

const isS3Configured = () => {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    process.env.AWS_REGION &&
    process.env.S3_BUCKET_NAME
  );
};

let s3Client = null;
const getS3Client = () => {
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
};

const uploadToS3 = async (file, folder = 'skillhub') => {
  try {
    if (!isS3Configured()) {
      logger.warn('S3 not configured, falling back');
      const fileName = getFileName(file);
      const baseUrl = process.env.BASE_URL || 'https://quickchatindia.com';

      let cleanPath;
      if (file.startsWith('uploads/')) {
        cleanPath = file;
      } else if (file.includes('uploads/')) {
        cleanPath = file.substring(file.indexOf('uploads/'));
      } else {
        cleanPath = `uploads/${fileName}`;
      }
      cleanPath = cleanPath.replace(/\\/g, '/');

      return {
        url: `${baseUrl}/${cleanPath}`,
        publicId: fileName,
        key: `${folder}/${fileName}`,
        fallback: true,
      };
    }

    const fileName = getFileName(file);
    const fileStream = fs.createReadStream(file);
    const ext = path.extname(fileName).toLowerCase().slice(1);

    let contentType = 'application/octet-stream';
    if (['jpg', 'jpeg'].includes(ext)) contentType = 'image/jpeg';
    else if (ext === 'png') contentType = 'image/png';
    else if (ext === 'gif') contentType = 'image/gif';
    else if (ext === 'webp') contentType = 'image/webp';
    else if (ext === 'pdf') contentType = 'application/pdf';
    else if (ext === 'doc') contentType = 'application/msword';
    else if (ext === 'docx') contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    else if (ext === 'mp4') contentType = 'video/mp4';
    else if (ext === 'mov') contentType = 'video/quicktime';
    else if (ext === 'avi') contentType = 'video/x-msvideo';
    else if (ext === 'mkv') contentType = 'video/x-matroska';
    else if (ext === '3gp') contentType = 'video/3gpp';
    else if (ext === 'webm') contentType = 'video/webm';

    const videoExtensions = ['.mp4', '.mov', '.avi', '.mkv', '.3gp', '.webm', '.flv', '.wmv'];
    const isVideo = videoExtensions.some((vExt) => fileName.toLowerCase().endsWith(vExt));

    const key = `${folder}/${Date.now()}-${Math.round(Math.random() * 1e9)}-${fileName}`;
    const bucket = process.env.S3_BUCKET_NAME;

    logger.info(`Uploading ${isVideo ? 'video' : 'file'} to S3: ${key}`);

    const parallelUploads3 = new Upload({
      client: getS3Client(),
      params: {
        Bucket: bucket,
        Key: key,
        Body: fileStream,
        ContentType: contentType,
        ACL: process.env.S3_FILE_ACL || 'public-read',
      },
      queueSize: 4,
      partSize: 1024 * 1024 * 5,
      leavePartsOnError: false,
    });

    const result = await parallelUploads3.done();

    let url;
    if (process.env.S3_CDN_URL) {
      url = `${process.env.S3_CDN_URL}/${key}`;
    } else if (process.env.S3_USE_PATH_STYLE === 'true') {
      const region = process.env.AWS_REGION;
      url = `https://s3.${region}.amazonaws.com/${bucket}/${key}`;
    } else {
      url = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    }

    logger.info(`Successfully uploaded to S3: ${url}`);

    return {
      url,
      publicId: key,
      key,
      resourceType: isVideo ? 'video' : (contentType.startsWith('image/') ? 'image' : 'raw'),
      format: ext,
      bucket,
      location: result.Location,
    };
  } catch (error) {
    logger.error('S3 upload error:', {
      message: error.message,
      stack: error.stack,
      code: error.Code || error.code,
    });

    const fileName = getFileName(file);
    const baseUrl = process.env.BASE_URL || 'https://quickchatindia.com';

    let cleanPath;
    if (file.startsWith('uploads/')) {
      cleanPath = file;
    } else if (file.includes('uploads/')) {
      cleanPath = file.substring(file.indexOf('uploads/'));
    } else {
      cleanPath = `uploads/${fileName}`;
    }
    cleanPath = cleanPath.replace(/\\/g, '/');

    logger.warn(`S3 upload failed, using fallback local URL: ${baseUrl}/${cleanPath}`);

    return {
      url: `${baseUrl}/${cleanPath}`,
      publicId: fileName,
      fallback: true,
    };
  }
};

const deleteFromS3 = async (publicId) => {
  try {
    if (!isS3Configured() || !publicId || publicId.startsWith('http')) {
      return false;
    }

    const params = {
      Bucket: process.env.S3_BUCKET_NAME,
      Key: publicId,
    };

    await getS3Client().send(new DeleteObjectCommand(params));
    logger.info(`Successfully deleted from S3: ${publicId}`);
    return true;
  } catch (error) {
    logger.error('S3 delete error:', error);
    return false;
  }
};

const getS3PresignedUrl = async (key, expiresIn = 3600) => {
  try {
    if (!isS3Configured()) {
      return null;
    }
    const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
    const command = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
    });
    return await getSignedUrl(getS3Client(), command, { expiresIn });
  } catch (error) {
    logger.error('S3 presigned URL error:', error);
    return null;
  }
};

module.exports = {
  uploadToS3,
  deleteFromS3,
  getS3PresignedUrl,
  isS3Configured,
  getS3Client,
};
