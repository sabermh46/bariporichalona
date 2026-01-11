// services/CaretakerPermissionService.js
const db = require("../config/knex");

class CaretakerPermissionService {
  /**
   * Check if a caretaker has permission for a specific house
   */
  async hasCaretakerPermission(caretakerId, houseId, permissionKey) {
    try {
      if (!caretakerId || !houseId || !permissionKey) {
        throw new Error('Missing required parameters caretakerId, houseId, or permissionKey');
      }

      // Check if user is assigned as caretaker to this house
      const assignment = await db('caretakerassignment as ca')
        .where('ca.caretakerId', caretakerId)
        .where('ca.houseId', houseId)
        .andWhere(function() {
          this.where('ca.expiresAt', '>', new Date())
            .orWhereNull('ca.expiresAt');
        })
        .first();
      
      if (!assignment) {
        return false;
      }

      // Check if assignment has the required permission
      const hasPermission = await db('caretakerassignmentpermission as cap')
        .join('permission as p', 'cap.permissionId', 'p.id')
        .where('cap.caretakerAssignmentId', assignment.id)
        .where('p.key', permissionKey)
        .whereNull('cap.revokedAt')
        .first();
      
      return !!hasPermission;
    } catch (error) {
      console.error('Error checking caretaker permission:', error.message);
      return false;
    }
  }

  /**
   * Get all houses where a caretaker is assigned
   */
  async getCaretakerHouses(caretakerId) {
    try {
      if (!caretakerId) {
        throw new Error('Missing caretakerId parameter');
      }

      const assignments = await db('caretakerassignment as ca')
        .where('ca.caretakerId', caretakerId)
        .andWhere(function() {
          this.where('ca.expiresAt', '>', new Date())
            .orWhereNull('ca.expiresAt');
        })
        .select('ca.houseId');
      
      return assignments.map(a => parseInt(a.houseId));
    } catch (error) {
      console.error('Error getting caretaker houses:', error.message);
      return [];
    }
  }

  /**
   * Get all permissions for a caretaker in a specific house
   */
  async getCaretakerHousePermissions(caretakerId, houseId) {
    try {
      if (!caretakerId || !houseId) {
        throw new Error('Missing required parameters');
      }

      const assignment = await db('caretakerassignment as ca')
        .where('ca.caretakerId', caretakerId)
        .where('ca.houseId', houseId)
        .andWhere(function() {
          this.where('ca.expiresAt', '>', new Date())
            .orWhereNull('ca.expiresAt');
        })
        .first();
      
      if (!assignment) {
        return [];
      }

      const permissions = await db('caretakerassignmentpermission as cap')
        .join('permission as p', 'cap.permissionId', 'p.id')
        .where('cap.caretakerAssignmentId', assignment.id)
        .whereNull('cap.revokedAt')
        .select('p.key');
      
      return permissions.map(p => p.key);
    } catch (error) {
      console.error('Error getting caretaker permissions:', error.message);
      return [];
    }
  }

  /**
   * Check if user has any permission for a house
   */
  async hasHousePermission(user, houseId, permissionKey) {
    try {
      if (!user || !houseId || !permissionKey) {
        throw new Error('Missing required parameters');
      }

      const PermissionService = require("./permission.service");
      
      // For non-caretakers, use the existing permission service
      if (user.role.slug !== 'caretaker') {
        return await PermissionService.hasPermission(user.id, permissionKey);
      }
      
      // For caretakers, check caretaker-specific permissions
      return await this.hasCaretakerPermission(user.id, houseId, permissionKey);
    } catch (error) {
      console.error('Error checking house permission:', error.message);
      return false;
    }
  }

  /**
   * Get all houses a user can access based on their role and permissions
   */
  async getAccessibleHouses(user) {
    try {
      if (!user || !user.role || !user.id) {
        throw new Error('Invalid user object');
      }

      if (user.role.slug === 'web_owner') {
        // Web owner can access all houses
        const houses = await db('house').select('id');
        return houses.map(h => parseInt(h.id));
      } else if (user.role.slug === 'house_owner') {
        // House owner can access their own houses
        const houses = await db('house')
          .where('ownerId', user.id)
          .select('id');
        return houses.map(h => parseInt(h.id));
      } else if (user.role.slug === 'staff') {
        // Staff can access houses of owners they manage
        // Get house_owner role
        const houseOwnerRole = await db('role').where('slug', 'house_owner').first();
        if (!houseOwnerRole) return [];
        
        // Get users managed by this staff
        const managedUsers = await db('user')
          .where('parentId', user.id)
          .where('roleId', houseOwnerRole.id)
          .select('id');
        
        const ownerIds = managedUsers.map(u => u.id);
        if (ownerIds.length === 0) return [];
        
        const houses = await db('house')
          .whereIn('ownerId', ownerIds)
          .select('id');
        return houses.map(h => parseInt(h.id));
      } else if (user.role.slug === 'caretaker') {
        // Caretaker can access houses where they are assigned
        return await this.getCaretakerHouses(user.id);
      }
      
      return [];
    } catch (error) {
      console.error('Error getting accessible houses:', error.message);
      return [];
    }
  }
}

module.exports = new CaretakerPermissionService();