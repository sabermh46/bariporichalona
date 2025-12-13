const permissionService = require("../services/permission.service");


const permissionMiddleware = (permissionKey) => {
    return async (req, res, next) => {
        try {
            if (!req.user) {
                return res.status(401).json({ 
                    success: false,
                    error: "Access denied. User not authenticated." 
                });
            }

            if(req.user.role.slug === 'web_owner' || req.user.role.slug === 'developer') {
                return next();
            }

            const hasPermission = await permissionService.hasPermission(
                req.user.id,
                permissionKey
            )

            if (!hasPermission) {
                return res.status(403).json({ 
                    success: false,
                    error: `Access denied. Missing permission: ${permissionKey}`,
                    code: "PERMISSION_DENIED"
                });
            }

            next();
        } catch (error) {
            console.error('Permission middleware error:', error);
            res.status(500).json({
                success: false,
                error: 'Permission check failed'
            });
        }
    }
}

module.exports = permissionMiddleware;