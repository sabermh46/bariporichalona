exports.loginSuccess = (req, res) => {
  if (!req.user) {
    return res.status(403).json({ error: true, message: "Not Authorized" });
  }

  return res.json({
    error: false,
    message: "Login successful",
    user: req.user
  });
};
