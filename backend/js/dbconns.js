// backend/js/dbconns.js
// Database Connections Module
// Responsible for managing database interactions and persisting trading data

const mariadb = require('mariadb');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: require('path').resolve(__dirname, '../.env') });

// Trading configuration
const BUY_THRESHOLD_PERCENT = parseFloat(process.env.BUY_THRESHOLD_PERCENT || 0.01);  // Default to 1% if not set
const SELL_THRESHOLD_PERCENT = parseFloat(process.env.SELL_THRESHOLD_PERCENT || 0.01); // Default to 1% if not set

// Database connection configuration with better defaults and connection handling
const dbConfig = {
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  acquireTimeout: 30000,     // Longer timeout for acquiring connections (30s)
  connectTimeout: 20000,     // Longer connection timeout (20s)
  idleTimeout: 60000,        // How long connections can remain idle (60s)
  maxIdle: 5,                // Max idle connections to keep in pool
  trace: process.env.NODE_ENV, // Stack trace for debugging in non-production
  multipleStatements: false, // Security: disable multiple statements
  dateStrings: true,         // Return dates as strings for consistency
  resetAfterUse: true,       // Reset connection state after use
  timezone: 'Z',             // UTC timezone for consistency
  // Connection retry strategy
  canRetry: true,            // Enable connection retries
  acquireRetryDelay: 2000,   // Delay between connection retry attempts
  acquireRetries: 5          // Number of connection retries
};

// Create a connection pool
let pool = null;
let isConnected = false;

// Keep track of connection attempts to prevent endless retries
let connectionAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;
const CONNECTION_BACKOFF_MS = 3000; // 3 seconds

/**
 * Initialize the database connection pool with retry mechanism
 * @returns {Promise<boolean>} True if initialization was successful
 */
async function initialize() {
  try {
    if (connectionAttempts >= MAX_INIT_ATTEMPTS) {
      console.error(`Failed to connect to database after ${MAX_INIT_ATTEMPTS} attempts. Will operate in degraded mode.`);
      return false;
    }
    
    connectionAttempts++;
    console.log(`Initializing database connection pool (attempt ${connectionAttempts}/${MAX_INIT_ATTEMPTS})...`);
    
    // Create the connection pool if it doesn't exist
    if (!pool) {
      pool = mariadb.createPool(dbConfig);
      
      // Only log connection errors, not normal connection acquisition/release
      // This reduces log noise for normal database operations
      pool.on('error', function(err) {
        console.error('Database connection error:', err);
        // Only reset connection status for fatal errors
        if (err.fatal) {
          isConnected = false;
        }
      });
    }
    
    // Test the connection with a timeout
    const connection = await Promise.race([
      pool.getConnection(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), dbConfig.connectTimeout)
      )
    ]);
    
    console.log('Database connection successful');
    
    // Check database version and server info for debugging
    const [versionResult] = await connection.query('SELECT VERSION() as version');
    console.log(`Connected to MariaDB version: ${versionResult.version}`);
    
    // Release the connection back to the pool
    connection.release();
    
    // Reset connection attempts on success
    connectionAttempts = 0;
    isConnected = true;
    return true;
  } catch (error) {
    console.error(`Failed to initialize database connection (attempt ${connectionAttempts}/${MAX_INIT_ATTEMPTS}):`, error);
    isConnected = false;
    
    // Try to reconnect after a delay, with increasing backoff
    if (connectionAttempts < MAX_INIT_ATTEMPTS) {
      const backoffTime = CONNECTION_BACKOFF_MS * connectionAttempts;
      console.log(`Will retry database connection in ${backoffTime}ms...`);
      await new Promise(resolve => setTimeout(resolve, backoffTime));
      return initialize(); // Retry recursively
    }
    
    return false;
  }
}

/**
 * Get a connection from the pool with better error handling
 * @returns {Promise<Object>} A database connection
 */
