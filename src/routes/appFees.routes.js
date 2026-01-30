const express = require('express');
const router = express.Router();
const AppFeePaymentController = require('../controllers/appFeePayment.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

// Apply authentication to all routes
router.use(authMiddleware);

// Get all app fee payments
router.get('/payments', 
    roleMiddleware(['web_owner', 'staff', 'house_owner', 'caretaker']),
    AppFeePaymentController.getPayments
);

// Get payment statistics
router.get('/payments/stats',
    roleMiddleware(['web_owner', 'staff', 'house_owner', 'caretaker']),
    AppFeePaymentController.getPaymentStats
);

// Get due amount calculation for house owner
router.get('/payments/calculate-due/:house_owner_id',
    roleMiddleware(['web_owner', 'staff', 'house_owner', 'caretaker']),
    async (req, res, next) => {
        try {
            const { house_owner_id } = req.params;
            const userRole = req.user.role?.slug;
            const userId = req.user.id;
            
            // Permission check
            if (userRole === 'house_owner' && parseInt(house_owner_id) !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only view your own due amount'
                });
            }
            
            if (userRole === 'caretaker') {
                const accessibleOwners = await AppFeePaymentController.getAccessibleHouseOwners(userId);
                if (!accessibleOwners.includes(parseInt(house_owner_id))) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have access to this house owner'
                    });
                }
            }
            
            if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.view');
                if (!hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'Permission denied'
                    });
                }
            }
            
            const calculation = await AppFeePaymentController.calculateDueAmount(parseInt(house_owner_id));
            
            if (!calculation) {
                return res.status(404).json({
                    success: false,
                    error: 'Unable to calculate due amount'
                });
            }
            
            res.json({
                success: true,
                data: calculation
            });
        } catch (error) {
            next(error);
        }
    }
);

// Create payment record
router.post('/payments',
    roleMiddleware(['web_owner', 'staff', 'house_owner', 'caretaker']),
    AppFeePaymentController.createPayment
);

// Update payment (verify/reject)
router.put('/payments/:id',
    roleMiddleware(['web_owner', 'staff']),
    AppFeePaymentController.updatePayment
);

// Soft delete payment
router.delete('/payments/:id',
    roleMiddleware(['web_owner', 'staff']),
    AppFeePaymentController.deletePayment
);

// Generate monthly fees (admin only - usually called by cron)
router.post('/payments/generate-monthly',
    roleMiddleware(['web_owner']),
    async (req, res, next) => {
        try {
            const results = await AppFeePaymentController.generateMonthlyFees();
            res.json({
                success: true,
                data: results,
                message: `Generated ${results.length} monthly fee payments`
            });
        } catch (error) {
            next(error);
        }
    }
);

// Get payment by ID
router.get('/payments/:id',
    roleMiddleware(['web_owner', 'staff', 'house_owner', 'caretaker']),
    async (req, res, next) => {
        try {
            const { id } = req.params;
            const userRole = req.user.role?.slug;
            const userId = req.user.id;
            
            const payment = await db('app_fee_payment as afp')
                .join('user as ho', 'afp.house_owner_id', 'ho.id')
                .leftJoin('user as v', 'afp.verified_by', 'v.id')
                .where('afp.id', id)
                .andWhereNull('afp.deleted_at')
                .select(
                    'afp.*',
                    'ho.name as house_owner_name',
                    'ho.email as house_owner_email',
                    'ho.phone as house_owner_phone',
                    'v.name as verifier_name',
                    'v.email as verifier_email'
                )
                .first();
            
            if (!payment) {
                return res.status(404).json({
                    success: false,
                    error: 'Payment not found'
                });
            }
            
            // Permission check
            if (userRole === 'house_owner' && payment.house_owner_id !== userId) {
                return res.status(403).json({
                    success: false,
                    error: 'You can only view your own payments'
                });
            }
            
            if (userRole === 'caretaker') {
                const accessibleOwners = await AppFeePaymentController.getAccessibleHouseOwners(userId);
                if (!accessibleOwners.includes(payment.house_owner_id)) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have access to this payment'
                    });
                }
            }
            
            if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.view');
                if (!hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'Permission denied'
                    });
                }
            }
            
            // Parse metadata
            payment.metadata = payment.metadata ? JSON.parse(payment.metadata) : null;
            
            res.json({
                success: true,
                data: payment
            });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;