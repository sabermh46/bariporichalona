const AuthService = require("../services/auth.service");
const PermissionService = require("../services/permission.service");
const { serializeBigInt } = require("../utils/serializer");
const db = require("../config/knex");

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
      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  async login(req, res) {
    try {
      const data = await AuthService.login(req.body);
      res.json(serializeBigInt(data));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
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

  async refreshToken(req, res) {
    try {
      const data = await AuthService.refreshToken(req, res);
      res.json(serializeBigInt(data));
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

      if(req.user.role.slug === 'staff' ) {
        if(roleSlug && (roleSlug !== 'house_owner' && roleSlug !== 'caretaker')) {
          throw new Error("Staff can only generate tokens for House_Owner Or Caretaker role");
        }
        let hasThisPermission = await PermissionService.hasPermission(req.user.id, 'registrationToken.create');
        if(!hasThisPermission) {
          throw new Error("You do not have permission to generate registration tokens");
        }
      }
      
      const result = await AuthService.generateRegistrationToken(req.user.id, {
        email,
        roleSlug: roleSlug || 'house_owner',
        expiresInHours: expiresInHours || 24,
        metadata: metadata || {}
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
        permissions 
      } = req.body;

      const result = await AuthService.createUserAccount(req.user.id, {
        email,
        name,
        phone,
        roleSlug,
        password
      }, {
        sendEmail: sendEmail || false,
        generateToken: generateToken || false,
        houseLimit,
        permissions: permissions || []
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
      
      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Get managed users
  async getManagedUsers(req, res) {
    try {
      const { role } = req.query;
      
      const users = await AuthService.getManagedUsers(req.user.id, role);
      
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
      
      res.json(serializeBigInt(result));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Get system settings
  async getSystemSettings(req, res) {
    try {
      const settings = await db('system_setting')
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
        return res.status(403).json({ error: 'Only web owner can update system settings' });
      }

      const existingSetting = await db('system_setting')
        .where('key', key)
        .first();

      let setting;
      
      if (existingSetting) {
        // Update existing
        await db('system_setting')
          .where('key', key)
          .update({
            value: JSON.stringify(value),
            type: typeof value,
            updatedAt: new Date()
          });
        
        setting = await db('system_setting')
          .where('key', key)
          .first();
      } else {
        // Insert new
        const [id] = await db('system_setting').insert({
          key,
          value: JSON.stringify(value),
          type: typeof value,
          category: 'general',
          isPublic: false,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        
        setting = await db('system_setting')
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
      const setting = await db('system_setting')
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
      const sessions = await db('user_login_as as ula')
        .where(function() {
          this.where('ula.userId', req.user.id)
              .orWhere('ula.targetUserId', req.user.id);
        })
        .leftJoin('user as u', 'ula.userId', 'u.id')
        .leftJoin('user as tu', 'ula.targetUserId', 'tu.id')
        .leftJoin('role as ur', 'u.roleId', 'ur.id')
        .leftJoin('role as tur', 'tu.roleId', 'tur.id')
        .leftJoin('role as or', 'ula.originalRoleId', 'or.id')
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
          'or.slug as original_role_slug'
        )
        .orderBy('ula.createdAt', 'desc');

      // Format the response
      const formattedSessions = sessions.map(session => ({
        id: session.id,
        userId: session.userId,
        targetUserId: session.targetUserId,
        sessionToken: session.sessionToken,
        originalRoleId: session.originalRoleId,
        reason: session.reason,
        endedAt: session.endedAt,
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
}

module.exports = new AuthController();