async function getConnection() {
  // If not connected, try to initialize (but only if we haven't exceeded max attempts)
  if (!isConnected && connectionAttempts < MAX_INIT_ATTEMPTS) {
    await initialize();
  }
  
  // If still not connected after initialization attempt, throw error
  if (!isConnected) {
    throw new Error('Database connection unavailable - operating in degraded mode');
  }
  
  try {
    return await pool.getConnection();
  } catch (error) {
    console.error('Error getting database connection:', error);
    
    // If error appears to be a connection issue, mark as disconnected
    if (error.code === 'ECONNREFUSED' || error.code === 'ER_ACCESS_DENIED_ERROR' || 
        error.code === 'ER_GET_CONNECTION_TIMEOUT' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      isConnected = false;
      // Trigger reconnection attempt on next query
      connectionAttempts = 0;
    }
    
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
 * Execute a SQL query with retry logic for transient errors
 * @param {string} sql - The SQL query to execute
 * @param {Array} params - The parameters for the query
 * @param {Object} options - Query options
 * @param {number} options.retries - Number of retries for transient errors (default: 2)
 * @param {number} options.retryDelay - Delay between retries in ms (default: 1000)
 * @returns {Promise<Object>} The query result
 */
async function query(sql, params = [], options = {}) {
  const retries = options.retries || 2;
  const retryDelay = options.retryDelay || 1000;
  let attempt = 0;
  let lastError = null;
  
  while (attempt <= retries) {
    let conn;
    try {
      conn = await getConnection();
      
      // Add query timeout for safety
      const queryOptions = { 
        timeout: 15000 // 15 second timeout for queries
      };
      
      const result = await conn.query({
        sql,
        values: params,
        ...queryOptions
      });
      
      return result;
    } catch (error) {
      lastError = error;
      console.error(`Database query error (attempt ${attempt + 1}/${retries + 1}):`, error);
      
      // Determine if error is transient and eligible for retry
      const isTransientError = 
        error.code === 'ER_LOCK_DEADLOCK' ||
        error.code === 'ER_LOCK_WAIT_TIMEOUT' ||
        error.code === 'ER_QUERY_INTERRUPTED' ||
        error.code === 'PROTOCOL_CONNECTION_LOST' ||
        error.code === 'ER_QUERY_TIMEOUT';
      
      if (isTransientError && attempt < retries) {
        attempt++;
        console.log(`Retrying query in ${retryDelay}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      } else {
        throw error;
      }
    } finally {
      if (conn) {
        try {
          conn.release();
        } catch (releaseError) {
          console.error('Error releasing database connection:', releaseError);
        }
      }
    }
  }
  
  // This should never be reached due to the throw in the loop, but just in case
  throw lastError || new Error('Unknown error executing database query');
}

/**
 * Record a trade in the database and update reference prices
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

  const { symbol, action, quantity, price, usdt_amount, isManualSellAll } = tradeData;
  
  try {
    // Start a transaction with a higher isolation level to prevent interference
    const conn = await getConnection();
    
    try {
      // Use SERIALIZABLE to ensure transaction isolation
      await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      await conn.beginTransaction();
      
      // Insert trade record
      const sql = `
        INSERT INTO trades (symbol, action, quantity, price, usdt_amount, created_at)
        VALUES (?, ?, ?, ?, ?, NOW())
      `;
      
      const result = await conn.query({
        sql,
        values: [symbol, action, quantity, price, usdt_amount]
      });
      
      // Get current reference prices
      const refPricesSql = `
        SELECT symbol, last_transaction_price
        FROM reference_prices
        WHERE symbol = ?
        FOR UPDATE
      `;
      
      const refResult = await conn.query({
        sql: refPricesSql,
        values: [symbol]
      });
      
      // Process reference prices
      const updateFields = [];
      const updateValues = [];
      
      // Always update last transaction price for any buy or sell
      updateFields.push('last_transaction_price = ?');
      updateValues.push(price);
      
      // Update next buy/sell prices based on the updated transaction price
      let nextBuyPrice = 0;
      let nextSellPrice = 0;
      
      // Calculate next buy price based on environment variable
      nextBuyPrice = price * (1 - BUY_THRESHOLD_PERCENT);
      updateFields.push('next_buy_price = ?');
      updateValues.push(nextBuyPrice);
      
      // Handle next sell price based on action type
      if (action === 'buy') {
        // For buys, set next sell price based on environment variable
        nextSellPrice = price * (1 + SELL_THRESHOLD_PERCENT);
        updateFields.push('next_sell_price = ?');
        updateValues.push(nextSellPrice);
        console.log(`BUY: Setting next sell price for ${symbol} to ${nextSellPrice} (${SELL_THRESHOLD_PERCENT * 100}% above purchase price)`);
      } 
      else if (action === 'sell') {
        // ONLY for manual "Sell All" operations, set next_sell_price to 0
        if (isManualSellAll === true) {
          nextSellPrice = 0;
          updateFields.push('next_sell_price = ?');
          updateValues.push(nextSellPrice);
          console.log(`MANUAL SELL ALL: Setting next sell price for ${symbol} to 0 (null value)`);
        }
        // For automated or partial sells that didn't come from "Sell All" button,
        // calculate next sell price based on the current transaction price
        else {
          // Set next sell price based on environment variable
          nextSellPrice = price * (1 + SELL_THRESHOLD_PERCENT);
          updateFields.push('next_sell_price = ?');
          updateValues.push(nextSellPrice);
          console.log(`AUTO/PARTIAL SELL: Setting next sell price for ${symbol} at ${nextSellPrice} (${SELL_THRESHOLD_PERCENT * 100}% above current transaction price)`);
        }
      }
      
      // Check if the record exists first
      const checkRefSql = `
        SELECT COUNT(*) as count
        FROM reference_prices
        WHERE symbol = ?
      `;
      
      const checkResult = await conn.query({
        sql: checkRefSql,
        values: [symbol]
      });
      
      if (checkResult[0].count > 0) {
        // Update existing record
        const updateRefSql = `
          UPDATE reference_prices
          SET last_transaction_price = ?,
              next_buy_price = ?,
              next_sell_price = ?
          WHERE symbol = ?
        `;
        
        await conn.query({
          sql: updateRefSql,
          values: [price, nextBuyPrice, nextSellPrice, symbol]
        });
      } else {
        // Create new record with appropriate values
        const insertRefSql = `
          INSERT INTO reference_prices
          (symbol, last_transaction_price, next_buy_price, next_sell_price)
          VALUES (?, ?, ?, ?)
        `;
        
        await conn.query({
          sql: insertRefSql,
          values: [symbol, price, nextBuyPrice, nextSellPrice]
        });
      }
      
      // Verify the update was successful before committing
      const verifySql = `
        SELECT symbol, last_transaction_price, next_buy_price, next_sell_price
        FROM reference_prices
        WHERE symbol = ?
      `;
      
      const verifyResult = await conn.query({
        sql: verifySql,
        values: [symbol]
      });
      
      // Verify the values match what we expect
      if (verifyResult.length === 0) {
        throw new Error(`Failed to verify reference price update for ${symbol}`);
      }
      
      const savedValues = verifyResult[0];
      const savedNextBuyPrice = parseFloat(savedValues.next_buy_price);
      const savedNextSellPrice = parseFloat(savedValues.next_sell_price);
      
      // Validate that the values match what we intended to set
      if (Math.abs(savedNextBuyPrice - nextBuyPrice) > 0.0001 || 
          (action === 'buy' && Math.abs(savedNextSellPrice - nextSellPrice) > 0.0001)) {
        console.error(`Verification failed! Expected buy=${nextBuyPrice}, sell=${nextSellPrice} but got buy=${savedNextBuyPrice}, sell=${savedNextSellPrice}`);
        
        // Attempt to fix the values with a direct update
        await conn.query({
          sql: `UPDATE reference_prices SET next_buy_price = ?, next_sell_price = ? WHERE symbol = ?`,
          values: [nextBuyPrice, nextSellPrice, symbol]
        });
        
        // Re-verify after the fix
        const reVerifyResult = await conn.query({
          sql: verifySql,
          values: [symbol]
        });
        
        if (reVerifyResult.length > 0) {
          console.log(`Verified prices for ${symbol}: Buy=${reVerifyResult[0].next_buy_price}, Sell=${reVerifyResult[0].next_sell_price}`);
        }
      } else {
        console.log(`Verified prices for ${symbol}: Buy=${savedNextBuyPrice}, Sell=${savedNextSellPrice}`);
      }
      
      // Commit the transaction
      await conn.commit();
      
      console.log(`Trade record inserted: ${symbol} ${action} at ${price}`);
      console.log(`Reference prices updated for ${symbol}: last_transaction_price=${price}, next_buy_price=${nextBuyPrice}, next_sell_price=${nextSellPrice}`);
      
      // Emit event to notify threshold update - ONLY after successful verification
      const thresholdData = {
        symbol,
        lastTransactionPrice: price,
        nextBuyPrice,
        nextSellPrice
      };
      
      // If global EventEmitter is available, emit event
      if (global.events && typeof global.events.emit === 'function') {
        global.events.emit('reference_price_updated', thresholdData);
      }
      
      // Return both the insert ID and the threshold data for downstream use
      return {
        insertId: result.insertId,
        thresholds: thresholdData
      };
    } catch (txError) {
      // Rollback on error
      await conn.rollback();
      console.error('Transaction error in recordTrade:', txError);
      throw txError;
    } finally {
      // Release the connection
      conn.release();
    }
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
 * Get or create reference prices for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @returns {Promise<Object>} The reference prices
 */
async function getReferencePrice(symbol) {
  try {
    const sql = `
      SELECT symbol, last_transaction_price, 
             next_buy_price, next_sell_price, updated_at
      FROM reference_prices
      WHERE symbol = ?
    `;
    
    const result = await query(sql, [symbol]);
    
    if (result.length === 0) {
      // If no reference prices exist, create a new entry with ON DUPLICATE KEY UPDATE
      const insertSql = `
        INSERT INTO reference_prices 
        (symbol, last_transaction_price, next_buy_price, next_sell_price)
        VALUES (?, 0, 0, 0)
        ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
      `;
      
      await query(insertSql, [symbol]);
      
      // Query again to get the record (whether it was inserted or already existed)
      const result = await query(sql, [symbol]);
      
      if (result.length > 0) {
        return {
          symbol,
          lastTransactionPrice: parseFloat(result[0].last_transaction_price),
          nextBuyPrice: parseFloat(result[0].next_buy_price),
          nextSellPrice: parseFloat(result[0].next_sell_price),
          updatedAt: result[0].updated_at
        };
      }
      
      // If still no results (unlikely), return default values
      return {
        symbol,
        lastTransactionPrice: 0,
        nextBuyPrice: 0,
        nextSellPrice: 0
      };
    }
    
    // Return the reference prices
    return {
      symbol,
      lastTransactionPrice: parseFloat(result[0].last_transaction_price),
      nextBuyPrice: parseFloat(result[0].next_buy_price),
      nextSellPrice: parseFloat(result[0].next_sell_price),
      updatedAt: result[0].updated_at
    };
  } catch (error) {
    console.error(`Error getting reference price for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Update reference prices for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @param {Object} priceData - The price data to update
 * @returns {Promise<boolean>} Success status
 */
/**
 * Update reference prices for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @param {Object} priceData - The price data to update
 * @param {boolean} priceData.forceUpdate - Optional flag to force update using higher priority
 * @returns {Promise<boolean>} Success status
 */
async function updateReferencePrice(symbol, priceData) {
  try {
    if (!symbol) {
      throw new Error('No symbol provided');
    }
    
    // If this is a forced update for critical trade operations, log it
    if (priceData.forceUpdate) {
      console.log(`[CRITICAL] Forcing reference price update for ${symbol} to prevent duplicate trades`);
    }
    
    const fields = [];
    const values = [];
    
    // Build the update fields dynamically
    if (priceData.lastTransactionPrice !== undefined) {
      fields.push('last_transaction_price = ?');
      values.push(priceData.lastTransactionPrice);
    }
    
    if (priceData.nextBuyPrice !== undefined) {
      fields.push('next_buy_price = ?');
      values.push(priceData.nextBuyPrice);
    }
    
    if (priceData.nextSellPrice !== undefined) {
      fields.push('next_sell_price = ?');
      values.push(priceData.nextSellPrice);
    }
    
    // Always update the timestamp to ensure the query always modifies the row
    fields.push('updated_at = NOW()');
    
    // If no fields to update, return success
    if (fields.length === 0) {
      return true;
    }
    
    // Add symbol to values
    values.push(symbol);
    
    // Get a dedicated connection for this critical operation
    const conn = await getConnection();
    
    try {
      // Begin transaction for consistency
      await conn.beginTransaction();
      
      // Build and execute the update query
      const sql = `
        UPDATE reference_prices
        SET ${fields.join(', ')}
        WHERE symbol = ?
      `;
      
      const result = await conn.query({
        sql,
        values
      });
      
      // Verify the update was successful
      if (result.affectedRows === 0) {
        // If no rows were affected, the symbol might not exist, so create it
        console.log(`No existing reference price record for ${symbol}, creating new record`);
        
        // Create an insert query with default values
        const insertSql = `
          INSERT INTO reference_prices 
          (symbol, last_transaction_price, next_buy_price, next_sell_price)
          VALUES (?, ?, ?, ?)
        `;
        
        const insertValues = [
          symbol,
          priceData.lastTransactionPrice !== undefined ? priceData.lastTransactionPrice : 0,
          priceData.nextBuyPrice !== undefined ? priceData.nextBuyPrice : 0,
          priceData.nextSellPrice !== undefined ? priceData.nextSellPrice : 0
        ];
        
        await conn.query({
          sql: insertSql,
          values: insertValues
        });
      }
      
      // Extra verification step - read back the values to ensure they were correctly saved
      const verifySql = `
        SELECT symbol, next_buy_price, next_sell_price
        FROM reference_prices
        WHERE symbol = ?
      `;
      
      const verifyResult = await conn.query({
        sql: verifySql,
        values: [symbol]
      });
      
      if (verifyResult.length > 0) {
        const saved = verifyResult[0];
        console.log(`Verified prices for ${symbol}: Buy=${saved.next_buy_price}, Sell=${saved.next_sell_price}`);
      }
      
      // Commit the transaction
      await conn.commit();
      
      console.log(`Reference price updated for ${symbol}`);
      return true;
    } catch (error) {
      // Rollback transaction on error
      await conn.rollback();
      console.error(`Database error updating reference prices for ${symbol}:`, error);
      throw error;
    } finally {
      // Always release the connection
      conn.release();
    }
  } catch (error) {
    console.error(`Error updating reference price for ${symbol}:`, error);
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
    // Get current holdings
    const holdings = await getCurrentHoldings(symbol);
    
    // Get reference prices from database
    const refPrices = await getReferencePrice(symbol);
    
    // Default values for nextBuyPrice and nextSellPrice
    let nextBuyPrice = 0;
    let nextSellPrice = refPrices.nextSellPrice; // Preserve existing sell price if it exists
    
    // If we have a last transaction price, use it to calculate next buy price
    if (refPrices.lastTransactionPrice > 0) {
      nextBuyPrice = refPrices.lastTransactionPrice * (1 - BUY_THRESHOLD_PERCENT); // Based on environment variable
    } else {
      // If no transaction price available, use current price
      nextBuyPrice = currentPrice * (1 - BUY_THRESHOLD_PERCENT);
    }
    
    // Calculate next sell price based on holdings ONLY if it's not already explicitly set to 0
    // A zero nextSellPrice is a valid state after a "sell all" operation and we should preserve it
    if (holdings.quantity > 0 && nextSellPrice !== 0) {
      if (refPrices.lastTransactionPrice > 0) {
        nextSellPrice = refPrices.lastTransactionPrice * (1 + SELL_THRESHOLD_PERCENT); // Based on environment variable
      } else {
        // Fallback to average buy price if no transaction price but we have holdings
        nextSellPrice = holdings.averageBuyPrice * (1 + SELL_THRESHOLD_PERCENT);
      }
    } else if (holdings.quantity <= 0 && nextSellPrice !== 0) {
      // We should only reset nextSellPrice to 0 if we're performing a manual "sell all" operation
      // For coins where we have negative holdings (after a purchase), we should keep the existing sell price
      // Let's check if the holdings are exactly 0 (sold all) or negative (purchased)
      if (holdings.quantity === 0) {
        // If exactly zero holdings, we can set nextSellPrice to 0
        nextSellPrice = 0;
      } else {
        // If negative holdings (after purchase), preserve the existing sell price
        console.log(`Preserving sell price ${nextSellPrice} for ${symbol} with negative holdings ${holdings.quantity}`);
      }
    }
    
    // Log values for debugging
    console.log(`[calculateTradingThresholds] For ${symbol}: Current nextSellPrice=${refPrices.nextSellPrice}, holdings=${holdings.quantity}, calculated nextSellPrice=${nextSellPrice}`);
    
    // Update reference price values in the database, but only update nextSellPrice
    // if it's different from what's already in the database to avoid unnecessary overwrites
    const updateData = {
      nextBuyPrice: nextBuyPrice
    };
    
    // Only include nextSellPrice in update if it changed
    if (nextSellPrice !== refPrices.nextSellPrice) {
      updateData.nextSellPrice = nextSellPrice;
    }
    
    await updateReferencePrice(symbol, updateData);
    
    // Calculate profit/loss percentage
    const profitLossPercentage = holdings.averageBuyPrice > 0 
      ? ((currentPrice - holdings.averageBuyPrice) / holdings.averageBuyPrice) * 100
      : 0;
    
    return {
      symbol,
      nextBuyPrice,
      nextSellPrice,
      holdingsQuantity: holdings.quantity,
      profitLossPercentage,
      // Include reference prices for debugging
      lastTransactionPrice: refPrices.lastTransactionPrice
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
 * Update account balances in the database
 * @param {Object} balances - The account balances { symbol: amount }
 * @returns {Promise<boolean>} Success status
 */
async function updateAccountBalances(balances) {
  if (!balances) {
    throw new Error('No balance data provided');
  }

  // First check if the account_balances table exists, create it if not
  try {
    const checkTableSql = `
      CREATE TABLE IF NOT EXISTS account_balances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL UNIQUE,
        balance DECIMAL(18, 8) NOT NULL DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_symbol (symbol)
      )
    `;
    
    await query(checkTableSql);
    
    // Insert or update balances for each symbol
    for (const [symbol, balance] of Object.entries(balances)) {
      const upsertSql = `
        INSERT INTO account_balances (symbol, balance, last_updated)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          balance = VALUES(balance),
          last_updated = NOW()
      `;
      
      await query(upsertSql, [symbol, balance]);
    }
    
    console.log('Account balances updated in database');
    return true;
  } catch (error) {
    console.error('Error updating account balances in database:', error);
    throw error;
  }
}

/**
 * Get current account balances from the database
 * @returns {Promise<Object>} The account balances { symbol: amount }
 */
async function getAccountBalances() {
  try {
    // Check if the table exists first
    const checkTableSql = `
      CREATE TABLE IF NOT EXISTS account_balances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        symbol VARCHAR(20) NOT NULL UNIQUE,
        balance DECIMAL(18, 8) NOT NULL DEFAULT 0,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_symbol (symbol)
      )
    `;
    
    await query(checkTableSql);
    
    // Get all balances
    const sql = `
      SELECT symbol, balance
      FROM account_balances
    `;
    
    const result = await query(sql);
    
    // Convert to object
    const balances = {};
    for (const row of result) {
      balances[row.symbol] = parseFloat(row.balance);
    }
    
    return balances;
  } catch (error) {
    console.error('Error getting account balances from database:', error);
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

/**
 * Save app settings to the database
 * @param {Object} settings - The settings to save
 * @returns {Promise<boolean>} Success status
 */
async function saveAppSettings(settings) {
  try {
    // First check if the app_settings table exists, create it if not
    const checkTableSql = `
      CREATE TABLE IF NOT EXISTS app_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(50) NOT NULL UNIQUE,
        setting_value TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_key (setting_key)
      )
    `;
    
    await query(checkTableSql);
    
    // Insert or update settings
    for (const [key, value] of Object.entries(settings)) {
      const upsertSql = `
        INSERT INTO app_settings (setting_key, setting_value, last_updated)
        VALUES (?, ?, NOW())
        ON DUPLICATE KEY UPDATE
          setting_value = VALUES(setting_value),
          last_updated = NOW()
      `;
      
      await query(upsertSql, [key, JSON.stringify(value)]);
    }
    
    console.log('App settings saved to database');
    return true;
  } catch (error) {
    console.error('Error saving app settings to database:', error);
    throw error;
  }
}

/**
 * Get app settings from the database
 * @param {string} key - The setting key to retrieve (optional, if not provided returns all settings)
 * @returns {Promise<Object|any>} The settings or specific setting value
 */
async function getAppSettings(key = null) {
  try {
    // Check if the table exists first
    const checkTableSql = `
      CREATE TABLE IF NOT EXISTS app_settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(50) NOT NULL UNIQUE,
        setting_value TEXT,
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_key (setting_key)
      )
    `;
    
    await query(checkTableSql);
    
    let sql, params;
    
    // Get specific setting or all settings
    if (key) {
      sql = `
        SELECT setting_key, setting_value
        FROM app_settings
        WHERE setting_key = ?
      `;
      params = [key];
    } else {
      sql = `
        SELECT setting_key, setting_value
        FROM app_settings
      `;
      params = [];
    }
    
    const result = await query(sql, params);
    
    if (key) {
      // Return the specific setting value or null if not found
      if (result.length > 0) {
        try {
          return JSON.parse(result[0].setting_value);
        } catch (e) {
          return result[0].setting_value;
        }
      }
      return null;
    } else {
      // Convert to object and parse JSON values
      const settings = {};
      for (const row of result) {
        try {
          settings[row.setting_key] = JSON.parse(row.setting_value);
        } catch (e) {
          settings[row.setting_key] = row.setting_value;
        }
      }
      return settings;
    }
  } catch (error) {
    console.error('Error getting app settings from database:', error);
    return key ? null : {};
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
  updateAccountBalances,
  getAccountBalances,
  getReferencePrice,
  updateReferencePrice,
  saveAppSettings,
  getAppSettings,
  close
};