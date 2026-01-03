// controllers/CaretakerAssignmentPermissionController.js
class CaretakerAssignmentPermissionController {
  async assignPermissions(req, res) {
    try {
      const { assignmentId } = req.params;
      const { permissionIds } = req.body;
      const grantedBy = req.user.id;
      
      const result = await CaretakerAssignmentService.assignPermissions(
        assignmentId, 
        permissionIds, 
        grantedBy
      );
      
      res.json(serializeBigInt(result));
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  }
  
  async revokePermissions(req, res) {
    try {
      const { assignmentId } = req.params;
      const { permissionIds } = req.body;
      const revokedBy = req.user.id;
      
      const result = await CaretakerAssignmentService.revokePermissions(
        assignmentId, 
        permissionIds, 
        revokedBy
      );
      
      res.json(serializeBigInt(result));
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  }
  
  async getPermissions(req, res) {
    try {
      const { assignmentId } = req.params;
      
      const permissions = await CaretakerAssignmentService.getPermissions(assignmentId);
      
      res.json(serializeBigInt(permissions));
    } catch (err) {
      console.error(err);
      res.status(400).json({ error: err.message });
    }
  }
}