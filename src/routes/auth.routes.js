const router = require("express").Router();
const AuthController = require("../controllers/auth.controller");
const authMiddleware = require("../middleware/auth.middleware");
const roleMiddleware = require("../middleware/role.middleware");
const { loginLimiter, passwordResetLimiter, registrationLimiter, refreshLimiter, validateTokenLimiter, checkLinkLimiter } = require("../middleware/rateLimiter");
const { uploadSingleMiddleware, validateUploadMiddleware } = require("../utils/fileUpload");

router.post("/register", registrationLimiter, AuthController.register);
router.post('/validate-token', validateTokenLimiter, AuthController.validateToken);
router.get('/settings', AuthController.getSystemSettings);

router.post('/generate-token', authMiddleware, roleMiddleware(['web_owner', 'staff']), AuthController.generateToken);
router.post('/create-user', 
    authMiddleware,
    roleMiddleware(['web_owner', 'staff']),
    AuthController.createUser
)
router.post('/login-as',
    authMiddleware,
    roleMiddleware(['web_owner', 'staff']),
    AuthController.loginAs
)
router.post('/exit-login-as',
    authMiddleware,
    AuthController.exitLoginAs
)

router.get('/managed-users',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff']),
  AuthController.getManagedUsers
);

router.put('/user/:userId/limits',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff']),
  AuthController.updateUserLimits
);

router.get('/registration-tokens',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff']),
  AuthController.getRegistrationTokens
);

router.delete('/registration-token/:tokenId',
  authMiddleware,
  roleMiddleware(['web_owner', 'staff']),
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


router.post("/login", loginLimiter, AuthController.login);
router.post("/logout", AuthController.logout);
router.post("/set-password", authMiddleware, AuthController.setPassword);
router.post("/link-google", authMiddleware, AuthController.linkGoogleAccount);
router.post("/check-link", checkLinkLimiter, AuthController.checkAccountLink);
router.post("/refresh", refreshLimiter, AuthController.refreshToken);
router.get("/public-registration-status", AuthController.getPublicRegistrationStatus);

// Password management routes
router.post('/forgot-password',
    passwordResetLimiter,
    AuthController.forgotPassword
);

router.post('/reset-password',
    passwordResetLimiter,
    AuthController.resetPassword
);

// Protected routes
router.post('/change-password',
    authMiddleware,
    AuthController.changePassword
);

router.post('/profile/avatar',
    authMiddleware,
    uploadSingleMiddleware('avatar'),
    validateUploadMiddleware,
    AuthController.uploadAvatar
);

module.exports = router;
