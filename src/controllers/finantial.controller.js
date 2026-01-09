// Updated financial.controller.js with snake_case column names
const db = require('../config/knex');
const { v4: uuidv4 } = require('uuid');
const NotificationService = require('../services/emailSmsNotification.service');
const CaretakerPermissionService = require('../services/CaretakerPermission.service');
const HouseController = require('./house.controller');
const permissionService = require('../services/permission.service');

class FinancialController {

    constructor() {
        // bind all to fix the this.function() reading indefined
        this.recordRentPayment = this.recordRentPayment.bind(this);
        this.generateRentInvoices = this.generateRentInvoices.bind(this);
        this.recordExpense = this.recordExpense.bind(this);
        this.recordAppFeePayment = this.recordAppFeePayment.bind(this);
        this.getFinancialDashboard = this.getFinancialDashboard.bind(this);
        this.sendRentReminders = this.sendRentReminders.bind(this);

        this.calculateNextDueDate = this.calculateNextDueDate.bind(this);
        this.checkHouseAccess = this.checkHouseAccess.bind(this);
        this.calculateMonthlyProfit = this.calculateMonthlyProfit.bind(this);
        this.getProfitReport = this.getProfitReport.bind(this);
    }

    async calculateMonthlyProfit(req, res) {
    try {
        const { houseId, month, year } = req.query;
        const userId = req.user.id;

        // Validate parameters
        const targetMonth = month ? parseInt(month) : new Date().getMonth() + 1;
        const targetYear = year ? parseInt(year) : new Date().getFullYear();
        const startDate = new Date(targetYear, targetMonth - 1, 1);
        const endDate = new Date(targetYear, targetMonth, 0);

        // Check permission
        if (req.user.role.slug !== 'web_owner') {
        const hasAccess = await this.checkHouseAccess(userId, houseId);
        if (!hasAccess) {
            return res.status(403).json({
            success: false,
            error: 'You do not have permission to view profit for this house',
            });
        }
        }

        // Get all income sources for the month
        const rentIncome = await db('rent_payment')
        .where('house_id', houseId)
        .andWhere('paid_date', '>=', startDate)
        .andWhere('paid_date', '<=', endDate)
        .andWhere('status', 'paid')
        .sum('paid_amount as total')
        .first();

        const advanceIncome = await db('advance_payment')
        .where('house_id', houseId)
        .andWhere('payment_date', '>=', startDate)
        .andWhere('payment_date', '<=', endDate)
        .sum('paid_amount as total')
        .first();

        // Get all expenses for the month
        const expenses = await db('house_expense')
        .where('house_id', houseId)
        .andWhere('expense_date', '>=', startDate)
        .andWhere('expense_date', '<=', endDate)
        .andWhere('status', 'approved')
        .select('category', 'amount', 'description');

        const totalExpenses = expenses.reduce((sum, expense) => 
        sum + parseFloat(expense.amount || 0), 0
        );

        // Calculate profit
        const totalRentIncome = parseFloat(rentIncome?.total || 0);
        const totalAdvanceIncome = parseFloat(advanceIncome?.total || 0);
        const totalIncome = totalRentIncome + totalAdvanceIncome;
        const profit = totalIncome - totalExpenses;

        // Categorize expenses
        const expenseCategories = {};
        expenses.forEach(expense => {
        const category = expense.category;
        if (!expenseCategories[category]) {
            expenseCategories[category] = {
            total: 0,
            items: []
            };
        }
        expenseCategories[category].total += parseFloat(expense.amount || 0);
        expenseCategories[category].items.push({
            amount: expense.amount,
            description: expense.description
        });
        });

        return res.json({
        success: true,
        data: {
            month: targetMonth,
            year: targetYear,
            period: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
            income: {
            rent: totalRentIncome,
            advance_payments: totalAdvanceIncome,
            total: totalIncome
            },
            expenses: {
            total: totalExpenses,
            by_category: expenseCategories,
            items: expenses
            },
            profit: {
            amount: profit,
            percentage: totalIncome > 0 ? (profit / totalIncome * 100) : 0
            }
        }
        });
    } catch (error) {
        console.error('Calculate monthly profit error:', error);
        return res.status(500).json({
        success: false,
        error: 'Failed to calculate monthly profit'
        });
    }
    }

