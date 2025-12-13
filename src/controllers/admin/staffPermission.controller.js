const prisma = require("../../config/prisma");
const permissionService = require("../../services/permission.service");


class StaffPermissionController {

    async getStaffList(req, res) {
        try {
            const { search, page = 1, limit = 20 } = req.query;
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);
            const skip = (pageNum - 1) * limitNum;

            const where = {
                role: {
                    slug: 'staff'
                },
                status: 'active'
            };

            if (search) {
                where.OR = [
                    { name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } }
                ];
            }

            const total = await prisma.user.count({ where })

            const staffUsers = await prisma.user.findMany({
                where,
                select: {
                    id: true,
                    uuid: true,
                    email: true,
                    name: true,
                    phone: true,
                    avatarUrl: true,
                    status: true,
                    lastLoginAt: true,
                    createdAt: true,
                    parent: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    },
                    staffPermissionsAssigned: {
                        where: {
                            revokedAt: null
                        },
                        include: {
                            permission: true,
                            granter: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true
                                }
                            }
                        }
                    }
                },
                skip,
                take: limitNum,
                orderBy: {
                    createdAt: 'desc'
                }
            })

            const formatStaff = staffUsers.map(staff => ({
                ...staff,
                permissions: staff.staffPermissionsAssigned.map(sp => ({
                    id: sp.permission.id,
                    key: sp.permission.key,
                    description: sp.permission.description,
                    grantedAt: sp.grantedAt,
                    grantedBy: sp.granter
                })),
                totalPermissions: staff.staffPermissionsAssigned.length
            }))

            res.json({
                success: true,
                data: formatStaff,
                pagination: {
                    total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.ceil(total / limitNum)
                }
            })
            
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
            
            const {staffId} = req.params;

            const staff = await prisma.user.findUnique({
                where: {
                    id: BigInt(staffId),
                    role: {
                        slug: "staff"
                    }
                },
                select: {
                    id: true,
                    uuid: true,
                    email: true,
                    name: true,
                    phone: true,
                    avatarUrl: true,
                    status: true,
                    lastLoginAt: true,
                    createdAt: true,
                    metadata: true,
                    parent: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    },
                    staffPermissionsAssigned: {
                        where: {
                            revokedAt: null
                        },
                        include: {
                            permission: true,
                            granter: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true
                                }
                            }
                        }
                    },
                    staffPermissionsGranted: {
                        include: {
                            permission: true,
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true
                                }
                            }
                        }
                    },
                    staffPermissionsRevoked: {
                        include: {
                            permission: true,
                            user: {
                                select: {
                                    id: true,
                                    name: true,
                                    email: true
                                }
                            }
                        }
                    }
                }
            });

            if (!staff) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Staff member not found' 
                });
            }

            const response = {
                ...staff,
                assignedPermissions: staff.staffPermissionsAssigned.map(sp => ({
                    id: sp.permission.id,
                    key: sp.permission.key,
                    description: sp.permission.description,
                    grantedAt: sp.grantedAt,
                    grantedBy: sp.granter
                })),
                grantedToOthers: staff.staffPermissionsGranted.map(sp => ({
                    permission: sp.permission.key,
                    user: sp.user,
                    grantedAt: sp.grantedAt
                })),
                revokedFromOthers: staff.staffPermissionsRevoked.map(sp => ({
                    permission: sp.permission.key,
                    user: sp.user,
                    revokedAt: sp.revokedAt
                }))
            }

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
            const permissions = await prisma.permission.findMany({
                orderBy: {
                    key: 'asc'
                }
            })

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
                    all: permissions,
                    grouped
                }
            })

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
            )
            

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
            const { staffIds } = req.params;
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
                        BigInt(staffIds),
                        BigInt(permissionId),
                        req.user.id
                    );
                    results.push(result);
                } catch (error) {
                    errors.push({
                        permissionId,
                        error: error.message
                    });
                }
            }

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
                    errors.push({
                        permissionId,
                        error: error.message
                    });
                }
            }

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

            const history = await prisma.staffPermission.findMany({
                where: {
                    userId: BigInt(staffId)
                },
                include: {
                    permission: true,
                    granter: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    },
                    revoker: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    }
                },
                orderBy: {
                    grantedAt: 'desc'
                },
                take: parseInt(limit)
            });

            const formattedHistory = history.map(record => ({
                id: record.id,
                permission: {
                    id: record.permission.id,
                    key: record.permission.key,
                    description: record.permission.description
                },
                grantedAt: record.grantedAt,
                grantedBy: record.granter,
                revokedAt: record.revokedAt,
                revokedBy: record.revoker,
                status: record.revokedAt ? 'revoked' : 'active',
                duration: record.revokedAt ?
                    record.revokedAt - record.grantedAt :
                    Date.now() - record.grantedAt
            }))
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
            
            const {staffId} = req.params;
            const {status} = req.body;

            if (!['active', 'inactive', 'suspended'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid status value. Use: active, inactive, or suspended.'
                });
            }

            const staff = await prisma.user.findUnique({
                where: {
                    id: BigInt(staffId),
                    role: {
                        slug: "staff"
                    }
                }
            })

            if (!staff) {
                return res.status(404).json({ 
                    success: false,
                    error: 'Staff member not found' 
                });
            }

            const updatedStaff = await prisma.user.update({
                where: {
                    id: BigInt(staffId)
                },
                data: {
                    status,
                    metadata: {
                        ...staff.metadata,
                        statusChangedAt: new Date().toISOString(),
                        statusChangedBy: req.user.id,
                        statusReason: req.body.reason || null
                    }
                },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    status: true,
                    updatedAt: true
                }
            })

            res.json({
                success: true,
                message: `Staff status updated to ${status}`,
                data: updatedStaff
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
            const {staffId} = req.params;
            const { days = 30 } = req.query;

            const startDate = new Date();
            startDate.setDate(startDate.getDate() - parseInt(days));

            const grantedPermissions = await prisma.staffPermission.count({
                where: {
                    grantedBy: BigInt(staffId),
                    grantedAt: {
                        gte: startDate
                    }
                }
            })

            const revokedPermissions = await prisma.staffPermission.count({
                where: {
                    revokedBy: BigInt(staffId),
                    revokedAt: {
                        gte: startDate
                    }
                }
            })

            const lastActivity = await prisma.staffPermission.findFirst({
                where: {
                    OR: [
                        { grantedBy: BigInt(staffId) },
                        { revokedBy: BigInt(staffId) }
                    ]
                },
                orderBy: {
                    grantedAt: 'desc',
                },
                select: {
                    grantedAt: true,
                    permission: {
                        select: {
                            key: true
                        }
                    }
                }
            });

            res.json({
                success: true,
                data: {
                    grantedPermissions,
                    revokedPermissions,
                    totalActivity: grantedPermissions + revokedPermissions,
                    lastActivity: lastActivity ? {
                        time: lastActivity.grantedAt,
                        action: 'granted',
                        permission: lastActivity.permission.key
                    } : null,
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

             const sourcePermissions = await prisma.staffPermission.findMany({
                where: {
                    userId: BigInt(sourceStaffId),
                    revokedAt: null
                },
                include: {
                    permission: true
                }
             });

             if(sourcePermissions.length === 0) {
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
                        sp.permissionId,
                        req.user.id
                    );
                    results.push(sp.permission.key);
                } catch (error) {
                    errors.push({
                        permission: sp.permission.key,
                        error: error.message
                    });
                }
            }

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