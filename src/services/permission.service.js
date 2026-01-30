// src/services/permission.service.js
const db = require("../config/knex");
const permissionCache = require("../utils/permissionCache");

class PermissionService {

    constructor() {
        // Bind all methods that use 'this' to the instance
        this.getUserPermissions = this.getUserPermissions.bind(this);
        this.hasPermission = this.hasPermission.bind(this);
        this.batchCheckPermissions = this.batchCheckPermissions.bind(this);
        this.hasAnyPermission = this.hasAnyPermission.bind(this);
        this.canCreateRole = this.canCreateRole.bind(this);
        this.getRolePermissions = this.getRolePermissions.bind(this);
        this.getAllSystemPermissions = this.getAllSystemPermissions.bind(this);
        
    }
  // Get user permissions with caching
  async getUserPermissions(userId) {
    try {
      // Make sure we're calling the cache method correctly
      return await permissionCache.getUserPermissions(userId, async () => {
        // Get user with role
        const user = await db("user")
          .where("user.id", userId)
          .leftJoin("role", "user.roleId", "role.id")
          .select(
            "user.id as user_id",
            "role.id as role_id",
            "role.slug as role_slug"
          )
          .first();

        if (!user) return [];

        // Get role permissions
        const rolePermissions = await db("rolepermission as rp")
          .join("permission as p", "rp.permissionId", "p.id")
          .where("rp.roleId", user.role_id)
          .select("p.key")
          .then((rows) => rows.map((row) => row.key));

        // Get staff permissions
        const staffPermissions = await db("staffpermission as sp")
          .join("permission as p", "sp.permissionId", "p.id")
          .where("sp.userId", userId)
          .whereNull("sp.revokedAt")
          .select("p.key")
          .then((rows) => rows.map((row) => row.key));

        // Get caretaker permissions (if user is a caretaker)
        const caretakerPermissions = await db("caretakerassignment as ca")
          .join(
            "caretakerassignmentpermission as cap",
            "ca.id",
            "cap.caretakerAssignmentId"
          )
          .join("permission as p", "cap.permissionId", "p.id")
          .where("ca.caretakerId", userId)
          .where(function () {
            this.where("ca.expiresAt", ">", new Date()).orWhereNull(
              "ca.expiresAt"
            );
          })
          .select("p.key")
          .distinct()
          .then((rows) => rows.map((row) => row.key));

        // Combine all permissions
        return [
          ...new Set([
            ...rolePermissions,
            ...staffPermissions,
            ...caretakerPermissions,
          ]),
        ];
      });
    } catch (error) {
      console.error("Error in getUserPermissions:", error);
      // Fallback: return empty array
      return [];
    }
  }

  // Get role permissions with caching
  async getRolePermissions(roleId) {
    return permissionCache.getRolePermissions(roleId, async () => {
      const permissions = await db("rolepermission as rp")
        .join("permission as p", "rp.permissionId", "p.id")
        .where("rp.roleId", roleId)
        .select("p.key")
        .then((rows) => rows.map((row) => row.key));

      return permissions;
    });
  }

  // Check if user has specific permission (with caching)
  async hasPermission(userId, permissionKey) {
    const permissions = await this.getUserPermissions(userId);    
    return permissions.includes(permissionKey);
  }

  async canCreateRole(creatorRoleSlug, targetRoleSlug) {
        const roleHierarchy = {
            'web_owner': 100,
            'staff': 80,
            'house_owner': 60,
            'caretaker': 40
        };
        
        return roleHierarchy[creatorRoleSlug] > roleHierarchy[targetRoleSlug];
    }

  // Get all system permissions with caching
  async getAllSystemPermissions() {
    return permissionCache.getAllPermissions(async () => {
      const permissions = await db("permission")
        .select("id", "key", "description", "createdAt", "updatedAt")
        .orderBy("key", "asc");

      return permissions.map((perm) => ({
        id: perm.id,
        key: perm.key,
        description: perm.description,
        createdAt: perm.createdAt,
        updatedAt: perm.updatedAt,
      }));
    });
  }

