// Updated FinancialController.js with snake_case column names
const db = require('../config/knex');
const { v4: uuidv4 } = require('uuid');
const NotificationService = require('../services/emailSmsNotification.service');

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
    }
    // 1. Record rent payment (manual by house owner)
    async recordRentPayment(req, res) {
        try {
            const { payment_method, paid_amount, transaction_id, notes, paid_date } = req.body;
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
                    'renter.name as renterName',
                    'renter.email as renterEmail',
                    'renter.phone as renterPhone'
                )
                .first();

            if (!flat) {
                return res.status(404).json({
                    success: false,
                    error: 'Flat not found'
                });
            }

            // Check permission
            if (req.user.role.slug !== 'web_owner') {
                const hasAccess = await this.checkHouseAccess(userId, flat.house_id);
                if (!hasAccess) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to record payments for this house'
                    });
                }
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
            const paymentAmount = paid_amount || currentPayment.amount;
            let lateFee = 0;

            // Calculate late fee if payment is late
            if (actualPaidDate > currentPayment.due_date) {
                const daysLate = Math.ceil((actualPaidDate - currentPayment.due_date) / (1000 * 60 * 60 * 24));
                const dailyLateFee = (currentPayment.amount * (flat.late_fee_percentage || 5)) / 100 / 30;
                lateFee = Math.round(dailyLateFee * daysLate * 100) / 100;
            }

            const totalAmount = parseFloat(paymentAmount) + parseFloat(lateFee);
            const status = parseFloat(paymentAmount) >= parseFloat(currentPayment.amount) ? 'paid' : 'partial';

            // Start transaction
            const trx = await db.transaction();

            try {
                // Update rent payment record
                await trx('rent_payment').where('id', currentPayment.id).update({
                    paid_date: actualPaidDate,
                    paid_amount: totalAmount,
                    payment_method,
                    transaction_id,
                    late_fee_amount: lateFee,
                    status,
                    notes,
                    updated_at: new Date()
                });

                // Update flat
                await trx('flat').where('id', flat_id).update({
                    last_rent_paid_date: actualPaidDate,
                    updatedAt: new Date()
                });

                // Calculate next due date
                const nextDueDate = this.calculateNextDueDate(actualPaidDate, flat.should_pay_rent_day);

                // Create next month's rent payment
                const nextPayment = {
                    uuid: uuidv4(),
                    flat_id,
                    renter_id: flat.renter_id,
                    house_id: flat.house_id,
                    amount: flat.rent_amount || 0,
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
                            transactionId: transaction_id
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
                        amount: totalAmount,
                        lateFee,
                        status,
                        nextDueDate
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

    // 4. Record app fee payment
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

    // Helper methods
    async checkHouseAccess(userId, houseId) {
        const result = await db('house')
            .leftJoin('caretakerassignment', function() {
                this.on('house.id', '=', 'caretakerassignment.houseId')
                    .andOn('caretakerassignment.expiresAt', '>', new Date());
            })
            .where('house.id', houseId)
            .andWhere(function() {
                this.where('house.ownerId', userId)
                    .orWhere('caretakerassignment.caretakerId', userId);
            })
            .select('house.id')
            .first();

        return !!result;
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