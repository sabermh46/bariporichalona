const db = require("../config/knex");

class AppFeePaymentController {
    constructor() {
        this.monthlyFeePerHouse = 500;
    }

    // Calculate due amount for house owner
    async calculateDueAmount(houseOwnerId) {
        try {
            // Count active houses
            const activeHouses = await db('house')
                .where('ownerId', houseOwnerId)
                .andWhere('active', true)
                .count('id as count')
                .first();
            
            const houseCount = parseInt(activeHouses.count) || 0;
            const totalDue = houseCount * this.monthlyFeePerHouse;
            
            // Check existing pending payments for this month
            const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
            const existingPayment = await db('app_fee_payment')
                .where('house_owner_id', houseOwnerId)
                .andWhere('due_date', 'like', `${currentMonth}%`)
                .andWhere('status', 'pending')
                .andWhereNull('deleted_at')
                .first();
            
            return {
                houseOwnerId,
                activeHouseCount: houseCount,
                monthlyFeePerHouse: this.monthlyFeePerHouse,
                totalDue,
                hasPendingPayment: !!existingPayment,
                pendingPaymentId: existingPayment?.id
            };
        } catch (error) {
            console.error('Calculate due amount error:', error);
            return null;
        }
    }

    // Generate monthly fees for all house owners (to be run via cron)
    async generateMonthlyFees() {
        const trx = await db.transaction();
        
        try {
            const currentDate = new Date();
            const dueDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 10); // Due on 10th of next month
            
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
                        house_id: 0, // This is system-wide, not house-specific
                        amount: calculation.totalDue,
                        fee_type: 'monthly_subscription',
                        due_date: dueDate,
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

    // Create payment record (by house owner/caretaker)
    async createPayment(req, res) {
        try {
            const { 
                house_owner_id, 
                house_id, 
                amount, 
                payment_method, 
                transaction_id,
                notes,
                proof_image_url 
            } = req.body;
            
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Validate required fields
            if (!house_owner_id || !amount || !payment_method) {
                return res.status(400).json({
                    success: false,
                    error: 'house_owner_id, amount, and payment_method are required'
                });
            }
            
            let validHouseOwnerId = house_owner_id;
            
            // Check permissions
            if (userRole === 'house_owner') {
                // House owner can only create for themselves
                if (parseInt(house_owner_id) !== userId) {
                    return res.status(403).json({
                        success: false,
                        error: 'You can only create payments for yourself'
                    });
                }
            } else if (userRole === 'caretaker') {
                // Caretaker can create for house owners they manage
                const accessibleOwners = await this.getAccessibleHouseOwners(userId);
                if (!accessibleOwners.includes(parseInt(house_owner_id))) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to create payments for this house owner'
                    });
                }
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
            
            // Check if house owner exists and is active
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
            
            // Prepare metadata
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
            
            // Create payment record
            const paymentData = {
                uuid: uuidv4(),
                house_owner_id: validHouseOwnerId,
                house_id: house_id || 0,
                amount,
                fee_type: 'monthly_subscription',
                due_date: new Date(), // Default to today
                payment_method,
                transaction_id,
                status: 'pending',
                notes,
                metadata: JSON.stringify(metadata),
                created_at: new Date(),
                updated_at: new Date()
            };
            
            const [paymentId] = await db('app_fee_payment').insert(paymentData);
            
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
                message: 'Payment record created successfully. Waiting for verification.'
            });
            
        } catch (error) {
            console.error('Create payment error:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to create payment record'
            });
        }
    }

    // Update payment (mainly for verification)
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
                payment_method,
                invoice_url 
            } = req.body;
            
            const userId = req.user.id;
            const userRole = req.user.role?.slug;
            
            // Check permission - only web_owner and staff with permission can verify
            if (!['web_owner', 'staff'].includes(userRole)) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to verify payments'
                });
            }
            
            if (userRole === 'staff') {
                const hasPerm = await hasPermission(userId, 'app_fees.verify');
                if (!hasPerm) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to verify payments'
                    });
                }
            }
            
            // Get payment
            const payment = await trx('app_fee_payment')
                .where('id', id)
                .andWhereNull('deleted_at')
                .first();
            
            if (!payment) {
                await trx.rollback();
                return res.status(404).json({
                    success: false,
                    error: 'Payment not found'
                });
            }
            
            // Prepare update data
            const updateData = {
                updated_at: new Date()
            };
            
            // Parse existing metadata
            let metadata = {};
            if (payment.metadata) {
                try {
                    metadata = JSON.parse(payment.metadata);
                } catch (e) {
                    console.error('Error parsing metadata:', e);
                }
            }
            
            // Update fields if provided
            if (status) {
                updateData.status = status;
                
                if (status === 'paid') {
                    updateData.verified_by = userId;
                    updateData.verified_at = new Date();
                    updateData.paid_date = paid_date || new Date();
                    
                    // Add verification info to metadata
                    metadata.verifiedBy = {
                        id: userId,
                        name: req.user.name,
                        email: req.user.email,
                        role: userRole,
                        verifiedAt: new Date().toISOString()
                    };
                }
            }
            
            if (notes !== undefined) updateData.notes = notes;
            if (verified_notes !== undefined) {
                updateData.notes = (updateData.notes || '') + 
                    `\n[VERIFICATION NOTES - ${new Date().toLocaleString()}] ${verified_notes}`;
            }
            if (transaction_id !== undefined) updateData.transaction_id = transaction_id;
            if (payment_method !== undefined) updateData.payment_method = payment_method;
            if (invoice_url !== undefined) updateData.invoice_url = invoice_url;
            if (paid_date !== undefined) updateData.paid_date = paid_date;
            
            // Update metadata
            updateData.metadata = JSON.stringify({
                ...metadata,
                lastUpdatedBy: userId,
                lastUpdatedAt: new Date().toISOString()
            });
            
            // Perform update
            await trx('app_fee_payment')
                .where('id', id)
                .update(updateData);
            
            // Get updated payment
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
            
            return res.json({
                success: true,
                data: updatedPayment,
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
                .andWhereNull('deleted_at')
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
                query.andWhere('afp.payment_method', payment_method);
            }
            
            if (start_date) {
                query.andWhere('afp.due_date', '>=', start_date);
            }
            
            if (end_date) {
                query.andWhere('afp.due_date', '<=', end_date);
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
                    // Get house count for this owner
                    const houseCount = await db('house')
                        .where('ownerId', payment.house_owner_id)
                        .andWhere('active', true)
                        .count('id as count')
                        .first();
                    
                    return {
                        ...payment,
                        house_owner_active_houses: parseInt(houseCount.count) || 0,
                        expected_amount: parseInt(houseCount.count) * this.monthlyFeePerHouse,
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
                query.andWhereRaw('YEAR(due_date) = ?', [year]);
            }
            
            if (month) {
                query.andWhereRaw('MONTH(due_date) = ?', [month]);
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
                    .orderBy('due_date', 'asc')
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

module.exports = new AppFeePaymentController();