const router = require("express").Router();
const passport = require("passport");
const { serializeBigInt } = require("../utils/serializer");
const { sendAutoWelcomeNotification } = require("../utils/autoTestNotification");

router.get("/login/success", async (req, res)=>{
    if(req.user){

        const { createTokens } = require("../utils/tokens");
        const tokens = await createTokens(req.user.id.toString())
        console.log("tokens :"), tokens;
        const serializedUser = serializeBigInt(req.user);

        const user = { ...serializedUser };
        
        if(user.role?.slug === "web_owner") {
            setTimeout(async () => {
              await sendAutoWelcomeNotification(user.id, user.role.slug);
            }, 3000);
        }

        res.status(200).json({
            error: false,
            message: "Login Successful",
            user: serializedUser,
            ...tokens
        });
    } else {
        res.status(403).json({
            error: true,
            message: "Not Authorized"
        });
    }
})

router.get("/login/failed", (req, res)=>{
    res.status(401).json({
        error: true,
        message: "Login Failed"
    })
})


router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: "/auth/login/failed"
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

router.get("/logout", (req, res, next) => {
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