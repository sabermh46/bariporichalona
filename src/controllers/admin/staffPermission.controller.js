// controllers/admin/staffPermission.controller.js
const db = require("../../config/knex");
const permissionService = require("../../services/permission.service");
const audit = require("../../services/audit.service");

class StaffPermissionController {

    async getStaffList(req, res) {
        try {
            const { search, page = 1, limit = 20 } = req.query;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const offset = (pageNum - 1) * limitNum;

            let query = db('user')
                .join('role', 'user.roleId', 'role.id')
                .where('role.slug', 'staff')
                .where('user.status', 'active');

            if (search) {
                query = query.where(function() {
                    this.where('user.name', 'like', `%${search}%`)
                        .orWhere('user.email', 'like', `%${search}%`);
                });
            }

            // Get total count
            const totalQuery = query.clone();
            const [{ total }] = await totalQuery.count('* as total');

            // Get staff users with permissions
            const staffUsers = await query
                .leftJoin('user as parent', 'user.parentId', 'parent.id')
                .select(
                    'user.id',
                    'user.uuid',
                    'user.email',
                    'user.name',
                    'user.phone',
                    'user.avatarUrl',
                    'user.status',
                    'user.lastLoginAt',
                    'user.createdAt',
                    'parent.id as parent_id',
                    'parent.name as parent_name',
                    'parent.email as parent_email'
                )
                .offset(offset)
                .limit(limitNum)
                .orderBy('user.createdAt', 'desc');

            // Get permissions for each staff member
            const formattedStaff = [];
            for (const staff of staffUsers) {
                const staffPermissions = await db('staffpermission as sp')
                    .join('permission as p', 'sp.permissionId', 'p.id')
                    .leftJoin('user as granter', 'sp.grantedBy', 'granter.id')
                    .where('sp.userId', staff.id)
                    .whereNull('sp.revokedAt')
                    .select(
                        'p.id as permission_id',
                        'p.key as permission_key',
                        'p.description as permission_description',
                        'sp.grantedAt',
                        'granter.id as granter_id',
                        'granter.name as granter_name',
                        'granter.email as granter_email'
                    );

                formattedStaff.push({
                    ...staff,
                    id: staff.id.toString(),
                    parent: staff.parent_id ? {
                        id: staff.parent_id.toString(),
                        name: staff.parent_name,
                        email: staff.parent_email
                    } : null,
                    permissions: staffPermissions.map(sp => ({
                        id: sp.permission_id.toString(),
                        key: sp.permission_key,
                        description: sp.permission_description,
                        grantedAt: sp.grantedAt,
                        grantedBy: sp.granter_id ? {
                            id: sp.granter_id.toString(),
                            name: sp.granter_name,
                            email: sp.granter_email
                        } : null
                    })),
                    totalPermissions: staffPermissions.length
                });
            }

            res.json({
                success: true,
                data: formattedStaff,
                pagination: {
                    total: parseInt(total),
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            });
            
        } catch (error) {
            console.error('Get staff list error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch staff list' 
            });
        }
    }

