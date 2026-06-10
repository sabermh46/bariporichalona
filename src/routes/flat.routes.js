// routes/flatRoutes.js
const express = require('express');
const router = express.Router();
const FlatController = require('../controllers/flat.controller');
const FinancialController = require('../controllers/finantial.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const { checkHouseAccess, checkCaretakerHousePermission } = require('../middleware/caretakerPermission.middleware');
const db = require('../config/knex');

// Flat Management Routes
router.get('/houses/:houseId/flats',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.getFlats
);

router.post('/houses/:houseId/flats',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    checkHouseAccess(),
    checkCaretakerHousePermission('flats.create'),
    FlatController.createFlat
);

router.get('/flats/:id',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.getFlatDetails
);

router.put('/flats/:id',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.updateFlat
);

router.delete('/flats/:id',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.deleteFlat
);

router.post('/flats/:id/renter',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.assignRenter
);

router.post('/flats/:id/apply-advance', authMiddleware, FlatController.applyAdvancePayment);
router.get('/flats/:id/advance-payments', authMiddleware, FlatController.getFlatAdvancePayments);
router.post('/flats/:id/advance-payments',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.createAdvancePayment
);
router.put('/flats/:flatId/advance-payments/:advanceId',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.updateAdvancePayment
);
router.delete('/flats/:flatId/advance-payments/:advanceId',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.deleteAdvancePayment
);

router.delete('/flats/:id/renter',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FlatController.removeRenter
);

// Flat Payment Routes
router.get('/flats/:id/payments',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { page = 1, limit = 10, status } = req.query;
            const offset = (page - 1) * limit;

            // Verify the flat belongs to the requesting house_owner
            if (req.user.role.slug === 'house_owner') {
                const owned = await db('flat')
                    .join('house', 'flat.house_id', 'house.id')
                    .where('flat.id', id)
                    .where('house.ownerId', req.user.id)
                    .first('flat.id');
                if (!owned) return res.status(403).json({ success: false, error: 'Access denied' });
            }

            let query = db('rent_payment')
                .where('flat_id', id)
                .orderBy('due_date', 'desc');
            
            if (status) {
                query.where('status', status);
            }
            
            const payments = await query.limit(limit).offset(offset);
            const total = await db('rent_payment').where('flat_id', id).count('id as count').first();
            
            res.json({
                success: true,
                data: payments,
                meta: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(total.count),
                    totalPages: Math.ceil(total.count / limit)
                }
            });
        } catch (error) {
            console.error('Get flat payments error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch payments'
            });
        }
    }
);

// POST /flats/:id/payments is in financial.routes.js (FinancialController.recordRentPayment)

// Flat-specific financial routes
router.get('/flats/:id/financial-summary',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { year, month } = req.query;

            const flat = await db('flat')
                .join('house', 'flat.house_id', 'house.id')
                .where('flat.id', id)
                .select('flat.*', 'house.ownerId as houseOwnerId')
                .first();

            if (!flat) {
                return res.status(404).json({
                    success: false,
                    error: 'Flat not found'
                });
            }

            // house_owner may only access flats that belong to their houses
            if (req.user.role.slug === 'house_owner' && String(flat.houseOwnerId) !== String(req.user.id)) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
            
            let paymentQuery = db('rent_payment').where('flat_id', id);
            
            if (year && month) {
                const startDate = new Date(year, month - 1, 1);
                const endDate = new Date(year, month, 0);
                paymentQuery = paymentQuery
                    .where('due_date', '>=', startDate)
                    .where('due_date', '<=', endDate);
            }
            
            const payments = await paymentQuery.select('*');
            
            const summary = {
                totalDue: payments.reduce((sum, p) => sum + parseFloat(p.amount || 0), 0),
                totalPaid: payments.reduce((sum, p) => sum + parseFloat(p.paid_amount || 0), 0),
                totalPending: payments.filter(p => p.status === 'pending').length,
                totalOverdue: payments.filter(p => p.status === 'overdue').length,
                totalPaidCount: payments.filter(p => p.status === 'paid').length,
                averagePaymentDays: 0,
                payments: payments.slice(0, 5)
            };
            
            res.json({
                success: true,
                data: {
                    flat,
                    summary
                }
            });
        } catch (error) {
            console.error('Get flat financial summary error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch financial summary'
            });
        }
    }
);

// Search flats across houses (for web_owner)
router.get('/flats/search',
    authMiddleware,
    roleMiddleware(['web_owner', 'house_owner']),
    async (req, res) => {
        try {
            const { q, status, page = 1, limit = 20 } = req.query;
            const userId = req.user.id;
            const offset = (page - 1) * limit;
            
            let query = db('flat')
                .leftJoin('house', 'flat.house_id', 'house.id')
                .leftJoin('renter', 'flat.renter_id', 'renter.id')
                .select(
                    'flat.*',
                    'house.name as house_name',
                    'house.address as house_address',
                    'renter.name as renter_name',
                    'renter.phone as renter_phone'
                );
            
            // Apply permission filter
            if (req.user.role.slug !== 'web_owner') {
                query.where(function() {
                    this.where('house.ownerId', userId)
                        .orWhereExists(function() {
                            this.select('*')
                                .from('caretakerassignment')
                                .whereRaw('caretakerassignment.house_id = house.id')
                                .andWhere('caretakerassignment.caretaker_id', userId)
                                .andWhere('caretakerassignment.expires_at', '>', new Date());
                        });
                });
            }
            
            if (q) {
                query.andWhere(function() {
                    this.where('flat.name', 'like', `%${q}%`)
                        .orWhere('flat.number', 'like', `%${q}%`)
                        .orWhere('renter.name', 'like', `%${q}%`)
                        .orWhere('house.name', 'like', `%${q}%`);
                });
            }
            
            if (status === 'vacant') {
                query.andWhere('flat.renter_id', null);
            } else if (status === 'occupied') {
                query.andWhere('flat.renter_id', '!=', null);
            }
            
            // Get total count
            const countQuery = query.clone().clearSelect().count('flat.id as count').first();
            const totalResult = await countQuery;
            const total = parseInt(totalResult.count);
            
            // Get paginated results
            const flats = await query
                .limit(limit)
                .offset(offset)
                .orderBy('flat.created_at', 'desc');
            
            res.json({
                success: true,
                data: flats,
                meta: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        } catch (error) {
            console.error('Search flats error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to search flats'
            });
        }
    }
);

module.exports = router;