const router = require("express").Router();
const AuthController = require("../controllers/auth.controller");
const authMiddleware = require("../middleware/auth.middleware");
const { refreshToken } = require("../services/auth.service");

router.post("/register", AuthController.register);
router.post("/login", AuthController.login);
router.post("/set-password", authMiddleware, AuthController.setPassword);
router.post("/link-google", authMiddleware, AuthController.linkGoogleAccount);
router.post("/check-link", AuthController.checkAccountLink); // indicating this line
router.post("/refresh", refreshToken);


module.exports = router;
