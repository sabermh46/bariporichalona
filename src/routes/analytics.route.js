// routes/analytics.route.js
const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

// Single dashboard API endpoint
router.get('/dashboard', 
  authMiddleware,
  roleMiddleware(['web_owner', 'staff']),
  analyticsController.getDashboardData
);

// Admin only endpoints
router.get('/workers/stats',
  authMiddleware,
  roleMiddleware(['web_owner']),
  analyticsController.getWorkerStats
);

router.post('/cache/clear',
  authMiddleware,
  roleMiddleware(['web_owner']),
  analyticsController.clearCache
);

module.exports = router;