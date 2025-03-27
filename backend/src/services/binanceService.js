const crypto = require('crypto');
const axios = require('axios');
const querystring = require('querystring');
const db = require('../../config/database');
const logger = require('../utils/logger');
const telegramService = require('./telegramService');

// Environment variables
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const API_URL = process.env.BINANCE_API_URL || 'https://testnet.binance.vision';
const WEBSOCKET_URL = process.env.BINANCE_WEBSOCKET_URL || 'wss://testnet.binance.vision/ws/';
const RECV_WINDOW = process.env.BINANCE_RECV_WINDOW || 5000;
const TEST_MODE = process.env.NODE_ENV !== 'production' || process.env.BINANCE_TEST_MODE === 'true';

// Cache for symbol information
let symbolInfoCache = null;
let symbolInfoCacheTime = 0;
const CACHE_DURATION = 3600000; // 1 hour cache validity

/**
 * Creates a signature for a request using HMAC SHA256
 * @param {string} queryString - The query string to sign
 * @returns {string} - The hexadecimal digest of the HMAC
 */
const createSignature = (queryString) => {
  return crypto
    .createHmac('sha256', API_SECRET)
    .update(queryString)
    .digest('hex');
};

/**
 * Adds timestamp and signature to parameters
 * @param {Object} params - The parameters to sign
 * @returns {Object} - The signed parameters
 */
const signRequest = (params = {}) => {
  // Add timestamp if not present
  const paramsCopy = { ...params };
  if (!paramsCopy.timestamp) {
    paramsCopy.timestamp = Date.now();
  }
  
  // Add recvWindow if not present
  if (!paramsCopy.recvWindow) {
    paramsCopy.recvWindow = RECV_WINDOW;
  }
  
  // Convert params to query string
  const queryString = querystring.stringify(paramsCopy);
  
  // Generate signature
  const signature = createSignature(queryString);
  
  // Add signature to params
  paramsCopy.signature = signature;
  
  return paramsCopy;
};

/**
 * Makes a secure API request to Binance
 * @param {string} method - The HTTP method
 * @param {string} endpoint - The API endpoint
 * @param {Object} params - The request parameters
 * @returns {Promise} - The request promise
 */
const makeRequest = async (method, endpoint, params = {}) => {
  // Skip actual API calls in simulation mode if needed
  if (TEST_MODE && endpoint !== '/api/v3/exchangeInfo' && endpoint !== '/api/v3/ticker/price') {
    logger.debug(`[TEST MODE] Skipping real API call to ${endpoint}`);
    return simulateResponse(endpoint, params);
  }

  // Determine if this is a secure endpoint
  const isSecureEndpoint = 
    endpoint.includes('/api/v3/account') || 
    endpoint.includes('/api/v3/order') ||
    endpoint.includes('/api/v3/myTrades') ||
    endpoint.includes('/api/v3/openOrders');
  
  // For secure endpoints, sign the request
  const requestParams = isSecureEndpoint ? signRequest(params) : params;
  
  // Prepare headers
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  
  // Add API key header for secure endpoints
  if (isSecureEndpoint) {
    headers['X-MBX-APIKEY'] = API_KEY;
  }
  
  try {
    let response;
    const url = `${API_URL}${endpoint}`;
    
    logger.debug(`Making ${method} request to ${endpoint}`, { params: requestParams });
    
    // Make request based on method
    if (method === 'GET') {
      response = await axios.get(url, { 
        params: requestParams,
        headers 
      });
    } else if (method === 'POST') {
      response = await axios.post(url, querystring.stringify(requestParams), { headers });
    } else if (method === 'DELETE') {
      response = await axios.delete(url, { 
        params: requestParams,
        headers 
      });
    }
    
    logger.debug(`Successful response from ${endpoint}`);
    return response.data;
  } catch (error) {
    // Handle specific Binance error codes
    if (error.response) {
      const { status, data } = error.response;
      
      if (status === 401) {
        logger.error('Binance API authentication error: Invalid API key');
      } else if (status === 403) {
        logger.error('Binance API authorization error: WAF limit violated');
      } else if (status === 418) {
        logger.error('Binance API IP auto-ban: Too many requests after 429');
      } else if (status === 429) {
        logger.error('Binance API rate limit exceeded', { 
          retryAfter: error.response.headers['retry-after'] 
        });
      }
      
      throw {
        status,
        code: data.code,
        message: data.msg,
        url: endpoint,
        params: requestParams
      };
    }
    
    logger.error(`Error in Binance API request to ${endpoint}:`, error);
    throw error;
  }
};

