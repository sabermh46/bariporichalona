// controllers/imageController.js
const db = require('../config/knex');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const { hasPermission } = require('../services/permission.service');
const CaretakerPermissionService = require('../services/CaretakerPermission.service');

class ImageController {
  // Serve protected images
  async serveImage(req, res) {
    try {
      const { filePath } = req.params;
      
      // Decode the file path
      const decodedPath = decodeURIComponent(filePath);
      
      // Construct full path
      const fullPath = path.join(process.cwd(), 'uploads', decodedPath);
      
      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({
          success: false,
          error: 'Image not found'
        });
      }
      
      // Check user permissions (simplified version of your fileAccessMiddleware)
      const userId = req.user?.id;
      const userRole = req.user?.role?.slug;
      
      // Extract category and identifier from path
      const parts = decodedPath.split('/');
      const category = parts[0];
      const identifier = parts[1];
      
      // Check permissions based on category
      let hasAccess = false;
      
      if (userRole === 'web_owner') {
        hasAccess = true;
      } else if (category === 'renters') {
        const renterId = identifier;
        
        // Get renter to check ownership
        const renter = await db('renter')
          .where('id', renterId)
          .select('createdBy')
          .first();
        
        if (renter) {
          if (userRole === 'house_owner' && String(renter.createdBy) === String(userId)) {
            hasAccess = true;
          } else if (userRole === 'staff') {
            hasAccess = await hasPermission(userId, 'renters.view');
          } else if (userRole === 'caretaker') {
            const ownerHouses = await db('house').where('ownerId', renter.createdBy).select('id');
            const ownerHouseIds = ownerHouses.map(h => h.id);
            const allowed = await CaretakerPermissionService.getHousesWithPermission(userId, ownerHouseIds, 'renters.view');
            console.log(allowed + ' allowed');
            hasAccess = allowed;
          }
        }
      }
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
      
      // Set appropriate headers
      const mimeType = mime.lookup(fullPath) || 'application/octet-stream';
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      
      // Stream the file
      const fileStream = fs.createReadStream(fullPath);
      fileStream.pipe(res);
      
      fileStream.on('error', (error) => {
        console.error('Error streaming file:', error);
        res.status(500).json({
          success: false,
          error: 'Failed to serve image'
        });
      });
      
    } catch (error) {
      console.error('Serve image error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to serve image'
      });
    }
  }
  
  // Alternative: Generate signed URLs (more secure for production)
  async getSignedUrl(req, res) {
    try {
      const { filePath } = req.params;
      const userId = req.user.id;
      
      // Generate a signed token (simplified - use JWT for production)
      const crypto = require('crypto');
      const timestamp = Date.now();
      const token = crypto
        .createHmac('sha256', process.env.FILE_SECRET || 'your-secret-key')
        .update(`${userId}:${filePath}:${timestamp}`)
        .digest('hex');
      
      // Return signed URL (valid for 1 hour)
      const signedUrl = `/api/images/signed/${filePath}?token=${token}&t=${timestamp}`;
      
      return res.json({
        success: true,
        data: {
          url: signedUrl
        }
      });
      
    } catch (error) {
      console.error('Generate signed URL error:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate URL'
      });
    }
  }
}

module.exports = new ImageController();