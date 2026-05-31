// src/services/auth.service.js
const db = require("../config/knex");
const { hashPassword, verifyPassword } = require("../utils/password");
const { createTokens } = require("../utils/tokens");
const { v4: uuidv4 } = require("uuid");
const { validateRegistrationData } = require("../utils/validateRegistrationData");
const jwt = require("jsonwebtoken");
const permissionService = require("./permission.service");
const crypto = require("crypto");
const emailService = require('./email.service');

class AuthService {
  constructor() {
    this.defaultSettings = {
      "registration.public_enabled": {
        value: false,
        type: "boolean",
        category: "registration",
      },
      "registration.require_approval": {
        value: true,
        type: "boolean",
        category: "registration",
      },
      "registration.default_role": {
        value: "house_owner",
        type: "string",
        category: "registration",
      },
    };
  }

  async initializeSystemSettings() {
    for (const [key, setting] of Object.entries(this.defaultSettings)) {
      const existingSetting = await db('systemsetting')
        .where({ key })
        .first();

      if (!existingSetting) {
        await db('systemsetting').insert({
          key,
          value: setting.value,
          type: setting.type,
          category: setting.category,
          isPublic: setting.category === "registration" ? true : false,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }

    const defaultRoleLimits = [
      { roleSlug: 'web_owner', maxHouses: 999, maxCaretakers: 50, maxFlats: 1000, canLoginAs: JSON.stringify(['staff', 'house_owner', 'caretaker']) },
      { roleSlug: 'staff', maxHouses: 50, maxCaretakers: 20, maxFlats: 500, canLoginAs: JSON.stringify(['house_owner', 'caretaker']) },
      { roleSlug: 'house_owner', maxHouses: 5, maxCaretakers: 5, maxFlats: 50, canLoginAs: JSON.stringify(['caretaker']) },
      { roleSlug: 'caretaker', maxHouses: 0, maxCaretakers: 0, maxFlats: 0, canLoginAs: JSON.stringify([]) },
    ];

    for (const limit of defaultRoleLimits) {
      const existing = await db('rolelimit')
        .where({ roleSlug: limit.roleSlug })
        .first();

      if (!existing) {
        await db('rolelimit').insert({
          roleSlug: limit.roleSlug,
          maxHouses: limit.maxHouses,
          maxCaretakers: limit.maxCaretakers,
          maxFlats: limit.maxFlats,
          canLoginAs: limit.canLoginAs,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }
  }

  async getSettings(key, defaultValue = null) {
    const setting = await db('systemsetting')
      .where({ key })
      .first();

    if (setting) {
      // LONGTEXT stores everything as a string; deserialize to the correct type
      // so booleans like 'false' are not treated as truthy by callers.
      if (setting.type === 'boolean') {
        return setting.value === 'true' || setting.value === '1' || setting.value === 1 || setting.value === true;
      }
      if (setting.type === 'number') {
        return Number(setting.value);
      }
      return setting.value;
    }

    if (this.defaultSettings[key]) {
      return this.defaultSettings[key].value;
    }

    return defaultValue;
  }

async generateRegistrationToken(creatorId, options = {}) {
  const {
    email = null,
    roleSlug = 'caretaker',
    expiresInHours = 24,
    metaData = {}
  } = options;

  // 1. New Logic: Check if email is already registered
  if (email) {
    const existingUser = await db('user')
      .where({ email })
      .first();

    if (existingUser) {
      throw new Error(`Email ${email} is already registered to an account`);
    }
  }

  // 2. Fix: Use 'user.id' to avoid ambiguity
  const creator = await db('user')
    .where({ 'user.id': creatorId }) 
    .leftJoin('role', 'user.roleId', 'role.id')
    .select(
      'user.*',
      'role.slug as role_slug',
      'role.rank as role_rank'
    )
    .first();

  if (!creator) {
    throw new Error("Creator user not found");
  }

  const roleHierarchy = {
    'web_owner': 100,
    'staff': 80,
    'house_owner': 60,
    'caretaker': 40
  };

  const targetRole = await db('role')
    .where({ slug: roleSlug })
    .first();

  if (!targetRole) {
    throw new Error(`Role ${roleSlug} not found`);
  }

  if (roleHierarchy[creator.role_slug] <= roleHierarchy[roleSlug]) {
    throw new Error(`You cannot create ${roleSlug} accounts`);
  }

  if(roleSlug === 'caretaker') {
    if(!metaData.house_owner_id){
      throw new Error("metaData must include house_owner_id for caretaker registration tokens");
    }

    const houseOwner = await db('user')
      .where( 'user.id', metaData.house_owner_id ) 
      .leftJoin('role', 'user.roleId', 'role.id')
      .select('user.*', 'role.slug as role_slug')
      .first()

      if(!houseOwner || houseOwner.role_slug !== 'house_owner'){
        throw new Error("Invalid house_owner in metadata");
      }
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  const [registrationTokenId] = await db('registrationtoken').insert({
    token,
    createdBy: creatorId,
    email,
    roleSlug,
    expiresAt,
    metadata: JSON.stringify({
      ...metaData,
      createdByEmail: creator.email,
      createdByName: creator.name,
      house_owner_id: metaData.house_owner_id || null,
      house_ids: metaData.house_ids || null
    }),
    createdAt: new Date()
  });

  return {
    token,
    expiresAt,
    roleSlug,
    email,
    registrationLink: `${process.env.CLIENT_URL}/signup?token=${token}`
  };
}

  async validateRegistrationToken(token) {
    const registrationToken = await db('registrationtoken as rt')
      .where('rt.token', token)
      .leftJoin('user as creator', 'rt.createdBy', 'creator.id')
      .leftJoin('role', 'creator.roleId', 'role.id')
      .select(
        'rt.*',
        'creator.id as creator_id',
        'creator.name as creator_name',
        'creator.email as creator_email',
        'role.slug as creator_role_slug'
      )
      .first();

    if (!registrationToken) {
      throw new Error("Invalid registration token");
    }

    if (registrationToken.used) {
      throw new Error("This registration token has already been used");
    }

    if (registrationToken.expiresAt < new Date()) {
      throw new Error("This registration token has expired");
    }

    // Parse metadata if it exists
    if (registrationToken.metadata) {
      try {
        registrationToken.metadata = JSON.parse(registrationToken.metadata);
      } catch (e) {
        registrationToken.metadata = {};
      }
    }

    return {
      ...registrationToken,
      creator: {
        id: registrationToken.creator_id,
        name: registrationToken.creator_name,
        email: registrationToken.creator_email,
        role: {
          slug: registrationToken.creator_role_slug
        }
      }
    };
  }

  // Update the register function in auth.service.js
  async register(data, registrationToken = null, externalRegistration = false, extData = {}) {
      const {
          email,
          password,
          name,
          phone,
          token: requestToken
      } = data;

      // Validate required fields
      const validationErrors = validateRegistrationData(data);
      if (validationErrors) {
          throw new Error(validationErrors);
      }

      // Get public registration setting
      const publicRegistrationEnabled = await this.getSettings("registration.public_enabled", false);
      
      // Check if we can proceed without token
      if (!requestToken && !publicRegistrationEnabled && !externalRegistration) {
          throw new Error("Public registration is disabled. Please use a registration token.");
      }

      // Check existing user
      const existingUser = await db('user')
          .where({ email })
          .leftJoin('role', 'user.roleId', 'role.id')
          .select(
              'user.*',
              'role.name as role_name',
              'role.slug as role_slug'
          )
          .first();

      if (existingUser) {
          if (existingUser.googleId && !existingUser.passwordHash) {
              const { hash, salt } = await hashPassword(password);

              await db('user')
                  .where({ id: existingUser.id })
                  .update({
                      passwordHash: hash,
                      salt: salt,
                      needsPasswordSetup: false,
                      name: name || existingUser.name,
                      phone: phone || existingUser.phone,
                      updatedAt: new Date()
                  });

              const updatedUser = await db('user')
                  .where('user.id', existingUser.id)
                  .leftJoin('role', 'user.roleId', 'role.id')
                  .select(
                      'user.*',
                      'role.name as role_name',
                      'role.slug as role_slug'
                  )
                  .first();

              const permissions = await permissionService.getUserPermissions(updatedUser.id);
              const tokens = await createTokens(updatedUser.id.toString());

              return {
                  user: updatedUser,
                  ...tokens,
                  permission: permissions
              };
          }

          throw new Error("User already exists");
      }

      let roleSlug = await this.getSettings("registration.default_role", "caretaker");
      let tokenData = null;
      let createdBy = null;
      let tokenMetaData = {};

      if (externalRegistration) {
          // External registration - no token required
          roleSlug = extData.roleSlug || roleSlug;
          createdBy = extData.createdBy || null;
          tokenMetaData = extData.metadata || {};
          
          // Validate that creator has permission to create this role
          if (createdBy) {
              const creator = await db('user')
                  .where('user.id', createdBy)
                  .leftJoin('role', 'user.roleId', 'role.id')
                  .select('user.*', 'role.slug as creator_role_slug')
                  .first();
              
              if (!creator) {
                  throw new Error("Creator not found");
              }
              
              // Check role hierarchy
              const roleHierarchy = {
                  'web_owner': 100,
                  'staff': 80,
                  'house_owner': 60,
                  'caretaker': 40
              };

              if (roleHierarchy[creator.creator_role_slug] <= roleHierarchy[roleSlug]) {
                  throw new Error(`You cannot create ${roleSlug} accounts`);
              }
          }
      } else if (requestToken) {
          // Token-based registration
          tokenData = await this.validateRegistrationToken(requestToken);
          roleSlug = tokenData.roleSlug;
          createdBy = tokenData.createdBy;

          if (tokenData.metadata) {
              if (typeof tokenData.metadata === 'string') {
                  try {
                      tokenMetaData = JSON.parse(tokenData.metadata);
                  } catch (err) {
                      console.error('Error parsing token metadata:', err);
                      tokenMetaData = {};
                  }
              } else if (typeof tokenData.metadata === 'object' && tokenData.metadata !== null) {
                  tokenMetaData = tokenData.metadata;
              }
          }

          await db('registrationtoken')
              .where({ id: tokenData.id })
              .update({
                  used: true,
                  usedAt: new Date()
              });
      }

      const role = await db('role')
          .where({ slug: roleSlug })
          .first();

      if (!role) {
          throw new Error(`Role ${roleSlug} not found`);
      }

      const { hash, salt } = await hashPassword(password);

      return await db.transaction(async (trx) => {
          const [userId] = await trx('user').insert({
              uuid: uuidv4(),
              email,
              passwordHash: hash,
              salt,
              name,
              phone: phone === "" ? null : phone,
              needsPasswordSetup: false,
              roleId: role.id,
              parentId: createdBy || null,
              locale: 'en',
              status: 'active',
              metadata: JSON.stringify({
                  registeredVia: externalRegistration ? 'external' : (requestToken ? 'token' : 'public'),
                  registrationToken: requestToken || null,
                  registeredAt: new Date().toISOString(),
                  creator: createdBy ? { id: createdBy } : null
              }),
              createdAt: new Date(),
              updatedAt: new Date()
          });

          if (tokenData && !externalRegistration) {
              await trx('registrationtoken')
                  .where({ id: tokenData.id })
                  .update({
                      usedBy: userId
                  });
          }

          // Handle role-specific data
          await this.handleRoleSpecificData(trx, roleSlug, userId, tokenMetaData, createdBy);

          const user = await trx('user')
              .where('user.id', userId)
              .leftJoin('role', 'user.roleId', 'role.id')
              .leftJoin('user as parent', 'user.parentId', 'parent.id')
              .select(
                  'user.*',
                  'role.name as role_name',
                  'role.slug as role_slug',
                  'parent.id as parent_id',
                  'parent.name as parent_name',
                  'parent.email as parent_email'
              )
              .first();

          const tokens = await createTokens(user.id.toString());

          return {
              user: {
                  ...user,
                  role: {
                      name: user.role_name,
                      slug: user.role_slug
                  },
                  parent: user.parent_id ? {
                      id: user.parent_id,
                      name: user.parent_name,
                      email: user.parent_email
                  } : null
              },
              ...tokens,
              permission: [],
              registrationMethod: externalRegistration ? 'external' : (requestToken ? 'token' : 'public')
          };
      });
  }

// Helper function to handle role-specific data
async handleRoleSpecificData(trx, roleSlug, userId, metadata, createdBy) {
    switch (roleSlug) {
        case 'caretaker':
            if (metadata.house_owner_id) {
                const houseOwnerId = metadata.house_owner_id;
                const houseIds = metadata.house_ids || [];

                let houses = [];
                if (houseIds.length > 0) {
                    houses = await trx('house')
                        .whereIn('id', houseIds)
                        .andWhere({ ownerId: houseOwnerId })
                        .select('id');
                } else {
                    houses = await trx('house')
                        .where({ ownerId: houseOwnerId })
                        .select('id');
                }

                for (const house of houses) {
                    const [assignmentId] = await trx('caretakerassignment').insert({
                        uuid: uuidv4(),
                        houseId: house.id,
                        caretakerId: userId,
                        createdBy: houseOwnerId,
                        createdAt: new Date(),
                        expiresAt: metadata.expires_at ? new Date(metadata.expires_at) : null
                    });
                    
                    if (metadata.default_permissions && Array.isArray(metadata.default_permissions)) {
                        for (const permissionKey of metadata.default_permissions) {
                            const permission = await trx('permission')
                                .where({ key: permissionKey })
                                .first();
                            
                            if (permission) {
                                await trx('caretakerassignmentpermission').insert({
                                    caretakerAssignmentId: assignmentId,
                                    permissionId: permission.id,
                                    grantedBy: houseOwnerId,
                                    grantedAt: new Date()
                                });
                            }
                        }
                    }
                }
            }
            break;

        case 'staff':
            // Staff might have default permissions
            if (metadata.default_permissions && Array.isArray(metadata.default_permissions)) {
                for (const permissionKey of metadata.default_permissions) {
                    const permission = await trx('permission')
                        .where({ key: permissionKey })
                        .first();
                    
                    if (permission) {
                        await trx('staffpermission').insert({
                            userId: userId,
                            permissionId: permission.id,
                            grantedBy: createdBy || userId,
                            grantedAt: new Date()
                        });
                    }
                }
            }
            break;

        case 'house_owner':
            // House owner might have initial house data
            if (metadata.initial_houses && Array.isArray(metadata.initial_houses)) {
                for (const houseData of metadata.initial_houses) {
                    const [houseId] = await trx('house').insert({
                        uuid: uuidv4(),
                        ownerId: userId,
                        name: houseData.name || 'New House',
                        address: houseData.address || '',
                        active: houseData.active || true,
                        metadata: JSON.stringify(houseData.metadata || {}),
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
            break;
    }
}

  async createUserAccount(creatorId, userData, options = {}) {
    const {
      sendEmail = false,
      generateToken = false,
      houseLimit = null,
      permissions = []
    } = options;

    // Get creator info
    const creator = await db('user')
      .where('user.id', creatorId)
      .leftJoin('role', 'user.roleId', 'role.id')
      .select(
        'user.*',
        'role.slug as role_slug',
        'role.rank as role_rank'
      )
      .first();

    if (!creator) {
      throw new Error("Creator not found");
    }

    // Validate creator can create this type of user
    const targetRole = await db('role')
      .where({ slug: userData.roleSlug })
      .first();

    if (!targetRole) {
      throw new Error(`Role ${userData.roleSlug} not found`);
    }

    // Role hierarchy check
    const roleHierarchy = {
      'web_owner': 100,
      'staff': 80,
      'house_owner': 60,
      'caretaker': 40
    };

    if (roleHierarchy[creator.role_slug] <= roleHierarchy[userData.roleSlug]) {
      throw new Error(`You cannot create ${userData.roleSlug} accounts`);
    }

    // Check if user already exists
    const existingUser = await db('user')
      .where({ email: userData.email })
      .first();

    if (existingUser) {
      throw new Error("User with this email already exists");
    }

    let password = userData.password;
    if (!password) {
      password = crypto.randomBytes(8).toString('hex');
    }

    const { hash, salt } = await hashPassword(password);

    const result = await db.transaction(async (trx) => {
      // Create new user
      const [userId] = await trx('user').insert({
        uuid: uuidv4(),
        email: userData.email,
        passwordHash: hash,
        salt,
        name: userData.name || null,
        phone: userData.phone === "" ? null : userData.phone,
        roleId: targetRole.id,
        parentId: creatorId,
        needsPasswordSetup: false,
        locale: 'en',
        status: 'active',
        metadata: JSON.stringify({
          createdBy: creator.email,
          createdAt: new Date().toISOString(),
          houseLimit: houseLimit,
          permissions: permissions,
          ...userData.metadata
        }),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      // If houseLimit specified, create or update role limit
      if (houseLimit !== null && ['house_owner', 'staff'].includes(userData.roleSlug)) {
        const existingLimit = await trx('rolelimit')
          .where({ roleSlug: userData.roleSlug })
          .first();

        if (existingLimit) {
          await trx('rolelimit')
            .where({ roleSlug: userData.roleSlug })
            .update({ maxHouses: houseLimit });
        } else {
          await trx('rolelimit').insert({
            roleSlug: userData.roleSlug,
            maxHouses: houseLimit,
            maxCaretakers: 5,
            maxFlats: 50,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }

      const user = await trx('user')
        .where('user.id', userId)
        .leftJoin('role', 'user.roleId', 'role.id')
        .leftJoin('user as parent', 'user.parentId', 'parent.id')
        .select(
          'user.*',
          'role.name as role_name',
          'role.slug as role_slug',
          'parent.id as parent_id',
          'parent.name as parent_name',
          'parent.email as parent_email'
        )
        .first();

      let registrationToken = null;
      if (generateToken) {
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 168 * 60 * 60 * 1000);

        await trx('registrationtoken').insert({
          token,
          createdBy: creatorId,
          email: user.email,
          roleSlug: userData.roleSlug,
          expiresAt,
          metadata: JSON.stringify({
            houseLimit,
            permissions,
            autoCreated: true
          }),
          createdAt: new Date()
        });

        registrationToken = {
          token,
          expiresAt,
          roleSlug: userData.roleSlug,
          email: user.email,
          registrationLink: `${process.env.CLIENT_URL}/signup?token=${token}`
        };
      }

      return {
        user: {
          ...user,
          role: {
            name: user.role_name,
            slug: user.role_slug
          },
          parent: user.parent_id ? {
            id: user.parent_id,
            name: user.parent_name,
            email: user.parent_email
          } : null
        },
        password: sendEmail ? undefined : password,
        registrationToken
      };
    });

    if (sendEmail) {
      emailService.sendWelcomeCredentialsEmail(result.user.email, result.user.name, password)
        .catch((e) => console.error('[createUserAccount] welcome email failed:', e));
    }

    return result;
  }


  async checkUserHierarchy(parentId, childId) {
    const child = await db('user')
      .where('user.id', childId)
      .leftJoin('user as parent', 'user.parentId', 'parent.id')
      .select('user.*', 'parent.id as parent_id')
      .first();

    if (!child) return false;
    if (child.parentId === parentId) return true;
    if (!child.parentId) return false;

    return await this.checkUserHierarchy(parentId, child.parentId);
  }

  async loginAs(callerId, targetUserId, reason) {
    const roleHierarchy = { 'web_owner': 100, 'staff': 80, 'house_owner': 60, 'caretaker': 40 };

    const [caller, target] = await Promise.all([
      db('user').where('user.id', callerId)
        .leftJoin('role', 'user.roleId', 'role.id')
        .select('user.*', 'role.slug as role_slug', 'role.id as role_id')
        .first(),
      db('user').where('user.id', targetUserId)
        .leftJoin('role', 'user.roleId', 'role.id')
        .select('user.*', 'role.slug as role_slug')
        .first(),
    ]);

    if (!caller) throw new Error('Caller user not found');
    if (!target) throw new Error('Target user not found');
    if (target.status !== 'active') throw new Error('Target account is not active');

    const callerRank = roleHierarchy[caller.role_slug] || 0;
    const targetRank = roleHierarchy[target.role_slug] || 0;
    if (callerRank <= targetRank) {
      throw new Error(`You cannot login as a ${target.role_slug} account`);
    }

    // One active session per (caller, target) pair — replace any existing one.
    await db('userloginas').where({ userId: callerId, targetUserId: target.id }).delete();

    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours
    const [sessionId] = await db('userloginas').insert({
      userId: callerId,
      targetUserId: target.id,
      originalRoleId: caller.role_id,
      reason: reason || null,
      expiresAt,
      createdAt: new Date(),
    });

    const tokens = await createTokens(target.id.toString());
    const permissions = await permissionService.getUserPermissions(target.id);

    return {
      ...tokens,
      sessionId: String(sessionId),
      originalUserId: String(callerId),
      user: {
        id: target.id,
        email: target.email,
        name: target.name,
        role: { slug: target.role_slug },
        status: target.status,
      },
      permission: permissions,
      message: 'Now logged in as target user. Store sessionId to exit this session.',
    };
  }

  async exitLoginAs(loginSessionId, currentUserId) {
    return await db.transaction(async (trx) => {
      const session = await trx('userloginas as ula')
        .where('ula.id', loginSessionId)
        .leftJoin('user', 'ula.userId', 'user.id')
        .leftJoin('role', 'user.roleId', 'role.id')
        .select(
          'ula.*',
          'user.id as user_id',
          'user.email as user_email',
          'user.name as user_name',
          'role.slug as role_slug'
        )
        .first();

      if (!session) {
        throw new Error("Login-as session not found");
      }

      if (String(session.targetUserId) !== String(currentUserId)) {
        throw new Error("You can only exit your own login-as sessions");
      }

      await trx('userloginas')
        .where({ id: loginSessionId })
        .delete();

      const tokens = await createTokens(session.userId.toString());

      return {
        ...tokens,
        user: {
          id: session.user_id,
          email: session.user_email,
          name: session.user_name,
          role: { slug: session.role_slug }
        },
        message: 'Returned to original user session'
      };
    });
  }

  /**
   * Fetch full "house_owner DNA" for one house owner: profile, houses, flats,
   * app fee payments, income (rent + advance), expenses, loans.
   */
  async getHouseOwnerDna(houseOwnerId) {
    const houseIds = await db('house')
      .where('ownerId', houseOwnerId)
      .pluck('id');

    const [houses, flats, appFeePayments, rentPayments, advancePayments, expenses, loans] = await Promise.all([
      db('house').where('ownerId', houseOwnerId).select('*'),
      houseIds.length ? db('flat').whereIn('house_id', houseIds).select('*') : [],
      db('app_fee_payment').where('house_owner_id', houseOwnerId).select('*').orderBy('created_at', 'desc'),
      houseIds.length ? db('rent_payment').whereIn('house_id', houseIds).select('*').orderBy('paid_date', 'desc') : [],
      houseIds.length ? db('advance_payment').whereIn('house_id', houseIds).select('*').orderBy('payment_date', 'desc') : [],
      houseIds.length ? db('house_expense').whereIn('house_id', houseIds).select('*').orderBy('expense_date', 'desc') : [],
      houseIds.length ? db('house_loan').whereIn('house_id', houseIds).select('*') : []
    ]);

    // Optionally load loan payments per loan
    let loanPayments = [];
    if (loans.length) {
      const loanIds = loans.map(l => l.id);
      loanPayments = await db('house_loan_payment')
        .whereIn('loan_id', loanIds)
        .select('*')
        .orderBy('payment_date', 'desc');
    }

    return {
      profile: null,
      houses,
      flats,
      appFeePayments,
      income: {
        rentPayments,
        advancePayments
      },
      expenses,
      loans,
      loanPayments
    };
  }

  async getManagedUsers(userId, roleFilter = null, options = {}) {
    const { expandDna = false, targetUserId = null } = options;

    const user = await db('user')
      .where('user.id', userId)
      .leftJoin('role', 'user.roleId', 'role.id')
      .select('user.*', 'role.slug as role_slug')
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    let query = db('user')
      .leftJoin('role', 'user.roleId', 'role.id')
      .leftJoin('user as parent', 'user.parentId', 'parent.id')
      .select(
        'user.*',
        'role.name as role_name',
        'role.slug as role_slug',
        'parent.id as parent_id',
        'parent.name as parent_name',
        'parent.email as parent_email'
      );

    if (roleFilter) {
      query = query.where('role.slug', roleFilter);
    }
    if (targetUserId != null && targetUserId !== '') {
      query = query.where('user.id', targetUserId);
    }

    const allUsers = await query;

    // Filter users under management hierarchy
    const managedUsers = [];
    for (const targetUser of allUsers) {
      const isManaged = await this.checkUserHierarchy(userId, targetUser.id);
      if (isManaged) {
        const payload = {
          ...targetUser,
          role: {
            name: targetUser.role_name,
            slug: targetUser.role_slug
          },
          parent: targetUser.parent_id ? {
            id: targetUser.parent_id,
            name: targetUser.parent_name,
            email: targetUser.parent_email
          } : null
        };

        if (expandDna && targetUser.role_slug === 'house_owner') {
          const dna = await this.getHouseOwnerDna(targetUser.id);
          const profile = { ...targetUser };
          if (profile.profileJson) {
            try {
              profile.profileJson = typeof profile.profileJson === 'string' ? JSON.parse(profile.profileJson) : profile.profileJson;
            } catch (e) {
              profile.profileJson = {};
            }
          }
          dna.profile = profile;
          payload.dna = dna;
        }

        managedUsers.push(payload);
      }
    }

    return managedUsers;
  }

  async updateUserLimits(userId, updates) {
    return await db.transaction(async (trx) => {
      const user = await trx('user')
        .where('user.id', userId)
        .leftJoin('role', 'user.roleId', 'role.id')
        .select('user.*', 'role.slug as role_slug')
        .first();

      if (!user) {
        throw new Error("User not found");
      }

      if (updates.houseLimit !== undefined) {
        const existingLimit = await trx('rolelimit')
          .where({ roleSlug: user.role_slug })
          .first();

        if (existingLimit) {
          await trx('rolelimit')
            .where({ roleSlug: user.role_slug })
            .update({ maxHouses: updates.houseLimit });
        } else {
          await trx('rolelimit').insert({
            roleSlug: user.role_slug,
            maxHouses: updates.houseLimit,
            maxCaretakers: 5,
            maxFlats: 50,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }

      // Parse existing metadata
      let currentMetadata = {};
      if (user.metadata) {
        try {
          currentMetadata = JSON.parse(user.metadata);
        } catch (e) {
          currentMetadata = {};
        }
      }

      const updatedMetadata = {
        ...currentMetadata,
        houseLimit: updates.houseLimit !== undefined ? updates.houseLimit : currentMetadata.houseLimit,
        permissions: updates.permissions || currentMetadata.permissions,
        updatedAt: new Date().toISOString()
      };

      await trx('user')
        .where({ id: userId })
        .update({
          metadata: JSON.stringify(updatedMetadata),
          updatedAt: new Date()
        });

      const updatedUser = await trx('user')
        .where('user.id', userId)
        .leftJoin('role', 'user.roleId', 'role.id')
        .select('user.*', 'role.name as role_name', 'role.slug as role_slug')
        .first();

      return {
        ...updatedUser,
        role: {
          name: updatedUser.role_name,
          slug: updatedUser.role_slug
        }
      };
    });
  }

  async getRegistrationTokens(creatorId, filters = {}) {
    let query = db('registrationtoken as rt')
      .where('rt.createdBy', creatorId)
      .leftJoin('user as creator', 'rt.createdBy', 'creator.id')
      .leftJoin('user as used_by', 'rt.usedBy', 'used_by.id')
      .select(
        'rt.*',
        'creator.id as creator_id',
        'creator.name as creator_name',
        'creator.email as creator_email',
        'used_by.id as used_by_id',
        'used_by.name as used_by_name',
        'used_by.email as used_by_email'
      )
      .orderBy('rt.createdAt', 'desc');

    if (filters.used !== undefined) {
      query = query.where('rt.used', filters.used);
    }

    if (filters.roleSlug) {
      query = query.where('rt.roleSlug', filters.roleSlug);
    }

    if (filters.email) {
      query = query.where('rt.email', 'like', `%${filters.email}%`);
    }

    const tokens = await query;

    return tokens.map(token => {
      const result = {
        ...token,
        creator: {
          id: token.creator_id,
          name: token.creator_name,
          email: token.creator_email
        }
      };

      if (token.used_by_id) {
        result.user = {
          id: token.used_by_id,
          name: token.used_by_name,
          email: token.used_by_email
        };
      }

      // Remove temporary fields
      delete result.creator_id;
      delete result.creator_name;
      delete result.creator_email;
      delete result.used_by_id;
      delete result.used_by_name;
      delete result.used_by_email;

      return result;
    });
  }

  async revokeRegistrationToken(tokenId, creatorId) {
    const token = await db('registrationtoken')
      .where({ id: tokenId })
      .first();

    if (!token) {
      throw new Error("Registration token not found");
    }

    if (token.createdBy !== creatorId) {
      throw new Error("You can only revoke your own registration tokens");
    }

    if (token.used) {
      throw new Error("Cannot revoke a token that has already been used");
    }

    await db('registrationtoken')
      .where({ id: tokenId })
      .delete();

    return { message: "Registration token revoked successfully" };
  }

  async login(data) {
    const { email, password } = data;

    // Find user with role
    const user = await db('user')
      .where({ email })
      .leftJoin('role', 'user.roleId', 'role.id')
      .select(
        'user.*',
        'role.id as role_id',
        'role.name as role_name',
        'role.slug as role_slug',
        'role.rank as role_rank',
        'role.description as role_description'
      )
      .first();

    if (!user) {
      throw new Error("Invalid email or password");
    }

    // Check if user has password
    if (!user.passwordHash) {
      throw new Error("Please use Google login or set a password first");
    }

    const isPasswordValid = await verifyPassword(password, user.passwordHash, user.salt);

    if (!isPasswordValid) {
      throw new Error("Invalid email or password");
    }

    // Check if user is active
    if (user.status !== 'active') {
      throw new Error("Account is not active. Please contact administrator.");
    }

    // Get user permissions
    const permissions = await permissionService.getUserPermissions(user.id);

    // Update last login
    await db('user')
      .where({ id: user.id })
      .update({
        lastLoginAt: new Date(),
        updatedAt: new Date()
      });

    const tokens = await createTokens(user.id.toString());

    // Remove sensitive data from user object
    const userResponse = {
      id: user.id,
      uuid: user.uuid,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt,
      googleId: user.googleId,
      locale: user.locale,
      name: user.name,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      profileJson: user.profileJson,
      roleId: user.roleId,
      parentId: user.parentId,
      needsPasswordSetup: user.needsPasswordSetup,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      lastLoginIp: user.lastLoginIp,
      metadata: user.metadata,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      role: {
        id: user.role_id,
        name: user.role_name,
        slug: user.role_slug,
        rank: user.role_rank,
        description: user.role_description
      }
    };

    // Parse JSON fields
    if (userResponse.metadata) {
      try {
        userResponse.metadata = JSON.parse(userResponse.metadata);
      } catch (e) {
        userResponse.metadata = {};
      }
    }

    if (userResponse.profileJson) {
      try {
        userResponse.profileJson = JSON.parse(userResponse.profileJson);
      } catch (e) {
        userResponse.profileJson = {};
      }
    }

    const { sendAutoWelcomeNotification } = require("../utils/autoTestNotification");

    if (user.role_slug === "web_owner") {
      setTimeout(() => {
        sendAutoWelcomeNotification(user.id, user.role_slug).catch(err =>
          console.error("Auto welcome notification failed:", err)
        );
      }, 3000);
    }

    return {
      user: userResponse,
      ...tokens,
      permission: permissions
    };
  }

  async linkGoogleAccount(userId, googleId) {
    // Prevent duplicate Google usage
    const existingGoogleUser = await db('user')
      .where({ googleId })
      .first();

    if (existingGoogleUser) {
      throw new Error("This Google account is already linked to another user");
    }

    await db('user')
      .where({ id: userId })
      .update({
        googleId,
        emailVerifiedAt: new Date(),
        updatedAt: new Date()
      });

    return await db('user')
      .where({ id: userId })
      .first();
  }

  async setPassword(userId, password) {
    const { hash, salt } = await hashPassword(password);

    await db('user')
      .where({ id: userId })
      .update({
        passwordHash: hash,
        salt,
        needsPasswordSetup: false,
        updatedAt: new Date()
      });

    return await db('user')
      .where({ id: userId })
      .first();
  }

  async refreshToken(req, res) {
    // Accept token from HttpOnly cookie (preferred) or body (legacy fallback)
    const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({ message: "Refresh token missing" });
    }

    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH);
      const tokens = await createTokens(decoded.userId);

      return tokens;
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Invalid or expired refresh token" });
    }
  }

  async canLinkAccount(email, googleId) {
    const emailUser = await db('user')
      .where({ email })
      .first();

    if (!emailUser) {
      return {
        canLink: false,
        reason: "No email-based account found",
      };
    }

    // If already linked → block
    if (emailUser.googleId) {
      return {
        canLink: false,
        reason: "This email is already linked to a Google account",
      };
    }

    // Ensure this Google account is not already linked to another user
    const existingGoogleLink = await db('user')
      .where({ googleId })
      .first();

    if (existingGoogleLink) {
      return {
        canLink: false,
        reason: "This Google account is already linked to another user",
      };
    }

    // Safe to link
    return {
      canLink: true,
      emailUserId: emailUser.id,
    };
  }

  async forgotPassword(email) {
      try {
          // Find user by email
          const user = await db('user')
              .where('email', email)
              .andWhere('status', 'active')
              .first();

          // Don't reveal if user exists for security
          if (!user) {
              return { success: true, message: 'If an account exists with this email, a reset link will be sent' };
          }

          // Check if user has password set
          if (!user.passwordHash) {
              // User registered via Google, no password set
              return { 
                  success: false, 
                  error: 'This account uses Google authentication. Please sign in with Google.' 
              };
          }

          // Check for existing valid reset tokens
          const existingToken = await db('passwordresettoken')
              .where('userId', user.id)
              .andWhere('used', false)
              .andWhere('expiresAt', '>', new Date())
              .first();

          if (existingToken) {
              return { 
                  success: true, 
                  message: 'A password reset link has already been sent. Please check your email.' 
              };
          }

          // Generate reset token
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

          // Save reset token
          await db('passwordresettoken').insert({
              token,
              userId: user.id,
              email: user.email,
              expiresAt,
              createdAt: new Date(),
              updatedAt: new Date()
          });

          // Send reset email
          try {
              await emailService.sendPasswordResetEmail(user.email, token, user.name);
          } catch (emailError) {
              console.error('Failed to send reset email:', emailError);
              // Don't fail the request, just log it
          }

          return { 
              success: true, 
              message: 'If an account exists with this email, a reset link will be sent' 
          };
      } catch (error) {
          console.error('Forgot password error:', error);
          return { 
              success: false, 
              error: 'Failed to process password reset request' 
          };
      }
  }

  async resetPassword(token, newPassword) {
      const trx = await db.transaction();
      
      try {
          // Validate token
          const resetToken = await trx('passwordresettoken')
              .where('token', token)
              .andWhere('used', false)
              .andWhere('expiresAt', '>', new Date())
              .first();

          if (!resetToken) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: 'Invalid or expired reset token' 
              };
          }

          // Get user
          const user = await trx('user')
              .where('id', resetToken.userId)
              .andWhere('email', resetToken.email)
              .andWhere('status', 'active')
              .first();

          if (!user) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: 'User not found or inactive' 
              };
          }

          // Validate password strength
          const passwordErrors = this.validatePassword(newPassword);
          if (passwordErrors.length > 0) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: passwordErrors.join(', ') 
              };
          }

          // Hash new password
          const { hash, salt } = await hashPassword(newPassword);

          // Update user password
          await trx('user')
              .where('id', user.id)
              .update({
                  passwordHash: hash,
                  salt,
                  needsPasswordSetup: false,
                  updatedAt: new Date()
              });

          // Mark token as used
          await trx('passwordresettoken')
              .where('id', resetToken.id)
              .update({
                  used: true,
                  usedAt: new Date(),
                  updatedAt: new Date()
              });

          // Send password changed email
          try {
              await emailService.sendPasswordChangedEmail(user.email, user.name);
          } catch (emailError) {
              console.error('Failed to send password changed email:', emailError);
          }

          await trx.commit();

          return { 
              success: true, 
              message: 'Password has been reset successfully' 
          };
      } catch (error) {
          await trx.rollback();
          console.error('Reset password error:', error);
          return { 
              success: false, 
              error: 'Failed to reset password' 
          };
      }
  }

  async changePassword(userId, oldPassword, newPassword) {
      const trx = await db.transaction();
      
      try {
          // Get user with current password
          const user = await trx('user')
              .where('id', userId)
              .andWhere('status', 'active')
              .first();

          if (!user) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: 'User not found' 
              };
          }

          // Check if user has password (not Google-only account)
          if (!user.passwordHash) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: 'This account uses Google authentication. To set a password, use "Forgot Password" first.' 
              };
          }

          // Verify old password
          const isValid = await verifyPassword(oldPassword, user.passwordHash);
          if (!isValid) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: 'Current password is incorrect' 
              };
          }

          // Check if new password is same as old
          const isSame = await verifyPassword(newPassword, user.passwordHash);
          if (isSame) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: 'New password must be different from current password' 
              };
          }

          // Validate password strength
          const passwordErrors = this.validatePassword(newPassword);
          if (passwordErrors.length > 0) {
              await trx.rollback();
              return { 
                  success: false, 
                  error: passwordErrors.join(', ') 
              };
          }

          // Hash new password
          const { hash, salt } = await hashPassword(newPassword);

          // Update user
          await trx('user')
              .where('id', userId)
              .update({
                  passwordHash: hash,
                  salt,
                  updatedAt: new Date()
              });

          // Send password changed email
          try {
              await emailService.sendPasswordChangedEmail(user.email, user.name);
          } catch (emailError) {
              console.error('Failed to send password changed email:', emailError);
          }

          await trx.commit();

          return { 
              success: true, 
              message: 'Password changed successfully' 
          };
      } catch (error) {
          await trx.rollback();
          console.error('Change password error:', error);
          return { 
              success: false, 
              error: 'Failed to change password' 
          };
      }
  }

  // Add password validation helper
  validatePassword(password) {
      const errors = [];
      
      if (!password) {
          errors.push('Password is required');
          return errors;
      }

      if (password.length < 8) {
          errors.push('Password must be at least 8 characters');
      }

      if (!/[A-Z]/.test(password)) {
          errors.push('Password must contain at least one uppercase letter');
      }

      if (!/[a-z]/.test(password)) {
          errors.push('Password must contain at least one lowercase letter');
      }

      if (!/\d/.test(password)) {
          errors.push('Password must contain at least one number');
      }

      if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
          errors.push('Password must contain at least one special character');
      }

      return errors;
  }

  // Add this to your auth.service.js

  async hasPassword(userId) {
      const user = await db('user')
          .where('id', userId)
          .select('passwordHash')
          .first();
      
      return !!user?.passwordHash;
  }

  async setupPassword(userId, password) {
      const trx = await db.transaction();
      
      try {
          // Check if user already has password
          const user = await trx('user')
              .where('id', userId)
              .first();
          
          if (user.passwordHash) {
              await trx.rollback();
              return { success: false, error: 'Password already set' };
          }
          
          // Validate password
          const passwordErrors = this.validatePassword(password);
          if (passwordErrors.length > 0) {
              await trx.rollback();
              return { success: false, error: passwordErrors.join(', ') };
          }
          
          // Hash password
          const { hash, salt } = await hashPassword(password);
          
          // Update user
          await trx('user')
              .where('id', userId)
              .update({
                  passwordHash: hash,
                  salt,
                  needsPasswordSetup: false,
                  updatedAt: new Date()
              });
          
          await trx.commit();
          
          return { success: true, message: 'Password set successfully' };
      } catch (error) {
          await trx.rollback();
          console.error('Setup password error:', error);
          return { success: false, error: 'Failed to set password' };
      }
  }

}

module.exports = new AuthService();