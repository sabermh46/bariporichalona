// controllers/admin/cache.controller.js
const permissionService = require("../services/permission.service");
const authMiddleware = require("../middleware/auth.middleware");
const permissionCache = require("../utils/permissionCache");

class CacheController {
    
    // Get cache stats (web owner only)
    async getCacheStats(req, res) {
        try {
            if (req.user.role.slug !== 'web_owner' && req.user.role.slug !== 'developer') {
                return res.status(403).json({ error: 'Access denied' });
            }

            const stats = permissionCache.getStats();
            
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Clear user cache (web owner only)
    async clearUserCache(req, res) {
        try {
            if (req.user.role.slug !== 'web_owner' && req.user.role.slug !== 'developer') {
                return res.status(403).json({ error: 'Access denied' });
            }

            const { userId } = req.params;
            
            if (userId) {
                permissionCache.invalidateUser(BigInt(userId));
                authMiddleware.clearUserCache(userId);
            } else {
                permissionCache.invalidateAll();
                authMiddleware.clearUserCache();
            }

            res.json({
                success: true,
                message: userId ? `Cache cleared for user ${userId}` : 'All cache cleared'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Clear role cache (web owner only)
    async clearRoleCache(req, res) {
        try {
            if (req.user.role.slug !== 'web_owner' && req.user.role.slug !== 'developer') {
                return res.status(403).json({ error: 'Access denied' });
            }

            const { roleId } = req.params;
            
            if (roleId) {
                permissionCache.invalidateRole(BigInt(roleId));
            } else {
                permissionCache.invalidateAll();
            }

            res.json({
                success: true,
                message: roleId ? `Cache cleared for role ${roleId}` : 'All cache cleared'
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Warm up cache for all users (admin only)
    async warmUpCache(req, res) {
        try {
            if (req.user.role.slug !== 'web_owner' && req.user.role.slug !== 'developer') {
                return res.status(403).json({ error: 'Access denied' });
            }

            // Get all active users
            const users = await prisma.user.findMany({
                where: { status: 'active' },
                select: { id: true }
            });

            // Pre-cache permissions for all users
            const promises = users.map(user => 
                permissionService.getUserPermissions(user.id)
            );

            await Promise.all(promises);

            res.json({
                success: true,
                message: `Cache warmed up for ${users.length} users`
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }

    // Get memory usage
    async getMemoryUsage(req, res) {
        try {
            if (req.user.role.slug !== 'web_owner' && req.user.role.slug !== 'developer') {
                return res.status(403).json({ error: 'Access denied' });
            }

            const memoryUsage = process.memoryUsage();
            const cacheStats = permissionCache.getStats();

            res.json({
                success: true,
                data: {
                    memory: {
                        heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
                        heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
                        external: `${(memoryUsage.external / 1024 / 1024).toFixed(2)} MB`,
                        arrayBuffers: `${(memoryUsage.arrayBuffers / 1024 / 1024).toFixed(2)} MB`
                    },
                    cache: cacheStats
                }
            });
        } catch (error) {
            res.status(500).json({ error: error.message });
        }
    }
}

module.exports = new CacheController();