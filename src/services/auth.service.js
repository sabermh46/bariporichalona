const prisma = require("../config/prisma");
const { hashPassword, verifyPassword } = require("../utils/password");
const { createTokens } = require("../utils/tokens");
const { v4: uuid } = require("uuid");
const { validateRegistrationData } = require("../utils/validateRegistrationData");
const jwt = require("jsonwebtoken");

exports.register = async(data) => {

  const validationErrors = validateRegistrationData(data);
  if (validationErrors) {
    throw new Error(validationErrors);
  }


  const { email, password, name, phone } = data;

  const existingUser = await prisma.user.findFirst({ where: { email } });

  if (existingUser) {
    if(existingUser.googleId && !existingUser.passwordHash) {
      const { hash, salt } = hashPassword(password);

      const updatedUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          passwordHash: hash,
          salt: salt,
          needsPasswordSetup: false,
          name: name || existingUser.name,
          phone: phone || existingUser.phone
        }
      });
      const tokens = await createTokens(updatedUser.id.toString());
      return { user: updatedUser, ...tokens };
    }

    throw new Error("User already exists");

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
      roleId: null, //recheck this later
    }
  });

  const tokens = await createTokens(user.id.toString());
  
  return { user, ...tokens };

}

exports.login = async(data) => {
  const { email, password } = data;
  const user = await prisma.user.findFirst({ where: { email }, include: { role: true } });

  if (!user) {
    throw new Error("Invalid email or password");
  }
  

  const isPasswordValid = await verifyPassword(password, user.passwordHash);
  

  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
      // lastLoginIp: ipAddress // if you want to track IP
    }
  });
  
  const tokens = await createTokens(user.id.toString());
  console.log("tokens :"), tokens;
  return { user, ...tokens };
}


exports.linkGoogleAccount = async (userId, googleId) => {
  // Prevent duplicate Google usage
  const existingGoogleUser = await prisma.user.findFirst({
    where: { googleId }
  });

  if (existingGoogleUser) {
    throw new Error("This Google account is already linked to another user");
  }

  return await prisma.user.update({
    where: { id: userId },
    data: {
      googleId,
      emailVerifiedAt: new Date(),
    }
  });
};



exports.setPassword = async (userId, password) => {
  const { hash, salt } = await hashPassword(password);
  
  return await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: hash,
      salt,
      needsPasswordSetup: false
    }
  });
};




exports.refreshToken = async (req, res) => {
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
    return res.status(401).json({ message: "Invalid or expired refresh token" });
  }
};




exports.canLinkAccount = async (email, googleId) => {


  const emailUser = await prisma.user.findFirst({
    where: { email }
  });

  if (!emailUser) {
    return {
      canLink: false,
      reason: "No email-based account found"
    };
  }

  // 2. If already linked → block
  if (emailUser.googleId) {
    return {
      canLink: false,
      reason: "This email is already linked to a Google account"
    };
  }

  // 3. Ensure this Google account is not already linked to another user
  const existingGoogleLink = await prisma.user.findFirst({
    where: { googleId }
  });

  if (existingGoogleLink) {
    return {
      canLink: false,
      reason: "This Google account is already linked to another user"
    };
  }

  // ✅ Safe to link
  return {
    canLink: true,
    emailUserId: emailUser.id
  };
};
