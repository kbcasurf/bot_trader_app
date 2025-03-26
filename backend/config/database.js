const mariadb = require('mariadb');
const logger = require('../src/utils/logger');

// Create a database connection pool using environment variables
const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  connectTimeout: 10000, // 10 seconds
  acquireTimeout: 10000 // 10 seconds
});

// Log pool initialization
logger.info('Database pool initialized', {
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  database: process.env.DB_NAME
});

// Export the pool
module.exports = pool;