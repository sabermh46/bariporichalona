// src/services/auth.service.js
const db = require("../config/knex");
const { hashPassword, verifyPassword } = require("../utils/password");
const { createTokens } = require("../utils/tokens");
const { v4: uuidv4 } = require("uuid");
const { validateRegistrationData } = require("../utils/validateRegistrationData");
const jwt = require("jsonwebtoken");
const permissionService = require("./permission.service");
const crypto = require("crypto");

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
      createdByName: creator.name
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

  async register(data, registrationToken = null) {
    const {
      email,
      password,
      name,
      phone,
      token: requestToken
    } = data;

    const validationErrors = validateRegistrationData(data);
    if (validationErrors) {
      throw new Error(validationErrors);
    }

    // Check if public registration is enabled
    const publicRegistrationEnabled = await this.getSettings("registration.public_enabled", false);
    if (!requestToken && !publicRegistrationEnabled) {
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
          .where({ id: existingUser.id })
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

    if (requestToken) {
      tokenData = await this.validateRegistrationToken(requestToken);
      roleSlug = tokenData.roleSlug;
      createdBy = tokenData.createdBy;

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
          registeredVia: requestToken ? 'token' : 'public',
          registrationToken: requestToken || null,
          registeredAt: new Date().toISOString()
        }),
        createdAt: new Date(),
        updatedAt: new Date()
      });

      if (tokenData) {
        await trx('registrationtoken')
          .where({ id: tokenData.id })
          .update({
            usedBy: userId
          });
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
        registrationMethod: requestToken ? 'token' : 'public'
      };
    });
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
      .where({ id: creatorId })
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

    return await db.transaction(async (trx) => {
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
  }

  async loginAs(currentUserId, targetUserId, reason = 'Administrative Access') {
    return await db.transaction(async (trx) => {
      const currentUser = await trx('user')
        .where({ id: currentUserId })
        .leftJoin('role', 'user.roleId', 'role.id')
        .select(
          'user.*',
          'role.id as role_id',
          'role.slug as role_slug'
        )
        .first();

      if (!currentUser) {
        throw new Error("Current user not found");
      }

      const targetUser = await trx('user')
        .where({ id: targetUserId })
        .leftJoin('role', 'user.roleId', 'role.id')
        .select(
          'user.*',
          'role.id as role_id',
          'role.slug as role_slug'
        )
        .first();

      if (!targetUser) {
        throw new Error("Target user not found");
      }

      // Check permission
      const roleLimits = await trx('rolelimit')
        .where({ roleSlug: currentUser.role_slug })
        .first();

      if (!roleLimits || !roleLimits.canLoginAs) {
        throw new Error("You do not have permission to login as other users");
      }

      const allowedRoles = roleLimits.canLoginAs ? JSON.parse(roleLimits.canLoginAs) : [];
      if (!allowedRoles.includes(targetUser.role_slug)) {
        throw new Error(`You do not have permission to login as ${targetUser.role_slug} users`);
      }

      // Check if target user is under current user's hierarchy
      if (currentUser.role_slug !== 'web_owner') {
        const isHierarchyValid = await this.checkUserHierarchy(currentUserId, targetUserId);
        if (!isHierarchyValid) {
          throw new Error("You can only login as users under your management hierarchy");
        }
      }

      // Create login-as session
      const [loginSessionId] = await trx('userloginas').insert({
        userId: currentUserId,
        targetUserId: targetUserId,
        originalRoleId: currentUser.role_id,
        reason: reason,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
        createdAt: new Date()
      });

      const loginAsSession = await trx('userloginas as ula')
        .where('ula.id', loginSessionId)
        .leftJoin('user as target', 'ula.targetUserId', 'target.id')
        .leftJoin('role as target_role', 'target.roleId', 'target_role.id')
        .select(
          'ula.*',
          'target.id as target_id',
          'target.email as target_email',
          'target.name as target_name',
          'target_role.slug as target_role_slug'
        )
        .first();

      const tokens = await createTokens(targetUser.id.toString());

      return {
        ...tokens,
        user: targetUser,
        loginAsSession: {
          id: loginAsSession.id,
          originalUserId: currentUserId,
          originalRole: { slug: currentUser.role_slug },
          expiresAt: loginAsSession.expiresAt,
          reason: loginAsSession.reason
        }
      };
    });
  }

  async checkUserHierarchy(parentId, childId) {
    const child = await db('user')
      .where({ id: childId })
      .leftJoin('user as parent', 'user.parentId', 'parent.id')
      .select('user.*', 'parent.id as parent_id')
      .first();

    if (!child) return false;
    if (child.parentId === parentId) return true;
    if (!child.parentId) return false;

    return await this.checkUserHierarchy(parentId, child.parentId);
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

      if (session.userId !== currentUserId) {
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

  async getManagedUsers(userId, roleFilter = null) {
    const user = await db('user')
      .where({ id: userId })
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

    const allUsers = await query;

    // Filter users under management hierarchy
    const managedUsers = [];
    for (const targetUser of allUsers) {
      const isManaged = await this.checkUserHierarchy(userId, targetUser.id);
      if (isManaged) {
        managedUsers.push({
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
        });
      }
    }

    return managedUsers;
  }

  async updateUserLimits(userId, updates) {
    return await db.transaction(async (trx) => {
      const user = await trx('user')
        .where({ id: userId })
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
        .where({ id: userId })
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
      setTimeout(async () => {
        await sendAutoWelcomeNotification(user.id, user.role_slug);
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
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(401).json({ message: "Refresh token missing" });
      }

      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH);
      const tokens = await createTokens(decoded.userId);

      return res.json({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      });
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
}

module.exports = new AuthService();