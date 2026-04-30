const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const notificationController = require('../controllers/notification.controller');
const notify = require('../services/inAppNotification.service');

router.use(authMiddleware);

// List with pagination and filters (must be before /:id)
router.get('/', notificationController.list);

// Test endpoint — sends a notification to the currently logged-in user
router.post('/test-send', async (req, res) => {
    try {
        await notify.notifyUser(req.user.id, {
            title: 'Test Notification',
            message: 'Notification service is working correctly.',
            type: 'info',
            redirectLink: '/dashboard',
        });
        res.json({ success: true, message: 'Notification inserted', userId: String(req.user.id) });
    } catch (err) {
        console.error('[test-send] error:', err);
        res.status(500).json({ success: false, error: err.message, stack: err.stack });
    }
});

// Static/specific paths before parameterized routes
router.post('/read-all', notificationController.markAllAsRead);
router.delete('/read/all', notificationController.deleteAllRead);
router.get('/stats/summary', notificationController.getStatsSummary);
router.post('/batch/read', notificationController.batchMarkAsRead);

// By ID
router.get('/:id', notificationController.getById);
router.post('/:id/read', notificationController.markAsRead);
router.post('/:id/toggle-read', notificationController.toggleRead);
router.delete('/:id', notificationController.deleteById);

module.exports = router;
