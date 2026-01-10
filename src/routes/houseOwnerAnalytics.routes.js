// routes/houseOwnerAnalytics.routes.js
const express = require('express');
const router = express.Router();
const houseOwnerAnalyticsController = require('../controllers/houseOwnerAnalytics.controller');
const authMiddleware = require('../middleware/auth.middleware');

// All routes require authentication
router.use(authMiddleware);

// House owner dashboard routes
router.get('/dashboard', houseOwnerAnalyticsController.getHouseOwnerDashboard);
router.get('/monthly-stats', houseOwnerAnalyticsController.getMonthlyStats);
router.get('/expense-analysis', houseOwnerAnalyticsController.getExpenseAnalysis);
router.post('/refresh-dashboard', houseOwnerAnalyticsController.refreshDashboard);

module.exports = router;