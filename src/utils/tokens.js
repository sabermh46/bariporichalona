const jwt = require("jsonwebtoken");

// JWT_EXPIRES_IN
// JWT_REFRESH_EXPIRES_IN
exports.createTokens = async (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "3d" })
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d" })
  return { accessToken, refreshToken }
};