  // Admin: Grant permission to staff (with cache update)
  async grantPermissionToStaff(staffId, permissionId, grantedBy) {
    return await db.transaction(async (trx) => {
      // Check if staff exists and is actually a staff member
      const staff = await trx("user")
        .where("user.id", staffId)
        .leftJoin("role", "user.roleId", "role.id")
        .select("user.*", "role.slug as role_slug")
        .first();

      if (!staff) {
        throw new Error("Staff member not found");
      }

      if (staff.role_slug !== "staff") {
        throw new Error("User is not a staff member");
      }

      // Check if permission exists
      const permission = await trx("permission")
        .where({ id: permissionId })
        .first();

      if (!permission) {
        throw new Error("Permission not found");
      }

      // Check if there's an existing record (active or revoked)
      const existingPermission = await trx("staffpermission")
        .where({
          userId: staffId,
          permissionId: permissionId,
        })
        .first();

      let staffPermissionId;

      if (existingPermission) {
        // Update existing record (whether active or revoked)
        staffPermissionId = existingPermission.id;

        await trx("staffpermission")
          .where({ id: existingPermission.id })
          .update({
            grantedBy: grantedBy,
            grantedAt: new Date(),
            revokedAt: null,
            revokedBy: null,
          });
      } else {
        // Insert new record
        [staffPermissionId] = await trx("staffpermission").insert({
          userId: staffId,
          permissionId: permissionId,
          grantedBy: grantedBy,
          grantedAt: new Date(),
          revokedAt: null,
          revokedBy: null,
        });
      }

      // Get the created/updated staff permission with details
      const staffPermission = await trx("staffpermission as sp")
        .where("sp.id", staffPermissionId)
        .leftJoin("permission as p", "sp.permissionId", "p.id")
        .leftJoin("user as granter", "sp.grantedBy", "granter.id")
        .select(
          "sp.*",
          "p.key as permission_key",
          "p.description as permission_description",
          "granter.id as granter_id",
          "granter.name as granter_name",
          "granter.email as granter_email"
        )
        .first();

      // Format the response
      const result = {
        id: staffPermission.id,
        userId: staffPermission.userId,
        permissionId: staffPermission.permissionId,
        grantedBy: staffPermission.grantedBy,
        grantedAt: staffPermission.grantedAt,
        permission: {
          id: staffPermission.permissionId,
          key: staffPermission.permission_key,
          description: staffPermission.permission_description,
        },
        granter: {
          id: staffPermission.granter_id,
          name: staffPermission.granter_name,
          email: staffPermission.granter_email,
        },
      };

      // Invalidate cache for this user
      permissionCache.invalidateUser(staffId);

      return result;
    });
  }

  // Admin: Revoke permission from staff (with cache update)
  async revokePermissionFromStaff(staffId, permissionId, revokedBy) {
    return await db.transaction(async (trx) => {
      // Check if permission exists and is active
      const staffPermission = await trx("staffpermission as sp")
        .where({
          userId: staffId,
          permissionId: permissionId,
          revokedAt: null,
        })
        .leftJoin("permission as p", "sp.permissionId", "p.id")
        .select(
          "sp.*",
          "p.key as permission_key",
          "p.description as permission_description"
        )
        .first();

      if (!staffPermission) {
        throw new Error("Active permission not found");
      }

      // Revoke permission
      await trx("staffpermission").where({ id: staffPermission.id }).update({
        revokedAt: new Date(),
        revokedBy: revokedBy,
      });

      // Get the updated record with revoker details
      const revoked = await trx("staffpermission as sp")
        .where("sp.id", staffPermission.id)
        .leftJoin("permission as p", "sp.permissionId", "p.id")
        .leftJoin("user as revoker", "sp.revokedBy", "revoker.id")
        .select(
          "sp.*",
          "p.key as permission_key",
          "p.description as permission_description",
          "revoker.id as revoker_id",
          "revoker.name as revoker_name",
          "revoker.email as revoker_email"
        )
        .first();

      // Format the response
      const result = {
        id: revoked.id,
        userId: revoked.userId,
        permissionId: revoked.permissionId,
        revokedAt: revoked.revokedAt,
        revokedBy: revoked.revokedBy,
        permission: {
          id: revoked.permissionId,
          key: revoked.permission_key,
          description: revoked.permission_description,
        },
        revoker: {
          id: revoked.revoker_id,
          name: revoked.revoker_name,
          email: revoked.revoker_email,
        },
      };

      // Invalidate cache for this user
      permissionCache.invalidateUser(staffId);

      return result;
    });
  }

  // Get all staff members with their permissions
  async getAllStaffWithPermissions() {
    // First get all staff users
    const staffUsers = await db("user")
      .whereExists(function () {
        this.select("*")
          .from("role")
          .whereRaw("user.roleId = role.id")
          .where("role.slug", "staff");
      })
      .select("user.id", "user.name", "user.email", "user.roleId")
      .orderBy("user.name", "asc");

    // Get permissions for each staff member
    const staffWithPermissions = [];

    for (const staff of staffUsers) {
      // Get role
      const role = await db("role")
        .where({ id: staff.roleId })
        .select("id", "name", "slug", "rank", "description")
        .first();

      // Get staff permissions
      const staffPermissions = await db("staffpermission as sp")
        .where("sp.userId", staff.id)
        .whereNull("sp.revokedAt")
        .leftJoin("permission as p", "sp.permissionId", "p.id")
        .leftJoin("user as granter", "sp.grantedBy", "granter.id")
        .select(
          "sp.*",
          "p.key as permission_key",
          "p.description as permission_description",
          "granter.id as granter_id",
          "granter.name as granter_name",
          "granter.email as granter_email"
        );

      staffWithPermissions.push({
        id: staff.id,
        name: staff.name,
        email: staff.email,
        role: role,
        permissions: staffPermissions.map((sp) => ({
          id: sp.permissionId,
          key: sp.permission_key,
          description: sp.permission_description,
          grantedAt: sp.grantedAt,
          grantedBy: {
            id: sp.granter_id,
            name: sp.granter_name,
            email: sp.granter_email,
          },
        })),
      });
    }

    return staffWithPermissions;
  }