    async getStaffDetails(req, res) {
        try {
            const { staffId } = req.params;

            const staff = await db('user')
                .where('user.id', BigInt(staffId))
                .join('role', 'user.roleId', 'role.id')
                .where('role.slug', 'staff')
                .leftJoin('user as parent', 'user.parentId', 'parent.id')
                .select(
                    'user.*',
                    'role.slug as role_slug',
                    'parent.id as parent_id',
                    'parent.name as parent_name',
                    'parent.email as parent_email'
                )
                .first();

            if (!staff) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Staff member not found' 
                });
            }

            // Get assigned permissions
            const assignedPermissions = await db('staffpermission as sp')
                .join('permission as p', 'sp.permissionId', 'p.id')
                .leftJoin('user as granter', 'sp.grantedBy', 'granter.id')
                .where('sp.userId', BigInt(staffId))
                .whereNull('sp.revokedAt')
                .select(
                    'p.id as permission_id',
                    'p.key as permission_key',
                    'p.description as permission_description',
                    'sp.grantedAt',
                    'granter.id as granter_id',
                    'granter.name as granter_name',
                    'granter.email as granter_email'
                );

            // Get permissions granted by this staff
            const grantedToOthers = await db('staffpermission as sp')
                .join('permission as p', 'sp.permissionId', 'p.id')
                .join('user as receiver', 'sp.userId', 'receiver.id')
                .where('sp.grantedBy', BigInt(staffId))
                .select(
                    'p.key as permission_key',
                    'receiver.id as user_id',
                    'receiver.name as user_name',
                    'receiver.email as user_email',
                    'sp.grantedAt'
                );

            // Get permissions revoked by this staff
            const revokedFromOthers = await db('staffpermission as sp')
                .join('permission as p', 'sp.permissionId', 'p.id')
                .join('user as receiver', 'sp.userId', 'receiver.id')
                .where('sp.revokedBy', BigInt(staffId))
                .select(
                    'p.key as permission_key',
                    'receiver.id as user_id',
                    'receiver.name as user_name',
                    'receiver.email as user_email',
                    'sp.revokedAt'
                );

            // Parse metadata if it exists
            if (staff.metadata && typeof staff.metadata === 'string') {
                try {
                    staff.metadata = JSON.parse(staff.metadata);
                } catch (e) {
                    staff.metadata = {};
                }
            }

            const response = {
                ...staff,
                id: staff.id.toString(),
                parent: staff.parent_id ? {
                    id: staff.parent_id.toString(),
                    name: staff.parent_name,
                    email: staff.parent_email
                } : null,
                assignedPermissions: assignedPermissions.map(sp => ({
                    id: sp.permission_id.toString(),
                    key: sp.permission_key,
                    description: sp.permission_description,
                    grantedAt: sp.grantedAt,
                    grantedBy: sp.granter_id ? {
                        id: sp.granter_id.toString(),
                        name: sp.granter_name,
                        email: sp.granter_email
                    } : null
                })),
                grantedToOthers: grantedToOthers.map(g => ({
                    permission: g.permission_key,
                    user: {
                        id: g.user_id.toString(),
                        name: g.user_name,
                        email: g.user_email
                    },
                    grantedAt: g.grantedAt
                })),
                revokedFromOthers: revokedFromOthers.map(r => ({
                    permission: r.permission_key,
                    user: {
                        id: r.user_id.toString(),
                        name: r.user_name,
                        email: r.user_email
                    },
                    revokedAt: r.revokedAt
                }))
            };

            res.json({
                success: true,
                data: response
            });

        } catch (error) {
            console.error('Get staff details error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch staff details' 
            });
        }
    }

    async getAvailablePermissions(req, res) {
        try {
            const permissions = await db('permission')
                .select('*')
                .orderBy('key', 'asc');

            const grouped = {};
            permissions.forEach(perm => {
                const category = perm.key.split('.')[0];
                if (!grouped[category]) {
                    grouped[category] = [];
                }
                grouped[category].push(perm);
            });

            res.json({
                success: true,
                data: {
                    all: permissions.map(p => ({
                        ...p,
                        id: p.id.toString()
                    })),
                    grouped: Object.keys(grouped).reduce((acc, key) => {
                        acc[key] = grouped[key].map(p => ({
                            ...p,
                            id: p.id.toString()
                        }));
                        return acc;
                    }, {})
                }
            });

        } catch (error) {
            console.error('Get permissions error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch permissions' 
            });
        }
    }

    async grantPermission(req, res) {
        try {
            const { staffId } = req.params;
            const { permissionId } = req.body;

            if (!permissionId) {
                return res.status(400).json({ 
                    success: false,
                    error: 'Permission ID is required' 
                });
            }

            const result = await permissionService.grantPermissionToStaff(
                BigInt(staffId), 
                BigInt(permissionId), 
                req.user.id
            );

            res.json({
                success: true,
                message: 'Permission granted successfully',
                data: result
            });
        } catch (error) {
            console.error('Grant permission error:', error);
            
            if (error.message.includes('already granted')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
            
            if (error.message.includes('not a staff member')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }

            res.status(500).json({ 
                success: false,
                error: 'Failed to grant permission' 
            });
        }
    }

    // Revoke permission from staff
    async revokePermission(req, res) {
        try {
            const { staffId, permissionId } = req.params;

            const result = await permissionService.revokePermissionFromStaff(
                BigInt(staffId),
                BigInt(permissionId),
                req.user.id
            );

            res.json({
                success: true,
                message: 'Permission revoked successfully',
                data: result
            });
        } catch (error) {
            console.error('Revoke permission error:', error);
            
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }

            res.status(500).json({ 
                success: false,
                error: 'Failed to revoke permission' 
            });
        }
    }

    async bulkGrantPermissions(req, res) {
        try {
            const { staffId } = req.params;
            const { permissionIds } = req.body;
            
            if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Permission IDs are required'
                });
            }

            const results = [];
            const errors = [];

            for (const permissionId of permissionIds) {
                try {
                    const result = await permissionService.grantPermissionToStaff(
                        BigInt(staffId),
                        BigInt(permissionId),
                        req.user.id
                    );
                    results.push(result);
                } catch (error) {
                    console.error('Error granting permission ID', permissionId, error);
                    errors.push({
                        permissionId,
                        error: error.message
                    });
                }
            }

            audit.fromRequest(req, {
                entityType: 'staffpermission',
                entityId: staffId,
                action: 'permission_grant',
                actionCategory: 'permission',
                changes: { after: { granted: permissionIds } },
                metadata: { source: 'service', grantedCount: results.length, failedCount: errors.length },
                status: errors.length && !results.length ? 'failure' : 'success',
            });

            res.json({
                success: true,
                message: `Granted ${results.length} permissions, ${errors.length} failed`,
                data: {
                    granted: results,
                    failed: errors
                }
            });
        } catch (error) {
            console.error('Bulk grant permission error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to bulk grant permissions'
            });
        }
    }

    async bulkRevokePermissions(req, res) {
        try {
            const { staffId } = req.params;
            const { permissionIds } = req.body;
            
            if (!Array.isArray(permissionIds) || permissionIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Permission IDs are required'
                });
            }

            const results = [];
            const errors = [];

            for (const permissionId of permissionIds) {
                try {
                    const result = await permissionService.revokePermissionFromStaff(
                        BigInt(staffId),
                        BigInt(permissionId),
                        req.user.id
                    );
                    results.push(result);
                } catch (error) {
                    console.error('Error revoking permission ID', permissionId, error);
                    errors.push({
                        permissionId,
                        error: error.message
                    });
                }
            }

            audit.fromRequest(req, {
                entityType: 'staffpermission',
                entityId: staffId,
                action: 'permission_revoke',
                actionCategory: 'permission',
                changes: { before: { revoked: permissionIds } },
                metadata: { source: 'service', revokedCount: results.length, failedCount: errors.length },
                status: errors.length && !results.length ? 'failure' : 'success',
            });

            res.json({
                success: true,
                message: `Revoked ${results.length} permissions, ${errors.length} failed`,
                data: {
                    revoked: results,
                    failed: errors
                }
            });
        } catch (error) {
            console.error('Bulk revoke permission error:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to bulk revoke permissions'
            });
        }
    }

    async getPermissionHistory(req, res) {
        try {
            const { staffId } = req.params;
            const { limit = 50 } = req.query;

            const history = await db('staffpermission as sp')
                .join('permission as p', 'sp.permissionId', 'p.id')
                .leftJoin('user as granter', 'sp.grantedBy', 'granter.id')
                .leftJoin('user as revoker', 'sp.revokedBy', 'revoker.id')
                .where('sp.userId', BigInt(staffId))
                .select(
                    'sp.*',
                    'p.key as permission_key',
                    'p.description as permission_description',
                    'granter.name as granter_name',
                    'granter.email as granter_email',
                    'revoker.name as revoker_name',
                    'revoker.email as revoker_email'
                )
                .orderBy('sp.grantedAt', 'desc')
                .limit(parseInt(limit));

            const formattedHistory = history.map(record => ({
                id: record.id.toString(),
                permission: {
                    id: record.permissionId.toString(),
                    key: record.permission_key,
                    description: record.permission_description
                },
                grantedAt: record.grantedAt,
                grantedBy: record.granter_name ? {
                    id: record.grantedBy.toString(),
                    name: record.granter_name,
                    email: record.granter_email
                } : null,
                revokedAt: record.revokedAt,
                revokedBy: record.revoker_name ? {
                    id: record.revokedBy.toString(),
                    name: record.revoker_name,
                    email: record.revoker_email
                } : null,
                status: record.revokedAt ? 'revoked' : 'active',
                duration: record.revokedAt ?
                    new Date(record.revokedAt) - new Date(record.grantedAt) :
                    Date.now() - new Date(record.grantedAt)
            }));

            res.json({
                success: true,
                data: formattedHistory
            });
        } catch (error) {
            console.error('Get permission history error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch permission history' 
            });
        }
    }

    async updateStaffStatus(req, res) {
        try {
            const { staffId } = req.params;
            const { status, reason } = req.body;

            if (!['active', 'inactive', 'suspended'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status value. Use: active, inactive, or suspended.'
                });
            }

            const staff = await db('user')
                .where('user.id', BigInt(staffId))
                .join('role', 'user.roleId', 'role.id')
                .where('role.slug', 'staff')
                .first();

            if (!staff) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Staff member not found' 
                });
            }

            // Parse existing metadata
            let metadata = {};
            if (staff.metadata && typeof staff.metadata === 'string') {
                try {
                    metadata = JSON.parse(staff.metadata);
                } catch (e) {
                    metadata = {};
                }
            }

            const updateData = {
                status,
                metadata: JSON.stringify({
                    ...metadata,
                    statusChangedAt: new Date().toISOString(),
                    statusChangedBy: req.user.id,
                    statusReason: reason || null
                }),
                updatedAt: new Date()
            };

            await db('user')
                .where({ id: BigInt(staffId) })
                .update(updateData);

            const updatedStaff = await db('user')
                .where({ id: BigInt(staffId) })
                .select('id', 'email', 'name', 'status', 'updatedAt')
                .first();

            audit.fromRequest(req, {
                entityType: 'user',
                entityId: staffId,
                action: 'status_change',
                actionCategory: 'permission',
                reason: reason || null,
                changes: audit.diff({ status: staff.status }, { status }),
                metadata: { source: 'service' },
            });

            res.json({
                success: true,
                message: `Staff status updated to ${status}`,
                data: updatedStaff ? {
                    ...updatedStaff,
                    id: updatedStaff.id.toString()
                } : null
            });

        } catch (error) {
            console.error('Update staff status error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to update staff status' 
            });
        }
    }

    async getStaffActivity(req, res) {
        try {
            const { staffId } = req.params;
            const { days = 30 } = req.query;

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - parseInt(days));

            // Get granted permissions count
            const grantedResult = await db('staffpermission')
                .where('grantedBy', BigInt(staffId))
                .where('grantedAt', '>=', startDate)
                .count('* as count')
                .first();
            
            const grantedCount = parseInt(grantedResult?.count || 0);

            // Get revoked permissions count
            const revokedResult = await db('staffpermission')
                .where('revokedBy', BigInt(staffId))
                .where('revokedAt', '>=', startDate)
                .count('* as count')
                .first();
            
            const revokedCount = parseInt(revokedResult?.count || 0);

            // Get last granted activity
            const lastGranted = await db('staffpermission as sp')
                .join('permission as p', 'sp.permissionId', 'p.id')
                .where('sp.grantedBy', BigInt(staffId))
                .orderBy('sp.grantedAt', 'desc')
                .select('sp.grantedAt', 'p.key as permission_key')
                .first();

            // Get last revoked activity
            const lastRevoked = await db('staffpermission as sp')
                .join('permission as p', 'sp.permissionId', 'p.id')
                .where('sp.revokedBy', BigInt(staffId))
                .orderBy('sp.revokedAt', 'desc')
                .select('sp.revokedAt', 'p.key as permission_key')
                .first();

            // Determine the most recent activity
            let lastActivity = null;
            if (lastGranted && lastRevoked) {
                if (lastGranted.grantedAt > lastRevoked.revokedAt) {
                    lastActivity = {
                        time: lastGranted.grantedAt,
                        action: 'granted',
                        permission: lastGranted.permission_key
                    };
                } else {
                    lastActivity = {
                        time: lastRevoked.revokedAt,
                        action: 'revoked',
                        permission: lastRevoked.permission_key
                    };
                }
            } else if (lastGranted) {
                lastActivity = {
                    time: lastGranted.grantedAt,
                    action: 'granted',
                    permission: lastGranted.permission_key
                };
            } else if (lastRevoked) {
                lastActivity = {
                    time: lastRevoked.revokedAt,
                    action: 'revoked',
                    permission: lastRevoked.permission_key
                };
            }

            res.json({
                success: true,
                data: {
                    grantedPermissions: grantedCount,
                    revokedPermissions: revokedCount,
                    totalActivity: grantedCount + revokedCount,
                    lastActivity: lastActivity,
                    period: `${days} days`
                }
            });

        } catch (error) {
            console.error('Get staff activity error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to fetch staff activity' 
            });
        }
    }

    async copyPermissions(req, res) {
        try {
            const { sourceStaffId, targetStaffId } = req.body;

            if (!sourceStaffId || !targetStaffId) {
                return res.status(400).json({
                    success: false,
                    error: 'Source and target staff IDs are required'
                });
            }

            if (sourceStaffId === targetStaffId) {
                return res.status(400).json({
                    success: false,
                    error: 'Source and target staff IDs cannot be the same'
                });
            }

            const sourcePermissions = await db('staffpermission as sp')
                .join('permission as p', 'sp.permissionId', 'p.id')
                .where('sp.userId', BigInt(sourceStaffId))
                .whereNull('sp.revokedAt')
                .select('p.id as permission_id', 'p.key as permission_key');

            if (sourcePermissions.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Source staff has no active permissions to copy'
                });
            }

            const results = [];
            const errors = [];

            for (const sp of sourcePermissions) {
                try {
                    await permissionService.grantPermissionToStaff(
                        BigInt(targetStaffId),
                        BigInt(sp.permission_id),
                        req.user.id
                    );
                    results.push(sp.permission_key);
                } catch (error) {
                    errors.push({
                        permission: sp.permission_key,
                        error: error.message
                    });
                }
            }

            audit.fromRequest(req, {
                entityType: 'staffpermission',
                entityId: targetStaffId,
                action: 'permission_copy',
                actionCategory: 'permission',
                metadata: { source: 'service', sourceStaffId, targetStaffId, copied: results, failedCount: errors.length },
            });

            res.json({
                success: true,
                message: `Copied ${results.length} permissions, ${errors.length} failed`,
                data: {
                    copied: results,
                    failed: errors
                }
            });

        } catch (error) {
            console.error('Copy permissions error:', error);
            res.status(500).json({ 
                success: false,
                error: 'Failed to copy permissions' 
            });
        }
    }
}

module.exports = new StaffPermissionController();