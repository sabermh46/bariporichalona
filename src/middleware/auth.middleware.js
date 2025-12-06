const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

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

        console.log('Auth middleware - Token received:', token.substring(0, 20) + '...');

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('Token decoded successfully. User ID:', decoded.userId);
        } catch (jwtError) {
            console.error('JWT verification failed:', jwtError.message);
            
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

        // Find user with role
        let user;
        try {
            user = await prisma.user.findUnique({ 
                where: { id: BigInt(decoded.userId) },
                include: { 
                    role: true 
                }
            });
        } catch (dbError) {
            console.error('Database error when fetching user:', dbError);
            return res.status(500).json({
                success: false,
                error: "Database error",
                code: "DATABASE_ERROR"
            });
        }

        if (!user) {
            console.error('User not found for ID:', decoded.userId);
            return res.status(401).json({ 
                success: false,
                error: "User not found.",
                code: "USER_NOT_FOUND"
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

        // Remove sensitive data
        const userData = {
            id: user.id,
            uuid: user.uuid,
            email: user.email,
            emailVerifiedAt: user.emailVerifiedAt,
            googleId: user.googleId,
            locale: user.locale,
            name: user.name,
            phone: user.phone,
            avatarUrl: user.avatarUrl,
            profileJson: user.profileJson,
            roleId: user.roleId,
            parentId: user.parentId,
            needsPasswordSetup: user.needsPasswordSetup,
            status: user.status,
            lastLoginAt: user.lastLoginAt,
            lastLoginIp: user.lastLoginIp,
            metadata: user.metadata,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            deletedAt: user.deletedAt,
            role: user.role
        };

        // Attach user to request
        req.user = userData;
        
        // Also attach prisma instance if needed by other middleware
        if (!req.prisma) {
            req.prisma = prisma;
        }

        console.log('Auth successful for user:', {
            id: String(userData.id),
            email: userData.email,
            role: userData.role?.slug || 'No role'
        });

        next();
    } catch (error) {
        console.error('Auth middleware unexpected error:', error);
        
        // Don't expose internal error details in production
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

module.exports = authMiddleware;