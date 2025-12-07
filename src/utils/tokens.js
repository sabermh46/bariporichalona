const jwt = require("jsonwebtoken");

exports.createTokens = async (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "3d" })
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH, { expiresIn: "30d" })
  return { accessToken, refreshToken }
};
