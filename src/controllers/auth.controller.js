const AuthService = require("../services/auth.service");
const { serializeBigInt } = require("../utils/serializer");

exports.register = async (req, res) => {
  try {
    const data = await req.body;
    const { token } = req.query;
    if(token) {
      data.token = token;
    }
    const result = await AuthService.register(data);
    res.json(serializeBigInt(result));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

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