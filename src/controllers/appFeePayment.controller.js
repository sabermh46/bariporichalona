const db = require("../config/knex");
const { v4: uuidv4 } = require("uuid");
const hasPermission = require("../services/permission.service").hasPermission;
const NotificationService = require("../services/emailSmsNotification.service");
const { serializeBigInt } = require("../utils/serializer");

/**
 * When an app fee payment is accepted/recorded as paid, add the payment amount to the
 * house owner's expense records (one row per active house, amount split equally).
 * @param {object} dbOrTrx - db or transaction
 * @param {object} opts - { house_owner_id, amount, app_fee_payment_id, paid_date, verified_by }
 */
async function createExpenseRecordsForAppFeePayment(dbOrTrx, opts) {
    const { house_owner_id, amount, app_fee_payment_id, paid_date, verified_by } = opts;
    const houses = await dbOrTrx("house")
        .where("ownerId", house_owner_id)
        .andWhere("active", true)
        .select("id")
        .orderBy("id", "asc");
    if (houses.length === 0) return;
    const totalAmount = parseFloat(amount) || 0;
    if (totalAmount <= 0) return;
    const paidDate = paid_date ? new Date(paid_date) : new Date();
    const n = houses.length;
    const basePerHouse = Math.floor((totalAmount / n) * 100) / 100;
    const remainder = Math.round((totalAmount - basePerHouse * n) * 100) / 100;
    const expenseMeta = JSON.stringify({
        type: "app_fee",
        app_fee_payment_id,
        house_owner_id,
    });
    for (let i = 0; i < n; i++) {
        const houseAmount = i === n - 1 ? basePerHouse + remainder : basePerHouse;
        await dbOrTrx("house_expense").insert({
            uuid: uuidv4(),
            house_id: houses[i].id,
            category: "other",
            amount: houseAmount,
            description: "App fee (subscription)",
            expense_date: paidDate,
            status: "approved",
            approved_by: verified_by || null,
            paid_by: verified_by || null,
            metadata: expenseMeta,
            created_at: new Date(),
            updated_at: new Date(),
        });
    }
}

class AppFeePaymentController {
    constructor() {
        this.monthlyFeePerHouse = 500;
        this.defaultSubscriptionDays = 30;
        this.defaultOffsetDays = 5;
        this.getAmountForHouseCount = this.getAmountForHouseCount.bind(this);
        this.getAppFeeStatus = this.getAppFeeStatus.bind(this);
        this.calculateDueAmount = this.calculateDueAmount.bind(this);
        this.generateMonthlyFees = this.generateMonthlyFees.bind(this);
        this.createPayment = this.createPayment.bind(this);
        this.updatePayment = this.updatePayment.bind(this);
        this.deletePayment = this.deletePayment.bind(this);
        this.getPayments = this.getPayments.bind(this);
        this.getPaymentStats = this.getPaymentStats.bind(this);
        this.getAccessibleHouseOwners = this.getAccessibleHouseOwners.bind(this);
        this.getEmailLog = this.getEmailLog.bind(this);
        this.getEmailLogByRowId = this.getEmailLogByRowId.bind(this);
        this.resendAppFeeMail = this.resendAppFeeMail.bind(this);
    }

    // Amount for N houses (tiered: 1=500, 2=1000, 3=1500, ...)
    getAmountForHouseCount(houseCount) {
        const n = Math.max(0, parseInt(houseCount, 10) || 0);
        return n * this.monthlyFeePerHouse;
    }

    // DB ENUM is cash, bank, mobile_banking, other. Map API values (e.g. bank_transfer, mobile_money) to DB.
    normalizePaymentMethod(value) {
        if (!value || typeof value !== 'string') return null;
        const v = value.toLowerCase().trim();
        if (v === 'bank_transfer' || v === 'bank') return 'bank';
        if (v === 'mobile_money' || v === 'mobile_banking') return 'mobile_banking';
        if (['cash', 'other'].includes(v)) return v;
        return null;
    }

    // App fee status for middleware & UI: expiry, grace, block
    async getAppFeeStatus(houseOwnerId) {
        const lastPaid = await db("app_fee_payment")
            .where("house_owner_id", houseOwnerId)
            .andWhere("status", "paid")
            .whereNotNull("paid_date")
            .whereNull("deleted_at")
            .orderBy("paid_date", "desc")
            .select("id", "paid_date", "subscription_days", "offset_days", "house_count", "amount")
            .first();
        if (!lastPaid) {
            return {
                isActive: false,
                expiresAt: null,
                blockAfter: null,
                inGracePeriod: false,
                isBlocked: true,
                lastPaidPayment: null,
                canCreatePayment: true,
            };
        }
        const paidDate = new Date(lastPaid.paid_date);
        const subDays = parseInt(lastPaid.subscription_days, 10) || this.defaultSubscriptionDays;
        const offsetDays = parseInt(lastPaid.offset_days, 10) || this.defaultOffsetDays;
        const expiresAt = new Date(paidDate);
        expiresAt.setDate(expiresAt.getDate() + subDays);
        const blockAfter = new Date(expiresAt);
        blockAfter.setDate(blockAfter.getDate() + offsetDays);
        const now = new Date();
        const inGracePeriod = now > expiresAt && now <= blockAfter;
        const isBlocked = now > blockAfter;
        return {
            isActive: now <= blockAfter,
            expiresAt: expiresAt.toISOString(),
            blockAfter: blockAfter.toISOString(),
            inGracePeriod,
            isBlocked,
            lastPaidPayment: lastPaid,
            canCreatePayment: !isBlocked,
        };
    }

