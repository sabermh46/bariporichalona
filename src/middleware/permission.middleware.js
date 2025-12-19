// src/middleware/permission.middleware.js
const permissionService = require("../services/permission.service");

const requirePermission = (permissionKey) => {
    return async (req, res, next) => {
        try {
            const userId = req.user.id;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "User not authenticated"
                });
            }

            const hasPermission = await permissionService.hasPermission(userId, permissionKey);
            
            if (!hasPermission) {
                return res.status(403).json({
                    success: false,
                    error: `You don't have permission to ${permissionKey}`,
                    code: "INSUFFICIENT_PERMISSIONS"
                });
            }

            next();
        } catch (error) {
            console.error('Permission middleware error:', error);
            res.status(500).json({
                success: false,
                error: "Permission check failed"
            });
        }
    };
};

// Middleware for checking any of multiple permissions
const requireAnyPermission = (permissionKeys) => {
    return async (req, res, next) => {
        try {
            const userId = req.user.id;
            
            if (!userId) {
                return res.status(401).json({
                    success: false,
                    error: "User not authenticated"
                });
            }

            const hasAnyPermission = await permissionService.hasAnyPermission(userId, permissionKeys);
            
            if (!hasAnyPermission) {
                return res.status(403).json({
                    success: false,
                    error: `You don't have required permissions`,
                    code: "INSUFFICIENT_PERMISSIONS"
                });
            }

            next();
        } catch (error) {
            console.error('Permission middleware error:', error);
            res.status(500).json({
                success: false,
                error: "Permission check failed"
            });
        }
    };
};

module.exports = {
    requirePermission,
    requireAnyPermission
};