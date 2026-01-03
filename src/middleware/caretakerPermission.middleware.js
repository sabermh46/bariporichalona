// middleware/caretakerPermission.js

const HouseController = require("../controllers/house.controller");
const CaretakerPermissionService = require("../services/CaretakerPermission.service");

/**
 * Middleware to check if a caretaker has permission for a specific house
 * @param {string} permissionKey - The permission key to check
 * @returns {Function} - Express middleware
 */
function checkCaretakerHousePermission(permissionKey) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      
      // Skip check for non-caretakers
      if (user.role.slug !== 'caretaker') {
        return next();
      }

      // Extract houseId from request
      let houseId;
      
      if (req.params.houseId) {
        houseId = req.params.houseId;
      } else if (req.params.id && req.baseUrl.includes('/houses')) {
        houseId = req.params.id;
      } else if (req.body.houseId || req.body.house_id) {
        houseId = req?.body?.houseId || req?.body?.house_id;
      } else {
        return res.status(400).json({
          success: false,
          error: "House ID is required",
        });
      }

      // Check permission
      const hasPermission =  CaretakerPermissionService.hasCaretakerPermission(
        user.id,
        houseId,
        permissionKey
      );

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: `Permission '${permissionKey}' required for this house`,
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        success: false,
        error: 'Permission check failed',
      });
    }
  };
}

/**
 * Middleware to check if user can access a house (any permission)
 * @returns {Function} - Express middleware
 */
function checkHouseAccess() {
  return async (req, res, next) => {
    try {
      const user = req.user;
      const houseId = req.params.id || req.params.houseId || req.body.houseId;

      if (!houseId) {
        return res.status(400).json({
          success: false,
          error: "House ID is required",
        });
      }

      const hasAccess = await HouseController.canAccessHouse(user, houseId);

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: "You do not have access to this house",
        });
      }

      next();
    } catch (error) {
      console.error('House access check error:', error);
      res.status(500).json({
        success: false,
        error: 'Access check failed',
      });
    }
  };
}

module.exports = {
  checkCaretakerHousePermission,
  checkHouseAccess,
};