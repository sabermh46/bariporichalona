const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const notificationController = require('../controllers/notification.controller');

router.use(authMiddleware);

// List with pagination and filters (must be before /:id)
router.get('/', notificationController.list);

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
