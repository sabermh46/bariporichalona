// src/utils/permissionCache.js
class PermissionCache {
    constructor() {
        this.userPermissions = new Map(); // userId -> {permissions, timestamp}
        this.rolePermissions = new Map(); // roleId -> {permissions, timestamp}
        this.allPermissions = null; // Cache for all system permissions
        this.allPermissionsTimestamp = 0;
        
        this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes
        this.ALL_PERMISSIONS_TTL = 10 * 60 * 1000; // 10 minutes
    }

    // User permissions cache
    async getUserPermissions(userId, fetchCallback) {
        const cacheKey = `user_${userId}`;
        const cached = this.userPermissions.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
            return cached.permissions;
        }
        
        const permissions = await fetchCallback();
        this.userPermissions.set(cacheKey, {
            permissions,
            timestamp: Date.now()
        });
        
        return permissions;
    }

    // Role permissions cache
    async getRolePermissions(roleId, fetchCallback) {
        const cacheKey = `role_${roleId}`;
        const cached = this.rolePermissions.get(cacheKey);
        
        if (cached && (Date.now() - cached.timestamp < this.CACHE_TTL)) {
            return cached.permissions;
        }
        
        const permissions = await fetchCallback();
        this.rolePermissions.set(cacheKey, {
            permissions,
            timestamp: Date.now()
        });
        
        return permissions;
    }

    // All system permissions cache
    async getAllPermissions(fetchCallback) {
        if (this.allPermissions && 
            (Date.now() - this.allPermissionsTimestamp < this.ALL_PERMISSIONS_TTL)) {
            return this.allPermissions;
        }
        
        this.allPermissions = await fetchCallback();
        this.allPermissionsTimestamp = Date.now();
        
        return this.allPermissions;
    }

    // Invalidation methods
    invalidateUser(userId) {
        const cacheKey = `user_${userId}`;
        this.userPermissions.delete(cacheKey);
    }

    invalidateRole(roleId) {
        const cacheKey = `role_${roleId}`;
        this.rolePermissions.delete(cacheKey);
    }

    invalidateAll() {
        this.userPermissions.clear();
        this.rolePermissions.clear();
        this.allPermissions = null;
        this.allPermissionsTimestamp = 0;
    }

    // Batch invalidation
    invalidateUsers(userIds) {
        userIds.forEach(userId => this.invalidateUser(userId));
    }

    invalidateRoles(roleIds) {
        roleIds.forEach(roleId => this.invalidateRole(roleId));
    }

    // Get cache stats
    getStats() {
        return {
            userPermissionsSize: this.userPermissions.size,
            rolePermissionsSize: this.rolePermissions.size,
            allPermissionsCached: this.allPermissions !== null,
            allPermissionsAge: this.allPermissions ? 
                Date.now() - this.allPermissionsTimestamp : null
        };
    }
}

module.exports = new PermissionCache();