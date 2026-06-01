// middleware/multipartHandler.js
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { validateMagicBytes } = require('../utils/validateMagicBytes');

// Create a function that returns different middleware based on content-type
const multipartHandler = () => {
  return (req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    
    // If it's multipart/form-data, use multer
    if (contentType.includes('multipart/form-data')) {
      const storage = multer.diskStorage({
        destination: (req, file, cb) => {
          const tempDir = path.join(process.cwd(), 'uploads', 'temp');
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

      const fileFilter = (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|pdf/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (extname && mimetype) {
          return cb(null, true);
        }
        cb(new Error('Only image files (jpeg, jpg, png, gif) and PDFs are allowed'));
      };

      const upload = multer({
        storage,
        fileFilter,
        limits: { fileSize: 5 * 1024 * 1024 }
      }).fields([
        { name: 'nidFrontImage', maxCount: 1 },
        { name: 'nidBackImage', maxCount: 1 }
      ]);

      upload(req, res, (err) => {
        if (err) {
          console.error('Multer error:', err);
          return res.status(400).json({
            success: false,
            error: err.message
          });
        }

        // Validate actual file content against declared extension
        const allFiles = Object.values(req.files || {}).flat();
        for (const file of allFiles) {
          if (!validateMagicBytes(file.path, file.originalname)) {
            fs.unlinkSync(file.path);
            return res.status(422).json({
              success: false,
              error: 'File content does not match its declared type. Upload rejected.'
            });
          }
        }

        next();
      });
    } else {
      // For non-multipart requests, let body-parser handle it
      next();
    }
  };
};

module.exports = multipartHandler;