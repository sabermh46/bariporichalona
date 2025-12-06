const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.user) {
        return res.status(401).json({
          error: "Authentication required"
        });
      }

      // Check if user has a role
      if (!req.user.role) {
        return res.status(403).json({
          error: "User role not found"
        });
      }

      // Check if user's role is in allowed roles
      const userRoleSlug = req.user.role.slug;
      
      // If allowedRoles is a string, convert to array
      const allowedRolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
      
      if (!allowedRolesArray.includes(userRoleSlug)) {
        return res.status(403).json({
          error: `Access denied. Required roles: ${allowedRolesArray.join(', ')}`,
          userRole: userRoleSlug
        });
      }

      // Role check passed
      next();
    } catch (error) {
      console.error('Role middleware error:', error);
      res.status(500).json({
        error: "Internal server error in role validation"
      });
    }
  };
};

// Optional: Create specific role middlewares for convenience
roleMiddleware.webOwner = roleMiddleware(['WEB_OWNER']);
roleMiddleware.staff = roleMiddleware(['WEB_OWNER', 'STAFF']);
roleMiddleware.houseOwner = roleMiddleware(['WEB_OWNER', 'STAFF', 'HOUSE_OWNER']);
roleMiddleware.careTaker = roleMiddleware(['WEB_OWNER', 'STAFF', 'HOUSE_OWNER', 'CARE_TAKER']);

module.exports = roleMiddleware;