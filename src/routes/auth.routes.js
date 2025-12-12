const router = require("express").Router();
const AuthController = require("../controllers/auth.controller");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware")

router.post("/register", AuthController.register);
router.post('/validate-token', AuthController.validateToken);
router.get('/settings', AuthController.getSystemSettings);

router.post('/generate-token', authMiddleware, roleMiddleware(['web_owner', 'staff', 'house_owner']), AuthController.generateToken);
router.post('/create-user', 
    authMiddleware,
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    AuthController.createUser
)
router.post('/login-as',
    authMiddleware,
    roleMiddleware(['web_owner', 'staff', 'house_owner']),
    AuthController.loginAs
)
router.post('/exit-login-as',
    authMiddleware,
    AuthController.exitLoginAs
)

router.get('/managed-users',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff', 'house_owner']),
  AuthController.getManagedUsers
);

router.put('/user/:userId/limits',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff']),
  AuthController.updateUserLimits
);

router.get('/registration-tokens',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff', 'house_owner']),
  AuthController.getRegistrationTokens
);

router.delete('/registration-token/:tokenId',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff', 'house_owner']),
  AuthController.revokeRegistrationToken
);

router.get('/login-as-sessions',
  authMiddleware,
  AuthController.getLoginAsSessions
);

router.put('/system-settings',
  authMiddleware,
  roleMiddleware(['web_owner']),
  AuthController.updateSystemSettings
);


router.post("/login", AuthController.login);
router.post("/set-password", authMiddleware, AuthController.setPassword);
router.post("/link-google", authMiddleware, AuthController.linkGoogleAccount);
router.post("/check-link", AuthController.checkAccountLink); // indicating this line
router.post("/refresh", AuthController.refreshToken);
router.get("/public-registration-status", AuthController.getPublicRegistrationStatus);


module.exports = router;
