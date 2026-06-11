const AuthService = require("../services/auth.service");
const PermissionService = require("../services/permission.service");
const { serializeBigInt } = require("../utils/serializer");
const db = require("../config/knex");
const notificationController = require("./notification.controller");
const notify = require("../services/inAppNotification.service");
const pushService = require("../services/pushNotification.service");
const audit = require("../services/audit.service");
const path = require("path");
const fs = require("fs");
const { moveToPermanentLocation } = require("../utils/fileUpload");
const { v4: uuidv4 } = require("uuid");

class AuthController {
  // Public registration
  async register(req, res) {
    try {
      const { token } = req.query;
      const data = req.body;

      // If token is provided in query, add it to data
      if (token) {
        data.token = token;
      }

      const result = await AuthService.register(data);
      if (result.user && result.user.role && result.user.role.slug === "house_owner") {
        try {
          await notificationController.createSystemCommonNotification({
            title: "New house owner registered",
            message: `${result.user.name || result.user.email} signed up as a house owner.`,
            redirectLink: `/admin/house-owners/${result.user.id}`,
          });
        } catch (notifErr) {
          console.error("System notification (house owner signup):", notifErr);
        }
      }
      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async login(req, res) {
    try {
      const data = await AuthService.login(req.body);
      const { refreshToken, ...responseData } = data;

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      });

      audit.fromRequest(req, {
        actorId: data.user?.id,
        actorRole: data.user?.role?.slug,
        actorName: data.user?.name,
        actorEmail: data.user?.email,
        entityType: 'user',
        entityId: data.user?.id,
        action: 'login',
        actionCategory: 'auth',
        metadata: { source: 'service' },
      });

      res.json(serializeBigInt(responseData));
    } catch (err) {
      audit.fromRequest(req, {
        actorRole: 'anonymous',
        actorEmail: req.body?.email || null,
        entityType: 'user',
        entityId: req.body?.email || null,
        action: 'login_failed',
        actionCategory: 'auth',
        status: 'failure',
        metadata: { source: 'service', reason: err.message },
      });
      res.status(400).json({ error: err.message });
    }
  };