    // Get profit report for multiple months
    async getProfitReport(req, res) {
    try {
        const { houseId, startDate, endDate } = req.query;
        const userId = req.user.id;

        // Check permission
        if (req.user.role.slug !== 'web_owner') {
        const hasAccess = await this.checkHouseAccess(userId, houseId);
        if (!hasAccess) {
            return res.status(403).json({
            success: false,
            error: 'You do not have permission to view profit report',
            });
        }
        }

        const start = startDate ? new Date(startDate) : new Date(new Date().getFullYear(), 0, 1);
        const end = endDate ? new Date(endDate) : new Date();

        // Get monthly breakdown
        const monthlyData = await db.raw(`
        SELECT 
            DATE_FORMAT(COALESCE(rp.paid_date, ap.payment_date), '%Y-%m') as month,
            COALESCE(SUM(rp.paid_amount), 0) as rent_income,
            COALESCE(SUM(ap.paid_amount), 0) as advance_income,
            COALESCE(SUM(he.amount), 0) as expenses
        FROM (
            SELECT DISTINCT DATE_FORMAT(paid_date, '%Y-%m') as month 
            FROM rent_payment 
            WHERE house_id = ? AND paid_date BETWEEN ? AND ?
            UNION
            SELECT DISTINCT DATE_FORMAT(payment_date, '%Y-%m') as month 
            FROM advance_payment 
            WHERE house_id = ? AND payment_date BETWEEN ? AND ?
            UNION
            SELECT DISTINCT DATE_FORMAT(expense_date, '%Y-%m') as month 
            FROM house_expense 
            WHERE house_id = ? AND expense_date BETWEEN ? AND ? AND status = 'approved'
        ) months
        LEFT JOIN rent_payment rp ON DATE_FORMAT(rp.paid_date, '%Y-%m') = months.month 
            AND rp.house_id = ? AND rp.status = 'paid'
        LEFT JOIN advance_payment ap ON DATE_FORMAT(ap.payment_date, '%Y-%m') = months.month 
            AND ap.house_id = ?
        LEFT JOIN house_expense he ON DATE_FORMAT(he.expense_date, '%Y-%m') = months.month 
            AND he.house_id = ? AND he.status = 'approved'
        GROUP BY months.month
        ORDER BY months.month
        `, [houseId, start, end, houseId, start, end, houseId, start, end, houseId, houseId, houseId]);

        const report = monthlyData[0].map(row => ({
        month: row.month,
        rent_income: parseFloat(row.rent_income || 0),
        advance_income: parseFloat(row.advance_income || 0),
        total_income: parseFloat(row.rent_income || 0) + parseFloat(row.advance_income || 0),
        expenses: parseFloat(row.expenses || 0),
        profit: (parseFloat(row.rent_income || 0) + parseFloat(row.advance_income || 0)) - parseFloat(row.expenses || 0)
        }));

        // Calculate totals
        const totals = report.reduce((acc, row) => ({
        rent_income: acc.rent_income + row.rent_income,
        advance_income: acc.advance_income + row.advance_income,
        total_income: acc.total_income + row.total_income,
        expenses: acc.expenses + row.expenses,
        profit: acc.profit + row.profit
        }), {
        rent_income: 0,
        advance_income: 0,
        total_income: 0,
        expenses: 0,
        profit: 0
        });

        return res.json({
        success: true,
        data: {
            period: {
            start: start.toISOString().split('T')[0],
            end: end.toISOString().split('T')[0]
            },
            monthly_breakdown: report,
            totals: totals
        }
        });
    } catch (error) {
        console.error('Get profit report error:', error);
        return res.status(500).json({
        success: false,
        error: 'Failed to generate profit report'
        });
    }
    }
    // 1. Record rent payment (manual by house owner + need to ensure that caretaker has permission)
    async recordRentPayment(req, res) {
    try {
        const { 
            payment_method, 
            paid_amount,  // This is actually base rent amount from frontend
            transaction_id, 
            notes, 
            paid_date, 
            calculate_next_payment,
            amenities = [],
            base_rent,
            amenities_total,
            late_fee,
            use_advance_payment = false
        } = req.body;
        
        const userId = req.user.id;
        const { id: flat_id } = req.params;

        // Get flat with renter and house info
        const flat = await db('flat')
            .join('house', 'flat.house_id', 'house.id')
            .leftJoin('renter', 'flat.renter_id', 'renter.id')
            .where('flat.id', flat_id)
            .select(
                'flat.*',
                'house.ownerId',
                'house.name as houseName',
                'house.metadata as houseMetadata',
                'renter.name as renterName',
                'renter.email as renterEmail',
                'renter.phone as renterPhone',
                'renter.nid as renterNid'
            )
            .first();

        if (!flat) {
            return res.status(404).json({
                success: false,
                error: 'Flat not found'
            });
        }

        // Parse flat metadata to get current amenities
        let flatMetadata = {};
        try {
            flatMetadata = flat.metadata && typeof flat.metadata === 'string'
                ? JSON.parse(flat.metadata)
                : flat.metadata || {};
        } catch (e) {
            console.error('Failed to parse flat metadata:', e);
            flatMetadata = {};
        }

        // Use provided amenities or fall back to flat metadata amenities
        let paymentAmenities = [];
        if (amenities && amenities.length > 0) {
            // Use amenities from request (customized for this payment)
            paymentAmenities = amenities.map(amenity => ({
                name: amenity.name || '',
                charge: parseFloat(amenity.charge) || 0
            }));
        } else if (flatMetadata.amenities && flatMetadata.amenities.length > 0) {
            // Use flat's default amenities
            paymentAmenities = flatMetadata.amenities.map(amenity => ({
                name: amenity.name || '',
                charge: parseFloat(amenity.charge) || 0
            }));
        }

        // Calculate amenities total
        const amenitiesTotal = paymentAmenities.reduce(
            (sum, item) => sum + (parseFloat(item.charge) || 0), 
            0
        );

        let hasAccess = false;

        const currentUser = req.user;
        // Check permission
        if (currentUser.role.slug === "web_owner") {
            hasAccess = true;
        } else if (currentUser.role.slug === "house_owner") {
            // House owner can only record payments for their own houses
            hasAccess = flat.ownerId === currentUser.id;
        } else if (currentUser.role.slug === "staff") {
            // Staff needs payments.create permission
            const hasPermission = await permissionService.hasPermission(
                currentUser.id,
                "payments.create"
            );
            hasAccess = hasPermission;
        } else if (currentUser.role.slug === "caretaker") {
            // Caretaker needs payments.create permission for this specific house
            hasAccess = await CaretakerPermissionService.hasCaretakerPermission(
                currentUser.id,
                flat.house_id,
                "payments.create"
            );
        }

        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                error: "You do not have permission to record payments for this house",
            });
        }

        // Get the current pending rent payment
        const currentPayment = await db('rent_payment')
            .where('flat_id', flat_id)
            .andWhere('status', 'in', ['pending', 'overdue'])
            .orderBy('due_date', 'asc')
            .first();

        if (!currentPayment) {
            return res.status(400).json({
                success: false,
                error: 'No pending rent payment found for this flat'
            });
        }

        const actualPaidDate = paid_date ? new Date(paid_date) : new Date();
        
        // Use provided amounts or calculate them
        // FIXED: Use paid_amount from request body, not undefined paidAmount variable
        const baseRentAmount = parseFloat(base_rent || paid_amount || currentPayment.base_amount || flat.rent_amount || 0);
        const calculatedLateFee = parseFloat(late_fee) || 0;

        // If late fee not provided, calculate it
        let finalLateFee = calculatedLateFee;
        if (calculatedLateFee === 0 && actualPaidDate > currentPayment.due_date) {
            const daysLate = Math.ceil((actualPaidDate - currentPayment.due_date) / (1000 * 60 * 60 * 24));
            const dailyLateFee = (baseRentAmount * (flat.late_fee_percentage || 5)) / 100 / 30;
            finalLateFee = Math.round(dailyLateFee * daysLate * 100) / 100;
        }

        // Calculate total
        const totalAmount = baseRentAmount + amenitiesTotal + finalLateFee;
        
        // FIXED: Calculate expected total properly
        // Get the expected total from the current payment
        // If the payment has base_amount and amenities_charge fields, sum them
        // Otherwise, use the amount field which should be the total
        let expectedTotal = 0;
        if (currentPayment.base_amount !== null && currentPayment.base_amount !== undefined && 
            currentPayment.amenities_charge !== null && currentPayment.amenities_charge !== undefined) {
            // Payment has breakdown
            expectedTotal = parseFloat(currentPayment.base_amount || 0) + 
                          parseFloat(currentPayment.amenities_charge || 0);
        } else {
            // Payment doesn't have breakdown, use amount field
            expectedTotal = parseFloat(currentPayment.amount || 0);
        }

        // FIXED: Better status calculation
        let status = 'paid';
        
        // If paid amount is less than expected total, it's partial
        if (totalAmount < expectedTotal) {
            status = 'partial';
        } 
        // If paid amount is 0 or negative, mark as pending
        else if (totalAmount <= 0) {
            status = 'pending';
        }
        // If status was provided in request, use it (but validate)
        else if (req.body.status && ['pending', 'paid', 'overdue', 'partial', 'cancelled'].includes(req.body.status)) {
            status = req.body.status;
        }
        // If we're recording a payment with full amount, it's paid
        else {
            status = 'paid';
        }

        let advancePaymentUsed = null;
        if (use_advance_payment) {
        const availableAdvance = await db('advance_payment')
            .where('flat_id', flat_id)
            .andWhere('renter_id', currentPayment.renter_id)
            .andWhere('remaining_amount', '>', 0)
            .orderBy('payment_date', 'asc')
            .first();

        if (availableAdvance) {
            const useAmount = Math.min(
            parseFloat(availableAdvance.remaining_amount),
            parseFloat(paid_amount) || totalAmount
            );
            
            // Apply advance payment
            const newRemaining = parseFloat(availableAdvance.remaining_amount) - useAmount;
            await db('advance_payment')
            .where('id', availableAdvance.id)
            .update({
                remaining_amount: newRemaining,
                status: newRemaining > 0 ? 'partially_used' : 'fully_used',
                updated_at: new Date()
            });

            advancePaymentUsed = {
            advance_payment_id: availableAdvance.id,
            amount: useAmount,
            remaining: newRemaining
            };

            // Adjust paid amount
            paid_amount = (parseFloat(paid_amount) || totalAmount) - useAmount;
        }
        }

        // Prepare payment metadata
        const paymentMetadata = {
            amenities: paymentAmenities,
            amenitiesTotal: amenitiesTotal,
            lateFee: finalLateFee,
            baseRent: baseRentAmount,
            advancePaymentUsed: advancePaymentUsed,
            renterDetails: {
                name: flat.renterName,
                nid: flat.renterNid
            },
            houseName: flat.houseName,
            flatNumber: flat.number,
            paymentType: amenities.length > 0 ? 'customized' : 'standard',
            statusDetermination: {
                totalPaid: totalAmount,
                expectedTotal: expectedTotal,
                calculationMethod: currentPayment.base_amount !== null ? 'breakdown' : 'simple'
            }
        };

        // Start transaction
        const trx = await db.transaction();

        try {
            // Update rent payment record
            await trx('rent_payment').where('id', currentPayment.id).update({
                paid_date: actualPaidDate,
                paid_amount: totalAmount,
                base_amount: baseRentAmount,
                amenities_charge: amenitiesTotal,
                payment_method,
                transaction_id,
                late_fee_amount: finalLateFee,
                status: status,
                notes,
                metadata: JSON.stringify(paymentMetadata),
                updated_at: new Date()
            });

            // Update flat
            await trx('flat').where('id', flat_id).update({
                last_rent_paid_date: actualPaidDate,
                updatedAt: new Date()
            });

            let nextDueDate = null;

            // Calculate next due date
            if (String(calculate_next_payment) === 'true') {
                nextDueDate = this.calculateNextDueDate(actualPaidDate, flat.should_pay_rent_day);

                // Get flat metadata for next payment
                let nextPaymentAmenities = [];
                if (flatMetadata.amenities && flatMetadata.amenities.length > 0) {
                    // Use flat's default amenities for next payment
                    nextPaymentAmenities = flatMetadata.amenities.map(amenity => ({
                        name: amenity.name || '',
                        charge: parseFloat(amenity.charge) || 0
                    }));
                }

                const nextAmenitiesTotal = nextPaymentAmenities.reduce(
                    (sum, item) => sum + (parseFloat(item.charge) || 0), 
                    0
                );

                const nextPaymentTotal = baseRentAmount + nextAmenitiesTotal;

                const nextPayment = {
                    uuid: uuidv4(),
                    flat_id,
                    renter_id: flat.renter_id,
                    house_id: flat.house_id,
                    amount: nextPaymentTotal, // Store total amount
                    base_amount: baseRentAmount,
                    amenities_charge: nextAmenitiesTotal,
                    metadata: JSON.stringify({
                        amenities: nextPaymentAmenities,
                        breakdown: {
                            base_rent: baseRentAmount,
                            amenities_charge: nextAmenitiesTotal,
                            total: nextPaymentTotal
                        }
                    }),
                    due_date: nextDueDate,
                    status: 'pending',
                    created_at: new Date(),
                    updated_at: new Date()
                };

                await trx('rent_payment').insert(nextPayment);

                // Update flat with next due date
                await trx('flat').where('id', flat_id).update({
                    rent_due_date: nextDueDate
                });
            }

            await trx.commit();

            // Send receipt notification
            if (flat.renterEmail || flat.renterPhone) {
                try {
                    await NotificationService.sendPaymentReceipt({
                        renterName: flat.renterName,
                        email: flat.renterEmail,
                        phone: flat.renterPhone,
                        amount: totalAmount,
                        paymentDate: actualPaidDate,
                        flatNumber: flat.number,
                        houseName: flat.houseName,
                        transactionId: transaction_id,
                        breakdown: {
                            baseRent: baseRentAmount,
                            amenities: amenitiesTotal,
                            lateFee: finalLateFee
                        },
                        status: status
                    });
                } catch (notificationError) {
                    console.error('Failed to send notification:', notificationError);
                    // Don't fail the payment if notification fails
                }
            }

            return res.json({
                success: true,
                data: {
                    paymentId: currentPayment.id,
                    baseRent: baseRentAmount,
                    amenitiesTotal,
                    lateFee: finalLateFee,
                    totalAmount,
                    expectedTotal,
                    status,
                    nextDueDate,
                    metadata: paymentMetadata
                },
                message: 'Payment recorded successfully'
            });

        } catch (error) {
            await trx.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Record rent payment error:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to record payment'
        });
    }
}
    // 2. Generate monthly rent invoices
    async generateRentInvoices(req, res) {
        try {
            const { house_id, month } = req.body;
            const userId = req.user.id;

            // Check permission
            if (req.user.role.slug === 'caretaker') {
                const hasAccess = await this.checkHouseAccess(userId, house_id);
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to generate invoices for this house'
                    });
                }
            }

            // Get all flats with active renters in the house
            const flats = await db('flat')
                .where('house_id', house_id)
                .andWhere('renter_id', '!=', null)
                .select('id', 'renter_id', 'rent_amount', 'should_pay_rent_day', 'number');

            if (flats.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No flats with active renters found in this house'
                });
            }

            const targetMonth = month ? new Date(month) : new Date();
            targetMonth.setMonth(targetMonth.getMonth() + 1); // Next month

            const invoices = [];
            const errors = [];

            for (const flat of flats) {
                try {
                    // Calculate due date for next month
                    const dueDate = new Date(
                        targetMonth.getFullYear(),
                        targetMonth.getMonth(),
                        flat.should_pay_rent_day
                    );

                    // Check if invoice already exists for this month
                    const existingInvoice = await db('rent_payment')
                        .where('flat_id', flat.id)
                        .andWhere('due_date', '>=', new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1))
                        .andWhere('due_date', '<=', new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0))
                        .first();

                    if (existingInvoice) {
                        errors.push(`Invoice already exists for flat ${flat.number} for ${targetMonth.toISOString().slice(0, 7)}`);
                        continue;
                    }

                    // Create rent payment record
                    const rentPayment = {
                        uuid: uuidv4(),
                        flat_id: flat.id,
                        renter_id: flat.renter_id,
                        house_id,
                        amount: flat.rent_amount || 0,
                        due_date,
                        status: 'pending',
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    const [paymentId] = await db('rent_payment').insert(rentPayment);

                    invoices.push({
                        flatId: flat.id,
                        flatNumber: flat.number,
                        amount: flat.rent_amount,
                        dueDate,
                        paymentId
                    });

                } catch (error) {
                    errors.push(`Failed to create invoice for flat ${flat.number}: ${error.message}`);
                }
            }

            return res.json({
                success: true,
                data: {
                    generated: invoices.length,
                    invoices,
                    errors: errors.length > 0 ? errors : undefined
                },
                message: `Generated ${invoices.length} rent invoices`
            });

        } catch (error) {
            console.error('Generate rent invoices error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to generate rent invoices'
            });
        }
    }

    // 3. Record house expense
    async recordExpense(req, res) {
        try {
            const { house_id, category, amount, description, expense_date, payment_method, receipt_url } = req.body;
            const userId = req.user.id;

            // Get house
            const house = await db('house').where('id', house_id).first();
            if (!house) {
                return res.status(404).json({
                    success: false,
                    error: 'House not found'
                });
            }

            // Check permission
            if (req.user.role.slug !== 'web_owner') {
                const hasAccess = await this.checkHouseAccess(userId, house_id);
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to record expenses for this house'
                    });
                }
            }

            // For web_owner, expenses need approval from house owner
            let status = 'pending';
            if (req.user.role.slug === 'web_owner') {
                status = 'pending';
            } else if (req.user.role.slug === 'house_owner' && house.ownerId === userId) {
                status = 'approved';
            } else {
                status = 'pending';
            }

            const expense = {
                uuid: uuidv4(),
                house_id,
                category,
                amount,
                description,
                expense_date: expense_date ? new Date(expense_date) : new Date(),
                paid_by: userId,
                payment_method,
                receipt_url,
                status,
                created_at: new Date(),
                updated_at: new Date()
            };

            const [expenseId] = await db('house_expense').insert(expense);

            // Send approval request if needed
            if (status === 'pending' && req.user.role.slug === 'web_owner') {
                try {
                    await NotificationService.sendExpenseApprovalRequest({
                        houseId: house_id,
                        houseName: house.name,
                        amount,
                        category,
                        description,
                        expenseId: expenseId,
                        requestedBy: req.user.name
                    });
                } catch (notificationError) {
                    console.error('Failed to send approval request:', notificationError);
                }
            }

            return res.status(201).json({
                success: true,
                data: {
                    id: expenseId,
                    ...expense
                },
                message: 'Expense recorded successfully'
            });

        } catch (error) {
            console.error('Record expense error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to record expense'
            });
        }
    }

    // 4. Record app fee payment (A house owner pays app fee to web owner [this platform])
    async recordAppFeePayment(req, res) {
        try {
            const { house_owner_id, house_id, amount, fee_type, due_date, payment_method, transaction_id } = req.body;
            const userId = req.user.id;

            // Only web_owner can record app fee payments
            if (req.user.role.slug === 'caretaker' || req.user.role.slug === 'house_owner') {
                return res.status(403).json({
                    success: false,
                    error: 'Only web owner can record app fee payments'
                });
            }

            // Get house and owner
            const house = await db('house').where('id', house_id).first();
            if (!house) {
                return res.status(404).json({
                    success: false,
                    error: 'House not found'
                });
            }

            const houseOwner = await db('user').where('id', house_owner_id).first();
            if (!houseOwner) {
                return res.status(404).json({
                    success: false,
                    error: 'House owner not found'
                });
            }

            const feePayment = {
                uuid: uuidv4(),
                house_owner_id,
                house_id,
                amount,
                fee_type,
                due_date: due_date ? new Date(due_date) : new Date(),
                paid_date: new Date(),
                payment_method,
                transaction_id,
                status: 'paid',
                created_at: new Date(),
                updated_at: new Date()
            };

            const [paymentId] = await db('app_fee_payment').insert(feePayment);

            // Send notification to house owner
            try {
                await NotificationService.sendAppFeeReceipt({
                    houseOwnerEmail: houseOwner.email,
                    houseOwnerName: houseOwner.name,
                    houseName: house.name,
                    amount,
                    feeType: fee_type,
                    paymentDate: new Date(),
                    transactionId: transaction_id
                });
            } catch (notificationError) {
                console.error('Failed to send notification:', notificationError);
            }

            return res.status(201).json({
                success: true,
                data: {
                    id: paymentId,
                    ...feePayment
                },
                message: 'App fee payment recorded successfully'
            });

        } catch (error) {
            console.error('Record app fee payment error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to record app fee payment'
            });
        }
    }

    // 5. Get financial dashboard
    async getFinancialDashboard(req, res) {
        try {
            const { houseId, startDate, endDate } = req.query;
            const userId = req.user.id;

            let houseIds = [];

            // Determine which houses the user can access
            if (houseId) {
                // Check permission for specific house
                if (req.user.role.slug !== 'web_owner') {
                    const hasAccess = await this.checkHouseAccess(userId, houseId);
                    if (!hasAccess) {
                        return res.status(403).json({
                            success: false,
                            error: 'You do not have permission to view this house\'s financial data'
                        });
                    }
                }
                houseIds = [houseId];
            } else if (req.user.role.slug === 'web_owner') {
                // Web owner can see all houses
                const houses = await db('house').select('id');
                houseIds = houses.map(h => h.id);
            } else {
                // Get houses owned or managed by user
                const houses = await db('house')
                    .leftJoin('caretakerassignment', function() {
                        this.on('house.id', '=', 'caretakerassignment.house_id')
                            .andOn('caretakerassignment.expires_at', '>', new Date());
                    })
                    .where(function() {
                        this.where('house.ownerId', userId)
                            .orWhere('caretakerassignment.caretakerId', userId);
                    })
                    .select('house.id')
                    .distinct();

                houseIds = houses.map(h => h.id);
            }

            if (houseIds.length === 0) {
                return res.json({
                    success: true,
                    data: {
                        overview: {
                            totalRentDue: 0,
                            totalRentCollected: 0,
                            totalExpenses: 0,
                            netIncome: 0,
                            pendingPayments: 0,
                            overduePayments: 0
                        },
                        recentTransactions: [],
                        upcomingPayments: [],
                        chartData: {}
                    }
                });
            }

            const dateFilter = {};
            if (startDate) dateFilter.startDate = new Date(startDate);
            if (endDate) dateFilter.endDate = new Date(endDate);

            // Get overview statistics
            const overview = await this.getFinancialOverview(houseIds, dateFilter);

            // Get recent transactions
            const recentTransactions = await this.getRecentTransactions(houseIds, dateFilter);

            // Get upcoming payments
            const upcomingPayments = await this.getUpcomingPayments(houseIds);

            // Get chart data
            const chartData = await this.getChartData(houseIds, dateFilter);

            return res.json({
                success: true,
                data: {
                    overview,
                    recentTransactions,
                    upcomingPayments,
                    chartData
                }
            });

        } catch (error) {
            console.error('Get financial dashboard error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch financial dashboard'
            });
        }
    }

    // 6. Send rent reminders
    async sendRentReminders(req, res) {
        try {
            const { daysBefore = 3, houseId } = req.body;
            const userId = req.user.id;

            // Check permission
            if (req.user.role.slug !== 'web_owner') {
                if (houseId) {
                    const hasAccess = await this.checkHouseAccess(userId, houseId);
                    if (!hasAccess) {
                        return res.status(403).json({
                            success: false,
                            error: 'You do not have permission to send reminders for this house'
                        });
                    }
                }
            }

            // Calculate reminder date
            const reminderDate = new Date();
            reminderDate.setDate(reminderDate.getDate() + parseInt(daysBefore));

            // Get payments due on reminder date
            let query = db('rent_payment')
                .join('flat', 'rent_payment.flat_id', 'flat.id')
                .join('renter', 'rent_payment.renter_id', 'renter.id')
                .join('house', 'rent_payment.house_id', 'house.id')
                .where('rent_payment.status', 'pending')
                .andWhere('rent_payment.due_date', '<=', reminderDate)
                .andWhere('rent_payment.due_date', '>=', new Date())
                .select(
                    'rent_payment.*',
                    'flat.number as flatNumber',
                    'flat.rent_amount',
                    'renter.name as renterName',
                    'renter.email as renterEmail',
                    'renter.phone as renterPhone',
                    'house.name as houseName'
                );

            if (houseId) {
                query.andWhere('rent_payment.house_id', houseId);
            }

            const payments = await query;

            const results = [];
            const errors = [];

            for (const payment of payments) {
                try {
                    await NotificationService.sendRentReminder({
                        renterName: payment.renterName,
                        email: payment.renterEmail,
                        phone: payment.renterPhone,
                        flatNumber: payment.flatNumber,
                        houseName: payment.houseName,
                        amount: payment.amount,
                        dueDate: payment.due_date,
                        daysBefore: parseInt(daysBefore)
                    });

                    results.push({
                        paymentId: payment.id,
                        renterName: payment.renterName,
                        sent: true
                    });

                } catch (error) {
                    errors.push({
                        paymentId: payment.id,
                        renterName: payment.renterName,
                        error: error.message
                    });
                }
            }

            return res.json({
                success: true,
                data: {
                    remindersSent: results.length,
                    results,
                    errors: errors.length > 0 ? errors : undefined
                },
                message: `Sent ${results.length} rent reminders`
            });

        } catch (error) {
            console.error('Send rent reminders error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to send rent reminders'
            });
        }
    }

    // Helper methods [maybe this need to update with your latest code ]
    async checkHouseAccess(userId, houseId) {
        try {
            const user = await db('user as u')
            .where('u.id', userId)
            .leftJoin('role as r', 'u.roleId', 'r.id')
            .select('u.*', 'r.slug as role_slug')
            .first();
            
            if (!user) return false;

            if (user.role_slug === 'web_owner') {
            return true;
            }

            if (user.role_slug === 'house_owner') {
            const house = await db('house')
                .where('id', houseId)
                .andWhere('ownerId', userId)
                .first();
            return !!house;
            }

            if (user.role_slug === 'staff') {
            // Check if staff manages this house owner
            const house = await db('house').where('id', houseId).first();
            if (!house) return false;
            
            return await HouseController.checkUserHierarchy(userId, house.ownerId);
            }

            if (user.role_slug === 'caretaker') {

            const accessibleHouses = await CaretakerPermissionService.getCaretakerHouses(userId);
            return accessibleHouses.includes(parseInt(houseId));
            }

            return false;
        } catch (error) {
            console.error('Error in checkHouseAccess:', error);
            return false;
        }
    }

    calculateNextDueDate(currentDate, dayOfMonth) {
        const nextMonth = new Date(currentDate);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        nextMonth.setDate(dayOfMonth);
        return nextMonth;
    }

    async getFinancialOverview(houseIds, dateFilter) {
        const whereClause = {
            house_id: { in: houseIds }
        };

        if (dateFilter.startDate) {
            whereClause.created_at = { '>=': dateFilter.startDate };
        }
        if (dateFilter.endDate) {
            whereClause.created_at = whereClause.created_at || {};
            whereClause.created_at['<='] = dateFilter.endDate;
        }

        // Get rent statistics
        const rentStats = await db('rent_payment')
            .whereIn('house_id', houseIds)
            .select(
                db.raw('SUM(amount) as totalDue'),
                db.raw('SUM(paid_amount) as totalCollected'),
                db.raw('COUNT(CASE WHEN status = "pending" THEN 1 END) as pendingCount'),
                db.raw('COUNT(CASE WHEN status = "overdue" THEN 1 END) as overdueCount')
            )
            .first();

        // Get expense statistics
        const expenseStats = await db('house_expense')
            .whereIn('house_id', houseIds)
            .andWhere('status', 'approved')
            .select(db.raw('SUM(amount) as totalExpenses'))
            .first();

        const totalRentDue = parseFloat(rentStats.totalDue || 0);
        const totalRentCollected = parseFloat(rentStats.totalCollected || 0);
        const totalExpenses = parseFloat(expenseStats.totalExpenses || 0);
        const netIncome = totalRentCollected - totalExpenses;

        return {
            totalRentDue,
            totalRentCollected,
            totalExpenses,
            netIncome,
            pendingPayments: parseInt(rentStats.pendingCount || 0),
            overduePayments: parseInt(rentStats.overdueCount || 0)
        };
    }

    async getRecentTransactions(houseIds, dateFilter) {
        let query = db('rent_payment')
            .whereIn('house_id', houseIds)
            .unionAll(function() {
                this.select(
                    'id',
                    'uuid',
                    'house_id',
                    db.raw('"expense" as type'),
                    'amount',
                    'created_at',
                    'status',
                    db.raw('NULL as payment_method'),
                    db.raw('NULL as renter_id'),
                    db.raw('NULL as flat_id')
                )
                .from('house_expense')
                .whereIn('house_id', houseIds);
            })
            .orderBy('created_at', 'desc')
            .limit(20);

        if (dateFilter.startDate) {
            query.andWhere('created_at', '>=', dateFilter.startDate);
        }
        if (dateFilter.endDate) {
            query.andWhere('created_at', '<=', dateFilter.endDate);
        }

        const transactions = await query;

        // Fetch additional details
        const enhancedTransactions = await Promise.all(
            transactions.map(async (tx) => {
                if (tx.type === 'rent') {
                    const details = await db('rent_payment')
                        .join('flat', 'rent_payment.flat_id', 'flat.id')
                        .join('renter', 'rent_payment.renter_id', 'renter.id')
                        .where('rent_payment.id', tx.id)
                        .select(
                            'flat.number as flatNumber',
                            'renter.name as renterName',
                            'rent_payment.payment_method'
                        )
                        .first();

                    return {
                        ...tx,
                        flatNumber: details?.flatNumber,
                        renterName: details?.renterName,
                        description: `Rent payment - Flat ${details?.flatNumber}`
                    };
                } else {
                    const details = await db('house_expense')
                        .where('id', tx.id)
                        .select('category', 'description')
                        .first();

                    return {
                        ...tx,
                        description: details?.description || `${details?.category} expense`
                    };
                }
            })
        );

        return enhancedTransactions;
    }

    async getUpcomingPayments(houseIds) {
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        const payments = await db('rent_payment')
            .join('flat', 'rent_payment.flat_id', 'flat.id')
            .join('renter', 'rent_payment.renter_id', 'renter.id')
            .join('house', 'rent_payment.house_id', 'house.id')
            .whereIn('rent_payment.house_id', houseIds)
            .andWhere('rent_payment.status', 'pending')
            .andWhere('rent_payment.due_date', '<=', thirtyDaysFromNow)
            .andWhere('rent_payment.due_date', '>=', new Date())
            .select(
                'rent_payment.*',
                'flat.number as flatNumber',
                'renter.name as renterName',
                'renter.phone as renterPhone',
                'house.name as houseName'
            )
            .orderBy('rent_payment.due_date', 'asc')
            .limit(10);

        return payments;
    }

    async getChartData(houseIds, dateFilter) {
        const sixMonthsAgo = new Date();
        sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

        // Get monthly rent collected
        const monthlyRent = await db('rent_payment')
            .whereIn('house_id', houseIds)
            .andWhere('status', 'paid')
            .andWhere('paid_date', '>=', sixMonthsAgo)
            .select(
                db.raw('DATE_FORMAT(paid_date, "%Y-%m") as month'),
                db.raw('SUM(paid_amount) as amount')
            )
            .groupBy('month')
            .orderBy('month');

        // Get monthly expenses
        const monthlyExpenses = await db('house_expense')
            .whereIn('house_id', houseIds)
            .andWhere('status', 'approved')
            .andWhere('expense_date', '>=', sixMonthsAgo)
            .select(
                db.raw('DATE_FORMAT(expense_date, "%Y-%m") as month'),
                db.raw('SUM(amount) as amount')
            )
            .groupBy('month')
            .orderBy('month');

        // Get payment status distribution
        const paymentStatus = await db('rent_payment')
            .whereIn('house_id', houseIds)
            .select(
                'status',
                db.raw('COUNT(*) as count'),
                db.raw('SUM(amount) as amount')
            )
            .groupBy('status');

        // Get expense categories
        const expenseCategories = await db('house_expense')
            .whereIn('house_id', houseIds)
            .andWhere('status', 'approved')
            .select(
                'category',
                db.raw('SUM(amount) as amount'),
                db.raw('COUNT(*) as count')
            )
            .groupBy('category');

        return {
            monthlyRent: monthlyRent.map(item => ({
                month: item.month,
                amount: parseFloat(item.amount || 0)
            })),
            monthlyExpenses: monthlyExpenses.map(item => ({
                month: item.month,
                amount: parseFloat(item.amount || 0)
            })),
            paymentStatus: paymentStatus.map(item => ({
                status: item.status,
                count: parseInt(item.count || 0),
                amount: parseFloat(item.amount || 0)
            })),
            expenseCategories: expenseCategories.map(item => ({
                category: item.category,
                amount: parseFloat(item.amount || 0),
                count: parseInt(item.count || 0)
            }))
        };
    }
}

module.exports = new FinancialController();