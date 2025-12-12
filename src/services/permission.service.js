// services/permission.service.js
const prisma = require("../config/prisma");
const permissionCache = require("../utils/permissionCache");

class PermissionService {
    
    // Get user permissions with caching
    async getUserPermissions(userId) {
        return permissionCache.getUserPermissions(userId, async () => {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                include: {
                    role: {
                        include: {
                            // Correct: Role has RolePermission relation, not permissions
                            RolePermission: {
                                include: {
                                    permission: true
                                }
                            }
                        }
                    },
                    // Correct: User has staffPermissionsAssigned relation for permissions assigned to them
                    staffPermissionsAssigned: {
                        where: {
                            revokedAt: null
                        },
                        include: {
                            permission: true
                        }
                    }
                }
            });

            if (!user) return [];

            // Combine role permissions and staff permissions
            const rolePermissions = user.role?.RolePermission?.map(rp => rp.permission.key) || [];
            const staffPermissions = user.staffPermissionsAssigned.map(sp => sp.permission.key);
            
            return [...new Set([...rolePermissions, ...staffPermissions])];
        });
    }

    // Get role permissions with caching
    async getRolePermissions(roleId) {
        return permissionCache.getRolePermissions(roleId, async () => {
            const role = await prisma.role.findUnique({
                where: { id: roleId },
                include: {
                    // Correct: Role has RolePermission relation
                    RolePermission: {
                        include: {
                            permission: true
                        }
                    }
                }
            });

            return role ? role.RolePermission.map(rp => rp.permission.key) : [];
        });
    }

    // Check if user has specific permission (with caching)
    async hasPermission(userId, permissionKey) {
        const permissions = await this.getUserPermissions(userId);
        return permissions.includes(permissionKey);
    }

    // Get all system permissions with caching
    async getAllSystemPermissions() {
        return permissionCache.getAllPermissions(async () => {
            const permissions = await prisma.permission.findMany({
                select: { 
                    id: true,
                    key: true,
                    description: true,
                    createdAt: true,
                    updatedAt: true 
                }
            });
            return permissions;
        });
    }

    // Admin: Grant permission to staff (with cache update)
    async grantPermissionToStaff(staffId, permissionId, grantedBy) {
        // Check if staff exists and is actually a staff member
        const staff = await prisma.user.findUnique({
            where: { id: staffId },
            include: { role: true }
        });

        if (!staff) {
            throw new Error('Staff member not found');
        }

        if (staff.role.slug !== 'staff') {
            throw new Error('User is not a staff member');
        }

        // Check if permission exists
        const permission = await prisma.permission.findUnique({
            where: { id: permissionId }
        });

        if (!permission) {
            throw new Error('Permission not found');
        }

        // Check if permission already granted and not revoked
        const existingPermission = await prisma.staffPermission.findFirst({
            where: {
                userId: staffId,
                permissionId: permissionId,
                revokedAt: null
            }
        });

        if (existingPermission) {
            throw new Error('Permission already granted to this staff member');
        }

        // Grant permission
        const staffPermission = await prisma.staffPermission.create({
            data: {
                userId: staffId,
                permissionId: permissionId,
                grantedBy: grantedBy
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
        });

        // Invalidate cache for this user
        permissionCache.invalidateUser(staffId);
        
        return staffPermission;
    }

    // Admin: Revoke permission from staff (with cache update)
    async revokePermissionFromStaff(staffId, permissionId, revokedBy) {
        // Check if permission exists and is active
        const staffPermission = await prisma.staffPermission.findFirst({
            where: {
                userId: staffId,
                permissionId: permissionId,
                revokedAt: null
            },
            include: {
                permission: true
            }
        });

        if (!staffPermission) {
            throw new Error('Active permission not found');
        }

        // Revoke permission
        const revoked = await prisma.staffPermission.update({
            where: { id: staffPermission.id },
            data: {
                revokedAt: new Date(),
                revokedBy: revokedBy
            },
            include: {
                permission: true,
                revoker: {
                    select: {
                        id: true,
                        name: true,
                        email: true
                    }
                }
            }
        });

        // Invalidate cache for this user
        permissionCache.invalidateUser(staffId);
        
        return revoked;
    }

    // Get all staff members with their permissions
    async getAllStaffWithPermissions() {
        const staffUsers = await prisma.user.findMany({
            where: {
                role: {
                    slug: 'staff'
                }
            },
            include: {
                role: true,
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
            orderBy: { name: 'asc' }
        });

        return staffUsers.map(staff => ({
            id: staff.id,
            name: staff.name,
            email: staff.email,
            role: staff.role,
            permissions: staff.staffPermissionsAssigned.map(sp => ({
                id: sp.permission.id,
                key: sp.permission.key,
                description: sp.permission.description,
                grantedAt: sp.grantedAt,
                grantedBy: sp.granter
            }))
        }));
    }

    // Get permission usage statistics
    async getPermissionStats() {
        const permissions = await prisma.permission.findMany({
            include: {
                _count: {
                    select: {
                        RolePermission: true,
                        staffPermissions: {
                            where: {
                                revokedAt: null
                            }
                        }
                    }
                }
            }
        });

        return permissions.map(perm => ({
            id: perm.id,
            key: perm.key,
            description: perm.description,
            totalAssigned: perm._count.RolePermission + perm._count.staffPermissions,
            roleAssignments: perm._count.RolePermission,
            staffAssignments: perm._count.staffPermissions
        }));
    }

    // Update user permissions in cache (called after admin updates)
    async updateUserPermissionsCache(userId) {
        permissionCache.invalidateUser(userId);
    }

    // Update role permissions in cache (called after admin updates)
    async updateRolePermissionsCache(roleId) {
        permissionCache.invalidateRole(roleId);
    }

    // Clear all cache (for system updates)
    async clearAllCache() {
        permissionCache.invalidateAll();
    }

    // Batch check permissions for multiple users
    async batchCheckPermissions(userIds, permissionKey) {
        const results = {};
        
        for (const userId of userIds) {
            const hasPerm = await this.hasPermission(userId, permissionKey);
            results[userId] = hasPerm;
        }
        
        return results;
    }
}

module.exports = new PermissionService();