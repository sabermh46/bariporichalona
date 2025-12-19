const router = require("express").Router();
const passport = require("passport");
const { serializeBigInt } = require("../utils/serializer");
const { sendAutoWelcomeNotification } = require("../utils/autoTestNotification");
const pushService = require("../services/pushNotification.service");
const authMiddleware = require("../middleware/auth.middleware");
const PushService = require("../services/push.service");
const permissionService  = require("../services/permission.service");
const { createTokens } = require("../utils/tokens");
const db = require("../config/knex");

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
            await db('user')
                .where({ id: serializedUser.id })
                .update({
                    lastLoginAt: new Date(),
                    updatedAt: new Date()
                });

            console.log("User permissions:", permissions);
            
            res.status(200).json({
                error: false,
                message: "Login Successful",
                user: {
                    ...serializedUser,
                    permission: permissions
                },
                ...tokens,
                permission: permissions
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