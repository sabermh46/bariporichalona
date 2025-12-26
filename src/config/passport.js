// src/config/passport.js
const passport = require("passport");
const { v4: uuidv4 } = require("uuid");
const AuthService = require("../services/auth.service");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db = require("./knex");

passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/auth/google/callback",
            scope: ["email", "profile"],
            prompt: "select_account",
            passReqToCallback: true
        },
        async(req, accessToken, refreshToken, profile, done) => {
            try {
                const googleId = profile.id;
                const email = profile.emails[0].value;
                const registrationToken = req.query.token || null;

                console.log(`Google auth attempt for: ${email}, token: ${registrationToken ? 'with token' : 'no token'}`);

                // CASE 1: User exists with this googleId (Login)
                let user = await db('user')
                    .where('user.googleId', googleId)
                    .leftJoin('role', 'user.roleId', 'role.id')
                    .select(
                        'user.*',
                        'role.name as role_name',
                        'role.slug as role_slug',
                        'role.rank as role_rank',
                        'role.description as role_description'
                    )
                    .first();

                if (user) {
                    console.log(`Existing Google user found: ${user.email}`);
                    
                    // Format user object to match expected structure
                    user = {
                        ...user,
                        role: {
                            id: user.roleId,
                            name: user.role_name,
                            slug: user.role_slug,
                            rank: user.role_rank,
                            description: user.role_description
                        }
                    };
                    
                    delete user.role_name;
                    delete user.role_slug;
                    delete user.role_rank;
                    delete user.role_description;
                    
                    return done(null, user);
                }

                let avatarUrl = profile.photos?.[0]?.value || null;

                // CASE 2: User exists with this email (Link Google account)
                user = await db('user')
                    .where('user.email', email)
                    .whereNull('user.googleId')
                    .leftJoin('role', 'user.roleId', 'role.id')
                    .select(
                        'user.*',
                        'role.name as role_name',
                        'role.slug as role_slug',
                        'role.rank as role_rank',
                        'role.description as role_description'
                    )
                    .first();

                if (user) {
                    console.log(`Linking Google to existing user: ${user.email}`);
                    
                    await db('user')
                        .where('user.id', user.id)
                        .update({
                            googleId: googleId,
                            emailVerifiedAt: new Date(),
                            needsPasswordSetup: false,
                            avatarUrl: user.avatarUrl ? user.avatarUrl : avatarUrl,
                            updatedAt: new Date()
                        });

                    // Get updated user with role
                    user = await db('user')
                        .where('user.id', user.id)
                        .leftJoin('role', 'user.roleId', 'role.id')
                        .select(
                            'user.*',
                            'role.name as role_name',
                            'role.slug as role_slug',
                            'role.rank as role_rank',
                            'role.description as role_description'
                        )
                        .first();

                    user = {
                        ...user,
                        role: {
                            id: user.roleId,
                            name: user.role_name,
                            slug: user.role_slug,
                            rank: user.role_rank,
                            description: user.role_description
                        }
                    };
                    
                    delete user.role_name;
                    delete user.role_slug;
                    delete user.role_rank;
                    delete user.role_description;
                    
                    return done(null, user);
                }

                // CASE 3: New Google signup
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
                        tokenData = await AuthService.validateRegistrationToken(registrationToken);
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
                    roleSlug = await AuthService.getSettings('registration.default_role', 'house_owner');
                }

                // Get role ID
                const role = await db('role')
                    .where({ slug: roleSlug })
                    .first();

                if (!role) {
                    return done(null, false, { 
                        message: `Role ${roleSlug} not found` 
                    });
                }

                // Create new user
                const userId = await db.transaction(async (trx) => {
                    const userData = {
                        uuid: uuidv4(),
                        email,
                        googleId,
                        name: profile.displayName,
                        avatarUrl: profile.photos?.[0]?.value || null,
                        needsPasswordSetup: true,
                        roleId: role.id,
                        parentId: createdBy || null,
                        emailVerifiedAt: new Date(),
                        locale: 'en',
                        status: 'active',
                        metadata: JSON.stringify({
                            registeredVia: registrationToken ? 'google_token' : (publicRegistrationEnabled ? 'google_public' : 'google'),
                            registrationToken: registrationToken || null,
                            googleProfile: {
                                id: profile.id,
                                displayName: profile.displayName,
                                locale: profile._json?.locale
                            }
                        }),
                        createdAt: new Date(),
                        updatedAt: new Date()
                    };

                    const [newUserId] = await trx('user').insert(userData);
                    
                    // Mark token as used if applicable
                    if (tokenData) {
                        await trx('registrationtoken')
                            .where({ id: tokenData.id })
                            .update({
                                used: true,
                                usedAt: new Date(),
                                usedBy: newUserId
                            });
                    }
                    
                    return newUserId;
                });

                // Get the newly created user with role
                user = await db('user')
                    .where('user.id', userId)
                    .leftJoin('role', 'user.roleId', 'role.id')
                    .leftJoin('user as parent', 'user.parentId', 'parent.id')
                    .select(
                        'user.*',
                        'role.name as role_name',
                        'role.slug as role_slug',
                        'role.rank as role_rank',
                        'role.description as role_description',
                        'parent.id as parent_id',
                        'parent.name as parent_name',
                        'parent.email as parent_email'
                    )
                    .first();

                user = {
                    ...user,
                    role: {
                        id: user.roleId,
                        name: user.role_name,
                        slug: user.role_slug,
                        rank: user.role_rank,
                        description: user.role_description
                    },
                    parent: user.parent_id ? {
                        id: user.parent_id,
                        name: user.parent_name,
                        email: user.parent_email
                    } : null
                };
                
                delete user.role_name;
                delete user.role_slug;
                delete user.role_rank;
                delete user.role_description;
                delete user.parent_id;
                delete user.parent_name;
                delete user.parent_email;

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
        const userId = BigInt(id);

        const user = await db('user')
            .where('user.id', userId)
            .leftJoin('role', 'user.roleId', 'role.id')
            .select(
                'user.*',
                'role.name as role_name',
                'role.slug as role_slug',
                'role.rank as role_rank',
                'role.description as role_description'
            )
            .first();

        if (!user) {
            return done(new Error('User not found'), null);
        }

        const formattedUser = {
            ...user,
            role: {
                id: user.roleId,
                name: user.role_name,
                slug: user.role_slug,
                rank: user.role_rank,
                description: user.role_description
            }
        };
        
        delete formattedUser.role_name;
        delete formattedUser.role_slug;
        delete formattedUser.role_rank;
        delete formattedUser.role_description;

        done(null, formattedUser);
    } catch (error) {
        done(error, null);
    }
});

module.exports = passport;