    // Calculate due amount for house owner (one record per owner, house_count = active houses)
    async calculateDueAmount(houseOwnerId) {
        try {
            const activeHouses = await db("house")
                .where("ownerId", houseOwnerId)
                .andWhere("active", true)
                .count("id as count")
                .first();
            const houseCount = parseInt(activeHouses.count, 10) || 0;
            const totalDue = this.getAmountForHouseCount(houseCount);
            const currentMonth = new Date().toISOString().slice(0, 7);
            const existingPayment = await db("app_fee_payment")
                .where("house_owner_id", houseOwnerId)
                .andWhere("start_date", "like", `${currentMonth}%`)
                .andWhere("status", "pending")
                .whereNull("deleted_at")
                .first();
            const status = await this.getAppFeeStatus(houseOwnerId);
            return {
                houseOwnerId,
                activeHouseCount: houseCount,
                monthlyFeePerHouse: this.monthlyFeePerHouse,
                totalDue,
                hasPendingPayment: !!existingPayment,
                pendingPaymentId: existingPayment?.id,
                appFeeStatus: status,
            };
        } catch (error) {
            console.error("Calculate due amount error:", error);
            return null;
        }
    }

    // Generate monthly fees for all house owners (to be run via cron)
    async generateMonthlyFees() {
        const trx = await db.transaction();
        
        try {
            const currentDate = new Date();
            const startDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 10); // Start on 10th of next month
            
            // Get all active house owners
            const houseOwners = await trx('user as u')
                .join('role as r', 'u.roleId', 'r.id')
                .where('r.slug', 'house_owner')
                .andWhere('u.status', 'active')
                .select('u.id');
            
            const results = [];
            
            for (const owner of houseOwners) {
                const calculation = await this.calculateDueAmount(owner.id);
                
                if (calculation && calculation.activeHouseCount > 0 && !calculation.hasPendingPayment) {
                    const paymentData = {
                        uuid: uuidv4(),
                        house_owner_id: owner.id,
                        house_count: calculation.activeHouseCount,
                        amount: calculation.totalDue,
                        fee_type: 'monthly_subscription',
                        start_date: startDate,
                        subscription_days: this.defaultSubscriptionDays,
                        offset_days: this.defaultOffsetDays,
                        payment_method: null,
                        transaction_id: null,
                        status: 'pending',
                        metadata: JSON.stringify({
                            generatedAt: new Date().toISOString(),
                            houseCount: calculation.activeHouseCount,
                            monthlyFeePerHouse: this.monthlyFeePerHouse,
                            calculationDetails: calculation
                        }),
                        created_at: new Date(),
                        updated_at: new Date()
                    };

                    const [paymentId] = await trx('app_fee_payment').insert(paymentData);
                    results.push({ ownerId: owner.id, paymentId, amount: calculation.totalDue });
                }
            }
            
            await trx.commit();
            return results;
        } catch (error) {
            await trx.rollback();
            throw error;
        }
    }

    // Create payment record: house_owner creates pending; web_owner can create accepted (status=paid) directly
    async createPayment(req, res) {
        try {
            const {
                house_owner_id,
                house_count: houseCountBody,
                amount,
                payment_method: paymentMethodBody,
                paymentMethod: paymentMethodBodyCamel,
                transaction_id,
                notes,
                proof_image_url,
                status: statusBody,
                subscription_days: subscriptionDaysBody,
                offset_days: offsetDaysBody,
                start_date: startDateBody,
                sendMail,
                sendSms
            } = req.body;
            const paymentMethodRaw = paymentMethodBody ?? paymentMethodBodyCamel;

            const userId = req.user.id;
            const userRole = req.user.role?.slug;

            if (!house_owner_id || amount == null || amount === '') {
                return res.status(400).json({
                    success: false,
                    error: 'house_owner_id and amount are required'
                });
            }
            
            let validHouseOwnerId = house_owner_id;
            
            // Check permissions
            if (userRole === 'house_owner' || userRole === 'caretaker') {
                return res.status(403).json({
                    success: false,
                    error: 'You cannot create app fee payments. Please contact the web owner.'
                });
            } else if (userRole === 'staff') {
                // Staff needs permission
                const hasPerm = await hasPermission(userId, 'app_fees.create');
                if (!hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to create app fee payments'
                    });
                }
            } else if (userRole === 'web_owner') {
                // Web owner can create for anyone
                // No additional checks needed
            } else {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to create payments'
                });
            }
            
            const houseOwner = await db('user as u')
                .join('role as r', 'u.roleId', 'r.id')
                .where('u.id', validHouseOwnerId)
                .andWhere('r.slug', 'house_owner')
                .andWhere('u.status', 'active')
                .first();

            if (!houseOwner) {
                return res.status(404).json({
                    success: false,
                    error: 'House owner not found or inactive'
                });
            }

            const activeHouseCount = await db('house')
                .where('ownerId', validHouseOwnerId)
                .andWhere('active', true)
                .count('id as count')
                .first()
                .then((r) => parseInt(r.count, 10) || 0);

            const houseCount = Number.isFinite(Number(houseCountBody)) && Number(houseCountBody) > 0
                ? Math.max(1, parseInt(houseCountBody, 10))
                : Math.max(1, activeHouseCount);

            if (userRole === 'house_owner' && houseCount > activeHouseCount) {
                return res.status(400).json({
                    success: false,
                    error: 'house_count cannot exceed your active house count'
                });
            }

            const expectedAmount = this.getAmountForHouseCount(houseCount);
            const amountNum = parseFloat(amount);
            if (!Number.isFinite(amountNum) || amountNum < 0) {
                return res.status(400).json({
                    success: false,
                    error: 'amount must be a valid number'
                });
            }

            const isWebOwnerCreatingPaid = userRole === 'web_owner' && statusBody === 'paid';
            const isWebOwnerCreatingPending = userRole === 'web_owner' && statusBody !== 'paid';
            const status = isWebOwnerCreatingPaid ? 'paid' : 'pending';
            const normalizedMethod = this.normalizePaymentMethod(paymentMethodRaw);
            const paymentMethod = normalizedMethod || (isWebOwnerCreatingPaid ? 'other' : null);
            if (!isWebOwnerCreatingPaid && !paymentMethod) {
                return res.status(400).json({
                    success: false,
                    error: 'payment_method is required when creating a pending payment (allowed: cash, bank, bank_transfer, mobile_banking, mobile_money, other)'
                });
            }

            const subscriptionDays = Number.isFinite(Number(subscriptionDaysBody)) && Number(subscriptionDaysBody) > 0
                ? parseInt(subscriptionDaysBody, 10)
                : this.defaultSubscriptionDays;
            const offsetDays = Number.isFinite(Number(offsetDaysBody)) && Number(offsetDaysBody) >= 0
                ? parseInt(offsetDaysBody, 10)
                : this.defaultOffsetDays;

            const metadata = {
                createdBy: {
                    id: userId,
                    role: userRole,
                    name: req.user.name,
                    email: req.user.email
                },
                createdAt: new Date().toISOString(),
                proofImageUrl: proof_image_url || null,
                additionalNotes: notes || null
            };
            if (isWebOwnerCreatingPending) {
                metadata.webOwnerCreatedPending = true;
            }

            let resolvedStartDate;
            if (userRole === 'web_owner' || userRole === 'staff') {
                const existingPending = await db('app_fee_payment')
                    .where('house_owner_id', validHouseOwnerId)
                    .andWhere('status', 'pending')
                    .whereNull('deleted_at')
                    .orderBy('start_date', 'desc')
                    .first();
                const today = new Date();
                today.setHours(0, 0, 0, 0);

                if (existingPending) {
                    const pendingStart = new Date(existingPending.start_date);
                    pendingStart.setHours(0, 0, 0, 0);
                    const subDays = parseInt(existingPending.subscription_days, 10) || subscriptionDays;
                    const periodEnd = new Date(pendingStart);
                    periodEnd.setDate(periodEnd.getDate() + subDays);
                    if (today >= pendingStart && today <= periodEnd) {
                        return res.status(400).json({
                            success: false,
                            error: 'There is already a pending invoice, within range today.'
                        });
                    }
                    const prevStart = new Date(existingPending.start_date);
                    prevStart.setHours(0, 0, 0, 0);
                    const minStart = new Date(prevStart);
                    minStart.setDate(minStart.getDate() + subDays);
                    if (startDateBody != null && startDateBody !== '') {
                        const provided = new Date(startDateBody);
                        provided.setHours(0, 0, 0, 0);
                        if (provided < minStart) {
                            return res.status(400).json({
                                success: false,
                                error: `start_date must be on or after ${minStart.toISOString().slice(0, 10)} (previous start_date + subscription_days)`
                            });
                        }
                        resolvedStartDate = provided;
                    } else {
                        const nextStart = new Date(minStart);
                        nextStart.setDate(nextStart.getDate() + 1);
                        resolvedStartDate = nextStart;
                    }
                } else {
                    const latestAny = await db('app_fee_payment')
                        .where('house_owner_id', validHouseOwnerId)
                        .whereNull('deleted_at')
                        .orderBy('start_date', 'desc')
                        .first();
                    if (latestAny) {
                        const prevStart = new Date(latestAny.start_date);
                        prevStart.setHours(0, 0, 0, 0);
                        const subDays = parseInt(latestAny.subscription_days, 10) || subscriptionDays;
                        const minStart = new Date(prevStart);
                        minStart.setDate(minStart.getDate() + subDays);
                        if (startDateBody != null && startDateBody !== '') {
                            const provided = new Date(startDateBody);
                            provided.setHours(0, 0, 0, 0);
                            if (provided < minStart) {
                                return res.status(400).json({
                                    success: false,
                                    error: `start_date must be on or after ${minStart.toISOString().slice(0, 10)} (previous start_date + subscription_days)`
                                });
                            }
                            resolvedStartDate = provided;
                        } else {
                            const nextStart = new Date(minStart);
                            nextStart.setDate(nextStart.getDate() + 1);
                            resolvedStartDate = nextStart;
                        }
                    } else {
                        resolvedStartDate = startDateBody ? new Date(startDateBody) : new Date();
                    }
                }
            } else {
                resolvedStartDate = startDateBody ? new Date(startDateBody) : new Date();
            }

            const paymentData = {
                uuid: uuidv4(),
                house_owner_id: validHouseOwnerId,
                house_count: houseCount,
                amount: amountNum,
                fee_type: 'monthly_subscription',
                start_date: resolvedStartDate,
                subscription_days: subscriptionDays,
                offset_days: offsetDays,
                payment_method: paymentMethod,
                transaction_id: transaction_id || null,
                status,
                notes: notes || null,
                metadata: JSON.stringify(metadata),
                created_at: new Date(),
                updated_at: new Date()
            };
            if (status === 'paid') {
                paymentData.paid_date = new Date();
                paymentData.verified_by = userId;
                paymentData.verified_at = new Date();
            }
            
            const [paymentId] = await db('app_fee_payment').insert(paymentData);

            if (status === 'paid') {
                try {
                    await createExpenseRecordsForAppFeePayment(db, {
                        house_owner_id: validHouseOwnerId,
                        amount: amountNum,
                        app_fee_payment_id: paymentId,
                        paid_date: new Date(),
                        verified_by: userId
                    });
                } catch (expenseErr) {
                    console.error('Create app fee expense records error:', expenseErr);
                }
                if (sendMail !== false) {
                    try {
                        await NotificationService.sendAppFeeReceipt({
                            houseOwnerEmail: houseOwner.email,
                            houseOwnerName: houseOwner.name,
                            amount: amountNum,
                            feeType: 'monthly_subscription',
                            paymentDate: new Date(),
                            houseName: null,
                            table_name: 'app_fee',
                            row_id: paymentId
                        });
                    } catch (mailErr) {
                        console.error('App fee receipt email error:', mailErr);
                    }
                }
            }

            // When web_owner or staff creates a pending invoice, also email the house owner (unless sendMail === false)
            if (status === 'pending' && (userRole === 'web_owner' || userRole === 'staff') && sendMail !== false) {
                try {
                    await NotificationService.sendAppFeeReceipt({
                        houseOwnerEmail: houseOwner.email,
                        houseOwnerName: houseOwner.name,
                        amount: amountNum,
                        feeType: 'monthly_subscription',
                        paymentDate: resolvedStartDate || new Date(),
                        houseName: null,
                        table_name: 'app_fee',
                        row_id: paymentId
                    });
                } catch (mailErr) {
                    console.error('App fee pending invoice email error:', mailErr);
                }
            }

            // When house_owner or caretaker creates pending, notify web_owner
            if (status === 'pending' && (userRole === 'house_owner' || userRole === 'caretaker') && sendMail !== false) {
                try {
                    const webOwner = await db('user as u')
                        .join('role as r', 'u.roleId', 'r.id')
                        .where('r.slug', 'web_owner')
                        .andWhere('u.status', 'active')
                        .select('u.email')
                        .first();
                    if (webOwner && webOwner.email) {
                        await NotificationService.sendAppFeeRequestToWebOwner({
                            webOwnerEmail: webOwner.email,
                            houseOwnerName: houseOwner.name,
                            houseOwnerEmail: houseOwner.email,
                            amount: amountNum,
                            paymentId,
                            transactionId: transaction_id || null,
                            notes: notes || null,
                            requestedAt: new Date()
                        });
                    }
                } catch (mailErr) {
                    console.error('App fee request to web owner email error:', mailErr);
                }
            }

            // Get the created payment with relations
            const payment = await db('app_fee_payment as afp')
                .join('user as ho', 'afp.house_owner_id', 'ho.id')
                .leftJoin('user as v', 'afp.verified_by', 'v.id')
                .where('afp.id', paymentId)
                .select(
                    'afp.*',
                    'ho.name as house_owner_name',
                    'ho.email as house_owner_email',
                    'v.name as verifier_name'
                )
                .first();
            
            return res.status(201).json({
                success: true,
                data: payment,
                message: status === 'paid'
                    ? 'App fee payment recorded successfully.'
                    : 'Payment record created successfully. Waiting for verification.'
            });
            
        } catch (error) {
            console.error('Create payment error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to create payment record'
            });
        }
    }

    // Update payment
    async updatePayment(req, res) {
        const trx = await db.transaction();
        
        try {
            const { id } = req.params;
            const {
                status,
                notes,
                verified_notes,
                paid_date,
                transaction_id,
                payment_method: paymentMethodBody,
                paymentMethod: paymentMethodBodyCamel,
                invoice_url,
                subscription_days: subscriptionDaysBody,
                offset_days: offsetDaysBody,
                sendMail,
                sendSms
            } = req.body;
            const paymentMethodRaw = paymentMethodBody ?? paymentMethodBodyCamel;
            
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Get payment
            const payment = await trx('app_fee_payment')
                .where('id', id)
                .whereNull('deleted_at')
                .first();
            
            if (!payment) {
                await trx.rollback();
                return res.status(404).json({
                    success: false,
                    error: 'Payment not found'
                });
            }
            
            // Parse existing metadata
            let metadata = {};
            if (payment.metadata) {
                try {
                    metadata = JSON.parse(payment.metadata);
                } catch (e) {
                    console.error('Error parsing metadata:', e);
                }
            }

            // Branch: web_owner / staff (full verify)
            if (['web_owner', 'staff'].includes(userRole)) {
                if (userRole === 'staff') {
                    const hasPerm = await hasPermission(userId, 'app_fees.verify');
                    if (!hasPerm) {
                        await trx.rollback();
                        return res.status(403).json({
                            success: false,
                            error: 'You do not have permission to verify payments'
                        });
                    }
                }

                const updateData = {
                    updated_at: new Date()
                };

                if (status) {
                    updateData.status = status;
                    
                    if (status === 'paid') {
                        updateData.verified_by = userId;
                        updateData.verified_at = new Date();
                        updateData.paid_date = paid_date || new Date();
                        if (Number.isFinite(Number(subscriptionDaysBody)) && Number(subscriptionDaysBody) > 0) {
                            updateData.subscription_days = parseInt(subscriptionDaysBody, 10);
                        }
                        if (Number.isFinite(Number(offsetDaysBody)) && Number(offsetDaysBody) >= 0) {
                            updateData.offset_days = parseInt(offsetDaysBody, 10);
                        }
                        metadata.verifiedBy = {
                            id: userId,
                            name: req.user.name,
                            email: req.user.email,
                            role: userRole,
                            verifiedAt: new Date().toISOString()
                        };
                        metadata.closed = true;
                        if (metadata.waiting_for_confirm !== undefined) delete metadata.waiting_for_confirm;
                    }
                    if (status === 'pending') {
                        if (metadata.waiting_for_confirm !== undefined) delete metadata.waiting_for_confirm;
                        if (metadata.closed !== undefined) delete metadata.closed;
                    }
                }

                if (notes !== undefined) updateData.notes = notes;
                if (verified_notes !== undefined) {
                    updateData.notes = (updateData.notes || '') + 
                        `\n[VERIFICATION NOTES - ${new Date().toLocaleString()}] ${verified_notes}`;
                }
                if (transaction_id !== undefined) updateData.transaction_id = transaction_id;
                if (paymentMethodRaw !== undefined && paymentMethodRaw !== null && paymentMethodRaw !== '') {
                    const normalized = this.normalizePaymentMethod(paymentMethodRaw);
                    updateData.payment_method = normalized || 'other';
                }
                if (invoice_url !== undefined) updateData.invoice_url = invoice_url;
                if (paid_date !== undefined) updateData.paid_date = paid_date;

                updateData.metadata = JSON.stringify({
                    ...metadata,
                    lastUpdatedBy: userId,
                    lastUpdatedAt: new Date().toISOString()
                });

                await trx('app_fee_payment')
                    .where('id', id)
                    .update(updateData);

                // When accepting (status paid) by web_owner/staff, add expense records
                if (status === 'paid') {
                    const paidDate = updateData.paid_date || new Date();
                    await createExpenseRecordsForAppFeePayment(trx, {
                        house_owner_id: payment.house_owner_id,
                        amount: payment.amount,
                        app_fee_payment_id: id,
                        paid_date: paidDate,
                        verified_by: userId
                    });
                }

                const updatedPayment = await trx('app_fee_payment as afp')
                    .join('user as ho', 'afp.house_owner_id', 'ho.id')
                    .leftJoin('user as v', 'afp.verified_by', 'v.id')
                    .where('afp.id', id)
                    .select(
                        'afp.*',
                        'ho.name as house_owner_name',
                        'ho.email as house_owner_email',
                        'v.name as verifier_name'
                    )
                    .first();
                
                await trx.commit();

                if (status === 'paid' && sendMail !== false && updatedPayment) {
                    try {
                        await NotificationService.sendAppFeeReceipt({
                            houseOwnerEmail: updatedPayment.house_owner_email,
                            houseOwnerName: updatedPayment.house_owner_name,
                            amount: payment.amount,
                            feeType: payment.fee_type || 'monthly_subscription',
                            paymentDate: updateData.paid_date || new Date(),
                            houseName: null,
                            table_name: 'app_fee',
                            row_id: parseInt(id, 10)
                        });
                    } catch (mailErr) {
                        console.error('App fee receipt email error:', mailErr);
                    }
                }

                return res.json({
                    success: true,
                    data: updatedPayment,
                    message: 'Payment updated successfully'
                });
            }

            // Branch: house_owner / caretaker (limited edit)
            if (userRole === 'house_owner') {
                if (payment.house_owner_id !== userId) {
                    await trx.rollback();
                    return res.status(403).json({
                        success: false,
                        error: 'You can only update your own app fee payments'
                    });
                }
            } else if (userRole === 'caretaker') {
                const accessibleOwners = await this.getAccessibleHouseOwners(userId);
                if (!accessibleOwners.includes(payment.house_owner_id)) {
                    await trx.rollback();
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have access to this payment'
                    });
                }
            } else {
                await trx.rollback();
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to update payments'
                });
            }

            const updateDataOwner = {
                updated_at: new Date()
            };

            if (status) {
                updateDataOwner.status = status;
                if (status === 'paid') {
                    updateDataOwner.paid_date = paid_date || new Date();
                    metadata.waiting_for_confirm = true;
                }
            }
            if (notes !== undefined) updateDataOwner.notes = notes;
            if (transaction_id !== undefined) updateDataOwner.transaction_id = transaction_id;
            if (paymentMethodRaw !== undefined && paymentMethodRaw !== null && paymentMethodRaw !== '') {
                const normalizedOwner = this.normalizePaymentMethod(paymentMethodRaw);
                updateDataOwner.payment_method = normalizedOwner || 'other';
            }

            updateDataOwner.metadata = JSON.stringify({
                ...metadata,
                lastUpdatedBy: userId,
                lastUpdatedAt: new Date().toISOString()
            });

            await trx('app_fee_payment')
                .where('id', id)
                .update(updateDataOwner);

            const updatedPaymentOwner = await trx('app_fee_payment as afp')
                .join('user as ho', 'afp.house_owner_id', 'ho.id')
                .leftJoin('user as v', 'afp.verified_by', 'v.id')
                .where('afp.id', id)
                .select(
                    'afp.*',
                    'ho.name as house_owner_name',
                    'ho.email as house_owner_email',
                    'v.name as verifier_name'
                )
                .first();

            await trx.commit();

            // If house_owner/caretaker marks as paid, inform web_owner via email
            if (status === 'paid' && sendMail !== false) {
                try {
                    const webOwner = await db('user as u')
                        .join('role as r', 'u.roleId', 'r.id')
                        .where('r.slug', 'web_owner')
                        .andWhere('u.status', 'active')
                        .select('u.email')
                        .first();
                    if (webOwner && webOwner.email) {
                        await NotificationService.sendAppFeeRequestToWebOwner({
                            webOwnerEmail: webOwner.email,
                            houseOwnerName: updatedPaymentOwner.house_owner_name,
                            houseOwnerEmail: updatedPaymentOwner.house_owner_email,
                            amount: payment.amount,
                            paymentId: parseInt(id, 10),
                            transactionId: transaction_id || payment.transaction_id || null,
                            notes: notes || payment.notes || null,
                            requestedAt: new Date()
                        });
                    }
                } catch (mailErr) {
                    console.error('App fee owner-paid notification email error:', mailErr);
                }
            }

            return res.json({
                success: true,
                data: updatedPaymentOwner,
                message: 'Payment updated successfully'
            });
            
        } catch (error) {
            await trx.rollback();
            console.error('Update payment error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to update payment'
            });
        }
    }

    // Soft delete payment
    async deletePayment(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Check permission
            if (!['web_owner', 'staff'].includes(userRole)) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to delete payments'
                });
            }
            
            if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.delete');
                if (!hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to delete payments'
                    });
                }
            }
            
            // Get payment first
            const payment = await db('app_fee_payment')
                .where('id', id)
                .whereNull('deleted_at')
                .first();
            
            if (!payment) {
                return res.status(404).json({
                    success: false,
                    error: 'Payment not found'
                });
            }
            
            // Soft delete
            await db('app_fee_payment')
                .where('id', id)
                .update({
                    deleted_at: new Date(),
                    updated_at: new Date(),
                    status: 'cancelled'
                });
            
            return res.json({
                success: true,
                message: 'Payment deleted successfully'
            });
            
        } catch (error) {
            console.error('Delete payment error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to delete payment'
            });
        }
    }

    // Get app_fee email log (paginated). table_name = 'app_fee'
    async getEmailLog(req, res) {
        try {
            const { sort = 'desc', page = 1, limit = 20 } = req.query;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            if (!['web_owner', 'staff'].includes(userRole)) {
                return res.status(403).json({ success: false, error: 'You do not have permission to view app fee email log' });
            }
            if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.view');
                if (!hasPerm) return res.status(403).json({ success: false, error: 'Permission denied' });
            }
            const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.min(100, Math.max(1, parseInt(limit, 10)));
            const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
            const order = (sort === 'asc') ? 'asc' : 'desc';
            const query = db('emaillog')
                .where('table_name', 'app_fee')
                .orderBy('sentAt', order);
            const totalResult = await query.clone().count('id as count').first();
            const total = parseInt(totalResult?.count || 0);
            const rows = await query
                .select('id', 'type', 'toEmail', 'subject', 'status', 'error', 'table_name', 'row_id', 'sentAt', 'metadata')
                .limit(limitNum)
                .offset(offset);
            return res.json({
                success: true,
                data: serializeBigInt(rows),
                meta: { page: parseInt(page, 10), limit: limitNum, total, totalPages: Math.ceil(total / limitNum) }
            });
        } catch (error) {
            console.error('Get app fee email log error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch email log' });
        }
    }

    // Get app_fee email log for a specific row_id (all logs for that payment, no pagination)
    async getEmailLogByRowId(req, res) {
        try {
            const { row_id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            if (!['web_owner', 'staff', 'house_owner', 'caretaker'].includes(userRole)) {
                return res.status(403).json({ success: false, error: 'Access denied' });
            }
            const payment = await db('app_fee_payment').where('id', row_id).whereNull('deleted_at').select('house_owner_id').first();
            if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
            if (userRole === 'house_owner' && payment.house_owner_id !== userId) {
                return res.status(403).json({ success: false, error: 'You can only view your own payment email log' });
            }
            if (userRole === 'caretaker') {
                const accessible = await this.getAccessibleHouseOwners(userId);
                if (!accessible.includes(payment.house_owner_id)) return res.status(403).json({ success: false, error: 'Access denied' });
            }
            if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.view');
                if (!hasPerm) return res.status(403).json({ success: false, error: 'Permission denied' });
            }
            const rows = await db('emaillog')
                .where('table_name', 'app_fee')
                .andWhere('row_id', row_id)
                .orderBy('sentAt', 'desc')
                .select('id', 'type', 'toEmail', 'subject', 'status', 'error', 'table_name', 'row_id', 'sentAt', 'metadata');
            return res.json({ success: true, data: serializeBigInt(rows) });
        } catch (error) {
            console.error('Get app fee email log by row_id error:', error);
            return res.status(500).json({ success: false, error: 'Failed to fetch email log' });
        }
    }

    // Resend app fee email (receipt if paid, request notification if pending)
    async resendAppFeeMail(req, res) {
        try {
            const { id } = req.params;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            if (!['web_owner', 'staff'].includes(userRole)) {
                return res.status(403).json({ success: false, error: 'You do not have permission to resend app fee emails' });
            }
            if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.verify');
                if (!hasPerm) return res.status(403).json({ success: false, error: 'Permission denied' });
            }
            const payment = await db('app_fee_payment as afp')
                .join('user as ho', 'afp.house_owner_id', 'ho.id')
                .where('afp.id', id)
                .whereNull('afp.deleted_at')
                .select('afp.*', 'ho.name as house_owner_name', 'ho.email as house_owner_email')
                .first();
            if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
            if (payment.status === 'paid') {
                await NotificationService.sendAppFeeReceipt({
                    houseOwnerEmail: payment.house_owner_email,
                    houseOwnerName: payment.house_owner_name,
                    amount: payment.amount,
                    feeType: payment.fee_type || 'monthly_subscription',
                    paymentDate: payment.paid_date || new Date(),
                    houseName: null,
                    table_name: 'app_fee',
                    row_id: parseInt(id, 10)
                });
            } else if (payment.status === 'pending') {
                const webOwner = await db('user as u')
                    .join('role as r', 'u.roleId', 'r.id')
                    .where('r.slug', 'web_owner')
                    .andWhere('u.status', 'active')
                    .select('u.email')
                    .first();
                if (webOwner && webOwner.email) {
                    await NotificationService.sendAppFeeRequestToWebOwner({
                        webOwnerEmail: webOwner.email,
                        houseOwnerName: payment.house_owner_name,
                        houseOwnerEmail: payment.house_owner_email,
                        amount: payment.amount,
                        paymentId: parseInt(id, 10),
                        transactionId: payment.transaction_id || null,
                        notes: payment.notes || null,
                        requestedAt: payment.created_at || new Date()
                    });
                }
            } else {
                return res.status(400).json({ success: false, error: 'Cannot resend email for this payment status' });
            }
            return res.json({ success: true, message: 'Email has been queued for delivery' });
        } catch (error) {
            console.error('Resend app fee mail error:', error);
            return res.status(500).json({ success: false, error: 'Failed to resend email' });
        }
    }

    // Get all payments with filters
    async getPayments(req, res) {
        try {
            const { 
                house_owner_id,
                status,
                fee_type,
                payment_method,
                start_date,
                end_date,
                search,
                page = 1,
                limit = 20
            } = req.query;
            
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            const offset = (page - 1) * limit;
            
            // Start building query
            let query = db('app_fee_payment as afp')
                .join('user as ho', 'afp.house_owner_id', 'ho.id')
                .leftJoin('user as v', 'afp.verified_by', 'v.id')
                .whereNull('afp.deleted_at')
                .select(
                    'afp.*',
                    'ho.name as house_owner_name',
                    'ho.email as house_owner_email',
                    'ho.phone as house_owner_phone',
                    'v.name as verifier_name',
                    'v.email as verifier_email'
                );
            
            // Apply role-based filters
            if (userRole === 'house_owner') {
                query.where('afp.house_owner_id', userId);
            } else if (userRole === 'caretaker') {
                const accessibleOwners = await this.getAccessibleHouseOwners(userId);
                if (accessibleOwners.length > 0) {
                    query.whereIn('afp.house_owner_id', accessibleOwners);
                } else {
                    query.where('1', '0'); // No access
                }
            } else if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.view');
                if (!hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to view payments'
                    });
                }
            }
            // web_owner can see all
            
            // Apply filters
            if (house_owner_id) {
                query.andWhere('afp.house_owner_id', house_owner_id);
            }
            
            if (status) {
                query.andWhere('afp.status', status);
            }
            
            if (fee_type) {
                query.andWhere('afp.fee_type', fee_type);
            }
            
            if (payment_method) {
                const normalizedFilter = this.normalizePaymentMethod(payment_method);
                if (normalizedFilter) query.andWhere('afp.payment_method', normalizedFilter);
            }
            
            if (start_date) {
                query.andWhere('afp.start_date', '>=', start_date);
            }
            
            if (end_date) {
                query.andWhere('afp.start_date', '<=', end_date);
            }
            
            if (search) {
                query.andWhere(function() {
                    this.where('ho.name', 'like', `%${search}%`)
                        .orWhere('ho.email', 'like', `%${search}%`)
                        .orWhere('ho.phone', 'like', `%${search}%`)
                        .orWhere('afp.transaction_id', 'like', `%${search}%`)
                        .orWhere('afp.notes', 'like', `%${search}%`);
                });
            }
            
            // Get total count
            const countQuery = query.clone().count('afp.id as count').first();
            const totalResult = await countQuery;
            const total = parseInt(totalResult.count);
            
            // Get paginated results
            const payments = await query
                .orderBy('afp.created_at', 'desc')
                .limit(limit)
                .offset(offset);
            
            // Get house count for each house owner
            const paymentsWithDetails = await Promise.all(
                payments.map(async (payment) => {
                    const activeCount = await db('house')
                        .where('ownerId', payment.house_owner_id)
                        .andWhere('active', true)
                        .count('id as count')
                        .first()
                        .then((r) => parseInt(r.count, 10) || 0);
                    const status = await this.getAppFeeStatus(payment.house_owner_id);
                    return {
                        ...payment,
                        house_owner_active_houses: activeCount,
                        expected_amount: this.getAmountForHouseCount(payment.house_count),
                        appFeeStatus: status,
                        metadata: payment.metadata ? JSON.parse(payment.metadata) : null
                    };
                })
            );
            
            return res.json({
                success: true,
                data: paymentsWithDetails,
                meta: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
            
        } catch (error) {
            console.error('Get payments error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch payments'
            });
        }
    }

    // Get payment statistics
    async getPaymentStats(req, res) {
        try {
            const { house_owner_id, year, month } = req.query;
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Start building query
            let query = db('app_fee_payment')
                .whereNull('deleted_at');
            
            // Apply role-based filters
            if (userRole === 'house_owner') {
                query.where('house_owner_id', userId);
            } else if (userRole === 'caretaker') {
                const accessibleOwners = await this.getAccessibleHouseOwners(userId);
                if (accessibleOwners.length > 0) {
                    query.whereIn('house_owner_id', accessibleOwners);
                } else {
                    return res.json({
                        success: true,
                        data: {
                            total_paid: 0,
                            total_pending: 0,
                            total_overdue: 0,
                            pending_payments: [],
                            recent_payments: []
                        }
                    });
                }
            } else if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.view');
                if (!hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'Permission denied'
                    });
                }
            }
            
            if (house_owner_id) {
                query.andWhere('house_owner_id', house_owner_id);
            }
            
            if (year) {
                query.andWhereRaw('YEAR(start_date) = ?', [year]);
            }
            
            if (month) {
                query.andWhereRaw('MONTH(start_date) = ?', [month]);
            }
            
            // Get statistics
            const [stats, pendingPayments, recentPayments] = await Promise.all([
                query.clone()
                    .select(
                        db.raw('SUM(CASE WHEN status = "paid" THEN amount ELSE 0 END) as total_paid'),
                        db.raw('SUM(CASE WHEN status = "pending" THEN amount ELSE 0 END) as total_pending'),
                        db.raw('SUM(CASE WHEN status = "overdue" THEN amount ELSE 0 END) as total_overdue'),
                        db.raw('COUNT(*) as total_count')
                    )
                    .first(),
                
                query.clone()
                    .where('status', 'pending')
                    .join('user as u', 'app_fee_payment.house_owner_id', 'u.id')
                    .select(
                        'app_fee_payment.*',
                        'u.name as house_owner_name',
                        'u.email as house_owner_email'
                    )
                    .orderBy('start_date', 'asc')
                    .limit(10),
                
                query.clone()
                    .where('status', 'paid')
                    .join('user as u', 'app_fee_payment.house_owner_id', 'u.id')
                    .select(
                        'app_fee_payment.*',
                        'u.name as house_owner_name',
                        'u.email as house_owner_email'
                    )
                    .orderBy('paid_date', 'desc')
                    .limit(10)
            ]);
            
            return res.json({
                success: true,
                data: {
                    total_paid: parseFloat(stats.total_paid) || 0,
                    total_pending: parseFloat(stats.total_pending) || 0,
                    total_overdue: parseFloat(stats.total_overdue) || 0,
                    total_count: parseInt(stats.total_count) || 0,
                    pending_payments: pendingPayments,
                    recent_payments: recentPayments,
                    monthly_fee_per_house: this.monthlyFeePerHouse
                }
            });
            
        } catch (error) {
            console.error('Get payment stats error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to fetch payment statistics'
            });
        }
    }

    // Helper: Get accessible house owners (reused from earlier)
    async getAccessibleHouseOwners(caretakerId) {
        try {
            const owners = await db('caretakerassignment as ca')
                .join('house as h', 'ca.houseId', 'h.id')
                .where('ca.caretakerId', caretakerId)
                .andWhere(function() {
                    this.where('ca.expiresAt', '>', new Date())
                        .orWhereNull('ca.expiresAt');
                })
                .andWhere('h.active', true)
                .distinct('h.ownerId')
                .pluck('h.ownerId');
            
            return owners.map(id => parseInt(id));
        } catch (error) {
            console.error('Get accessible owners error:', error);
            return [];
        }
    }
}

const controller = new AppFeePaymentController();
controller.createExpenseRecordsForAppFeePayment = createExpenseRecordsForAppFeePayment;
module.exports = controller;