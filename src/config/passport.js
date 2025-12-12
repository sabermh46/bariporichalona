const prisma = require("./prisma");
const passport = require("passport");
const { v4: uuid } = require("uuid");
const { serializeBigInt } = require("../utils/serializer");
const AuthService = require("../services/auth.service");
const GoogleStrategy = require('passport-google-oauth20').Strategy;

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/auth/google/callback",
            scope: ["email", "profile"],
            prompt: "select_account",
            passReqToCallback: true // Add this to access req
        },
        async(req, accessToken, refreshToken, profile, done) => {
            try {
                const googleId = profile.id;
                const email = profile.emails[0].value;
                const registrationToken = req.query.token || null; // Get token from query param

                console.log(`Google auth attempt for: ${email}, token: ${registrationToken ? 'with token' : 'no token'}`);

                // CASE 1: User exists with this googleId (Login)
                let user = await prisma.user.findUnique({
                    where: { googleId },
                    include: { role: true }
                });

                if (user) {
                    console.log(`Existing Google user found: ${user.email}`);
                    return done(null, user);
                }

                let avatarUrl = profile.photos?.[0]?.value || null;

                // CASE 2: User exists with this email (Link Google account)
                user = await prisma.user.findFirst({
                    where: {
                        email: email,
                        googleId: null
                    },
                    include: { role: true }
                });

                if (user) {
                    console.log(`Linking Google to existing user: ${user.email}`);
                    
                    user = await prisma.user.update({
                        where: { id: user.id },
                        data: {
                            googleId: googleId,
                            emailVerifiedAt: new Date(),
                            needsPasswordSetup: false,
                            avatarUrl: user.avatarUrl ? user.avatarUrl : avatarUrl,
                        },
                        include: { role: true }
                    });
                    return done(null, user);
                }

                // CASE 3: New Google signup - ONLY allowed under specific conditions
                console.log(`No existing account found for Google email: ${email}`);

                // Get public registration setting
                const publicRegistrationEnabled = await AuthService.getSettings('registration.public_enabled', false);

                console.log(`Public registration is ${publicRegistrationEnabled ? 'enabled' : 'disabled'}`);
                
                // If token is provided, validate it
                let tokenData = null;
                let roleSlug = null;
                let createdBy = null;

                if (registrationToken) {
                    try {
                        tokenData = await AuthService.validateRegistrationToken(registrationToken, email);
                        roleSlug = tokenData.roleSlug;
                        createdBy = tokenData.createdBy;
                        console.log(`Valid token for role: ${roleSlug}`);
                    } catch (tokenError) {
                        return done(null, false, { 
                            message: `Invalid registration token: ${tokenError.message}` 
                        });
                    }
                }

                // Determine if we can create a new account
                const canCreateAccount = publicRegistrationEnabled || registrationToken;
                
                if (!canCreateAccount) {
                    return done(null, false, { 
                        message: 'Account not found. Please register first or use a registration token.' 
                    });
                }

                // Determine role
                if (!roleSlug) {
                    // For public registration without token, use default role
                    roleSlug = await AuthService.getSettings('registration.default_role', 'house_owner');
                    console.log(roleSlug);
                    
                }

                // Get role ID
                const role = await prisma.role.findUnique({
                    where: { slug: roleSlug }
                });

                if (!role) {
                    return done(null, false, { 
                        message: `Role ${roleSlug} not found` 
                    });
                }

                // Create new user
                user = await prisma.user.create({
                    data: {
                        uuid: uuid(),
                        email,
                        googleId,
                        name: profile.displayName,
                        avatarUrl: profile.photos?.[0]?.value || null,
                        needsPasswordSetup: true, // User needs to set password later
                        roleId: role.id,
                        parentId: createdBy || null,
                        emailVerifiedAt: new Date(),
                        metadata: {
                            registeredVia: registrationToken ? 'google_token' : (publicRegistrationEnabled ? 'google_public' : 'google'),
                            registrationToken: registrationToken || null,
                            googleProfile: {
                                id: profile.id,
                                displayName: profile.displayName,
                                locale: profile._json?.locale
                            }
                        }
                    },
                    include: {
                        role: true,
                        parent: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                role: true
                            }
                        }
                    }
                });

                // Mark token as used if applicable
                if (tokenData) {
                    await prisma.registrationToken.update({
                        where: { id: tokenData.id },
                        data: {
                            used: true,
                            usedAt: new Date(),
                            usedBy: user.id
                        }
                    });
                }

                console.log(`New user created via Google: ${user.email} (${user.role.slug})`);
                return done(null, user);
                
            } catch (error) {
                console.error('Google strategy error:', error);
                return done(error);
            }
        }
    )
);

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
});