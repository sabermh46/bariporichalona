const express = require('express');
const router = express.Router();
const LoanController = require('../controllers/loan.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Apply auth middleware
router.use(authMiddleware);

// Create a new loan
router.post('/', LoanController.createLoan);

// Get loans for a specific house
router.get('/house/:houseId', LoanController.getLoansByHouse);

// Get details of a specific loan (incl. payments)
router.get('/:id', LoanController.getLoanDetails);

// Update a loan
router.put('/:id', LoanController.updateLoan);

// Delete a loan
router.delete('/:id', LoanController.deleteLoan);

// Record a payment for a loan
router.post('/:loanId/payments', LoanController.recordPayment);

// Update a payment
router.put('/payments/:paymentId', LoanController.updatePayment);

module.exports = router;