  // Get permission usage statistics
  async getPermissionStats() {
    const permissions = await db("permission").select(
      "permission.id",
      "permission.key",
      "permission.description"
    );

    const stats = [];

    for (const perm of permissions) {
      // Count role assignments
      const [roleAssignments] = await db("rolepermission")
        .where("permissionId", perm.id)
        .count("* as count")
        .first();

      // Count staff assignments (not revoked)
      const [staffAssignments] = await db("staffpermission")
        .where("permissionId", perm.id)
        .whereNull("revokedAt")
        .count("* as count")
        .first();

      const [caretakerAssignments] = await db('caretakerassignmentpermission as cap')
        .join('caretakerassignment as ca', 'cap.caretakerAssignmentId', 'ca.id')
        .where('cap.permissionId', perm.id)
        .where(function() {
            this.where('ca.expiresAt', '>', new Date())
                .orWhereNull('ca.expiresAt');
        })
        .count('* as count')
        .first();

      stats.push({
        id: perm.id,
        key: perm.key,
        description: perm.description,
        totalAssigned:
          parseInt(roleAssignments.count) +
          parseInt(staffAssignments.count) +
          parseInt(caretakerAssignments.count),
        roleAssignments: parseInt(roleAssignments.count),
        staffAssignments: parseInt(staffAssignments.count),
        caretakerAssignments: parseInt(caretakerAssignments.count),
      });
    }

    return stats;
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

    // Get all user permissions at once for efficiency
    const allPermissions = {};

    for (const userId of userIds) {
      const permissions = await this.getUserPermissions(userId);
      allPermissions[userId] = permissions;
    }

    // Check each user
    for (const userId of userIds) {
      results[userId] = allPermissions[userId].includes(permissionKey);
    }

    return results;
  }

  // Additional helper methods for Knex

  // Get permissions by category/group
  async getPermissionsByCategory(category = null) {
    let query = db("permission").select("*").orderBy("key", "asc");

    if (category) {
      // Assuming category is stored in metadata or we have a way to filter
      // This might need adjustment based on your actual schema
      query = query.where("key", "like", `${category}.%`);
    }

    const permissions = await query;

    // Group by category if no specific category requested
    if (!category) {
      const grouped = {};
      permissions.forEach((perm) => {
        const parts = perm.key.split(".");
        const category = parts[0];

        if (!grouped[category]) {
          grouped[category] = [];
        }

        grouped[category].push({
          id: perm.id,
          key: perm.key,
          description: perm.description,
        });
      });

      return grouped;
    }

    return permissions;
  }

  // Check if user has any of the given permissions
  async hasAnyPermission(userId, permissionKeys) {
    const permissions = await this.getUserPermissions(userId);
    return permissionKeys.some((key) => permissions.includes(key));
  }

  // Get users with specific permission
  async getUsersWithPermission(permissionKey) {
    // Get permission ID first
    const permission = await db("permission")
      .where({ key: permissionKey })
      .first();

    if (!permission) {
      return [];
    }

    // Users who have this permission via role
    const roleUsers = await db("user as u")
      .join("rolepermission as rp", "u.roleId", "rp.roleId")
      .where("rp.permissionId", permission.id)
      .select("u.*")
      .distinct();

    // Users who have this permission via staff permission
    const staffUsers = await db("user as u")
      .join("staffpermission as sp", "u.id", "sp.userId")
      .where("sp.permissionId", permission.id)
      .whereNull("sp.revokedAt")
      .select("u.*")
      .distinct();

    // Users who have this permission via caretaker assignment
    const caretakerUsers = await db("user as u")
      .join("caretakerassignment as ca", "u.id", "ca.caretakerId")
      .join(
        "caretakerassignmentpermission as cap",
        "ca.id",
        "cap.caretakerAssignmentId"
      )
      .where("cap.permissionId", permission.id)
      .where(function () {
        this.where("ca.expiresAt", ">", new Date()).orWhereNull("ca.expiresAt");
      })
      .select("u.*")
      .distinct();

    // Combine all users (remove duplicates by id)
    const allUsers = [...roleUsers, ...staffUsers, ...caretakerUsers];
    const uniqueUsers = [];
    const seenIds = new Set();

    allUsers.forEach((user) => {
      if (!seenIds.has(user.id)) {
        seenIds.add(user.id);
        uniqueUsers.push(user);
      }
    });

    return uniqueUsers;
  }
}

module.exports = new PermissionService();
