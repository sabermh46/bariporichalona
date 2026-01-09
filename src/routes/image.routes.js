// routes/imageRoutes.js
const express = require('express');
const router = express.Router();
const imageController = require('../controllers/image.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Serve images through proxy (with authentication)
router.get('/:filePath', authMiddleware, imageController.serveImage);

// Get signed URL (optional)
router.get('/signed-url/:filePath', authMiddleware, imageController.getSignedUrl);

module.exports = router;