// routes/renterRoutes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const RenterController = require('../controllers/rent.controller');
const { renterUploadMiddleware } = require('../middleware/uploadMiddleware');
const multipartHandler = require('../middleware/multipartHandler');
const db = require('../config/knex');

// Create renter (with file upload)
router.post('/renters',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner', 'staff', 'caretaker']),
    multipartHandler(),
    RenterController.createRenter
);

// Get renters with filters
router.get('/renters',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner', 'staff', 'caretaker']),
    RenterController.getRenters
);

// Get available renters (not assigned to any flat)
router.get('/renters/available',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner', 'staff']),
    RenterController.getAvailableRenters
);

// Get renter details
router.get('/renters/:id',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner', 'staff', 'caretaker']),
    RenterController.getRenterDetails
);

// Update renter (with file upload)
router.put('/renters/:id',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner', 'staff']),
    multipartHandler(),
    RenterController.updateRenter
);

// Get potential duplicate renters (for web owner and staff with permission)
router.get('/renters/potential-duplicates', async (req, res, next) => {
    try {
        await RenterController.findPotentialDuplicateRenters(req, res);
    } catch (error) {
        next(error);
    }
});

// Delete renter (soft delete)
router.delete('/renters/:id',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner', 'staff']),
    RenterController.deleteRenter
);

// Get renters by house
router.get('/houses/:houseId/renters',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner', 'staff']),
    async (req, res) => {
        try {
            const { houseId } = req.params;
            const { page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;

            // house_owner may only list renters for their own houses
            if (req.user.role.slug === 'house_owner') {
                const house = await db('house').where({ id: houseId, ownerId: req.user.id }).first('id');
                if (!house) return res.status(403).json({ success: false, error: 'Access denied' });
            }
            
            // Get renters assigned to flats in this house
            const renters = await db('renter')
                .join('flat', 'renter.id', 'flat.renter_id')
                .where('flat.house_id', houseId)
                .select('renter.*')
                .distinct('renter.id')
                .limit(limit)
                .offset(offset)
                .orderBy('renter.name', 'asc');
            
            const total = await db('renter')
                .join('flat', 'renter.id', 'flat.renter_id')
                .where('flat.house_id', houseId)
                .countDistinct('renter.id as count')
                .first();
            
            return res.json({
                success: true,
                data: renters,
                meta: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total.count),
                    totalPages: Math.ceil(total.count / limit)
                }
            });
        } catch (error) {
            console.error('Get house renters error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch house renters'
            });
        }
    }
);

module.exports = router;