// services/admin/userManagement.service.js

const prisma = require("../../config/prisma");

class UserManagementService {
    
    // Get user with full details including permissions
    async getUserWithFullDetails(userId) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                role: {
                    include: {
                        RolePermission: {
                            include: {
                                permission: true
                            }
                        }
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
                // Include other relations as needed
                parent: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        role: true
                    }
                },
                housesOwned: {
                    select: {
                        id: true,
                        name: true,
                        address: true
                    }
                }
            }
        });

        if (!user) return null;

        // Format the response
        return {
            ...user,
            permissions: [
                ...user.role.RolePermission.map(rp => rp.permission.key),
                ...user.staffPermissionsAssigned.map(sp => sp.permission.key)
            ],
            rolePermissions: user.role.RolePermission.map(rp => ({
                id: rp.permission.id,
                key: rp.permission.key,
                description: rp.permission.description
            })),
            staffPermissions: user.staffPermissionsAssigned.map(sp => ({
                id: sp.permission.id,
                key: sp.permission.key,
                description: sp.permission.description,
                grantedAt: sp.grantedAt,
                grantedBy: sp.granter
            }))
        };
    }
}

module.exports = new UserManagementService();