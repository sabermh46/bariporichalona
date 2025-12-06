const prisma = require("../config/prisma");

exports.findByEmail = (email) =>
  prisma.user.findUnique({ where: { email } });

exports.findByGoogleId = (googleId) =>
  prisma.user.findUnique({ where: { googleId } });

exports.createUser = (data) =>
  prisma.user.create({ data });

exports.updateById = (id, data) =>
  prisma.user.update({ where: { id }, data });
