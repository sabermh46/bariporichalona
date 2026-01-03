// services/CaretakerAssignmentService.js
class CaretakerAssignmentService {
  // Assign permissions to a caretaker assignment
  async assignPermissions(assignmentId, permissionIds, grantedBy) {
    return await db.transaction(async (trx) => {
      // Verify assignment exists
      const assignment = await trx('caretakerassignment')
        .where({ id: assignmentId })
        .first();
      
      if (!assignment) {
        throw new Error('Caretaker assignment not found');
      }
      
      // Check if permissions already exist
      const existingPermissions = await trx('caretakerassignmentpermission')
        .where({ caretakerAssignmentId: assignmentId })
        .whereIn('permissionId', permissionIds)
        .whereNull('revokedAt')
        .select('permissionId');
      
      const existingIds = existingPermissions.map(p => p.permissionId);
      const newPermissionIds = permissionIds.filter(id => !existingIds.includes(id));
      
      // Insert new permissions
      const insertData = newPermissionIds.map(permissionId => ({
        caretakerAssignmentId: assignmentId,
        permissionId,
        grantedBy,
        grantedAt: new Date()
      }));
      
      if (insertData.length > 0) {
        await trx('caretakerassignmentpermission').insert(insertData);
      }
      
      return {
        assigned: insertData.length,
        alreadyAssigned: existingIds.length
      };
    });
  }
  
  // Revoke permissions from a caretaker assignment
  async revokePermissions(assignmentId, permissionIds, revokedBy) {
    return await db.transaction(async (trx) => {
      const result = await trx('caretakerassignmentpermission')
        .where({ caretakerAssignmentId: assignmentId })
        .whereIn('permissionId', permissionIds)
        .whereNull('revokedAt')
        .update({
          revokedAt: new Date(),
          revokedBy
        });
      
      return { revoked: result };
    });
  }
  
  // Get permissions for a caretaker assignment
  async getPermissions(assignmentId) {
    const permissions = await db('caretakerassignmentpermission as cap')
      .join('permission as p', 'cap.permissionId', 'p.id')
      .leftJoin('user as grantedBy', 'cap.grantedBy', 'grantedBy.id')
      .leftJoin('user as revokedBy', 'cap.revokedBy', 'revokedBy.id')
      .where('cap.caretakerAssignmentId', assignmentId)
      .select(
        'cap.*',
        'p.key as permission_key',
        'p.description as permission_description',
        'grantedBy.name as granted_by_name',
        'grantedBy.email as granted_by_email',
        'revokedBy.name as revoked_by_name',
        'revokedBy.email as revoked_by_email'
      );
    
    return permissions;
  }
  
  // Create a new caretaker assignment
  async createAssignment(houseId, caretakerId, createdBy, expiresAt = null, permissions = []) {
    return await db.transaction(async (trx) => {
      // Verify house exists and user is owner
      const house = await trx('house')
        .where({ id: houseId })
        .first();
      
      if (!house) {
        throw new Error('House not found');
      }
      
      // Verify caretaker exists and has caretaker role
      const caretaker = await trx('user')
        .where({ id: caretakerId })
        .leftJoin('role', 'user.roleId', 'role.id')
        .select('user.id', 'role.slug as role_slug')
        .first();
      
      if (!caretaker || caretaker.role_slug !== 'caretaker') {
        throw new Error('User is not a caretaker');
      }
      
      // Check if assignment already exists
      const existingAssignment = await trx('caretakerassignment')
        .where({ houseId, caretakerId })
        .whereNull('expiresAt')
        .orWhere('expiresAt', '>', new Date())
        .first();
      
      if (existingAssignment) {
        throw new Error('Caretaker is already assigned to this house');
      }
      
      // Create assignment
      const [assignmentId] = await trx('caretakerassignment').insert({
        uuid: uuidv4(),
        houseId,
        caretakerId,
        createdBy,
        createdAt: new Date(),
        expiresAt
      });
      
      // Assign permissions if any
      if (permissions.length > 0) {
        await this.assignPermissions(assignmentId, permissions, createdBy);
      }
      
      return assignmentId;
    });
  }
}