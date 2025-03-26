const mariadb = require('mariadb');
const logger = require('../src/utils/logger');

// Create a database connection pool using environment variables
const pool = mariadb.createPool({
  host: process.env.DB_HOST || 'database',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'trading_bot_user',
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'crypto_trading_bot',
  connectionLimit: 5,
  connectTimeout: 10000, // 10 seconds
  acquireTimeout: 10000 // 10 seconds
});

// Log pool initialization
logger.info('Database pool initialized', {
  host: process.env.DB_HOST || 'database',
  user: process.env.DB_USER || 'trading_bot_user',
  database: process.env.DB_NAME || 'crypto_trading_bot'
});

// Export the pool
module.exports = pool;