/**
 * Simulates responses for testing without calling the actual API
 */
const simulateResponse = (endpoint, params) => {
  if (endpoint === '/api/v3/order' || endpoint === '/api/v3/order/test') {
    // Simulate order response
    return {
      symbol: params.symbol,
      orderId: Math.floor(Math.random() * 1000000),
      clientOrderId: params.newClientOrderId || `sim_${Date.now()}`,
      transactTime: Date.now(),
      price: params.price || "0.00000000",
      origQty: params.quantity,
      executedQty: params.quantity,
      status: "FILLED",
      timeInForce: params.timeInForce || "GTC",
      type: params.type,
      side: params.side
    };
  }
  
  // Default simulated response
  return { success: true, simulated: true };
};

/**
 * Get all trading pairs from the database
 */
exports.getTradingPairs = async () => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query('SELECT * FROM trading_pairs');
    return rows;
  } catch (error) {
    logger.error('Error fetching trading pairs:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Get a single trading pair by ID
 */
exports.getTradingPairById = async (tradingPairId) => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query('SELECT * FROM trading_pairs WHERE id = ?', [tradingPairId]);
    if (rows.length === 0) {
      throw new Error(`Trading pair with ID ${tradingPairId} not found`);
    }
    return rows[0];
  } catch (error) {
    logger.error(`Error fetching trading pair with ID ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Get a single trading pair by symbol
 */
exports.getTradingPairBySymbol = async (symbol) => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query('SELECT * FROM trading_pairs WHERE symbol = ?', [symbol]);
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  } catch (error) {
    logger.error(`Error fetching trading pair with symbol ${symbol}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Get cached or fresh exchange information from Binance
 */
exports.getExchangeInfo = async () => {
  try {
    const now = Date.now();
    
    // Return cached info if still valid
    if (symbolInfoCache && (now - symbolInfoCacheTime < CACHE_DURATION)) {
      return symbolInfoCache;
    }
    
    // Otherwise, fetch fresh data
    const exchangeInfo = await makeRequest('GET', '/api/v3/exchangeInfo');
    
    // Cache the result
    symbolInfoCache = exchangeInfo;
    symbolInfoCacheTime = now;
    
    return exchangeInfo;
  } catch (error) {
    logger.error('Error fetching exchange info from Binance:', error);
    throw error;
  }
};

/**
 * Get symbol information from exchange info
 */
exports.getSymbolInfo = async (symbol) => {
  const exchangeInfo = await exports.getExchangeInfo();
  return exchangeInfo.symbols.find(s => s.symbol === symbol);
};







/**
 * Get current price for a symbol from Binance
 */
exports.getCurrentPrice = async (symbol) => {
  try {
    // In Phase 2, we'll use Binance API for real price data but with some error handling
    try {
      // Try getting price from Binance API
      const ticker = await makeRequest('GET', '/api/v3/ticker/price', { symbol });
      return parseFloat(ticker.price);
    } catch (apiError) {
      logger.error(`Error fetching price from Binance API for ${symbol}:`, apiError);
      
      // Try to get the most recent price from our database as fallback
      const conn = await db.getConnection();
      const [latestPrice] = await conn.query(
        `SELECT price FROM price_history 
         WHERE trading_pair_id = (SELECT id FROM trading_pairs WHERE symbol = ?) 
         ORDER BY timestamp DESC LIMIT 1`,
        [symbol]
      );
      conn.release();
      
      if (latestPrice && latestPrice.length > 0) {
        logger.info(`Using cached price for ${symbol}: ${latestPrice[0].price}`);
        return parseFloat(latestPrice[0].price);
      }
      
      // If no cached price, use simulated price as last resort
      const mockPrices = {
        'BTCUSDT': 67500.25,
        'SOLUSDT': 145.75,
        'XRPUSDT': 0.55,
        'PENDLEUSDT': 2.35,
        'DOGEUSDT': 0.12,
        'NEARUSDT': 4.85
      };
      
      // Add some random fluctuation for simulation
      const basePrice = mockPrices[symbol] || 100;
      const fluctuation = (Math.random() - 0.5) * 0.02; // +/- 1% change
      const price = basePrice * (1 + fluctuation);
      
      logger.warn(`Using simulated price for ${symbol}: ${price.toFixed(2)}`);
      return parseFloat(price.toFixed(getPrecision(basePrice)));
    }
  } catch (error) {
    logger.error(`Error fetching price for ${symbol}:`, error);
    throw error;
  }
};

// Helper function for price precision
function getPrecision(price) {
  if (price < 0.1) return 6;
  if (price < 1) return 5;
  if (price < 10) return 4;
  if (price < 1000) return 2;
  return 2;
}

/**
 * Format a number according to Binance's requirements using step size
 */
exports.formatQuantity = async (symbol, quantity) => {
  try {
    const symbolInfo = await exports.getSymbolInfo(symbol);
    
    // Get the lot size filter
    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    
    if (!lotSizeFilter) {
      return quantity; // No filter found, return as is
    }
    
    const stepSize = parseFloat(lotSizeFilter.stepSize);
    
    // Calculate the precision from the step size
    const precision = Math.log10(1 / stepSize);
    
    // Format the quantity based on the precision
    return parseFloat(quantity.toFixed(Math.floor(precision)));
  } catch (error) {
    logger.error(`Error formatting quantity for ${symbol}:`, error);
    throw error;
  }
};

/**
 * Get holdings for a trading pair
 */
exports.getHoldings = async (tradingPairId) => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query(
      'SELECT * FROM holdings WHERE trading_pair_id = ?',
      [tradingPairId]
    );
    
    if (rows.length === 0) {
      // Return default holdings with zero quantity
      return {
        tradingPairId: parseInt(tradingPairId),
        quantity: 0,
        averageBuyPrice: 0,
        lastBuyPrice: 0
      };
    }
    
    return {
      tradingPairId: rows[0].trading_pair_id,
      quantity: parseFloat(rows[0].quantity),
      averageBuyPrice: parseFloat(rows[0].average_buy_price || 0),
      lastBuyPrice: parseFloat(rows[0].last_buy_price || 0)
    };
  } catch (error) {
    logger.error(`Error fetching holdings for trading pair ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Get transaction history for a trading pair
 */
exports.getTransactions = async (tradingPairId) => {
  let conn;
  try {
    conn = await db.getConnection();
    const rows = await conn.query(
      'SELECT * FROM transactions WHERE trading_pair_id = ? ORDER BY created_at DESC',
      [tradingPairId]
    );
    
    return rows.map(row => ({
      id: row.id,
      tradingPairId: row.trading_pair_id,
      type: row.transaction_type,
      quantity: parseFloat(row.quantity),
      price: parseFloat(row.price),
      totalAmount: parseFloat(row.total_amount),
      status: row.status,
      binanceOrderId: row.binance_order_id,
      timestamp: row.created_at
    }));
  } catch (error) {
    logger.error(`Error fetching transactions for trading pair ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Execute a buy order
 */
exports.executeBuyOrder = async (tradingPairId, amount, options = {}) => {
  let conn;
  try {
    conn = await db.getConnection();
    
    // Get trading pair information
    const tradingPair = await exports.getTradingPairById(tradingPairId);
    
    // Get current price from Binance
    const currentPrice = await exports.getCurrentPrice(tradingPair.symbol);
    
    // Calculate quantity based on investment amount
    const quantity = amount / currentPrice;
    
    // Format quantity according to Binance's requirements
    const formattedQuantity = await exports.formatQuantity(tradingPair.symbol, quantity);
    
    // Start transaction
    await conn.beginTransaction();
    
    // Insert transaction record
    const transactionResult = await conn.query(
      `INSERT INTO transactions 
       (trading_pair_id, transaction_type, quantity, price, total_amount, status, binance_order_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tradingPairId, 'BUY', formattedQuantity, currentPrice, amount, 'PENDING', null]
    );
    
    const transactionId = transactionResult.insertId;
    
    // Try to execute order on Binance
    let binanceOrderId = null;
    let orderStatus = 'COMPLETED'; // Default for test mode
    
    try {
      if (!options.skipBinanceOrder && !TEST_MODE) {
        // Format parameters for the order
        const orderParams = {
          symbol: tradingPair.symbol,
          side: 'BUY',
          type: 'MARKET',
          quantity: formattedQuantity
        };
        
        // Execute market order
        const order = await makeRequest('POST', '/api/v3/order', orderParams);
        
        binanceOrderId = order.orderId;
        orderStatus = 'COMPLETED';
        
        logger.info(`Binance BUY order executed: ${tradingPair.symbol}, ${formattedQuantity}, $${currentPrice}, OrderID: ${binanceOrderId}`);
      } else {
        logger.info(`Simulated BUY order: ${tradingPair.symbol}, ${formattedQuantity}, $${currentPrice}`);
      }
    } catch (orderError) {
      logger.error(`Error executing Binance BUY order:`, orderError);
      
      // Even if Binance order fails, we proceed with local transaction for simulation purposes
      orderStatus = 'FAILED';
      
      // Send error notification
      await telegramService.sendErrorNotification(
        orderError, 
        `Failed to execute BUY order for ${tradingPair.display_name}`
      );
    }
    
    // Update transaction status
    await conn.query(
      `UPDATE transactions SET status = ?, binance_order_id = ? WHERE id = ?`,
      [orderStatus, binanceOrderId, transactionId]
    );
    
    // If order failed on Binance but we're in test mode, still update holdings for simulation
    if (orderStatus === 'COMPLETED' || options.forceUpdateHoldings || TEST_MODE) {
      // Update or insert holdings
      const existingHoldings = await conn.query(
        'SELECT * FROM holdings WHERE trading_pair_id = ?',
        [tradingPairId]
      );
      
      if (existingHoldings.length > 0) {
        // Update existing holdings
        const currentHoldings = existingHoldings[0];
        const currentQuantity = parseFloat(currentHoldings.quantity);
        const newQuantity = currentQuantity + formattedQuantity;
        
        // Calculate new average buy price
        const currentValue = currentQuantity * parseFloat(currentHoldings.average_buy_price || 0);
        const newValue = formattedQuantity * currentPrice;
        const newAverageBuyPrice = (currentValue + newValue) / newQuantity;
        
        await conn.query(
          `UPDATE holdings 
           SET quantity = ?, average_buy_price = ?, last_buy_price = ? 
           WHERE trading_pair_id = ?`,
          [newQuantity, newAverageBuyPrice, currentPrice, tradingPairId]
        );
      } else {
        // Insert new holdings
        await conn.query(
          `INSERT INTO holdings 
           (trading_pair_id, quantity, average_buy_price, last_buy_price) 
           VALUES (?, ?, ?, ?)`,
          [tradingPairId, formattedQuantity, currentPrice, currentPrice]
        );
      }
    }
    
    // Commit transaction
    await conn.commit();
    
    // Send Telegram notification
    try {
      await telegramService.sendTradeNotification({
        tradingPair,
        type: 'BUY',
        quantity: formattedQuantity,
        price: currentPrice,
        totalAmount: amount,
        reason: options.reason || 'MANUAL'
      });
    } catch (notificationError) {
      logger.error('Failed to send trade notification:', notificationError);
    }
    
    // Return transaction details
    return {
      id: transactionId,
      tradingPairId: parseInt(tradingPairId),
      type: 'BUY',
      quantity: parseFloat(formattedQuantity.toFixed(8)),
      price: currentPrice,
      totalAmount: parseFloat(amount),
      status: orderStatus,
      binanceOrderId,
      timestamp: new Date()
    };
  } catch (error) {
    if (conn) await conn.rollback();
    logger.error('Error executing buy order:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Get current price for a symbol from WebSocket ONLY
 * No API fallback is allowed
 */
exports.getCurrentPrice = async (symbol) => {
  try {
    // Get price only from WebSocket service
    const websocketService = require('./websocketService');
    return websocketService.getLatestPrice(symbol);
  } catch (error) {
    logger.error(`Error fetching price from WebSocket for ${symbol}:`, error);
    throw new Error(`No price available for ${symbol} from WebSocket: ${error.message}`);
  }
};

/**
 * Format a number according to Binance's requirements using step size
 */
exports.formatQuantity = async (symbol, quantity) => {
  try {
    const symbolInfo = await exports.getSymbolInfo(symbol);
    
    // Get the lot size filter
    const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
    
    if (!lotSizeFilter) {
      return quantity; // No filter found, return as is
    }
    
    const stepSize = parseFloat(lotSizeFilter.stepSize);
    
    // Calculate the precision from the step size
    const precision = Math.log10(1 / stepSize);
    
    // Format the quantity based on the precision
    return parseFloat(quantity.toFixed(Math.floor(precision)));
  } catch (error) {
    logger.error(`Error formatting quantity for ${symbol}:`, error);
    throw error;
  }
};

/**
 * Execute a buy order
 */
exports.executeBuyOrder = async (tradingPairId, amount, options = {}) => {
  let conn;
  try {
    conn = await db.getConnection();
    
    // Get trading pair information
    const tradingPair = await exports.getTradingPairById(tradingPairId);
    
    // Get current price from WebSocket
    let currentPrice;
    try {
      const websocketService = require('./websocketService');
      currentPrice = websocketService.getLatestPrice(tradingPair.symbol);
    } catch (priceError) {
      throw new Error(`Cannot execute buy order: No price available from WebSocket for ${tradingPair.symbol}`);
    }
    
    // Calculate quantity based on investment amount
    const quantity = amount / currentPrice;
    
    // Format quantity according to Binance's requirements
    const formattedQuantity = await exports.formatQuantity(tradingPair.symbol, quantity);
    
    // Start transaction
    await conn.beginTransaction();
    
    // Insert transaction record
    const transactionResult = await conn.query(
      `INSERT INTO transactions 
       (trading_pair_id, transaction_type, quantity, price, total_amount, status, binance_order_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tradingPairId, 'BUY', formattedQuantity, currentPrice, amount, 'PENDING', null]
    );
    
    const transactionId = transactionResult.insertId;
    
    // Try to execute order on Binance
    let binanceOrderId = null;
    let orderStatus = 'COMPLETED'; // Default for test mode
    
    try {
      if (!options.skipBinanceOrder && !TEST_MODE) {
        // Format parameters for the order
        const orderParams = {
          symbol: tradingPair.symbol,
          side: 'BUY',
          type: 'MARKET',
          quantity: formattedQuantity
        };
        
        // Execute market order
        const order = await makeRequest('POST', '/api/v3/order', orderParams);
        
        binanceOrderId = order.orderId;
        orderStatus = 'COMPLETED';
        
        logger.info(`Binance BUY order executed: ${tradingPair.symbol}, ${formattedQuantity}, $${currentPrice}, OrderID: ${binanceOrderId}`);
      } else {
        logger.info(`Simulated BUY order: ${tradingPair.symbol}, ${formattedQuantity}, $${currentPrice}`);
      }
    } catch (orderError) {
      logger.error(`Error executing Binance BUY order:`, orderError);
      
      // Even if Binance order fails, we proceed with local transaction for simulation purposes
      orderStatus = 'FAILED';
      
      // Send error notification
      await telegramService.sendErrorNotification(
        orderError, 
        `Failed to execute BUY order for ${tradingPair.display_name}`
      );
    }
    
    // Update transaction status
    await conn.query(
      `UPDATE transactions SET status = ?, binance_order_id = ? WHERE id = ?`,
      [orderStatus, binanceOrderId, transactionId]
    );
    
    // If order failed on Binance but we're in test mode, still update holdings for simulation
    if (orderStatus === 'COMPLETED' || options.forceUpdateHoldings || TEST_MODE) {
      // Update or insert holdings
      const existingHoldings = await conn.query(
        'SELECT * FROM holdings WHERE trading_pair_id = ?',
        [tradingPairId]
      );
      
      if (existingHoldings.length > 0) {
        // Update existing holdings
        const currentHoldings = existingHoldings[0];
        const currentQuantity = parseFloat(currentHoldings.quantity);
        const newQuantity = currentQuantity + formattedQuantity;
        
        // Calculate new average buy price
        const currentValue = currentQuantity * parseFloat(currentHoldings.average_buy_price || 0);
        const newValue = formattedQuantity * currentPrice;
        const newAverageBuyPrice = (currentValue + newValue) / newQuantity;
        
        await conn.query(
          `UPDATE holdings 
           SET quantity = ?, average_buy_price = ?, last_buy_price = ? 
           WHERE trading_pair_id = ?`,
          [newQuantity, newAverageBuyPrice, currentPrice, tradingPairId]
        );
      } else {
        // Insert new holdings
        await conn.query(
          `INSERT INTO holdings 
           (trading_pair_id, quantity, average_buy_price, last_buy_price) 
           VALUES (?, ?, ?, ?)`,
          [tradingPairId, formattedQuantity, currentPrice, currentPrice]
        );
      }
    }
    
    // Commit transaction
    await conn.commit();
    
    // Send Telegram notification
    try {
      await telegramService.sendTradeNotification({
        tradingPair,
        type: 'BUY',
        quantity: formattedQuantity,
        price: currentPrice,
        totalAmount: amount,
        reason: options.reason || 'MANUAL'
      });
    } catch (notificationError) {
      logger.error('Failed to send trade notification:', notificationError);
    }
    
    // Return transaction details
    return {
      id: transactionId,
      tradingPairId: parseInt(tradingPairId),
      type: 'BUY',
      quantity: parseFloat(formattedQuantity.toFixed(8)),
      price: currentPrice,
      totalAmount: parseFloat(amount),
      status: orderStatus,
      binanceOrderId,
      timestamp: new Date()
    };
  } catch (error) {
    if (conn) await conn.rollback();
    logger.error('Error executing buy order:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Execute a sell all order
 */
exports.executeSellAllOrder = async (tradingPairId, options = {}) => {
  let conn;
  try {
    conn = await db.getConnection();
    
    // Get trading pair information
    const tradingPair = await exports.getTradingPairById(tradingPairId);
    
    // Get current holdings
    const holdings = await exports.getHoldings(tradingPairId);
    
    if (holdings.quantity <= 0) {
      throw new Error('No holdings to sell');
    }
    
    // Execute sell order with all holdings
    return await exports.executeSellOrder(tradingPairId, holdings.quantity, {
      ...options,
      reason: options.reason || 'MANUAL_SELL_ALL'
    });
  } catch (error) {
    logger.error('Error executing sell all order:', error);
    throw error;
  }
};

/**
 * Get account balance from Binance
 */
exports.getAccountBalance = async () => {
  try {
    if (TEST_MODE) {
      logger.info('Using simulated account balance in test mode');
      return {
        USDT: { available: '10000.00', onOrder: '0.00' },
        BTC: { available: '0.5', onOrder: '0.00' },
        SOL: { available: '10.0', onOrder: '0.00' }
      };
    }
    
    const account = await makeRequest('GET', '/api/v3/account');
    
    // Format balances into a more usable structure
    const balances = {};
    account.balances.forEach(balance => {
      balances[balance.asset] = {
        available: balance.free,
        onOrder: balance.locked
      };
    });
    
    return balances;
  } catch (error) {
    logger.error('Error fetching account balance from Binance:', error);
    throw error;
  }
};

/**
 * Get all supported symbols from Binance
 */
exports.getSupportedSymbols = async () => {
  try {
    const exchangeInfo = await exports.getExchangeInfo();
    return exchangeInfo.symbols.map(symbol => ({
      symbol: symbol.symbol,
      baseAsset: symbol.baseAsset,
      quoteAsset: symbol.quoteAsset,
      status: symbol.status,
      filters: symbol.filters
    }));
  } catch (error) {
    logger.error('Error fetching supported symbols from Binance:', error);
    throw error;
  }
};

/**
 * Test the connection to Binance API
 */
exports.testConnectivity = async () => {
  try {
    return await makeRequest('GET', '/api/v3/ping');
  } catch (error) {
    logger.error('Error testing connectivity to Binance API:', error);
    throw error;
  }
};

/**
 * Get the Binance server time
 */
exports.getServerTime = async () => {
  try {
    const response = await makeRequest('GET', '/api/v3/time');
    return response.serverTime;
  } catch (error) {
    logger.error('Error getting Binance server time:', error);
    throw error;
  }
};

// Export WebSocket base URL for other modules
exports.WEBSOCKET_URL = WEBSOCKET_URL;