const knex = require('knex');
require('dotenv').config();

const config = {
  client: 'mysql2',
  connection: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'baripknex',
    charset: 'utf8mb4',
  },
  pool: {
    min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
    max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    acquireTimeoutMillis: parseInt(process.env.DB_POOL_ACQUIRE_TIMEOUT, 10) || 30000,
    createTimeoutMillis: parseInt(process.env.DB_POOL_CREATE_TIMEOUT, 10) || 30000,
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_TIMEOUT, 10) || 30000,
    reapIntervalMillis: parseInt(process.env.DB_POOL_REAP_INTERVAL, 10) || 1000,
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: './database/migrations'
  },
  seeds: {
    directory: './database/seeds'
  },
  debug: process.env.NODE_ENV === 'development'
};

const db = knex(config);

module.exports = db;