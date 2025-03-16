const mysql = require('mysql2/promise');
const path = require('path');
// Update the path to point to the root .env file
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Database configuration from environment variables
const dbConfig = {
  host: process.env.DB_HOST || 'database',
  user: process.env.DB_USER || 'bot_trader_user',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'bot_trader',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Create a connection pool
let pool;

// Connect to the database with retry logic
async function connect() {
  try {
    console.log('Connecting to database with config:', {
      host: dbConfig.host,
      user: dbConfig.user,
      database: dbConfig.database
    });
    
    // Add retry logic for database connection
    let retries = 10;
    let lastError;
    
    while (retries > 0) {
      try {
        pool = mysql.createPool(dbConfig);
        
        // Test the connection
        const connection = await pool.getConnection();
        console.log('Connected to the database successfully');
        connection.release();
        
        return pool;
      } catch (error) {
        lastError = error;
        retries--;
        console.log(`Failed to connect to database. Retries left: ${retries}`);
        
        // Wait before retrying (increasing backoff)
        const delay = (10 - retries) * 1500;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    // If we've exhausted all retries, throw the last error
    throw lastError;
  } catch (error) {
    console.error('Database connection error:', error);
    throw error;
  }
}

// Execute a query with connection check
async function query(sql, params) {
  try {
    if (!pool) {
      await connect();
    }
    
    try {
      const [results] = await pool.execute(sql, params);
      return results;
    } catch (error) {
      // If connection was lost, try to reconnect once
      if (error.code === 'PROTOCOL_CONNECTION_LOST') {
        console.log('Database connection lost. Reconnecting...');
        await connect();
        const [results] = await pool.execute(sql, params);
        return results;
      }
      throw error;
    }
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Disconnect from the database
async function disconnect() {
  if (pool) {
    await pool.end();
    console.log('Database connection closed');
  }
}

module.exports = {
  connect,
  query,
  disconnect,
  getPool: () => pool
};