const { v4: uuid } = require("uuid");
const db = require("../config/knex");
const { serializeBigInt } = require("../utils/serializer");
const audit = require("../services/audit.service");

/**
 * Controller for handling Loan Management operations.
 * Uses Knex for database interactions.
 */
class LoanController {

    constructor() {
        this.createLoan = this.createLoan.bind(this);
        this.getLoansByHouse = this.getLoansByHouse.bind(this);
        this.getLoanDetails = this.getLoanDetails.bind(this);
        this.updateLoan = this.updateLoan.bind(this);
        this.deleteLoan = this.deleteLoan.bind(this);
        this.recordPayment = this.recordPayment.bind(this);
        this.updatePayment = this.updatePayment.bind(this);

    }

    /**
     * Create a new loan for a house
     */
    async createLoan(req, res) {
        try {
            const { 
                house_id, 
                provider_name, 
                amount, 
                interest_rate, 
                start_date, 
                end_date, 
                monthly_payment,
                metadata 
            } = req.body;

            if (!house_id || !provider_name || !amount || !start_date) {
                return res.status(400).json({
                    success: false,
                    error: "Missing required fields: house_id, provider_name, amount, start_date"
                });
            }

            // Verify house ownership/access (basic check, middleware handles auth)
            const house = await db('house').where('id', house_id).first();
            if (!house) {
                return res.status(404).json({ success: false, error: "House not found||বাড়ি খুঁজে পাওয়া যায়নি" });
            }
            
            // Check permission: Only owner or admin can add loan
            // Assuming authMiddleware populates req.user
            if (req.user.role.slug === 'house_owner' && house.ownerId !== req.user.id) {
                 return res.status(403).json({ success: false, error: "Unauthorized access to this house||এই বাড়িতে অননুমোদিত প্রবেশ" });
            }

            const loanData = {
                uuid: uuid(),
                house_id,
                provider_name,
                amount,
                interest_rate,
                start_date: new Date(start_date),
                end_date: end_date ? new Date(end_date) : null,
                monthly_payment,
                paid_amount: 0.00,
                status: 'active',
                metadata: metadata ? JSON.stringify(metadata) : null,
                created_at: new Date(),
                updated_at: new Date()
            };

            const [loanId] = await db('house_loan').insert(loanData);

            const newLoan = await db('house_loan').where('id', loanId).first();

            audit.fromRequest(req, {
                entityType: 'house_loan',
                entityId: loanId,
                action: 'create',
                actionCategory: 'financial',
                changes: { after: { house_id, provider_name, amount, monthly_payment } },
                metadata: { source: 'service' },
            });

            res.status(201).json({
                success: true,
                message: "Loan created successfully",
                data: serializeBigInt(newLoan)
            });

        } catch (error) {
            console.error("Create loan error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to create loan"
            });
        }
    }

    /**
     * Get all loans for a specific house
     */
    async getLoansByHouse(req, res) {
        try {
            const { houseId } = req.params;

            // Access check
            const house = await db('house').where('id', houseId).first();
            if (!house) {
                return res.status(404).json({ success: false, error: "House not found||বাড়ি খুঁজে পাওয়া যায়নি" });
            }
            
            if (req.user.role.slug === 'house_owner' && house.ownerId !== req.user.id) {
                 return res.status(403).json({ success: false, error: "Unauthorized access||অননুমোদিত প্রবেশ" });
            }

            const loans = await db('house_loan')
                .where('house_id', houseId)
                .orderBy('created_at', 'desc');

            // Attach payments for each loan
            const loanIds = loans.map((l) => l.id);
            const payments =
                loanIds.length > 0
                    ? await db('house_loan_payment')
                          .whereIn('loan_id', loanIds)
                          .orderBy('payment_date', 'desc')
                    : [];
            const paymentsByLoanId = payments.reduce((acc, p) => {
                const lid = p.loan_id.toString();
                if (!acc[lid]) acc[lid] = [];
                acc[lid].push(p);
                return acc;
            }, {});
            const loansWithPayments = loans.map((loan) => ({
                ...loan,
                payments: paymentsByLoanId[loan.id.toString()] || []
            }));

            res.json({
                success: true,
                data: serializeBigInt(loansWithPayments)
            });

        } catch (error) {
            console.error("Get loans error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch loans||ঋণের তালিকা আনতে ব্যর্থ হয়েছে" });
        }
    }

    /**
     * Get details of a single loan including payment history
     */
    async getLoanDetails(req, res) {
        try {
            const { loanId } = req.params;

            const loan = await db('house_loan').where('id', loanId).first();
            
            if (!loan) {
                return res.status(404).json({ success: false, error: "Loan not found||ঋণ খুঁজে পাওয়া যায়নি" });
            }

            // Verify access to the house associated with this loan
            const house = await db('house').where('id', loan.house_id).first();
             if (req.user.role.slug === 'house_owner' && house.ownerId !== req.user.id) {
                 return res.status(403).json({ success: false, error: "Unauthorized access||অননুমোদিত প্রবেশ" });
            }

            // Fetch payments
            const payments = await db('house_loan_payment')
                .where('loan_id', loanId)
                .orderBy('payment_date', 'desc');

            res.json({
                success: true,
                data: serializeBigInt({
                    ...loan,
                    payments
                })
            });

        } catch (error) {
            console.error("Get loan details error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch loan details||ঋণের বিবরণ আনতে ব্যর্থ হয়েছে" });
        }
    }

    /**
     * Update loan details
     */
    async updateLoan(req, res) {
        try {
            const { loanId } = req.params;
            const { 
                provider_name, 
                amount, 
                interest_rate, 
                start_date, 
                end_date, 
                monthly_payment,
                status,
                metadata 
            } = req.body;

            const loan = await db('house_loan').where('id', loanId).first();
            if (!loan) return res.status(404).json({ success: false, error: "Loan not found||ঋণ খুঁজে পাওয়া যায়নি" });

             const house = await db('house').where('id', loan.house_id).first();
             if (req.user.role.slug === 'house_owner' && house.ownerId !== req.user.id) {
                 return res.status(403).json({ success: false, error: "Unauthorized access||অননুমোদিত প্রবেশ" });
            }

            const updateData = {};
            if (provider_name) updateData.provider_name = provider_name;
            if (amount) updateData.amount = amount;
            if (interest_rate !== undefined) updateData.interest_rate = interest_rate;
            if (start_date) updateData.start_date = new Date(start_date);
            if (end_date !== undefined) updateData.end_date = end_date ? new Date(end_date) : null;
            if (monthly_payment !== undefined) updateData.monthly_payment = monthly_payment;
            if (status) updateData.status = status;
            if (metadata) updateData.metadata = JSON.stringify(metadata);
            
            updateData.updated_at = new Date();

            await db('house_loan').where('id', loanId).update(updateData);
            
            const updatedLoan = await db('house_loan').where('id', loanId).first();

            res.json({
                success: true,
                message: "Loan updated successfully",
                data: serializeBigInt(updatedLoan)
            });

        } catch (error) {
            console.error("Update loan error:", error);
            res.status(500).json({ success: false, error: "Failed to update loan||ঋণ আপডেট করতে ব্যর্থ হয়েছে" });
        }
    }

    /**
     * Delete a loan
     */
    async deleteLoan(req, res) {
        try {
            const { loanId } = req.params;
            
            const loan = await db('house_loan').where('id', loanId).first();
            if (!loan) return res.status(404).json({ success: false, error: "Loan not found||ঋণ খুঁজে পাওয়া যায়নি" });

            const house = await db('house').where('id', loan.house_id).first();
             if (req.user.role.slug === 'house_owner' && house.ownerId !== req.user.id) {
                 return res.status(403).json({ success: false, error: "Unauthorized access||অননুমোদিত প্রবেশ" });
            }

            await db('house_loan').where('id', loanId).del();
            await db('house_loan_payment').where('loan_id', loanId).del();

            audit.fromRequest(req, {
                entityType: 'house_loan',
                entityId: loanId,
                action: 'delete',
                actionCategory: 'financial',
                changes: { before: { provider_name: loan.provider_name, amount: loan.amount, house_id: loan.house_id } },
                metadata: { source: 'service', cascadedPayments: true },
            });

            res.json({
                success: true,
                message: "Loan deleted successfully"
            });

        } catch (error) {
            console.error("Delete loan error:", error);
            res.status(500).json({ success: false, error: "Failed to delete loan||ঋণ মুছতে ব্যর্থ হয়েছে" });
        }
    }

    /**
     * Record a payment for a loan
     */
    async recordPayment(req, res) {
        const trx = await db.transaction();
        try {
            const { loanId } = req.params;
            const { amount, payment_date, transaction_id, notes } = req.body;

            if (!amount || !payment_date) {
                return res.status(400).json({ success: false, error: "Amount and payment_date are required||পরিমাণ এবং পেমেন্টের তারিখ আবশ্যক" });
            }

            const loan = await trx('house_loan').where('id', loanId).first();
            if (!loan) {
                await trx.rollback();
                return res.status(404).json({ success: false, error: "Loan not found||ঋণ খুঁজে পাওয়া যায়নি" });
            }

            const house = await trx('house').where('id', loan.house_id).first();
             if (req.user.role.slug === 'house_owner' && house.ownerId !== req.user.id) {
                 await trx.rollback();
                 return res.status(403).json({ success: false, error: "Unauthorized access||অননুমোদিত প্রবেশ" });
            }

            // Insert payment record
            const paymentData = {
                uuid: uuid(),
                loan_id: loanId,
                amount,
                payment_date: new Date(payment_date),
                transaction_id: transaction_id || null,
                notes: notes || null,
                created_at: new Date(),
                updated_at: new Date()
            };

            const [paymentId] = await trx('house_loan_payment').insert(paymentData);

            // Update loan paid_amount
            const currentPaid = parseFloat(loan.paid_amount || 0);
            const paymentAmount = parseFloat(amount);
            const newPaidAmount = currentPaid + paymentAmount;
            
            const updateData = {
                paid_amount: newPaidAmount,
                updated_at: new Date()
            };

            // Auto-update status to 'paid' if fully paid
            if (newPaidAmount >= parseFloat(loan.amount)) {
                updateData.status = 'paid';
            }

            await trx('house_loan').where('id', loanId).update(updateData);

            await trx.commit();

            const newPayment = await db('house_loan_payment').where('id', paymentId).first();

            res.status(201).json({
                success: true,
                message: "Payment recorded successfully",
                data: serializeBigInt(newPayment)
            });

        } catch (error) {
            await trx.rollback();
            console.error("Record payment error:", error);
            res.status(500).json({ success: false, error: "Failed to record payment||পেমেন্ট রেকর্ড করতে ব্যর্থ হয়েছে" });
        }
    }

    /**
     * Update a loan payment
     */
    async updatePayment(req, res) {
        const trx = await db.transaction();
        try {
            const { loanPaymentId } = req.params;
            const { amount, payment_date, transaction_id, notes } = req.body;

            const payment = await trx('house_loan_payment').where('id', loanPaymentId).first();
            if (!payment) {
                await trx.rollback();
                return res.status(404).json({ success: false, error: "Payment not found||পেমেন্ট খুঁজে পাওয়া যায়নি" });
            }

            const loan = await trx('house_loan').where('id', payment.loan_id).first();
            if (!loan) {
                await trx.rollback();
                return res.status(404).json({ success: false, error: "Loan not found||ঋণ খুঁজে পাওয়া যায়নি" });
            }

            // Access Check
            const house = await trx('house').where('id', loan.house_id).first();
             if (req.user.role.slug === 'house_owner' && house.ownerId !== req.user.id) {
                 await trx.rollback();
                 return res.status(403).json({ success: false, error: "Unauthorized access||অননুমোদিত প্রবেশ" });
            }

            const updateData = {};
            if (payment_date) updateData.payment_date = new Date(payment_date);
            if (transaction_id !== undefined) updateData.transaction_id = transaction_id;
            if (notes !== undefined) updateData.notes = notes;
            
            // Handle amount change
            let amountDiff = 0;
            if (amount !== undefined) {
                const oldAmount = parseFloat(payment.amount);
                const newAmount = parseFloat(amount);
                amountDiff = newAmount - oldAmount;
                updateData.amount = newAmount;
            }

            if (Object.keys(updateData).length > 0) {
                updateData.updated_at = new Date();
                await trx('house_loan_payment').where('id', loanPaymentId).update(updateData);
            }

            // If amount changed, update loan total paid
            if (amountDiff !== 0) {
                const currentLoanPaid = parseFloat(loan.paid_amount);
                const newLoanPaid = currentLoanPaid + amountDiff;

                const loanUpdateData = {
                    paid_amount: newLoanPaid,
                    updated_at: new Date()
                };

                // Re-evaluate status
                if (newLoanPaid >= parseFloat(loan.amount)) {
                    loanUpdateData.status = 'paid';
                } else if (loan.status === 'paid' && newLoanPaid < parseFloat(loan.amount)) {
                    loanUpdateData.status = 'active'; // Revert to active if balance check fails
                }

                await trx('house_loan').where('id', loan.id).update(loanUpdateData);
            }

            await trx.commit();

            const updatedPayment = await db('house_loan_payment').where('id', loanPaymentId).first();

            res.json({
                success: true,
                message: "Payment updated successfully",
                data: serializeBigInt(updatedPayment)
            });

        } catch (error) {
            await trx.rollback();
            console.error("Update payment error:", error);
            res.status(500).json({ success: false, error: "Failed to update payment||পেমেন্ট আপডেট করতে ব্যর্থ হয়েছে" });
        }
    }
}


module.exports = new LoanController();
