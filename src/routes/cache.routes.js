// routes/admin/cache.routes.js
const express = require('express');
const router = express.Router();
const CacheController = require('../controllers/cache.controller');
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');

// All routes require web_owner or developer role
router.use(authMiddleware);
router.use(roleMiddleware(['web_owner', 'developer']));

// Cache management routes
router.get('/stats', CacheController.getCacheStats);
router.get('/memory', CacheController.getMemoryUsage);
router.post('/warmup', CacheController.warmUpCache);
router.delete('/user/:userId', CacheController.clearUserCache);
router.delete('/user', CacheController.clearUserCache); // Clear all
router.delete('/role/:roleId', CacheController.clearRoleCache);
router.delete('/role', CacheController.clearRoleCache); // Clear all

module.exports = router;