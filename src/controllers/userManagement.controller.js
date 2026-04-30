// src/controllers/userManagement.controller.js
const AuthService = require('../services/auth.service');
const db = require('../config/knex');
const { hashPassword } = require('../utils/password');
const notificationController = require('./notification.controller');
const notify = require('../services/inAppNotification.service');

class UserManagementController {

    constructor() {
        this.createStaff = this.createStaff.bind(this);
        this.createHouseOwner = this.createHouseOwner.bind(this);
        this.createCaretaker = this.createCaretaker.bind(this);
        this.listUsers = this.listUsers.bind(this);
        this.updateUserStatus = this.updateUserStatus.bind(this);
        this.deleteUser = this.deleteUser.bind(this);
        this.authService = new AuthService();
    }
    
    // Create Staff (only web_owner)
    async createStaff(req, res, next) {
        try {
            const currentUser = req.user;
            const { email, password, name, phone, metadata } = req.body;
            
            // Authorization check
            if (currentUser.role.slug !== 'web_owner') {
                return res.status(403).json({
                    success: false,
                    error: 'Only web owners can create staff accounts'
                });
            }
            
            // Validate input
            if (!email || !password || !name) {
                return res.status(400).json({
                    success: false,
                    error: 'Email, password, and name are required'
                });
            }
            
            // Check if user already exists
            const existingUser = await db('user')
                .where('email', email)
                .first();
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: 'User with this email already exists'
                });
            }
            
            // Create staff user
            const result = await this.authService.register(
                { email, password, name, phone },
                null, // no token
                true, // external registration
                {
                    roleSlug: 'staff',
                    createdBy: currentUser.id,
                    metadata: metadata || {}
                }
            );
            
            if (result.user?.id) {
                notify.notifyUser(result.user.id, {
                    title: 'Welcome to the Team',
                    message: `Your staff account has been created. You can now log in with your email.`,
                    type: 'success',
                    redirectLink: '/dashboard',
                }).catch((e) => console.error('[notify] createStaff:', e));
            }

            res.status(201).json({
                success: true,
                data: result.user,
                message: 'Staff account created successfully'
            });

        } catch (error) {
            console.error('Create staff error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to create staff account'
            });
        }
    }
    
    // Create House Owner (web_owner and staff with permission)
    async createHouseOwner(req, res, next) {
        try {
            const currentUser = req.user;
            const { email, password, name, phone, metadata, initial_houses } = req.body;
            
            // Authorization check
            let hasPermission = false;
            
            if (currentUser.role.slug === 'web_owner') {
                hasPermission = true;
            } else if (currentUser.role.slug === 'staff') {
                const perm = await permissionService.hasPermission(currentUser.id, 'house_owners.create');
                hasPermission = perm;
            }
            
            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to create house owners'
                });
            }
            
            // Validate input
            if (!email || !password || !name) {
                return res.status(400).json({
                    success: false,
                    error: 'Email, password, and name are required'
                });
            }
            
            // Check if user already exists
            const existingUser = await db('user')
                .where('email', email)
                .first();
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: 'User with this email already exists'
                });
            }
            
            // Prepare metadata with initial houses if provided
            const finalMetadata = {
                ...(metadata || {}),
                initial_houses: initial_houses || []
            };
            
            // Create house owner
            const result = await this.authService.register(
                { email, password, name, phone },
                null, // no token
                true, // external registration
                {
                    roleSlug: 'house_owner',
                    createdBy: currentUser.id,
                    metadata: finalMetadata
                }
            );
            try {
                await notificationController.createSystemCommonNotification({
                    title: 'New house owner created',
                    message: `${result.user.name || result.user.email} was added as a house owner.`,
                    redirectLink: `/admin/house-owners/${result.user.id}`,
                });
            } catch (notifErr) {
                console.error('System notification (house owner):', notifErr);
            }
            res.status(201).json({
                success: true,
                data: result.user,
                message: 'House owner account created successfully'
            });
            
        } catch (error) {
            console.error('Create house owner error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to create house owner account'
            });
        }
    }
    
    // Create Caretaker (web_owner, staff with permission, or house_owner)
    async createCaretaker(req, res, next) {
        try {
            const currentUser = req.user;
            const currentRole = currentUser.role.slug;
            
            const { 
                email, 
                password, 
                name, 
                phone, 
                house_owner_id,
                expires_at,
                metadata 
            } = req.body;
            
            // Determine house owner ID based on role
            let targetHouseOwnerId;
            
            if (currentRole === 'house_owner') {
                // House owner can only create caretakers for themselves
                targetHouseOwnerId = currentUser.id;
            } else if (currentRole === 'staff' || currentRole === 'web_owner') {
                // Staff/web_owner must specify house_owner_id
                if (!house_owner_id) {
                    return res.status(400).json({
                        success: false,
                        error: 'house_owner_id is required'
                    });
                }
                targetHouseOwnerId = house_owner_id;
                
                // Staff needs permission
                if (currentRole === 'staff') {
                    const perm = await permissionService.hasPermission(currentUser.id, 'caretakers.create');
                    if (!perm) {
                        return res.status(403).json({
                            success: false,
                            error: 'You do not have permission to create caretakers'
                        });
                    }
                }
                
                // Verify house owner exists and is actually a house owner
                const houseOwner = await db('user as u')
                    .join('role as r', 'u.roleId', 'r.id')
                    .where('u.id', targetHouseOwnerId)
                    .andWhere('r.slug', 'house_owner')
                    .select('u.*')
                    .first();
                
                if (!houseOwner) {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid house owner ID'
                    });
                }
            } else {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to create caretakers'
                });
            }
            
            // Validate input
            if (!email || !password || !name) {
                return res.status(400).json({
                    success: false,
                    error: 'Email, password, and name are required'
                });
            }
            
            // Check if user already exists
            const existingUser = await db('user')
                .where('email', email)
                .first();
            
            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    error: 'User with this email already exists'
                });
            }
            
            // Validate house_ids if provided
            let validHouseIds = [];
            if (house_ids && house_ids.length > 0) {
                const houses = await db('house')
                    .whereIn('id', house_ids)
                    .andWhere('ownerId', targetHouseOwnerId)
                    .select('id');
                
                validHouseIds = houses.map(h => h.id);
                
                if (validHouseIds.length !== house_ids.length) {
                    return res.status(400).json({
                        success: false,
                        error: 'Some houses do not belong to the specified house owner'
                    });
                }
            }
            
            // Prepare metadata
            const finalMetadata = {
                ...(metadata || {}),
                house_owner_id: targetHouseOwnerId,
                house_ids: validHouseIds,
                default_permissions: default_permissions || [],
                expires_at: expires_at || null
            };
            
            // Create caretaker
            const result = await AuthService.register(
                { email, password, name, phone },
                null, // no token
                true, // external registration
                {
                    roleSlug: 'caretaker',
                    createdBy: currentUser.id,
                    metadata: finalMetadata
                }
            );
            
            res.status(201).json({
                success: true,
                data: result.user,
                message: 'Caretaker account created successfully'
            });
            
        } catch (error) {
            console.error('Create caretaker error:', error);
            res.status(500).json({
                success: false,
                error: error.message || 'Failed to create caretaker account'
            });
        }
    }
    
    // List users by role (with filters)
    async listUsers(req, res, next) {
        try {
            const currentUser = req.user;
            const { role, search, status, page = 1, limit = 20 } = req.query;
            const offset = (page - 1) * limit;
            
            // Start building query
            let query = db('user as u')
                .join('role as r', 'u.roleId', 'r.id')
                .leftJoin('user as p', 'u.parentId', 'p.id')
                .select(
                    'u.id',
                    'u.uuid',
                    'u.email',
                    'u.name',
                    'u.phone',
                    'u.avatarUrl',
                    'u.status',
                    'u.createdAt',
                    'u.updatedAt',
                    'r.slug as role_slug',
                    'r.name as role_name',
                    'p.id as parent_id',
                    'p.name as parent_name'
                );
            
            // Apply role-based filters
            if (currentUser.role.slug === 'web_owner') {
                // Web owner can see all users
                // No additional filter needed
            } else if (currentUser.role.slug === 'staff') {
                // Staff can see house_owners and caretakers (that they created or have permission for)
                query.where(function() {
                    this.where('r.slug', 'house_owner')
                        .orWhere('r.slug', 'caretaker');
                });
            } else if (currentUser.role.slug === 'house_owner') {
                // House owner can only see their caretakers
                query.where('r.slug', 'caretaker')
                    .andWhere('u.parentId', currentUser.id);
            } else {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to view users'
                });
            }
            
            // Apply filters
            if (role) {
                query.andWhere('r.slug', role);
            }
            
            if (status) {
                query.andWhere('u.status', status);
            }
            
            if (search) {
                query.andWhere(function() {
                    this.where('u.name', 'like', `%${search}%`)
                        .orWhere('u.email', 'like', `%${search}%`)
                        .orWhere('u.phone', 'like', `%${search}%`);
                });
            }
            
            // Get total count
            const countQuery = query.clone().count('u.id as count').first();
            const totalResult = await countQuery;
            const total = parseInt(totalResult.count);
            
            // Get paginated results
            const users = await query
                .orderBy('u.createdAt', 'desc')
                .limit(limit)
                .offset(offset);
            
            // Enrich with role-specific data
            const enrichedUsers = await Promise.all(
                users.map(async (user) => {
                    let additionalData = {};
                    
                    if (user.role_slug === 'caretaker') {
                        // Get caretaker assignments
                        const assignments = await db('caretakerassignment as ca')
                            .join('house as h', 'ca.houseId', 'h.id')
                            .where('ca.caretakerId', user.id)
                            .select(
                                'ca.id',
                                'ca.uuid',
                                'ca.expiresAt',
                                'ca.createdAt',
                                'h.id as house_id',
                                'h.name as house_name',
                                'h.address as house_address'
                            );
                        
                        additionalData.assignments = assignments;
                    }
                    
                    if (user.role_slug === 'house_owner') {
                        // Get house count
                        const houseCount = await db('house')
                            .where('ownerId', user.id)
                            .count('id as count')
                            .first();
                        
                        additionalData.house_count = parseInt(houseCount.count) || 0;
                    }
                    
                    return {
                        ...user,
                        ...additionalData
                    };
                })
            );
            
            res.json({
                success: true,
                data: enrichedUsers,
                meta: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
            
        } catch (error) {
            console.error('List users error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to fetch users'
            });
        }
    }
    
    // Update user status
    async updateUserStatus(req, res, next) {
        try {
            const { id } = req.params;
            const { status } = req.body;
            const currentUser = req.user;
            
            if (!['active', 'inactive', 'suspended'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status'
                });
            }
            
            // Get target user
            const targetUser = await db('user as u')
                .join('role as r', 'u.roleId', 'r.id')
                .where('u.id', id)
                .select('u.*', 'r.slug as role_slug')
                .first();
            
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            // Check permissions based on role hierarchy
            const roleHierarchy = {
                'web_owner': 100,
                'staff': 80,
                'house_owner': 60,
                'caretaker': 40
            };
            
            const canUpdate = 
                currentUser.role.slug === 'web_owner' ||
                (currentUser.role.slug === 'staff' && 
                 roleHierarchy[currentUser.role.slug] > roleHierarchy[targetUser.role_slug]) ||
                (currentUser.role.slug === 'house_owner' && 
                 targetUser.role_slug === 'caretaker' && 
                 targetUser.parentId === currentUser.id);
            
            if (!canUpdate) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to update this user'
                });
            }
            
            // Update status
            await db('user')
                .where('id', id)
                .update({
                    status,
                    updatedAt: new Date()
                });
            
            const statusMessages = {
                active: 'Your account has been activated.',
                inactive: 'Your account has been deactivated.',
                suspended: 'Your account has been suspended. Please contact support.',
            };
            notify.notifyUser(id, {
                title: 'Account Status Changed',
                message: statusMessages[status] || `Your account status has been changed to ${status}.`,
                type: status === 'active' ? 'success' : 'warning',
                redirectLink: '/dashboard',
            }).catch((e) => console.error('[notify] updateUserStatus:', e));

            res.json({
                success: true,
                message: `User status updated to ${status}`
            });

        } catch (error) {
            console.error('Update user status error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to update user status'
            });
        }
    }
    
    // Delete user (soft delete)
    async deleteUser(req, res, next) {
        try {
            const { id } = req.params;
            const currentUser = req.user;
            
            // Get target user
            const targetUser = await db('user as u')
                .join('role as r', 'u.roleId', 'r.id')
                .where('u.id', id)
                .select('u.*', 'r.slug as role_slug')
                .first();
            
            if (!targetUser) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            
            // Only web_owner can delete users
            if (currentUser.role.slug !== 'web_owner') {
                return res.status(403).json({
                    success: false,
                    error: 'Only web owners can delete users'
                });
            }
            
            // Soft delete
            await db('user')
                .where('id', id)
                .update({
                    status: 'deleted',
                    deletedAt: new Date(),
                    updatedAt: new Date()
                });
            
            res.json({
                success: true,
                message: 'User deleted successfully'
            });
            
        } catch (error) {
            console.error('Delete user error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to delete user'
            });
        }
    }
}

module.exports = new UserManagementController();