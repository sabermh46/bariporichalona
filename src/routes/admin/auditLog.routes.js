// routes/admin/auditLog.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../../middleware/auth.middleware');
const roleMiddleware = require('../../middleware/role.middleware');
const AuditLogController = require('../../controllers/admin/auditLog.controller');

// All audit-log routes require authentication and web_owner role.
router.use(authMiddleware);
router.use(roleMiddleware(['web_owner']));

router.get('/', AuditLogController.list);
router.get('/facets', AuditLogController.getFacets);
router.get('/:id', AuditLogController.getOne);

module.exports = router;
