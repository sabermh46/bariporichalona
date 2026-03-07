const express = require('express');
const router = express.Router();
const LoanController = require('../controllers/loan.controller');
const authMiddleware = require('../middleware/auth.middleware');

// Apply auth middleware
router.use(authMiddleware);

// —— Loan (house_loan) ——
router.post('/loan-create', LoanController.createLoan);
router.get('/loan-by-house/:houseId', LoanController.getLoansByHouse);
router.get('/loan/:loanId', LoanController.getLoanDetails);
router.put('/loan/:loanId', LoanController.updateLoan);
router.delete('/loan/:loanId', LoanController.deleteLoan);

// —— Loan payment (house_loan_payment) ——
router.post('/loan-payment-create/:loanId', LoanController.recordPayment);
router.put('/loan-payment/:loanPaymentId', LoanController.updatePayment);

module.exports = router;
