// src/middleware/auth.middleware.js
const jwt = require("jsonwebtoken");
const db = require("../config/knex");
const permissionService = require("../services/permission.service");

// Cache for basic user data (without permissions)
const userCache = new Map();
const USER_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// Periodically evict expired entries so the Map never grows unbounded
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of userCache) {
        if (now - value.timestamp >= USER_CACHE_TTL) {
            userCache.delete(key);
        }
    }
}, USER_CACHE_TTL);

const authMiddleware = async (req, res, next) => {
    try {
        // Get token from Authorization header
        const authHeader = req.header('Authorization');
        
        if (!authHeader) {
            return res.status(401).json({ 
                success: false,
                error: "Access denied. No authorization header provided." 
            });
        }

        // Check if it's Bearer token
        const parts = authHeader.split(' ');
        if (parts.length !== 2 || parts[0] !== 'Bearer') {
            return res.status(401).json({ 
                success: false,
                error: "Invalid authorization format. Expected: Bearer <token>" 
            });
        }

        const token = parts[1];
        
        if (!token || token === 'null' || token === 'undefined') {
            return res.status(401).json({ 
                success: false,
                error: "Access denied. No token provided." 
            });
        }

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
        } catch (jwtError) {
            if (jwtError.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    error: "Token has expired",
                    code: "TOKEN_EXPIRED"
                });
            }
            
            if (jwtError.name === 'JsonWebTokenError') {
                return res.status(401).json({
                    success: false,
                    error: "Invalid token",
                    code: "INVALID_TOKEN"
                });
            }
            
            return res.status(401).json({
                success: false,
                error: "Token verification failed",
                code: "TOKEN_VERIFICATION_FAILED"
            });
        }

        // Check if userId exists in decoded token
        if (!decoded.userId) {
            return res.status(401).json({
                success: false,
                error: "Invalid token payload. Missing userId.",
                code: "INVALID_TOKEN_PAYLOAD"
            });
        }

        const userId = BigInt(decoded.userId);
        
        // Try to get user from cache first
        let user;
        const cachedUser = userCache.get(userId.toString());
        
        if (cachedUser && (Date.now() - cachedUser.timestamp < USER_CACHE_TTL)) {
            user = cachedUser.data;
        } else {
            // Find user with basic info
            user = await db('user')
                .where('user.id', userId)
                .leftJoin('role', 'user.roleId', 'role.id')
                .select(
                    'user.*',
                    'role.id as role_id',
                    'role.name as role_name',
                    'role.slug as role_slug',
                    'role.rank as role_rank',
                    'role.description as role_description'
                )
                .first();

            if (!user) {
                return res.status(401).json({ 
                    success: false,
                    error: "User not found.",
                    code: "USER_NOT_FOUND"
                });
            }

            // Parse JSON fields
            if (user.metadata) {
                try {
                    user.metadata = JSON.parse(user.metadata);
                } catch (e) {
                    user.metadata = {};
                }
            }
            if (user.profileJson) {
                try {
                    user.profileJson = JSON.parse(user.profileJson);
                } catch (e) {
                    user.profileJson = {};
                }
            }

            // Format user object
            user = {
                ...user,
                id: user.id,
                roleId: user.roleId,
                role: {
                    id: user.role_id,
                    name: user.role_name,
                    slug: user.role_slug,
                    rank: user.role_rank,
                    description: user.role_description
                }
            };

            // Remove temporary fields
            delete user.role_id;
            delete user.role_name;
            delete user.role_slug;
            delete user.role_rank;
            delete user.role_description;

            // Cache the user
            userCache.set(userId.toString(), {
                data: user,
                timestamp: Date.now()
            });
        }

        // Check if user is active
        if (user.status !== 'active') {
            return res.status(403).json({
                success: false,
                error: "Account is not active",
                code: "ACCOUNT_INACTIVE"
            });
        }

        // Get user permissions (optimized with caching)
        const permissions = await permissionService.getUserPermissions(user.id);

        // Attach user and permissions to request
        req.user = {
            ...user,
            permissions: permissions
        };
        
        // Set knex instance if needed
        if (!req.db) {
            req.db = db;
        }

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        
        const errorMessage = process.env.NODE_ENV === 'development' 
            ? error.message 
            : "Authentication failed";
        
        res.status(500).json({ 
            success: false,
            error: errorMessage,
            code: "AUTH_MIDDLEWARE_ERROR"
        });
    }
}

// Export cache clearing function for admin
authMiddleware.clearUserCache = (userId) => {
    if (userId) {
        userCache.delete(userId.toString());
    } else {
        userCache.clear();
    }
};

module.exports = authMiddleware;