// services/CaretakerPermissionService.js
const db = require("../config/knex");

class CaretakerPermissionService {
  /**
   * Check if a caretaker has permission for a specific house
   * @param {number} caretakerId - The caretaker user ID
   * @param {number} houseId - The house ID
   * @param {string} permissionKey - The permission key to check
   * @returns {boolean} - Whether the caretaker has permission
   */
  async hasCaretakerPermission(caretakerId, houseId, permissionKey) {
    try {
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
      console.error('Error checking caretaker permission:', error);
      return false;
    }
  }

  /**
   * Get all houses where a caretaker is assigned
   * @param {number} caretakerId - The caretaker user ID
   * @returns {Array} - Array of house IDs
   */
  async getCaretakerHouses(caretakerId) {
    try {
      const assignments = await db('caretakerassignment as ca')
        .where('ca.caretakerId', caretakerId)
        .andWhere(function() {
          this.where('ca.expiresAt', '>', new Date())
            .orWhereNull('ca.expiresAt');
        })
        .select('ca.houseId');
      
      return assignments.map(a => a.houseId);
    } catch (error) {
      console.error('Error getting caretaker houses:', error);
      return [];
    }
  }

  /**
   * Get all permissions for a caretaker in a specific house
   * @param {number} caretakerId - The caretaker user ID
   * @param {number} houseId - The house ID
   * @returns {Array} - Array of permission keys
   */
  async getCaretakerHousePermissions(caretakerId, houseId) {
    try {
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
      console.error('Error getting caretaker permissions:', error);
      return [];
    }
  }

  /**
   * Check if user has any permission for a house (combines staff and caretaker permissions)
   * @param {Object} user - The user object
   * @param {number} houseId - The house ID
   * @param {string} permissionKey - The permission key to check
   * @returns {boolean} - Whether the user has permission
   */
  async hasHousePermission(user, houseId, permissionKey) {
    const PermissionService = require("./permission.service");
    
    // For non-caretakers, use the existing permission service
    if (user.role.slug !== 'caretaker') {
      return await PermissionService.hasPermission(user.id, permissionKey);
    }
    
    // For caretakers, check caretaker-specific permissions
    return await this.hasCaretakerPermission(user.id, houseId, permissionKey);
  }

  /**
   * Get all houses a user can access based on their role and permissions
   * @param {Object} user - The user object
   * @returns {Array} - Array of house IDs
   */
  async getAccessibleHouses(user) {
    if (user.role.slug === 'web_owner') {
      // Web owner can access all houses
      const houses = await db('house').select('id');
      return houses.map(h => h.id);
    } else if (user.role.slug === 'house_owner') {
      // House owner can access their own houses
      const houses = await db('house')
        .where('ownerId', user.id)
        .select('id');
      return houses.map(h => h.id);
    } else if (user.role.slug === 'staff') {
      // Staff can access houses of owners they manage
      const managedOwners = await this.getManagedUsers(user.id, 'house_owner');
      const ownerIds = managedOwners.map(o => o.id);
      
      if (ownerIds.length === 0) return [];
      
      const houses = await db('house')
        .whereIn('ownerId', ownerIds)
        .select('id');
      return houses.map(h => h.id);
    } else if (user.role.slug === 'caretaker') {
      // Caretaker can access houses where they are assigned
      return this.getCaretakerHouses(user.id);
    }
    
    return [];
  }
}

module.exports = new CaretakerPermissionService();