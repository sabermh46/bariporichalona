// routes/caretakerRoutes.js
const express = require('express');
const router = express.Router();
const CaretakerController = require('../controllers/caretaker.controller');
const  authMiddleware  = require('../middleware/auth.middleware');

// Get all caretakers
router.get('/', authMiddleware, CaretakerController.getCaretakers);

// Get caretaker details with permissions
router.get('/:id/details', authMiddleware, CaretakerController.getCaretakerDetails);

// Update permissions for an assignment
router.put('/assignments/:assignmentId/permissions', authMiddleware, CaretakerController.updateAssignmentPermissions);

// Assign caretaker to a house
router.post('/:caretakerId/assign', authMiddleware, CaretakerController.assignToHouse);

// Remove caretaker from a house
router.delete('/assignments/:assignmentId', authMiddleware, CaretakerController.removeFromHouse);

// Delete caretaker
router.delete('/:id', authMiddleware, CaretakerController.deleteCaretaker);

module.exports = router;