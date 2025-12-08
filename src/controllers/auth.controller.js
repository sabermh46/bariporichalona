const AuthService = require("../services/auth.service");
const { serializeBigInt } = require("../utils/serializer");

exports.login = async (req, res) => {
  try {
    const data = await AuthService.login(req.body);
    res.json(serializeBigInt(data));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};


exports.setPassword = async (req, res) => {
  try {
    const { password } = req.body;
    const user = await AuthService.setPassword(req.user.id, password);
    res.json(serializeBigInt({ message: "Password set successfully", user }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.linkGoogleAccount = async (req, res) => {
  try {
    const { googleId } = req.body;
    const user = await AuthService.linkGoogleAccount(req.user.id, googleId);
    res.json(serializeBigInt({ message: "Google account linked successfully", user }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const data = await AuthService.refreshToken(refreshToken);
    res.json(serializeBigInt(data));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}


exports.checkAccountLink = async (req, res) => {
  try {
    const { email, googleId } = req.query;
    const result = await AuthService.canLinkAccount(email, googleId);
    res.json(serializeBigInt(result));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

const AuthService = require("../services/auth.service");
const { serializeBigInt } = require("../utils/serializer");

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

  // Generate registration token
  async generateToken(req, res) {
    try {
      const { email, roleSlug, expiresInHours, metadata } = req.body;
      
      const result = await AuthService.generateRegistrationToken(req.user.id, {
        email,
        roleSlug: roleSlug || 'flat_renter',
        expiresInHours: expiresInHours || 24,
        metadata: metadata || {}
      });

      res.json(serializeBigInt(result));
    } catch (err) {
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
      const settings = await prisma.systemSetting.findMany({
        where: {
          OR: [
            { isPublic: true },
            { category: 'registration' }
          ]
        }
      });

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

      const setting = await prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: {
          key,
          value,
          type: typeof value,
          category: 'general'
        }
      });

      res.json(serializeBigInt(setting));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }

  // Get user's login-as sessions
  async getLoginAsSessions(req, res) {
    try {
      const sessions = await prisma.userLoginAs.findMany({
        where: {
          OR: [
            { userId: req.user.id },
            { targetUserId: req.user.id }
          ]
        },
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true }
          },
          targetUser: {
            select: { id: true, name: true, email: true, role: true }
          },
          originalRole: true
        },
        orderBy: { createdAt: 'desc' }
      });

      res.json(serializeBigInt(sessions));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  }
}

module.exports = new AuthController();