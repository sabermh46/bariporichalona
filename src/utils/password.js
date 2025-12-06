const bcrypt = require("bcrypt");

exports.hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash(password, salt);
  return { salt, hash };
};

exports.verifyPassword = (password, hash) => {
  return bcrypt.compare(password, hash);
};
