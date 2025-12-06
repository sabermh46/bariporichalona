const prisma = require("./prisma");
const passport = require("passport");
const { v4: uuid } = require("uuid");
const { serializeBigInt } = require("../utils/serializer");
const GoogleStrategy = require('passport-google-oauth20').Strategy;

let webOwnerRoleId = null;

(async () => {
  const role = await prisma.role.findUnique({ where: { slug: "web_owner" } });
  webOwnerRoleId = role?.id || null;
})();

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/auth/google/callback",
            scope: ["email", "profile"],
            prompt: "select_account"
        },
        async(accessToken, refreshToken, profile, done) => {
            try {

                const googleId = profile.id;
                const email = profile.emails[0].value;

                let user = await prisma.user.findUnique({where: {googleId}});

                if(user) {
                    // Optional data cleanup/update if user logs in again after a long time
                    await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            emailVerifiedAt: new Date(),
                            name: profile.displayName, // Update name if Google profile changed
                        }
                    });
                    return done(null, user);
                }

                 // CASE 2: email exists but no googleId → link google

                user = await prisma.user.findFirst({where: {
                    email: email,
                    googleId: null
                }});

                if(user) {
                    user = await prisma.user.update({
                        where: {id: user.id},
                        data: {
                            googleId: googleId,
                            emailVerifiedAt: new Date()
                        }
                    });
                    return done(null, user);
                }

                // CASE 3: new google signup

                user = await prisma.user.create({
                    data: {
                        uuid: uuid(),
                        email,
                        googleId,
                        needsPasswordSetup: true,
                        name: profile.displayName,
                        avatarUrl: profile.photos?.[0]?.value || null,
                        roleId: webOwnerRoleId,
                        emailVerifiedAt: new Date(),
                        locale: profile._json?.locale || "en"
                    }
                });

                return done(null, user);
                
            } catch (error) {
                return done(error);
            }
        }
    )
)

passport.serializeUser((user, done)=>{
    done(null, user.id.toString());
});

passport.deserializeUser(async (id, done)=>{
    try {
        const userId = serializeBigInt(id);

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { role: true }
        });
        done(null, user);
    } catch (error) {
        done(error, null);
    }
})