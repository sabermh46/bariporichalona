const router = require("express").Router();
const passport = require("passport");
const { serializeBigInt } = require("../utils/serializer");
const { sendAutoWelcomeNotification } = require("../utils/autoTestNotification");
const pushService = require("../services/pushNotification.service");
const authMiddleware = require("../middleware/auth.middleware");
const PushService = require("../services/push.service");
const permissionService  = require("../services/permission.service");
const { createTokens } = require("../utils/tokens");
const prisma = require("../config/prisma");

router.get("/login/success", async (req, res)=>{
    if(req.user){
        try {
            const tokens = await createTokens(req.user.id.toString());
            
            const serializedUser = serializeBigInt(req.user);

            const user = { ...serializedUser };

            if(user.role?.slug === "web_owner") {
                setTimeout(async () => {
                await sendAutoWelcomeNotification(user.id, user.role.slug);
                }, 3000);
            }

            // Get user permissions
            const permissions = await permissionService.getUserPermissions(serializedUser.id);
            
            // Update user's last login time
            await prisma.user.update({
                where: { id: serializedUser.id },
                data: {
                    lastLoginAt: new Date(),
                    // lastLoginIp: req.ip // Uncomment if you want to track IP
                }
            });

            console.log("User permissions:", permissions);
            
            res.status(200).json({
                error: false,
                message: "Login Successful",
                user: {
                    ...serializedUser,
                    permission: permissions // Attach permissions to user object
                },
                ...tokens,
                permission: permissions // Also include at top level for backward compatibility
            });
        } catch (error) {
            console.error('Token creation error:', error);
            res.status(500).json({
                error: true,
                message: "Token creation failed",
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    } else {
        res.status(403).json({
            error: true,
            message: "Not Authenticated"
        });
    }
});

router.get("/login/failed", (req, res)=>{
    res.status(401).json({
        error: true,
        message: "Login Failed"
    });
});

router.get(
    "/google/callback",
    passport.authenticate("google", {
        failureRedirect: `${process.env.CLIENT_URL}/login?error=google_auth_failed`
    }),
    (req, res) => {
        // Successful authentication, redirect to frontend with success
        res.redirect(`${process.env.CLIENT_URL}/auth/success`);
    }
);

router.get(
    "/google",
    passport.authenticate("google", {
        scope: ["profile", "email"],
        prompt: "select_account"
    })
);

router.get("/logout", authMiddleware, async (req, res, next) => {

    await PushService.removeAllPushSubscription(req.user?.id);
    
    req.logout(function(err) {
        if (err) {
            return next(err);
        }
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ message: 'Logged out successfully' });
        });
    });
});

module.exports = router;