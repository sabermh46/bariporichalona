// routes/financialRoutes.js
const express = require('express');
const router = express.Router();

const FlatController = require('../controllers/flat.controller');
const FinancialController = require('../controllers/finantial.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const db = require('../config/knex');
// Flat Management Routes
router.get('/houses/:houseId/flats',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FlatController.getFlats
);

router.post('/houses/:houseId/flats',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FlatController.createFlat
);

router.get('/flats/:id',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FlatController.getFlatDetails
);

router.put('/flats/:id',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FlatController.updateFlat
);

router.delete('/flats/:id',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FlatController.deleteFlat
);

router.post('/flats/:id/renter',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FlatController.assignRenter
);

router.delete('/flats/:id/renter',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FlatController.removeRenter
);

// Financial Routes
router.get('/flats/:id/payments',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    async (req, res) => {
        // Get payment history for specific flat
        const { id } = req.params;
        const payments = await db('rent_payment')
            .where('flat_id', id)
            .orderBy('due_date', 'desc')
            .select('*');
        res.json({ success: true, data: payments });
    }
);

router.post('/flats/:id/payments',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FinancialController.recordRentPayment
);

router.get('/houses/:houseId/expenses',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    async (req, res) => {
        const { houseId } = req.params;
        const expenses = await db('houseexpense')
            .where('houseId', houseId)
            .orderBy('expenseDate', 'desc')
            .select('*');
        res.json({ success: true, data: expenses });
    }
);

router.post('/houses/:houseId/expenses',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FinancialController.recordExpense
);

router.get('/payments/rent',
    authMiddleware,
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
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
    roleMiddleware(['house_owner', 'staff', 'web_owner']),
    FinancialController.recordRentPayment
);

router.get('/payments/app-fee',
    authMiddleware,
    roleMiddleware(['web_owner', 'staff']), // Only web owner
    async (req, res) => {
        const { status, houseOwnerId } = req.query;
        let query = db('app_fee_payment').select('*');

        if (status) query.where('status', status);
        if (houseOwnerId) query.where('house_owner_id', houseOwnerId);

        query.orderBy('due_date', 'desc');
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

module.exports = router;