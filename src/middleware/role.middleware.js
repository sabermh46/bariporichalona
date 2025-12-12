const roleMiddleware = (roles = [], permissions = []) => {
    return async (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ 
                success: false,
                error: 'Authentication required' 
            });
        }

        // Check role-based access
        if (roles.length > 0) {
            const userRole = req.user.role?.slug;
            
            if (!userRole || !roles.includes(userRole)) {
                return res.status(403).json({ 
                    success: false,
                    error: 'Insufficient role privileges',
                    requiredRoles: roles,
                    userRole: userRole 
                });
            }
        }

        // Check permission-based access
        if (permissions.length > 0) {
            const userPermissions = req.user.permissions || [];
            
            // Check if user has ALL required permissions
            const hasAllPermissions = permissions.every(permission => 
                userPermissions.includes(permission)
            );
            
            if (!hasAllPermissions) {
                // For better debugging, check which permissions are missing
                const missingPermissions = permissions.filter(
                    permission => !userPermissions.includes(permission)
                );
                
                return res.status(403).json({ 
                    success: false,
                    error: 'Insufficient permissions',
                    requiredPermissions: permissions,
                    missingPermissions: missingPermissions,
                    userPermissions: userPermissions
                });
            }
        }

        next();
    };
};

module.exports = roleMiddleware;