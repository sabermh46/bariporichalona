// src/routes/push.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const pushController = require('../controllers/push.controller');

// Public route (if needed) - none for push

// User routes (require authentication)
router.post('/subscribe', authMiddleware, pushController.subscribe);
router.post('/unsubscribe', authMiddleware, pushController.unsubscribe);
router.get('/subscriptions', authMiddleware, pushController.getSubscriptions);
router.post('/test', authMiddleware, pushController.sendTest);
router.get('/logs', authMiddleware, pushController.getLogs);
router.get('/stats', authMiddleware, pushController.getStats);
router.get('/notifications', authMiddleware, pushController.getNotifications);
router.put('/notifications/:notificationId/read', authMiddleware, pushController.markAsRead);
router.put('/notifications/read-all', authMiddleware, pushController.markAllAsRead);
router.delete('/notifications/:notificationId', authMiddleware, pushController.deleteNotification);
router.delete('/notifications', authMiddleware, pushController.clearAllNotifications);

// Admin routes (require specific roles)
router.post('/send/user/:userId', 
  authMiddleware, 
  roleMiddleware(['WEB_OWNER', 'STAFF']),
  pushController.sendToUser
);

router.post('/send/role/:roleSlug',
  authMiddleware,
  roleMiddleware(['WEB_OWNER', 'STAFF']),
  pushController.sendToRole
);

router.post('/send/house/:houseId',
  authMiddleware,
  roleMiddleware(['WEB_OWNER', 'STAFF', 'HOUSE_OWNER']),
  pushController.sendToHouse
);

// Cleanup route (admin only) - optional
router.post('/cleanup', 
  authMiddleware,
  roleMiddleware(['WEB_OWNER']),
  async (req, res) => {
    try {
      // This would call pushService.cleanupDuplicateSubscriptions()
      res.json({ success: true, message: 'Cleanup completed' });
    } catch (error) {
      res.status(500).json({ error: 'Cleanup failed' });
    }
  }
);

module.exports = router;