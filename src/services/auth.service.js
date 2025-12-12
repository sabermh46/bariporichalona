const prisma = require("../config/prisma");
const { hashPassword, verifyPassword } = require("../utils/password");
const { createTokens } = require("../utils/tokens");
const { v4: uuid } = require("uuid");
const {
  validateRegistrationData,
} = require("../utils/validateRegistrationData");
const jwt = require("jsonwebtoken");
const { use } = require("passport");
const permissionService = require("./permission.service");
const crypto = require("crypto");
const { permission } = require("process");


class AuthService {
  constructor() {
    //this should be fetched from DB in future
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
        value: "flat_renter",
        type: "string",
        category: "registration",
      },
      "limits.default_house_limit": {
        value: 1,
        type: "number",
        category: "limits",
      },
      "limits.default_caretaker_limit": {
        value: 2,
        type: "number",
        category: "limits",
      },
      "security.token_expiry_hours": {
        value: 24,
        type: "number",
        category: "security",
      },
    };
  }

  async initializeSystemSettings(){
    for (const [key, setting] of Object.entries(this.defaultSettings)) {
      const existingSetting = await prisma.systemSetting.findUnique({
        where: { key },
      });

      if(!existingSetting){
          await prisma.systemSetting.create({
            data: {
              key,
              value: setting.value,
              type: setting.type,
              category: setting.category,
              isPublic: setting.category === "registration" ? true : false,
            },
          })
        }
    }

    const defaultRoleLimits = [
      { roleSlug: 'web_owner', maxHouses: 999, maxCaretakers: 50, maxFlats: 1000, canLoginAs: ['staff', 'house_owner', 'caretaker'] },
      { roleSlug: 'staff', maxHouses: 50, maxCaretakers: 20, maxFlats: 500, canLoginAs: ['house_owner', 'caretaker'] },
      { roleSlug: 'house_owner', maxHouses: 5, maxCaretakers: 5, maxFlats: 50, canLoginAs: ['caretaker'] },
      { roleSlug: 'caretaker', maxHouses: 0, maxCaretakers: 0, maxFlats: 0, canLoginAs: [] },
    ];

    for(const limit of defaultRoleLimits){
      const existing = await prisma.roleLimit.findUnique({
        where: {
          roleSlug: limit.roleSlug
        }
      })
      if(!existing){
        await prisma.roleLimit.create({
          data: {
            roleSlug: limit.roleSlug,
            maxHouses: limit.maxHouses,
            maxCaretakers: limit.maxCaretakers,
            maxFlats: limit.maxFlats,
            canLoginAs: limit.canLoginAs
          }
        });
      }
    }    
  }

  async getSettings(key, defaultValue = null) {
    const setting = await prisma.systemSetting.findUnique({
      where: { key },
    })

    if(setting){
      return setting.value;
    }

    if(this.defaultSettings[key]){
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

    const creator = await prisma.user.findUnique({
      where: { id: creatorId },
      include: { role: true }
    });

    if(!creator){
      throw new Error("Creator user not found");
    }

    const roleHierarchy = {
      'web_owner': 100,
      'staff': 80,
      'house_owner': 60,
      'caretaker': 40
    }

    const targetRole = await prisma.role.findUnique({
      where: { slug: roleSlug }
    });

    if(!targetRole){
      throw new Error(`Role ${roleSlug} not found`);
    }

    if(roleHierarchy[creator.role.slug] <= roleHierarchy[roleSlug]){
      throw new Error(`You cannot create ${roleSlug} accounts`);
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const registrationToken = await prisma.registrationToken.create({
      data: {
        token,
        createdBy: creatorId,
        email,
        roleSlug,
        expiresAt,
        metadata: {
          ...metaData,
          createdByEmail: creator.email,
          createdByName: creator.name
        }
      }
    });

    return {
      token,
      expiresAt,
      roleSlug,
      email,
      registrationLink: `${process.env.CLIENT_URL}/signup?token=${token}`
    }

  }

  async validateRegistrationToken(token) {
    const registrationToken = await prisma.registrationToken.findUnique({
      where: { token },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    })
    console.log(registrationToken);
    

    if(!registrationToken){
      throw new Error("Invalid registration token");
    }

    if(registrationToken.used) {
      throw new Error("This registration token has already been used");
    }

    if(registrationToken.expiresAt < new Date()){
      throw new Error("This registration token has expired");
    }

    return registrationToken;

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

    //check if public registration is enabled
    const publicRegistrationEnabled = await this.getSettings("registration.public_enabled", false);
    if(!requestToken && !publicRegistrationEnabled){
      throw new Error("Public registration is disabled. Please use a registration token.");
    }

    // check existing user
    const existingUser = await prisma.user.findFirst({ 
      where: { email },
      include: { role: true }
     });

    if (existingUser) {

      if(existingUser.googleId && !existingUser.passwordHash) {
        const { hash, salt } = hashPassword(password);

        const updatedUser = await prisma.user.update({
          where: {
            id: existingUser.id
          },
          data: {
            passwordHash: hash,
            salt: salt,
            needsPasswordSetup: false,
            name: name || existingUser.name,
            phone: phone || existingUser.phone,
          },
          include: { role: true }
        })

        const permissions = await permissionService.getUserPermissions(updatedUser.id);

        const tokens = await createTokens(updatedUser.id.toString());
        return { user: updatedUser, ...tokens, permission: permissions };

      }

      throw new Error("User already exists");

    }

    let roleSlug = await this.getSettings("registration.default_role", "caretaker");

    let tokenData = null;
    let createdBy = null;

    if(requestToken){
      tokenData = await this.validateRegistrationToken(requestToken, email);
      roleSlug = tokenData.roleSlug;
      createdBy = tokenData.createdBy;

      await prisma.registrationToken.update({
        where: {
          id: tokenData.id,
        },
        data: {
          used: true,
          usedAt: new Date(),
        }
      })
    }

    const role = await prisma.role.findUnique({
      where: {
        slug: roleSlug
      }
    })

    if(!role){
      throw new Error(`Role ${roleSlug} not found`);
    }

    const { hash, salt } = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        uuid: uuid(),
        email,
        passwordHash: hash,
        salt,
        name,
        phone: phone === "" ? null : phone,
        needsPasswordSetup: false,
        roleId: role.id,
        parentId: createdBy || null,
        metadata: {
          registeredVia: requestToken ? 'token' : 'public',
          registrationToken: requestToken || null,
          registeredAt: new Date().toISOString()
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
    })

    if(tokenData) {
      await prisma.registrationToken.update({
        where: {
          id: tokenData.id,
        },
        data: {
          usedBy: user.id,
        }
      })
    }

    const tokens = await createTokens(user.id.toString());

    return {
      user,
      ...tokens,
      permission: [],
      registrationMethod: requestToken ? 'token' : 'public'
    }

  }

  async createUserAccount(creatorId, userData, options = {}) {
    const {
      sendEmail = false,
      generateToken = false,
      houseLimit = null,
      permissions = []
    } = options;

    //get creator info
    const creator = await prisma.user.findUnique({
      where: {
        id: creatorId
      },
      include: {
        role: true
      }
    })

    if(!creator){
      throw new Error("Creator not found");
    }

    //validate creator can create this type of user
    const targetRole = await prisma.role.findUnique({
      where: {
        slug: userData.roleSlug
      }
    })

    if(!targetRole){
      throw new Error(`Role ${userData.roleSlug} not found`);
    }

    // Role hierarchy check
    const roleHierarchy = {
      'web_owner': 100,
      'staff': 80,
      'house_owner': 60,
      'caretaker': 40
    };

    if(roleHierarchy[creator.role.slug] <= roleHierarchy[userData.roleSlug]){
      throw new Error(`You cannot create ${userData.roleSlug} accounts`);
    }

    //check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        email: userData.email
      }
    })

    if(existingUser){
      throw new Error("User with this email already exists");
    }

    let password = userData.password;
    if(!password){
      password = crypto.randomBytes(8).toString('hex'); //generate random password
    }

    const { hash, salt } = await hashPassword(password);

    //create new user
    const user = await prisma.user.create({
      data: {
        uuid: uuid(),
        email: userData.email,
        passwordHash: hash,
        salt,
        name: userData.name || null,
        phone: userData.phone === "" ? null : userData.phone,
        roleId: targetRole.id,
        parentId: creatorId,
        needsPasswordSetup: false,
        metadata: {
          createdBy: creator.email,
          createdAt: new Date().toISOString(),
          houseLimit: houseLimit,
          permissions: permissions,
          ...userData.metadata
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

     // If houseLimit specified, create or update role limit
    if (houseLimit !== null && ['house_owner', 'staff'].includes(userData.roleSlug)) {
      await prisma.roleLimit.upsert({
        where: { roleSlug: userData.roleSlug },
        update: { maxHouses: houseLimit },
        create: {
          roleSlug: userData.roleSlug,
          maxHouses: houseLimit,
          maxCaretakers: 5,
          maxFlats: 50
        }
      });
    }


    if(sendEmail){
      //TODO: send email to user with account details
      console.log(`Account created for ${user.email}, password: ${password}`); 
    }

    let registrationToken = null;
    if(generateToken) {
      registrationToken = await this.generateRegistrationToken(creatorId, {
        email: user.email,
        roleSlug: userData.roleSlug,
        expiresInHours: 168,
        metaData: {
          houseLimit,
          permissions,
          autoCreated: true
        }
      });
    }


    return {
      user,
      password: sendEmail ? undefined : password,
      registrationToken
    }

  }


  async loginAs(currentUserId, targetUserId, reason = 'Administrative Access') {
    const currentUser = await prisma.user.findUnique({
      where: {
        id: currentUserId
      },
      include: {
        role: true
      }
    })

    if(!currentUser){
      throw new Error("Current user not found");
    }

    const targetUser = await prisma.user.findUnique({
      where: {
        id: targetUserId
      },
      include: {
        role: true
      }
    })

    if(!targetUser){
      throw new Error("Target user not found");
    }

    // check permission
    const roleLimits = await prisma.roleLimit.findUnique({
      where: {
        roleSlug: currentUser.role.slug
      }
    });

    if(!roleLimits || !roleLimits.canLoginAs) {
      throw new Error("You do not have permission to login as other users");
    }

    const allowedRoles = roleLimits.canLoginAs || [];
    if(!allowedRoles.includes(targetUser.role.slug)){
      throw new Error(`You do not have permission to login as ${targetUser.role.slug} users`);
    }

    //check if target user is under current user's hierarchy
    if(currentUser.role.slug !== 'web_owner'){
      const isHierarchyValid = await this.checkUserHierarchy(currentUserId, targetUserId);
      if(!isHierarchyValid){
        throw new Error("You can only login as users under your management hierarchy");
      }
    }

    //create login-as session
    const loginAsSession = await prisma.userLoginAs.create({
      data: {
        userId: currentUserId,
        targetUserId: targetUserId,
        originalRoleId: currentUser.roleId,
        reason: reason,
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours
      },
      include: {
        targetUser: {
          include: { role: true }
        }
      }
    })

    const tokens = await createTokens(targetUser.id.toString());

    return {
      ...tokens,
      user: targetUser,
      loginAsSession: {
        id: loginAsSession.id,
        originalUserId: currentUserId,
        originalRole: currentUser.role,
        expiresAt: loginAsSession.expiresAt,
        reason: loginAsSession.reason
      }
    };

  }

  async checkUserHierarchy(parentId, childId) {
    const child = await prisma.user.findUnique({
      where: { id: childId },
      include: { parent: true }
    })

    if(!child) return false;
    if(child.parentId === parentId) return true;
    if(!child.parentId) return false;

    return await this.checkUserHierarchy(parentId, child.parentId);
  }

  async exitLoginAs(loginSessionId, currentUserId) {
    const session = await prisma.userLoginAs.findUnique({
      where: {
        id: loginSessionId
      },
      include: {
        user: {
          include: {
            role: true
          }
        }
      }
    })

    if(!session){
      throw new Error("Login-as session not found");
    }

    if(session.userId !== currentUserId){
      throw new Error("You can only exit your own login-as sessions");
    }

    await prisma.userLoginAs.delete({
      where: {
        id: loginSessionId
      }
    });

    const tokens = await createTokens(session.userId.toString());

    return {
      ...tokens,
      user: session.user,
      message: 'Returned to original user session'
    };

  }


  async getManagedUsers(userId, roleFilter = null ) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true }
    })
    if(!user){
      throw new Error("User not found");
    }

    const allUsers = await prisma.user.findMany({
      where: {
        role: roleFilter ? { slug: roleFilter } : undefined
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

    //filter users under management hierarchy
    const managedUsers = [];
    for(const targetUser of allUsers){
      const isManaged = await this.checkUserHierarchy(userId, targetUser.id);
      if(isManaged){
        managedUsers.push(targetUser);
      }
    }

    return managedUsers;
  }

  async updateUserLimits(userId, updates) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { role: true }
    })

    if(!user){
      throw new Error("User not found");
    }

    if(updates.houseLimit !== undefined) {
      await prisma.roleLimit.upsert({
        where: {
          roleSlug: user.role.slug
        },
        update: {
          maxHouses: updates.houseLimit
        },
        create: {
          roleSlug: user.role.slug,
          maxHouses: updates.houseLimit,
          maxCaretakers: 5,
          maxFlats: 50
        }
      });
    }

    const currentMetadata = user.metadata || {};
    const updatedMetadata = {
      ...currentMetadata,
      houseLimit: updates.houseLimit !== undefined ? updates.houseLimit : currentMetadata.houseLimit,
      permissions: updates.permissions || currentMetadata.permissions,
      updatedAt: new Date().toISOString()
    };

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        metadata: updatedMetadata
      },
      include: { role: true }
    })

    return updatedUser;
  }

  async getRegistrationTokens(creatorId, filters = {}) {
    const where = {
      createdBy: creatorId,
      ...(filters.used !== undefined ? { used: filters.used } : {}),
      ...(filters.roleSlug ? { roleSlug: filters.roleSlug } : {}),
      ...(filters.email && { email: { contains: filters.email }})
    };

    const tokens = await prisma.registrationToken.findMany({
      where,
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    return tokens;
  }

  //revoke registration token
  async revokeRegistrationToken(tokenId, creatorId) {
    const token = await prisma.registrationToken.findUnique({
      where: { id: tokenId }
    });

    if(!token){
      throw new Error("Registration token not found");
    }

    if(token.createdBy !== creatorId){
      throw new Error("You can only revoke your own registration tokens");
    }

    if(token.used){
      throw new Error("Cannot revoke a token that has already been used");
    }

    await prisma.registrationToken.delete({
      where: { id: tokenId }
    })

    return { message: "Registration token revoked successfully" };
  }

async login(data) {
    const { email, password } = data;
    
    // Find user with role
    const user = await prisma.user.findFirst({
      where: { email },
      include: { 
        role: true 
      },
    });

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
    console.log("User permissions:", permissions);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        // lastLoginIp: data.ip // If you pass IP from controller
      },
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
      role: user.role,
      permission: permissions // Add permissions to user object
    };

        const { sendAutoWelcomeNotification } = require("../utils/autoTestNotification");

        if(user.role?.slug === "web_owner") {
            setTimeout(async () => {
              await sendAutoWelcomeNotification(user.id, user.role.slug);
            }, 3000);
        }

    return { 
      user: userResponse, 
      ...tokens,
      permission: permissions // Also include separately for backward compatibility
    };
  }

  async linkGoogleAccount (userId, googleId) {
    // Prevent duplicate Google usage
    const existingGoogleUser = await prisma.user.findFirst({
      where: { googleId },
    });

    if (existingGoogleUser) {
      throw new Error("This Google account is already linked to another user");
    }

    return await prisma.user.update({
      where: { id: userId },
      data: {
        googleId,
        emailVerifiedAt: new Date(),
      },
    });
  };

  async setPassword (userId, password) {
    const { hash, salt } = await hashPassword(password);

    return await prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: hash,
        salt,
        needsPasswordSetup: false,
      },
    });
  };

  async refreshToken (req, res) {
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
  };

  async canLinkAccount (email, googleId) {
    const emailUser = await prisma.user.findFirst({
      where: { email },
    });

    if (!emailUser) {
      return {
        canLink: false,
        reason: "No email-based account found",
      };
    }

    // 2. If already linked → block
    if (emailUser.googleId) {
      return {
        canLink: false,
        reason: "This email is already linked to a Google account",
      };
    }

    // 3. Ensure this Google account is not already linked to another user
    const existingGoogleLink = await prisma.user.findFirst({
      where: { googleId },
    });

    if (existingGoogleLink) {
      return {
        canLink: false,
        reason: "This Google account is already linked to another user",
      };
    }

    // ✅ Safe to link
    return {
      canLink: true,
      emailUserId: emailUser.id,
    };
  };

}

module.exports = new AuthService();