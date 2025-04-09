// backend/js/dbconns.js
// Database Connections Module
// Responsible for managing database interactions and persisting trading data

const mariadb = require('mariadb');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: require('path').resolve(__dirname, '../../.env') });

// Database connection configuration with better defaults and connection handling
const dbConfig = {
  host: process.env.DB_HOST || 'database',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'trading_bot_user',
  password: process.env.DB_PASSWORD || 'mariadb_secret',
  database: process.env.DB_NAME || 'crypto_trading_bot',
  connectionLimit: 10,
  acquireTimeout: 30000,     // Longer timeout for acquiring connections (30s)
  connectTimeout: 20000,     // Longer connection timeout (20s)
  idleTimeout: 60000,        // How long connections can remain idle (60s)
  maxIdle: 5,                // Max idle connections to keep in pool
  trace: process.env.NODE_ENV !== 'production', // Stack trace for debugging in non-production
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

  const { symbol, action, quantity, price, usdt_amount } = tradeData;
  
  try {
    // Start a transaction
    const conn = await getConnection();
    
    try {
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
        SELECT symbol, initial_purchase_price, last_purchase_price, last_sell_price
        FROM reference_prices
        WHERE symbol = ?
      `;
      
      const refResult = await conn.query({
        sql: refPricesSql,
        values: [symbol]
      });
      
      // Process reference prices
      const updateFields = [];
      const updateValues = [];
      
      if (action === 'buy') {
        // Update last purchase price for any buy
        updateFields.push('last_purchase_price = ?');
        updateValues.push(price);
        
        // Get existing trades for this symbol
        const existingTradesSql = `
          SELECT COUNT(*) as trade_count
          FROM trades
          WHERE symbol = ?
        `;
        
        const tradesResult = await conn.query({
          sql: existingTradesSql,
          values: [symbol]
        });
        
        // If this is the first buy ever or first buy after a sell that liquidated all holdings,
        // update initial purchase price
        const currentHoldings = await getCurrentHoldings(symbol);
        const isFirstBuyAfterLiquidation = currentHoldings.quantity <= quantity;
        
        if (tradesResult[0].trade_count <= 1 || isFirstBuyAfterLiquidation) {
          updateFields.push('initial_purchase_price = ?');
          updateValues.push(price);
          console.log(`Setting initial purchase price for ${symbol} to ${price}`);
        }
      } else if (action === 'sell') {
        // Update last sell price for any sell
        updateFields.push('last_sell_price = ?');
        updateValues.push(price);
      }
      
      // Update next buy/sell thresholds based on the updated reference prices
      let nextBuyThreshold = 0;
      let nextSellThreshold = 0;
      
      // Calculate next buy threshold (5% below last transaction price)
      nextBuyThreshold = price * 0.95;
      updateFields.push('next_buy_threshold = ?');
      updateValues.push(nextBuyThreshold);
      
      // For next sell threshold, we need the initial purchase price
      if (refResult.length > 0) {
        // If this is a buy that updated the initial purchase price, use that
        const initialPrice = (action === 'buy' && updateFields.includes('initial_purchase_price = ?')) 
          ? price 
          : parseFloat(refResult[0].initial_purchase_price);
        
        if (initialPrice > 0) {
          nextSellThreshold = initialPrice * 1.05;
          updateFields.push('next_sell_threshold = ?');
          updateValues.push(nextSellThreshold);
        }
      }
      
      // If we have fields to update
      if (updateFields.length > 0) {
        // Add symbol to values
        updateValues.push(symbol);
        
        // Update reference prices
        const updateRefSql = `
          UPDATE reference_prices
          SET ${updateFields.join(', ')}
          WHERE symbol = ?
        `;
        
        // Insert if not exists
        const upsertRefSql = `
          INSERT INTO reference_prices 
          (symbol, ${action === 'buy' ? 'last_purchase_price' : 'last_sell_price'}, 
           ${action === 'buy' && updateFields.includes('initial_purchase_price = ?') ? 'initial_purchase_price' : ''}, 
           next_buy_threshold, 
           ${nextSellThreshold > 0 ? 'next_sell_threshold' : ''})
          VALUES (?, ?, ${action === 'buy' && updateFields.includes('initial_purchase_price = ?') ? '?,' : ''} 
                  ?, ${nextSellThreshold > 0 ? '?' : ''})
          ON DUPLICATE KEY UPDATE ${updateFields.join(', ')}
        `;
        
        const upsertValues = [
          symbol, 
          price, 
          ...(action === 'buy' && updateFields.includes('initial_purchase_price = ?') ? [price] : []), 
          nextBuyThreshold,
          ...(nextSellThreshold > 0 ? [nextSellThreshold] : []),
          ...updateValues
        ];
        
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
          await conn.query({
            sql: updateRefSql,
            values: updateValues
          });
        } else {
          // Create new record with appropriate values
          const insertValues = [
            symbol,
            ...(action === 'buy' ? [price, price] : [0, 0]),
            ...(action === 'sell' ? [price] : [0]),
            nextBuyThreshold,
            nextSellThreshold
          ];
          
          const insertRefSql = `
            INSERT INTO reference_prices
            (symbol, initial_purchase_price, last_purchase_price, last_sell_price, next_buy_threshold, next_sell_threshold)
            VALUES (?, ?, ?, ?, ?, ?)
          `;
          
          await conn.query({
            sql: insertRefSql,
            values: insertValues
          });
        }
      }
      
      // Commit the transaction
      await conn.commit();
      
      console.log(`Trade record inserted: ${symbol} ${action} at ${price}`);
      console.log(`Reference prices updated for ${symbol}`);
      
      return result.insertId;
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
      SELECT symbol, initial_purchase_price, last_purchase_price, last_sell_price, 
             next_buy_threshold, next_sell_threshold, updated_at
      FROM reference_prices
      WHERE symbol = ?
    `;
    
    const result = await query(sql, [symbol]);
    
    if (result.length === 0) {
      // If no reference prices exist, create a new entry with ON DUPLICATE KEY UPDATE
      const insertSql = `
        INSERT INTO reference_prices 
        (symbol, initial_purchase_price, last_purchase_price, last_sell_price, 
         next_buy_threshold, next_sell_threshold)
        VALUES (?, 0, 0, 0, 0, 0)
        ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
      `;
      
      await query(insertSql, [symbol]);
      
      // Query again to get the record (whether it was inserted or already existed)
      const result = await query(sql, [symbol]);
      
      if (result.length > 0) {
        return {
          symbol,
          initialPurchasePrice: parseFloat(result[0].initial_purchase_price),
          lastPurchasePrice: parseFloat(result[0].last_purchase_price),
          lastSellPrice: parseFloat(result[0].last_sell_price),
          nextBuyThreshold: parseFloat(result[0].next_buy_threshold),
          nextSellThreshold: parseFloat(result[0].next_sell_threshold),
          updatedAt: result[0].updated_at
        };
      }
      
      // If still no results (unlikely), return default values
      return {
        symbol,
        initialPurchasePrice: 0,
        lastPurchasePrice: 0,
        lastSellPrice: 0,
        nextBuyThreshold: 0,
        nextSellThreshold: 0
      };
    }
    
    // Return the reference prices
    return {
      symbol,
      initialPurchasePrice: parseFloat(result[0].initial_purchase_price),
      lastPurchasePrice: parseFloat(result[0].last_purchase_price),
      lastSellPrice: parseFloat(result[0].last_sell_price),
      nextBuyThreshold: parseFloat(result[0].next_buy_threshold),
      nextSellThreshold: parseFloat(result[0].next_sell_threshold),
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
async function updateReferencePrice(symbol, priceData) {
  try {
    if (!symbol) {
      throw new Error('No symbol provided');
    }
    
    const fields = [];
    const values = [];
    
    // Build the update fields dynamically
    if (priceData.initialPurchasePrice !== undefined) {
      fields.push('initial_purchase_price = ?');
      values.push(priceData.initialPurchasePrice);
    }
    
    if (priceData.lastPurchasePrice !== undefined) {
      fields.push('last_purchase_price = ?');
      values.push(priceData.lastPurchasePrice);
    }
    
    if (priceData.lastSellPrice !== undefined) {
      fields.push('last_sell_price = ?');
      values.push(priceData.lastSellPrice);
    }
    
    if (priceData.nextBuyThreshold !== undefined) {
      fields.push('next_buy_threshold = ?');
      values.push(priceData.nextBuyThreshold);
    }
    
    if (priceData.nextSellThreshold !== undefined) {
      fields.push('next_sell_threshold = ?');
      values.push(priceData.nextSellThreshold);
    }
    
    // If no fields to update, return success
    if (fields.length === 0) {
      return true;
    }
    
    // Add symbol to values
    values.push(symbol);
    
    // Build and execute the update query
    const sql = `
      UPDATE reference_prices
      SET ${fields.join(', ')}
      WHERE symbol = ?
    `;
    
    await query(sql, values);
    
    console.log(`Reference price updated for ${symbol}`);
    return true;
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
    let nextSellPrice = 0;
    
    // If we have a last transaction price (buy or sell), use it to calculate fixed next buy price
    if (refPrices.lastPurchasePrice > 0 || refPrices.lastSellPrice > 0) {
      // Use the most recent transaction price (either buy or sell)
      const lastTransactionPrice = Math.max(refPrices.lastPurchasePrice, refPrices.lastSellPrice);
      nextBuyPrice = lastTransactionPrice * 0.95; // Fixed at 5% below last transaction price
    } else {
      // If no transaction price available, use current price
      nextBuyPrice = currentPrice * 0.95;
    }
    
    // If we have an initial purchase price, calculate fixed next sell price
    if (refPrices.initialPurchasePrice > 0) {
      nextSellPrice = refPrices.initialPurchasePrice * 1.05; // Fixed at 5% above initial purchase price
    } else if (holdings.quantity > 0) {
      // Fallback to average buy price if we have holdings but no initial purchase price
      nextSellPrice = holdings.averageBuyPrice * 1.05;
    } else {
      // No sell threshold if no holdings
      nextSellPrice = 0;
    }
    
    // Update reference price thresholds in the database
    await updateReferencePrice(symbol, {
      nextBuyThreshold: nextBuyPrice,
      nextSellThreshold: nextSellPrice
    });
    
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
      initialPurchasePrice: refPrices.initialPurchasePrice,
      lastTransactionPrice: Math.max(refPrices.lastPurchasePrice, refPrices.lastSellPrice)
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