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
  connectionLimit: 20,       // Increased from 10 to 20 to handle high concurrency
  acquireTimeout: 30000,     // Longer timeout for acquiring connections (30s)
  connectTimeout: 20000,     // Longer connection timeout (20s)
  idleTimeout: 60000,        // How long connections can remain idle (60s)
  maxIdle: 10,               // Increased from 5 to 10 idle connections to keep in pool
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
 * @returns {Promise<Object>} The inserted record ID and updated thresholds
 */
async function recordTrade(tradeData) {
  if (!tradeData) {
    throw new Error('No trade data provided');
  }

  const { symbol, action, quantity, price, usdt_amount, isManualSellAll } = tradeData;
  
  try {
    // Start a transaction with a higher isolation level to prevent interference
    let conn = null;
    try {
      conn = await getConnection();
      
      // Use SERIALIZABLE to ensure transaction isolation
      await conn.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
      await conn.beginTransaction();
      
      // Insert trade record with support for original Binance trade time and ID
      const sql = `
        INSERT INTO trades (symbol, action, quantity, price, usdt_amount, trade_time, binance_trade_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      
      // Use trade_time from tradeData if provided, otherwise use current time
      const tradeTime = tradeData.trade_time ? new Date(tradeData.trade_time) : new Date();
      const binanceTradeId = tradeData.binance_trade_id || null;
      
      const result = await conn.query({
        sql,
        values: [symbol, action, quantity, price, usdt_amount, tradeTime, binanceTradeId]
      });
      
      // Get current reference prices
      const refPricesSql = `
        SELECT symbol, first_transaction_price, last_transaction_price
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
      
      // Handle different scenarios based on action type
      if (action === 'buy') {
        // Check if this is the first buy operation by looking at the existing data
        // IMPORTANT: A buy is treated as a "first buy" in these cases:
        // 1. It's the very first buy for this symbol, or
        // 2. It's the first buy after a "sell all" operation (first_transaction_price is reset to 0 on sell)
        // 3. It's the first manually initiated buy (historical trades should not update reference prices at first run)
        let isFirstBuy = false;
        
        if (refResult.length === 0) {
          // No existing record, this is definitely the first buy
          isFirstBuy = true;
        } else {
          // Check if first_transaction_price is 0, indicating first buy or buy after sell all
          const firstTransactionPrice = parseFloat(refResult[0].first_transaction_price || '0');
          isFirstBuy = (firstTransactionPrice === 0);
        }
        
        // Calculate next buy price based on last_transaction_price (current price)
        // Per requirement 3.2: next_buy_price must use last_transaction_price as reference
        nextBuyPrice = price * (1 - BUY_THRESHOLD_PERCENT);
        updateFields.push('next_buy_price = ?');
        updateValues.push(nextBuyPrice);
        console.log(`BUY: Setting next buy price for ${symbol} to ${nextBuyPrice} (${BUY_THRESHOLD_PERCENT * 100}% below last transaction price: ${price})`);
        
        // Only update first_transaction_price and next_sell_price if this is the first buy
        if (isFirstBuy) {
          // Set first_transaction_price to the current transaction price
          // Per requirement 2.1: When Buy button is clicked, its price is added to DB as first_transaction_price
          updateFields.push('first_transaction_price = ?');
          updateValues.push(price);
          console.log(`FIRST BUY: Setting first transaction price for ${symbol} to ${price}`);
          
          // Calculate next sell price based on first_transaction_price
          // Per requirement 2.1: next_sell_price must use first_transaction_price as reference
          nextSellPrice = price * (1 + SELL_THRESHOLD_PERCENT);
          updateFields.push('next_sell_price = ?');
          updateValues.push(nextSellPrice);
          console.log(`FIRST BUY: Setting next sell price for ${symbol} to ${nextSellPrice} (${SELL_THRESHOLD_PERCENT * 100}% above first transaction price: ${price})`);
        } else {
          console.log(`SUBSEQUENT BUY: Not changing first_transaction_price or next_sell_price for ${symbol} to preserve profit targets`);
        }
      } 
      else if (action === 'sell') {
        // If this is a sell operation (For requirement 2.2)
        
        // Calculate next buy price based on current sell price (last_transaction_price)
        nextBuyPrice = price * (1 - BUY_THRESHOLD_PERCENT);
        updateFields.push('next_buy_price = ?');
        updateValues.push(nextBuyPrice);
        
        // For ALL sell operations, set next_sell_price to 0
        // This implements requirement 2.2 and 3.3
        nextSellPrice = 0;
        updateFields.push('next_sell_price = ?');
        updateValues.push(nextSellPrice);
        console.log(`SELL OPERATION: Setting next sell price for ${symbol} to 0`);
        
        // IMPORTANT: Reset first_transaction_price to 0 for ALL sell operations
        // This ensures the next buy after a sell will be treated as a "first buy"
        // allowing it to set new next_sell_price and first_transaction_price values
        // Per updated requirements 2.2 and 3.3
        updateFields.push('first_transaction_price = ?');
        updateValues.push(0);
        console.log(`SELL OPERATION: Setting first transaction price for ${symbol} to 0 (next buy will be treated as first buy)`);
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
        // Build dynamic SQL update statement
        const setClause = updateFields.join(', ');
        const updateRefSql = `
          UPDATE reference_prices
          SET ${setClause}
          WHERE symbol = ?
        `;
        
        // Add symbol to the values array
        updateValues.push(symbol);
        
        await conn.query({
          sql: updateRefSql,
          values: updateValues
        });
      } else {
        // Create new record with appropriate values
        const insertRefSql = `
          INSERT INTO reference_prices
          (symbol, first_transaction_price, last_transaction_price, next_buy_price, next_sell_price)
          VALUES (?, ?, ?, ?, ?)
        `;
        
        // Determine first_transaction_price
        let firstTransactionPrice = 0; // Default value
        if (action === 'buy') {
          // For ANY buy operation, set first_transaction_price to current price
          firstTransactionPrice = price;
        }
        
        await conn.query({
          sql: insertRefSql,
          values: [symbol, firstTransactionPrice, price, nextBuyPrice, nextSellPrice]
        });
      }
      
      // Verify the update was successful before committing
      const verifySql = `
        SELECT symbol, first_transaction_price, last_transaction_price, next_buy_price, next_sell_price
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
      const savedFirstPrice = parseFloat(savedValues.first_transaction_price);
      
      // Validate that the values match what we intended to set
      if (Math.abs(savedNextBuyPrice - nextBuyPrice) > 0.0001 || 
          Math.abs(savedNextSellPrice - nextSellPrice) > 0.0001 ||
          (action === 'buy' && Math.abs(parseFloat(savedValues.first_transaction_price) - price) > 0.0001)) {
        console.error(`Verification failed! Expected buy=${nextBuyPrice}, sell=${nextSellPrice}, first=${price} but got buy=${savedNextBuyPrice}, sell=${savedNextSellPrice}, first=${savedValues.first_transaction_price}`);
        
        // Attempt to fix the values with a direct update - include first_transaction_price for buy operations
        if (action === 'buy') {
          // For buy operations, ONLY update the next_sell_price if this is the first buy
          // (first_transaction_price is 0 or this is a new entry)
          if (savedFirstPrice === 0) {
            // First buy - update all values including next_sell_price
            await conn.query({
              sql: `UPDATE reference_prices SET first_transaction_price = ?, next_buy_price = ?, next_sell_price = ? WHERE symbol = ?`,
              values: [price, nextBuyPrice, nextSellPrice, symbol]
            });
          } else {
            // Subsequent buy - preserve existing next_sell_price
            await conn.query({
              sql: `UPDATE reference_prices SET first_transaction_price = ?, next_buy_price = ? WHERE symbol = ?`,
              values: [savedFirstPrice, nextBuyPrice, symbol]
            });
          }
        } else {
          await conn.query({
            sql: `UPDATE reference_prices SET next_buy_price = ?, next_sell_price = ? WHERE symbol = ?`,
            values: [nextBuyPrice, nextSellPrice, symbol]
          });
        }
        
        // Re-verify after the fix
        const reVerifyResult = await conn.query({
          sql: verifySql,
          values: [symbol]
        });
        
        if (reVerifyResult.length > 0) {
          console.log(`Verified prices for ${symbol}: First=${reVerifyResult[0].first_transaction_price}, Last=${reVerifyResult[0].last_transaction_price}, Buy=${reVerifyResult[0].next_buy_price}, Sell=${reVerifyResult[0].next_sell_price}`);
        }
      } else {
        console.log(`Verified prices for ${symbol}: First=${savedFirstPrice}, Last=${price}, Buy=${savedNextBuyPrice}, Sell=${savedNextSellPrice}`);
      }
      
      // Commit the transaction
      await conn.commit();
      
      console.log(`Trade record inserted: ${symbol} ${action} at ${price}`);
      console.log(`Reference prices updated for ${symbol}: first_transaction_price=${savedFirstPrice}, last_transaction_price=${price}, next_buy_price=${nextBuyPrice}, next_sell_price=${nextSellPrice}`);
      
      // Emit event to notify threshold update - ONLY after successful verification
      const thresholdData = {
        symbol,
        firstTransactionPrice: savedFirstPrice,
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
      if (conn) {
        try {
          await conn.rollback();
        } catch (rollbackError) {
          console.error('Error during rollback in recordTrade:', rollbackError);
        }
      }
      console.error('Transaction error in recordTrade:', txError);
      throw txError;
    } finally {
      // Release the connection if it exists
      if (conn) {
        try {
          conn.release();
        } catch (releaseError) {
          console.error('Error releasing connection in recordTrade:', releaseError);
        }
      }
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
      SELECT id, symbol, action, quantity, price, usdt_amount, trade_time, binance_trade_id
      FROM trades
      WHERE symbol = ?
      ORDER BY trade_time DESC
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
    // Get current balance from account_balances table
    const balanceSql = `
      SELECT balance
      FROM account_balances
      WHERE symbol = ?
    `;
    
    // Get all buy transactions for average price calculation
    const buySql = `
      SELECT SUM(quantity) as total_bought, SUM(usdt_amount) as total_spent
      FROM trades
      WHERE symbol = ? AND action = 'buy'
    `;
    
    // Get all sell transactions for profit calculation
    const sellSql = `
      SELECT SUM(quantity) as total_sold, SUM(usdt_amount) as total_received
      FROM trades
      WHERE symbol = ? AND action = 'sell'
    `;
    
    // Run all three queries
    const [balanceResult, buyResult, sellResult] = await Promise.all([
      query(balanceSql, [symbol]),
      query(buySql, [symbol]),
      query(sellSql, [symbol])
    ]);
    
    // Get current balance from database - this is the source of truth
    const currentQuantity = balanceResult.length > 0 ? parseFloat(balanceResult[0].balance) || 0 : 0;
    
    // Get trading data for calculations
    const totalBought = buyResult[0].total_bought || 0;
    const totalSpent = buyResult[0].total_spent || 0;
    const totalSold = sellResult[0].total_sold || 0;
    const totalReceived = sellResult[0].total_received || 0;
    
    // Calculate average buy price (useful for profit calculation)
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
      SELECT symbol, first_transaction_price, last_transaction_price, 
             next_buy_price, next_sell_price, updated_at
      FROM reference_prices
      WHERE symbol = ?
    `;
    
    const result = await query(sql, [symbol]);
    
    if (result.length === 0) {
      // If no reference prices exist, create a new entry with explicit zero values
      // This ensures we follow requirement 1.3 - set all values to 0 for new symbols
      console.log(`Creating new reference price record for ${symbol} with all values set to 0`);
      
      const insertSql = `
        INSERT INTO reference_prices 
        (symbol, first_transaction_price, last_transaction_price, next_buy_price, next_sell_price)
        VALUES (?, 0, 0, 0, 0)
        ON DUPLICATE KEY UPDATE 
          first_transaction_price = 0,
          last_transaction_price = 0,
          next_buy_price = 0,
          next_sell_price = 0,
          updated_at = CURRENT_TIMESTAMP
      `;
      
      await query(insertSql, [symbol]);
      
      // Query again to get the record (whether it was inserted or already existed)
      const result = await query(sql, [symbol]);
      
      if (result.length > 0) {
        return {
          symbol,
          firstTransactionPrice: parseFloat(result[0].first_transaction_price),
          lastTransactionPrice: parseFloat(result[0].last_transaction_price),
          nextBuyPrice: parseFloat(result[0].next_buy_price),
          nextSellPrice: parseFloat(result[0].next_sell_price),
          updatedAt: result[0].updated_at
        };
      }
      
      // If still no results (unlikely), return default values
      return {
        symbol,
        firstTransactionPrice: 0,
        lastTransactionPrice: 0,
        nextBuyPrice: 0,
        nextSellPrice: 0
      };
    }
    
    // Return the reference prices
    return {
      symbol,
      firstTransactionPrice: parseFloat(result[0].first_transaction_price),
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
 * Get all reference prices in a single query
 * @returns {Promise<Object>} Map of reference prices by symbol
 */
async function getAllReferencePrices() {
  try {
    const sql = `
      SELECT symbol, first_transaction_price, last_transaction_price, 
             next_buy_price, next_sell_price, updated_at
      FROM reference_prices
    `;
    
    const result = await query(sql);
    
    // Convert to a map of reference prices by symbol
    const refPricesMap = {};
    for (const row of result) {
      refPricesMap[row.symbol] = {
        symbol: row.symbol,
        firstTransactionPrice: parseFloat(row.first_transaction_price),
        lastTransactionPrice: parseFloat(row.last_transaction_price),
        nextBuyPrice: parseFloat(row.next_buy_price),
        nextSellPrice: parseFloat(row.next_sell_price),
        updatedAt: row.updated_at
      };
    }
    
    return refPricesMap;
  } catch (error) {
    console.error('Error getting all reference prices:', error);
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
    if (priceData.firstTransactionPrice !== undefined) {
      fields.push('first_transaction_price = ?');
      values.push(priceData.firstTransactionPrice);
    }
    
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
    let conn = null;
    try {
      conn = await getConnection();
      
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
          (symbol, first_transaction_price, last_transaction_price, next_buy_price, next_sell_price)
          VALUES (?, ?, ?, ?, ?)
        `;
        
        const insertValues = [
          symbol,
          priceData.firstTransactionPrice !== undefined ? priceData.firstTransactionPrice : 0,
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
        SELECT symbol, first_transaction_price, last_transaction_price, next_buy_price, next_sell_price
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
      if (conn) {
        try {
          await conn.rollback();
        } catch (rollbackError) {
          console.error(`Rollback error for ${symbol}:`, rollbackError);
        }
      }
      console.error(`Database error updating reference prices for ${symbol}:`, error);
      throw error;
    } finally {
      // Always release the connection if it exists
      if (conn) {
        try {
          conn.release();
        } catch (releaseError) {
          console.error(`Error releasing connection for ${symbol}:`, releaseError);
        }
      }
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
    // Get balances and holdings info in parallel
    const [accountBalances, holdings, refPrices] = await Promise.all([
      getAccountBalances(),
      getCurrentHoldings(symbol),
      getReferencePrice(symbol)
    ]);
    
    // Get current balance from account_balances (source of truth)
    const currentBalance = accountBalances[symbol] || 0;
    
    // Default values for nextBuyPrice and nextSellPrice
    let nextBuyPrice = 0;
    let nextSellPrice = refPrices.nextSellPrice; // Always preserve existing sell price
    
    // If we have a last transaction price, use it to calculate next buy price
    // This implements requirement 3.2 - buy order based on next_buy_price
    if (refPrices.lastTransactionPrice > 0) {
      nextBuyPrice = refPrices.lastTransactionPrice * (1 - BUY_THRESHOLD_PERCENT);
    } else {
      // If no transaction price available, use current price
      nextBuyPrice = currentPrice * (1 - BUY_THRESHOLD_PERCENT);
    }
    
    // Handle next sell price calculation according to requirements
    // Per requirement 3.2: The next_sell_price can not be modified after first buy
    // Only update sell price if:
    // 1. We have holdings AND
    // 2. first_transaction_price is 0 (no first transaction recorded yet) AND
    // 3. Current price is valid
    if (currentBalance > 0 && refPrices.firstTransactionPrice === 0 && currentPrice > 0) {
      // Only for first buy - calculate sell price based on current price
      nextSellPrice = currentPrice * (1 + SELL_THRESHOLD_PERCENT);
      console.log(`[THRESHOLD] Setting initial sell price for ${symbol} based on current price: ${currentPrice} -> ${nextSellPrice}`);
    } else if (currentBalance <= 0) {
      // If balance is 0 or negative, set nextSellPrice to 0 as per requirements
      // This implements the behavior after a sell operation
      nextSellPrice = 0;
      console.log(`[THRESHOLD] Setting sell price to 0 for ${symbol} (no holdings)`);
    } else {
      // If we already have holdings and first_transaction_price is set,
      // don't modify the next_sell_price - keep existing value
      console.log(`[THRESHOLD] Preserving existing sell price for ${symbol}: ${nextSellPrice}`);
    }
    
    // Log values for debugging
    console.log(`[calculateTradingThresholds] For ${symbol}: Current nextSellPrice=${refPrices.nextSellPrice}, balance=${currentBalance}, calculated nextSellPrice=${nextSellPrice}`);
    
    // Update reference price values in the database
    const updateData = {
      nextBuyPrice: nextBuyPrice
    };
    
    // Only include nextSellPrice in the update if:
    // 1. We're setting it to 0 (after a sell), OR
    // 2. We're setting the initial value (first_transaction_price is 0)
    if (nextSellPrice === 0 || refPrices.firstTransactionPrice === 0) {
      updateData.nextSellPrice = nextSellPrice;
      
      // CRITICAL FIX: If we're setting nextSellPrice to 0 (which happens after a sell),
      // we MUST also reset firstTransactionPrice to 0 to maintain consistency
      if (nextSellPrice === 0 && currentBalance <= 0) {
        console.log(`[CONSISTENCY FIX] Also resetting firstTransactionPrice to 0 for ${symbol} after a sell operation`);
        updateData.firstTransactionPrice = 0;
      }
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
      holdingsQuantity: currentBalance, // Use account_balances as source of truth
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
    // Get symbols from account_balances and trades together
    const sql = `
      SELECT DISTINCT symbol
      FROM (
        SELECT symbol FROM trades
        UNION
        SELECT symbol FROM account_balances
      ) as combined_symbols
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

  try {
    // Use the table definition from schema.sql - no need to check if it exists
    // as the table is now part of our core schema
    
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

/**
 * Convert BigInt values to numbers for JSON serialization
 * @param {any} data - The data to convert
 * @returns {any} The converted data
 */
function convertBigIntToNumber(data) {
  // Handle null/undefined
  if (data == null) return data;
  
  // Handle BigInt directly
  if (typeof data === 'bigint') return Number(data);
  
  // Handle arrays
  if (Array.isArray(data)) {
    return data.map(item => convertBigIntToNumber(item));
  }
  
  // Handle objects (but not dates or other special objects)
  if (typeof data === 'object' && !(data instanceof Date) && data.constructor === Object) {
    const newObj = {};
    for (const key in data) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        newObj[key] = convertBigIntToNumber(data[key]);
      }
    }
    return newObj;
  }
  
  // Return primitive values and other objects as is
  return data;
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
  getAllReferencePrices, // Added new function
  updateReferencePrice,
  saveAppSettings,
  getAppSettings,
  query,  // Export the query function for direct database access when needed
  getConnection, // Export the getConnection function needed for direct DB operations
  convertBigIntToNumber, // Export the BigInt converter
  close
};