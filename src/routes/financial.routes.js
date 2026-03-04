// routes/financialRoutes.js
const express = require('express');
const router = express.Router();

const FinancialController = require('../controllers/finantial.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const db = require('../config/knex');

// Record rent payment for a flat (GET /flats/:id/payments is in flat.routes.js with pagination)
router.post('/flats/:id/payments',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FinancialController.recordRentPayment
);

router.get('/houses/:houseOwnerId/expenses',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    async (req, res) => {
        try {
            const { houseOwnerId } = req.params;
            const { houseId } = req.query; // Typically comes from ?houseId=...

            // 1. Get all valid house IDs owned by this user for security/filtering
            const ownedHouseIds = await db('house')
                .where('ownerId', houseOwnerId)
                .pluck('id');

            if (ownedHouseIds.length === 0) {
                return res.json({ success: true, data: [], message: 'No houses found' });
            }

            // 2. Determine target IDs (either the specific house or all owned houses)
            let targetHouseIds;
            if (houseId) {
                const hId = parseInt(houseId);
                // Security check: Ensure the requested houseId belongs to the owner
                if (!ownedHouseIds.includes(hId)) {
                    return res.status(403).json({ success: false, message: 'Unauthorized house access' });
                }
                targetHouseIds = [hId];
            } else {
                targetHouseIds = ownedHouseIds;
            }

            // 3. Fetch expenses with rounding to fix the floating point issue
            const expenses = await db('house_expense') // Use your actual table name
                .whereIn('house_id', targetHouseIds)
                .select(
                    'id',
                    'uuid',
                    'house_id',
                    'category',
                    'description',
                    db.raw('ROUND(amount, 2) as amount'), 
                    'expense_date',
                    'status',
                    'payment_method',
                    'created_at'
                )
                .orderBy('expense_date', 'desc');

            const totalSum = expenses.reduce((sum, exp) => sum + (parseFloat(exp.amount) || 0), 0);
            res.json({ 
                success: true, 
                data: expenses,
                summary: {
                    totalCount: expenses.length,
                    totalAmount: parseFloat(totalSum.toFixed(2))
                }
            });

        } catch (error) {
            console.error('Error fetching expenses:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    }
);

router.post('/houses/:houseId/expenses',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner','caretaker']),
    FinancialController.recordExpense
);

router.get('/payments/rent',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    async (req, res) => {
        const { status, houseId, startDate, endDate } = req.query;
        let query = db('rent_payment').select('*');

        if (status) query.where('status', status);
        if (houseId) query.where('house_id', houseId);
        if (startDate) query.where('due_date', '>=', new Date(startDate));
        if (endDate) query.where('due_date', '<=', new Date(endDate));

        query.orderBy('due_date', 'desc');
        const payments = await query;
        res.json({ success: true, data: payments });
    }
);

router.post('/payments/rent',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FinancialController.recordRentPayment
);

router.put('/payments/rent/:id',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
    FinancialController.updateRentPayment
);

router.get('/payments/app-fee',
    authMiddleware,
    roleMiddleware(['web_owner', 'staff', 'caretaker']), // Only web owner
    async (req, res) => {
        const { status, houseOwnerId } = req.query;
        let query = db('app_fee_payment').whereNull('deleted_at').select('*');

        if (status) query.where('status', status);
        if (houseOwnerId) query.where('house_owner_id', houseOwnerId);

        query.orderBy('start_date', 'desc');
        const payments = await query;
        res.json({ success: true, data: payments });
    }
);

router.post('/payments/app-fee',
    authMiddleware,
    roleMiddleware(['web_owner']),
    FinancialController.recordAppFeePayment
);

router.get('/financial/dashboard',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FinancialController.getFinancialDashboard
);

router.post('/notifications/rent-reminders',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FinancialController.sendRentReminders
);

router.post('/financial/generate-invoices',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FinancialController.generateRentInvoices
);

router.get('/financial/monthly-profit', authMiddleware, FinancialController.calculateMonthlyProfit);
router.get('/financial/profit-report', authMiddleware, FinancialController.getProfitReport);

// Refund due (advance remaining at renter removal): list and settle
router.get('/financial/payment-receipts',
  authMiddleware,
  roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
  FinancialController.listPaymentReceipts
);

router.post('/financial/resend-payment-receipt',
  authMiddleware,
  roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
  FinancialController.resendPaymentReceipt
);

router.get('/financial/refund-due',
  authMiddleware,
  roleMiddleware(['house_owner', 'staff', 'web_owner', 'caretaker']),
  FinancialController.getRefundDue
);
router.post('/financial/refund-settled',
  authMiddleware,
  roleMiddleware(['house_owner', 'staff', 'web_owner']),
  FinancialController.settleRefund
);

module.exports = router;