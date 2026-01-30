// src/routes/userManagement.routes.js
const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth.middleware');
const roleMiddleware = require('../middleware/role.middleware');
const { validate } = require('../middleware/validate.middleware');
const userManagementController = require('../controllers/userManagement.controller');
// Apply authentication to all routes
router.use(authMiddleware);

// Create staff (web_owner only)
router.post('/staff',
    roleMiddleware(['web_owner']),
    validate({
        email: 'required|email',
        password: 'required|string|min:8',
        name: 'required|string|min:2',
        phone: 'string'
    }),
    userManagementController.createStaff
);

// Create house owner (web_owner and staff with permission)
router.post('/house-owners',
    roleMiddleware(['web_owner', 'staff']),
    validate({
        email: 'required|email',
        password: 'required|string|min:8',
        name: 'required|string|min:2',
        phone: 'string'
    }),
    userManagementController.createHouseOwner
);

// Create caretaker (web_owner, staff with permission, house_owner)
router.post('/caretakers',
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    validate({
        email: 'required|email',
        password: 'required|string|min:8',
        name: 'required|string|min:2',
        phone: 'string',
        house_owner_id: 'numeric'
    }),
    userManagementController.createCaretaker
);

// List users with filters
router.get('/users',
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    userManagementController.listUsers
);

// Update user status
router.patch('/users/:id/status',
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    validate({
        status: 'required|in:active,inactive,suspended'
    }),
    userManagementController.updateUserStatus
);

// Delete user (soft delete)
router.delete('/users/:id',
    roleMiddleware(['web_owner']),
    userManagementController.deleteUser
);

module.exports = router;