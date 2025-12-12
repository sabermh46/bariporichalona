// utils/permissionCache.js
class PermissionCache {
    constructor() {
        this.cache = {
            userPermissions: new Map(), // userId -> { permissions: [], timestamp }
            rolePermissions: new Map(), // roleId -> { permissions: [], timestamp }
            allPermissions: null,       // All permission objects
            lastUpdated: null
        };
        this.TTL = 5 * 60 * 1000; // 5 minutes TTL
    }

    // Convert ID to string for consistent Map keys
    #idToString(id) {
        return id.toString();
    }

    // Get cached permissions for user
    async getUserPermissions(userId, fetchCallback) {
        const key = this.#idToString(userId);
        const cached = this.cache.userPermissions.get(key);
        
        if (cached && (Date.now() - cached.timestamp < this.TTL)) {
            return cached.permissions;
        }
        
        // Fetch fresh data
        const permissions = await fetchCallback();
        this.cache.userPermissions.set(key, {
            permissions,
            timestamp: Date.now()
        });
        
        return permissions;
    }

    // Get cached permissions for role
    async getRolePermissions(roleId, fetchCallback) {
        const key = this.#idToString(roleId);
        const cached = this.cache.rolePermissions.get(key);
        
        if (cached && (Date.now() - cached.timestamp < this.TTL)) {
            return cached.permissions;
        }
        
        const permissions = await fetchCallback();
        this.cache.rolePermissions.set(key, {
            permissions,
            timestamp: Date.now()
        });
        
        return permissions;
    }

    // Invalidate cache for specific user
    invalidateUser(userId) {
        const key = this.#idToString(userId);
        this.cache.userPermissions.delete(key);
    }

    // Invalidate cache for specific role
    invalidateRole(roleId) {
        const key = this.#idToString(roleId);
        this.cache.rolePermissions.delete(key);
    }

    // Invalidate all cache
    invalidateAll() {
        this.cache.userPermissions.clear();
        this.cache.rolePermissions.clear();
        this.cache.allPermissions = null;
        this.cache.lastUpdated = null;
    }

    // Get all permissions (for permission management)
    async getAllPermissions(fetchCallback) {
        if (!this.cache.allPermissions || 
            !this.cache.lastUpdated || 
            (Date.now() - this.cache.lastUpdated > this.TTL)) {
            
            this.cache.allPermissions = await fetchCallback();
            this.cache.lastUpdated = Date.now();
        }
        
        return this.cache.allPermissions;
    }

    // Update permissions cache after admin changes
    updateUserPermissions(userId, permissions) {
        const key = this.#idToString(userId);
        this.cache.userPermissions.set(key, {
            permissions,
            timestamp: Date.now()
        });
    }

    // Update role permissions cache
    updateRolePermissions(roleId, permissions) {
        const key = this.#idToString(roleId);
        this.cache.rolePermissions.set(key, {
            permissions,
            timestamp: Date.now()
        });
    }

    // Get cache stats (for monitoring)
    getStats() {
        return {
            cachedUsers: this.cache.userPermissions.size,
            cachedRoles: this.cache.rolePermissions.size,
            totalPermissions: this.cache.allPermissions ? this.cache.allPermissions.length : 0,
            lastUpdated: this.cache.lastUpdated,
            memoryUsage: process.memoryUsage().heapUsed
        };
    }
}

// Create singleton instance
const permissionCache = new PermissionCache();
module.exports = permissionCache;