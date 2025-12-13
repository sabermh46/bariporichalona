// routes/admin/staffPermissions.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middleware/auth.middleware');
const roleMiddleware = require('../../middleware/role.middleware');
const StaffPermissionController = require('../../controllers/admin/staffPermission.controller');

// All routes require authentication and web_owner role
router.use(authMiddleware);
router.use(roleMiddleware(['web_owner']));

// Staff management routes
router.get('/staff', StaffPermissionController.getStaffList);
router.get('/staff/:staffId', StaffPermissionController.getStaffDetails);
router.get('/staff/:staffId/activity', StaffPermissionController.getStaffActivity);
router.get('/staff/:staffId/history', StaffPermissionController.getPermissionHistory);
router.put('/staff/:staffId/status', StaffPermissionController.updateStaffStatus);

// Permission management routes
router.get('/permissions', StaffPermissionController.getAvailablePermissions);
router.post('/staff/:staffId/permissions', StaffPermissionController.grantPermission);
router.delete('/staff/:staffId/permissions/:permissionId', StaffPermissionController.revokePermission);
router.post('/staff/:staffId/permissions/bulk', StaffPermissionController.bulkGrantPermissions);
router.delete('/staff/:staffId/permissions/bulk', StaffPermissionController.bulkRevokePermissions);
router.post('/permissions/copy', StaffPermissionController.copyPermissions);

module.exports = router;