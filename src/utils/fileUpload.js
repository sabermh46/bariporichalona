// utils/fileUpload.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { validateMagicBytes } = require('./validateMagicBytes');

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Create a temporary folder for uploads
        const tempDir = path.join(uploadsDir, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|pdf/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);

    if (extname && mimetype) {
        return cb(null, true);
    }
    cb(new Error('Only image files (jpeg, jpg, png, gif) and PDFs are allowed'));
};

// Initialize upload
const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

const uploadMultipleMiddleware = (fields) => {
    return upload.fields(fields);
};
const uploadSingleMiddleware = (fieldName) => {
    return upload.single(fieldName);
}

// Move file from temp to permanent location
const moveToPermanentLocation = (tempFilePath, destinationFolder, filename) => {
    const destDir = path.join(uploadsDir, destinationFolder);
    
    // Create destination directory if it doesn't exist
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }
    
    const destPath = path.join(destDir, filename);
    
    // Move file
    fs.renameSync(tempFilePath, destPath);
    
    return path.relative(uploadsDir, destPath);
};

// Clean up temp files
const cleanupTempFiles = (filePaths) => {
    filePaths.forEach(filePath => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    });
};

// Middleware: validate magic bytes after multer saves file(s) to temp
const validateUploadMiddleware = (req, res, next) => {
  const files = [];
  if (req.file) files.push(req.file);
  if (req.files) {
    if (Array.isArray(req.files)) {
      files.push(...req.files);
    } else {
      Object.values(req.files).forEach(arr => files.push(...arr));
    }
  }

  for (const file of files) {
    if (!validateMagicBytes(file.path, file.originalname)) {
      fs.unlinkSync(file.path);
      return res.status(422).json({
        success: false,
        error: 'File content does not match its declared type. Upload rejected.'
      });
    }
  }

  next();
};

// Get file URL
const getFileUrl = (filePath) => {
  if (!filePath) return null;
  return `/uploads/${filePath.replace(/\\/g, '/')}`;
};

module.exports = {
  uploadMultipleMiddleware,
  uploadSingleMiddleware,
  validateUploadMiddleware,
  moveToPermanentLocation,
  cleanupTempFiles,
  getFileUrl,
  uploadsDir
};