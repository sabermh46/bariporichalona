require('dotenv').config(); 

const MariadbAdapter = require("@prisma/adapter-mariadb");
const { PrismaClient } = require("@prisma/client");

// Read connection details from environment variables
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'barip';

// 1. Instantiate the adapter
const adapter = new MariadbAdapter.PrismaMariaDb({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
});

// 2. Instantiate PrismaClient using the adapter
const prisma = new PrismaClient({ adapter });

module.exports = prisma;