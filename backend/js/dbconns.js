// backend/js/dbconns.js
// Database Connections Module
// Responsible for managing database interactions and persisting trading data

const mariadb = require('mariadb');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Database connection configuration
const dbConfig = {
  host: process.env.DB_HOST || 'database',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 5,
  connectTimeout: 10000
};

// Create a connection pool
let pool = null;
let isConnected = false;

/**
 * Initialize the database connection pool
 * @returns {Promise<boolean>} True if initialization was successful
 */
async function initialize() {
  try {
    console.log('Initializing database connection pool...');
    
    // Create the connection pool
    pool = mariadb.createPool(dbConfig);
    
    // Test the connection
    const connection = await pool.getConnection();
    console.log('Database connection successful');
    
    // Release the connection back to the pool
    connection.release();
    
    isConnected = true;
    return true;
  } catch (error) {
    console.error('Failed to initialize database connection:', error);
    isConnected = false;
    return false;
  }
}

/**
 * Get a connection from the pool
 * @returns {Promise<Object>} A database connection
 */
async function getConnection() {
  if (!pool) {
    await initialize();
  }
  
  try {
    return await pool.getConnection();
  } catch (error) {
    console.error('Error getting database connection:', error);
    throw error;
  }
}

/**
 * Check if the database is connected
 * @returns {boolean} True if connected
 */
function isReady() {
  return isConnected;
}

/**
 * Execute a SQL query
 * @param {string} sql - The SQL query to execute
 * @param {Array} params - The parameters for the query
 * @returns {Promise<Object>} The query result
 */
async function query(sql, params = []) {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.query(sql, params);
    return result;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
}

/**
 * Record a trade in the database
 * @param {Object} tradeData - The trade data to record
 * @param {string} tradeData.symbol - The cryptocurrency symbol
 * @param {string} tradeData.action - The action (buy/sell)
 * @param {number} tradeData.quantity - The amount of cryptocurrency
 * @param {number} tradeData.price - The price at which the trade occurred
 * @param {number} tradeData.usdt_amount - The USDT value of the trade
 * @returns {Promise<Object>} The inserted record ID
 */
async function recordTrade(tradeData) {
  if (!tradeData) {
    throw new Error('No trade data provided');
  }

  const { symbol, action, quantity, price, usdt_amount } = tradeData;
  
  try {
    const sql = `
      INSERT INTO trades (symbol, action, quantity, price, usdt_amount, created_at)
      VALUES (?, ?, ?, ?, ?, NOW())
    `;
    
    const result = await query(sql, [symbol, action, quantity, price, usdt_amount]);
    
    console.log(`Trade record inserted: ${symbol} ${action} at ${price}`);
    return result.insertId;
  } catch (error) {
    console.error('Error recording trade:', error);
    throw error;
  }
}

/**
 * Get trading history for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} limit - The maximum number of records to return
 * @returns {Promise<Array>} The trading history
 */
async function getTradingHistory(symbol, limit = 10) {
  try {
    const sql = `
      SELECT id, symbol, action, quantity, price, usdt_amount, created_at
      FROM trades
      WHERE symbol = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;
    
    const result = await query(sql, [symbol, limit]);
    return result;
  } catch (error) {
    console.error(`Error getting trading history for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get current holdings for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @returns {Promise<Object>} The current holdings
 */
async function getCurrentHoldings(symbol) {
  try {
    // Get all buy transactions
    const buySql = `
      SELECT SUM(quantity) as total_bought, SUM(usdt_amount) as total_spent
      FROM trades
      WHERE symbol = ? AND action = 'buy'
    `;
    
    // Get all sell transactions
    const sellSql = `
      SELECT SUM(quantity) as total_sold, SUM(usdt_amount) as total_received
      FROM trades
      WHERE symbol = ? AND action = 'sell'
    `;
    
    const buyResult = await query(buySql, [symbol]);
    const sellResult = await query(sellSql, [symbol]);
    
    const totalBought = buyResult[0].total_bought || 0;
    const totalSpent = buyResult[0].total_spent || 0;
    const totalSold = sellResult[0].total_sold || 0;
    const totalReceived = sellResult[0].total_received || 0;
    
    // Calculate current holdings
    const currentQuantity = totalBought - totalSold;
    const averageBuyPrice = totalBought > 0 ? totalSpent / totalBought : 0;
    
    return {
      symbol,
      quantity: currentQuantity,
      averageBuyPrice,
      totalSpent,
      totalReceived,
      netProfit: totalReceived - totalSpent
    };
  } catch (error) {
    console.error(`Error getting current holdings for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Calculate trading thresholds for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} currentPrice - The current price
 * @returns {Promise<Object>} The trading thresholds
 */
async function calculateTradingThresholds(symbol, currentPrice) {
  try {
    const holdings = await getCurrentHoldings(symbol);
    
    // If no holdings, return default thresholds
    if (holdings.quantity <= 0) {
      return {
        symbol,
        nextBuyPrice: currentPrice * 0.95, // 5% drop
        nextSellPrice: 0, // No sell threshold if no holdings
        holdingsQuantity: 0,
        profitLossPercentage: 0
      };
    }
    
    // If we have holdings, calculate thresholds
    const averageBuyPrice = holdings.averageBuyPrice;
    const nextBuyPrice = currentPrice * 0.95; // 5% drop for next buy
    const nextSellPrice = averageBuyPrice * 1.05; // 5% above average buy price for sell
    
    // Calculate profit/loss percentage
    const profitLossPercentage = ((currentPrice - averageBuyPrice) / averageBuyPrice) * 100;
    
    return {
      symbol,
      nextBuyPrice,
      nextSellPrice,
      holdingsQuantity: holdings.quantity,
      profitLossPercentage
    };
  } catch (error) {
    console.error(`Error calculating trading thresholds for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get all trading symbols in the database
 * @returns {Promise<Array<string>>} List of trading symbols
 */
async function getAllTradingSymbols() {
  try {
    const sql = `
      SELECT DISTINCT symbol
      FROM trades
    `;
    
    const result = await query(sql);
    return result.map(row => row.symbol);
  } catch (error) {
    console.error('Error getting all trading symbols:', error);
    throw error;
  }
}

/**
 * Close the database connection pool
 */
async function close() {
  if (pool) {
    try {
      await pool.end();
      console.log('Database connection pool closed');
      isConnected = false;
    } catch (error) {
      console.error('Error closing database connection pool:', error);
    }
  }
}

// Export public API
module.exports = {
  initialize,
  isReady,
  recordTrade,
  getTradingHistory,
  getCurrentHoldings,
  calculateTradingThresholds,
  getAllTradingSymbols,
  close
};