  async logout(req, res) {
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });
    res.json({ success: true });
  };

  async setPassword(req, res) {
    try {
      const { password } = req.body;
      const user = await AuthService.setPassword(req.user.id, password);
      res.json(serializeBigInt({ message: "Password set successfully", user }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  };

  async linkGoogleAccount(req, res) {
    try {
      const { googleId } = req.body;
      const user = await AuthService.linkGoogleAccount(req.user.id, googleId);
      res.json(serializeBigInt({ message: "Google account linked successfully", user }));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async forgotPassword(req, res, next) {
        try {
            const { email } = req.body;
            const result = await AuthService.forgotPassword(email);
            
            if (!result.success) {
                return res.status(400).json(result);
            }
            
            res.json(result);
        } catch (error) {
            next(error);
        }
    }

    async resetPassword(req, res, next) {
        try {
            const { token, password } = req.body;
            const result = await AuthService.resetPassword(token, password);
            
            if (!result.success) {
                return res.status(400).json(result);
            }
            
            res.json(result);
        } catch (error) {
            next(error);
        }
    }

    async changePassword(req, res, next) {
        try {
            const { oldPassword, newPassword } = req.body;
            const userId = req.user.id;
            
            const result = await AuthService.changePassword(userId, oldPassword, newPassword);

            if (!result.success) {
                return res.status(400).json(result);
            }

            audit.fromRequest(req, {
                entityType: 'user',
                entityId: userId,
                action: 'password_change',
                actionCategory: 'auth',
                metadata: { source: 'service' },
            });

            res.json(result);
        } catch (error) {
            next(error);
        }
    }

  async refreshToken(req, res) {
    try {
      const data = await AuthService.refreshToken(req, res);
      const { refreshToken, ...responseData } = data;

      res.cookie('refreshToken', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      });

      res.json(serializeBigInt(responseData));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async checkAccountLink(req, res) {
    try {
      const { email, googleId } = req.query;
      const result = await AuthService.canLinkAccount(email, googleId);
      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Generate registration token
  async generateToken(req, res) {
    try {
      const { email, roleSlug, expiresInHours, metadata } = req.body;

      

      let parsedMetadata = {};
      if (metadata) {
        let raw = {};
        if (typeof metadata === 'string') {
          try { raw = JSON.parse(metadata); } catch (_) {}
        } else if (typeof metadata === 'object' && !Array.isArray(metadata)) {
          raw = metadata;
        }
        if (Array.isArray(raw.house_ids) && raw.house_ids.length > 0) {
          parsedMetadata.house_ids = raw.house_ids
            .map(id => parseInt(id, 10))
            .filter(id => Number.isFinite(id) && id > 0);
        }
        if (raw.house_owner_id) {
          const ownerId = parseInt(raw.house_owner_id, 10);
          if (Number.isFinite(ownerId) && ownerId > 0) {
            parsedMetadata.house_owner_id = ownerId;
          }
        }
      }

      if (roleSlug === 'caretaker' && req.user.role.slug === 'house_owner') {
        parsedMetadata.house_owner_id = req.user.id;
        
        // Optionally allow specifying house IDs
        if (parsedMetadata.house_ids && Array.isArray(parsedMetadata.house_ids)) {
          // Verify these houses belong to the house owner
          const houses = await db('house')
            .whereIn('id', parsedMetadata.house_ids)
            .andWhere('ownerId', req.user.id)
            .select('id');
          
          if (houses.length !== parsedMetadata.house_ids.length) {
            throw new Error('Some houses do not belong to you');
          }
        }
      }

      

      if(req.user.role.slug === 'staff' ) {
        if(roleSlug && (roleSlug !== 'house_owner' && roleSlug !== 'caretaker')) {
          throw new Error("Staff can only generate tokens for House_Owner Or Caretaker role");
        }
        let hasThisPermission = await PermissionService.hasPermission(req.user.id, 'registrationToken.create');
        if(!hasThisPermission) {
          throw new Error("You do not have permission to generate registration tokens");
        }
        if (roleSlug === 'caretaker' && !parsedMetadata.house_owner_id) {
          throw new Error("house_owner_id is required in metadata when staff generates caretaker token");
        }
      }
      
      const result = await AuthService.generateRegistrationToken(req.user.id, {
        email,
        roleSlug: roleSlug || 'house_owner',
        expiresInHours: expiresInHours || 24,
        metaData: parsedMetadata || {}
      });

      res.json(serializeBigInt(result));
    } catch (err) {
      console.log(err);
      res.status(400).json({ error: err.message });
    }
  }

  // Validate registration token
  async validateToken(req, res) {
    try {
      const { token, email } = req.body;      
      const tokenData = await AuthService.validateRegistrationToken(token, email);
      
      res.json(serializeBigInt({
        valid: true,
        token: {
          roleSlug: tokenData.roleSlug,
          email: tokenData.email,
          expiresAt: tokenData.expiresAt,
          createdBy: tokenData.creator
        }
      }));
    } catch (err) {
      res.status(400).json({ 
        valid: false,
        error: err.message 
      });
    }
  }

  // Create user account (admin/staff/house_owner)
  async createUser(req, res) {
    try {
      const {
        email,
        name,
        phone,
        roleSlug,
        password,
        sendEmail,
        generateToken,
        houseLimit,
        permissions,
        metadata
      } = req.body;

      const result = await AuthService.createUserAccount(req.user.id, {
        email,
        name,
        phone,
        roleSlug,
        password,
        metadata: metadata || {}
      }, {
        sendEmail: sendEmail || false,
        generateToken: generateToken || false,
        houseLimit,
        permissions: permissions || []
      });

      if (result.user && result.user.role && result.user.role.slug === "house_owner") {
        try {
          await notificationController.createSystemCommonNotification({
            title: "New house owner created",
            message: `${result.user.name || result.user.email} was added as a house owner.`,
            redirectLink: `/admin/house-owners/${result.user.id}`,
          });
        } catch (notifErr) {
          console.error("System notification (house owner create-user):", notifErr);
        }
      }

      if (result.user && result.user.role && result.user.role.slug === "caretaker" && metadata?.house_owner_id) {
        const caretakerName = result.user.name || result.user.email;
        const houseOwnerId = Number(metadata.house_owner_id);

        // In-app notifications
        notify.notifyUser(houseOwnerId, {
          title: 'New Caretaker Added',
          message: `${caretakerName} has been added as a caretaker for your properties.`,
          type: 'success',
          redirectLink: '/caretakers',
        }).catch(e => console.error('[notify] caretaker create-user (owner):', e));

        notify.notifyUser(result.user.id, {
          title: 'Account Created',
          message: 'Your caretaker account has been set up. You can now log in.',
          type: 'info',
          redirectLink: '/dashboard',
        }).catch(e => console.error('[notify] caretaker create-user (caretaker):', e));

        // Push notifications
        pushService.sendToUser(
          houseOwnerId,
          'New Caretaker Added',
          `${caretakerName} has been added as a caretaker for your properties.`,
          { type: 'caretaker_added', url: '/caretakers' }
        ).catch(e => console.error('[push] caretaker create-user (owner):', e));

        pushService.sendToUser(
          result.user.id,
          'Account Created',
          'Your caretaker account has been set up. You can now log in.',
          { type: 'account_created', url: '/dashboard' }
        ).catch(e => console.error('[push] caretaker create-user (caretaker):', e));
      }

      if (result.user && result.user.role && result.user.role.slug === "staff") {
        const staffName = result.user.name || result.user.email;

        // System notification for admins
        try {
          await notificationController.createSystemCommonNotification({
            title: "New staff member added",
            message: `${staffName} was added as a staff member.`,
            redirectLink: `/admin/view/all-staff`,
          });
        } catch (notifErr) {
          console.error("System notification (staff create-user):", notifErr);
        }

        // Welcome the new staff member
        notify.notifyUser(result.user.id, {
          title: 'Account Created',
          message: 'Your staff account has been set up. You can now log in.',
          type: 'info',
          redirectLink: '/dashboard',
        }).catch(e => console.error('[notify] staff create-user (staff):', e));

        pushService.sendToUser(
          result.user.id,
          'Account Created',
          'Your staff account has been set up. You can now log in.',
          { type: 'account_created', url: '/dashboard' }
        ).catch(e => console.error('[push] staff create-user (staff):', e));
      }

      audit.fromRequest(req, {
        entityType: 'user',
        entityId: result.user?.id,
        action: 'create',
        actionCategory: 'user_mgmt',
        metadata: { source: 'service', roleSlug: result.user?.role?.slug, email: result.user?.email },
      });

      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Login as another user
  async loginAs(req, res) {
    try {
      const { targetUserId, reason } = req.body;

      const result = await AuthService.loginAs(req.user.id, targetUserId, reason);

      audit.fromRequest(req, {
        entityType: 'user',
        entityId: targetUserId,
        action: 'login_as',
        actionCategory: 'auth',
        reason: reason || null,
        metadata: { source: 'service', originalUserId: req.user.id },
      });

      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Exit login-as session
  async exitLoginAs(req, res) {
    try {
      const { sessionId } = req.body;

      const result = await AuthService.exitLoginAs(sessionId, req.user.id);

      audit.fromRequest(req, {
        entityType: 'user',
        entityId: req.user.id,
        action: 'login_as_exit',
        actionCategory: 'auth',
        metadata: { source: 'service', sessionId },
      });

      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Get managed users (optional expand=dna for full house_owner DNA; optional userId to fetch one user)
  async getManagedUsers(req, res) {
    try {
      const { role, expand, userId: targetUserId } = req.query;

      const users = await AuthService.getManagedUsers(req.user.id, role, {
        expandDna: expand === 'dna',
        targetUserId: targetUserId || null
      });

      res.json(serializeBigInt(users));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Update user limits
  async updateUserLimits(req, res) {
    try {
      const { userId } = req.params;
      const { houseLimit, permissions } = req.body;
      
      const updatedUser = await AuthService.updateUserLimits(userId, {
        houseLimit,
        permissions
      });
      
      res.json(serializeBigInt(updatedUser));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Get registration tokens
  async getRegistrationTokens(req, res) {
    try {
      const filters = req.query;
      
      const tokens = await AuthService.getRegistrationTokens(req.user.id, filters);
      
      res.json(serializeBigInt(tokens));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Revoke registration token
  async revokeRegistrationToken(req, res) {
    try {
      const { tokenId } = req.params;
      
      const result = await AuthService.revokeRegistrationToken(tokenId, req.user.id);

      audit.fromRequest(req, {
        entityType: 'registrationtoken',
        entityId: tokenId,
        action: 'revoke',
        actionCategory: 'user_mgmt',
        metadata: { source: 'service' },
      });

      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Get system settings
  async getSystemSettings(req, res) {
    try {
      const settings = await db('systemsetting')
        .where(function() {
          this.where('isPublic', true)
              .orWhere('category', 'registration');
        })
        .select('*')
        .orderBy('key');

      res.json(serializeBigInt(settings));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Update system settings (admin only)
  async updateSystemSettings(req, res) {
    try {
      const { key, value } = req.body;

      // Check if user is web_owner
      if (req.user.role.slug !== 'web_owner') {
        return res.status(403).json({ error: 'Only web owner can update system settings||শুধুমাত্র ওয়েব মালিক সিস্টেম সেটিংস আপডেট করতে পারবেন' });
      }

      const existingSetting = await db('systemsetting')
        .where('key', key)
        .first();

      let setting;

      if (existingSetting) {
        // Update existing
        await db('systemsetting')
          .where('key', key)
          .update({
            value: JSON.stringify(value),
            type: typeof value,
            updatedAt: new Date()
          });

        setting = await db('systemsetting')
          .where('key', key)
          .first();
      } else {
        // Insert new
        const [id] = await db('systemsetting').insert({
          key,
          value: JSON.stringify(value),
          type: typeof value,
          category: 'general',
          isPublic: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        setting = await db('systemsetting')
          .where('id', id)
          .first();
      }

      res.json(serializeBigInt(setting));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async getPublicRegistrationStatus(req, res) {
    try {
      const setting = await db('systemsetting')
        .where('key', 'registration.public_enabled')
        .first();
      
      const isEnabled = setting ? JSON.parse(setting.value) : false;
      res.json({ publicRegistrationEnabled: isEnabled });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Get user's login-as sessions
  async getLoginAsSessions(req, res) {
    try {
      const sessions = await db('userloginas as ula')
        .where(function() {
          this.where('ula.userId', req.user.id)
              .orWhere('ula.targetUserId', req.user.id);
        })
        .leftJoin('user as u', 'ula.userId', 'u.id')
        .leftJoin('user as tu', 'ula.targetUserId', 'tu.id')
        .leftJoin('role as ur', 'u.roleId', 'ur.id')
        .leftJoin('role as tur', 'tu.roleId', 'tur.id')
        .leftJoin('role as orig_role', 'ula.originalRoleId', 'orig_role.id')
        .select(
          'ula.*',
          'u.id as user_id',
          'u.name as user_name',
          'u.email as user_email',
          'ur.slug as user_role_slug',
          'tu.id as target_user_id',
          'tu.name as target_user_name',
          'tu.email as target_user_email',
          'tur.slug as target_user_role_slug',
          'orig_role.slug as original_role_slug'
        )
        .orderBy('ula.createdAt', 'desc');

      // Format the response
      const formattedSessions = sessions.map(session => ({
        id: session.id,
        userId: session.userId,
        targetUserId: session.targetUserId,
        originalRoleId: session.originalRoleId,
        reason: session.reason,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        user: {
          id: session.user_id,
          name: session.user_name,
          email: session.user_email,
          role: {
            slug: session.user_role_slug
          }
        },
        targetUser: {
          id: session.target_user_id,
          name: session.target_user_name,
          email: session.target_user_email,
          role: {
            slug: session.target_user_role_slug
          }
        },
        originalRole: {
          slug: session.original_role_slug
        }
      }));

      res.json(serializeBigInt(formattedSessions));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async uploadAvatar(req, res) {
    try {
      const userId = req.user.id;
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'No file uploaded||কোনো ফাইল আপলোড হয়নি' });

      const ext = path.extname(file.originalname).toLowerCase();
      const filename = `${uuidv4()}${ext}`;
      const relativePath = moveToPermanentLocation(file.path, `avatars/${userId}`, filename);
      const avatarPath = `/uploads/${relativePath.replace(/\\/g, '/')}`;

      const user = await db('user').where('id', userId).first();
      let currentMetadata = {};
      if (user.metadata) {
        try { currentMetadata = JSON.parse(user.metadata); } catch (e) {}
      }

      // Delete old avatar file if one exists
      if (currentMetadata.avatarPath) {
        // avatarPath is like /uploads/avatars/{id}/file.jpg — strip leading slash for join
        const stripped = currentMetadata.avatarPath.replace(/^\//, '');
        const oldFilePath = path.join(process.cwd(), stripped);
        if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
      }

      const updatedMetadata = { ...currentMetadata, avatarPath };
      await db('user').where('id', userId).update({ metadata: JSON.stringify(updatedMetadata) });

      res.json({ success: true, avatarPath });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new AuthController();