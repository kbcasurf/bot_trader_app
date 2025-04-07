// backend/js/binance.js
// Binance API Integration Module
// Responsible for connecting to Binance API for trading operations and price updates

const WebSocket = require('ws');
const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');
const EventEmitter = require('events');

// Import internal modules
const db = require('./dbconns');
const telegram = require('./telegram');

// Load environment variables
dotenv.config({ path: require('path').resolve(__dirname, '../../.env') });

// Binance API configuration
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const BINANCE_API_URL = process.env.BINANCE_API_URL || 'https://testnet.binance.vision'; 
const BINANCE_WS_URL = process.env.BINANCE_WEBSOCKET_URL || 'wss://testnet.binance.vision';
const BINANCE_RECV_WINDOW = parseInt(process.env.BINANCE_RECV_WINDOW || '5000');

// Create a custom event emitter for price updates
class BinanceEvents extends EventEmitter {}
const binanceEvents = new BinanceEvents();

// Module state
const state = {
  websocket: null,          // WebSocket connection
  isConnected: false,       // Whether we're connected to Binance
  lastPrices: new Map(),    // Map of symbol -> price
  tradingEnabled: false,    // Whether trading is enabled
  autoTradingEnabled: false, // Whether auto-trading is enabled
  supportedSymbols: ['BTC', 'SOL', 'XRP', 'PENDLE', 'DOGE', 'NEAR'],
  wsReconnectInterval: null, // Interval for WebSocket reconnection attempts
  wsHeartbeatInterval: null, // Interval for WebSocket heartbeat
  lastMessageTime: 0,        // Timestamp of the last received message
  lastPriceLogTime: {},      // Last time we logged a price update for each symbol
  lastGetPriceLogTime: {},   // Last time we logged a getSymbolPrice call for each symbol
  serviceStatus: {           // Overall service status
    wsConnected: false,
    apiConnected: false,
    lastError: null,
    lastReconnectAttempt: 0
  }
};

// WebSocket configuration
const WS_CONFIG = {
  pingInterval: 20000,       // 20 seconds ping interval
  reconnectDelay: 2000,      // Initial delay for reconnection attempts
  maxReconnectDelay: 60000,  // Maximum delay for reconnection attempts
  maxReconnectAttempts: 10,  // Maximum number of reconnection attempts
  heartbeatTimeout: 30000,   // Time without message to trigger reconnect
  pongTimeout: 5000          // Timeout waiting for pong response
};

/**
 * Initialize the Binance API connection
 * @returns {Promise<boolean>} True if initialization was successful
 */
async function initialize() {
  console.log('Initializing Binance API connection...');
  
  try {
    // Check API key and secret
    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
      console.error('Binance API key or secret not found in environment variables');
      return false;
    }
    
    // Test API connection by getting exchange info
    try {
      await getExchangeInfo();
      console.log('Binance API connection successful');
      state.serviceStatus.apiConnected = true;
    } catch (error) {
      console.warn('Could not connect to Binance API:', error.message);
      state.serviceStatus.apiConnected = false;
      state.serviceStatus.lastError = error.message;
      // Continue anyway - WebSocket might still work
    }
    
    // Set initial placeholder prices
    // These will be quickly updated by WebSocket
    for (const symbol of state.supportedSymbols) {
      // Use realistic initial values
      const initialPrices = {
        'BTC': 50000,
        'SOL': 100,
        'XRP': 0.5,
        'PENDLE': 2,
        'DOGE': 0.1,
        'NEAR': 5
      };
      
      state.lastPrices.set(symbol, initialPrices[symbol] || 10);
      console.log(`Setting initial price for ${symbol}: $${initialPrices[symbol]}`);
    }
    
    // Initialize WebSocket connection for real-time price updates
    console.log('Initializing Binance WebSocket for real-time price updates using combined stream');
    await initializeWebSocket();
    
    // Only enable trading if both API and WebSocket are connected
    state.tradingEnabled = state.serviceStatus.apiConnected && state.isConnected;
    
    // Notify via Telegram
    telegram.sendMessage(`Binance connection: API=${state.serviceStatus.apiConnected}, WebSocket=${state.isConnected}`);
    
    return state.tradingEnabled;
  } catch (error) {
    console.error('Failed to initialize Binance API:', error);
    telegram.sendErrorNotification('Failed to connect to Binance API: ' + error.message);
    state.serviceStatus.lastError = error.message;
    return false;
  }
}

/**
 * Initialize WebSocket connection for price updates with robust error handling
 * Uses a single combined stream for all symbols
 * @returns {Promise<boolean>} True if initialization was successful
 */
async function initializeWebSocket() {
  // Clear any existing reconnection interval
  if (state.wsReconnectInterval) {
    clearInterval(state.wsReconnectInterval);
    state.wsReconnectInterval = null;
  }
  
  // Clear any existing heartbeat interval
  if (state.wsHeartbeatInterval) {
    clearInterval(state.wsHeartbeatInterval);
    state.wsHeartbeatInterval = null;
  }
  
  try {
    // Close existing connection if needed
    closeWebSocketConnection();
    
    // Create combined stream URL for all symbols
    // Format: wss://testnet.binance.vision/stream?streams=btcusdt@bookTicker/solusdt@bookTicker/...
    const streamSymbols = state.supportedSymbols.map(symbol => 
      `${symbol.toLowerCase()}usdt@bookTicker`
    ).join('/');
    
    // Use the combined stream URL pattern
    const combinedStreamUrl = `${BINANCE_WS_URL}/stream?streams=${streamSymbols}`;
    
    console.log(`Connecting to Binance WebSocket (combined stream)...`);
    
    // Create a new WebSocket connection
    const socket = new WebSocket(combinedStreamUrl, {
      perMessageDeflate: false, // Disable compression for better performance
      handshakeTimeout: 10000,  // 10 second handshake timeout
      timeout: 30000            // 30 second connection timeout
    });
    
    // Set connection state
    state.websocket = socket;
    state.serviceStatus.lastReconnectAttempt = Date.now();
    
    // Return a promise that resolves when the connection is established
    // or rejects if there's an error during connection
    return new Promise((resolve, reject) => {
      // Set a connection timeout
      const connectionTimeout = setTimeout(() => {
        reject(new Error('WebSocket connection timeout'));
        socket.terminate();
      }, 20000); // 20 second connection timeout
      
      // Handle WebSocket connection open
      socket.on('open', () => {
        console.log('Binance WebSocket connection opened (combined stream)');
        clearTimeout(connectionTimeout);
        
        // Set connection state
        state.isConnected = true;
        state.serviceStatus.wsConnected = true;
        state.lastMessageTime = Date.now();
        
        // Set up heartbeat interval to detect stale connections
        state.wsHeartbeatInterval = setInterval(() => {
          checkWebSocketHealth();
        }, WS_CONFIG.heartbeatTimeout);
        
        // Notify connection change
        notifyConnectionChange(true);
        
        // Resolve the promise
        resolve(true);
      });
      
      // Handle WebSocket messages
      socket.on('message', (data) => {
        handleWebSocketMessage(data);
        
        // Update last message time for heartbeat
        state.lastMessageTime = Date.now();
      });
      
      // Handle WebSocket pings
      socket.on('ping', (payload) => {
        // Respond with a pong containing the same payload
        try {
          socket.pong(payload);
        } catch (err) {
          console.error('Error sending pong response:', err);
        }
      });
      
      // Handle WebSocket errors
      socket.on('error', (error) => {
        console.error('Binance WebSocket error:', error);
        clearTimeout(connectionTimeout);
        
        // Update state
        state.serviceStatus.lastError = error.message;
        
        // Reject the promise if it hasn't been resolved yet
        reject(error);
        
        // Handle the error (will attempt reconnect if needed)
        handleWebSocketError(error);
      });
      
      // Handle WebSocket connection close
      socket.on('close', (code, reason) => {
        console.log(`Binance WebSocket connection closed: Code: ${code}, Reason: ${reason}`);
        clearTimeout(connectionTimeout);
        
        // Only reject if the promise hasn't been resolved yet
        if (!state.isConnected) {
          reject(new Error(`WebSocket connection closed: ${reason || 'Unknown reason'}`));
        }
        
        // Handle the connection close
        handleWebSocketClose(code, reason);
      });
    });
    
  } catch (error) {
    console.error('Error initializing WebSocket:', error);
    state.isConnected = false;
    state.serviceStatus.wsConnected = false;
    state.serviceStatus.lastError = error.message;
    notifyConnectionChange(false);
    
    // Start reconnection attempt
    scheduleReconnect();
    
    return false;
  }
}

/**
 * Handle messages received from the WebSocket
 * @param {*} data - The message data
 */
function handleWebSocketMessage(data) {
  try {
    const message = JSON.parse(data);
    
    // Combined stream messages have a specific format:
    // {"stream":"<streamName>","data":<rawPayload>}
    if (message.stream && message.data) {
      const streamData = message.data;
      
      // Handle the bookTicker data format
      // {
      //   "u":400900217,     // order book updateId
      //   "s":"BNBUSDT",     // symbol
      //   "b":"25.35190000", // best bid price
      //   "B":"31.21000000", // best bid qty
      //   "a":"25.36520000", // best ask price
      //   "A":"40.66000000"  // best ask qty
      // }
      
      if (streamData.s && streamData.a) {
        // Extract symbol (remove USDT suffix)
        const symbol = streamData.s.replace('USDT', '');
        
        // Extract ask price (a) as our reference price
        const price = parseFloat(streamData.a);
        
        // Only process supported symbols
        if (state.supportedSymbols.includes(symbol)) {
          // Update price in state
          state.lastPrices.set(symbol, price);
          
          // Notify price update to listeners
          notifyPriceUpdate(symbol, price);
          
          // Only log price updates once per 60 seconds per symbol (reduced frequency)
          const now = Date.now();
          const lastLogTime = state.lastPriceLogTime[symbol] || 0;
          if (now - lastLogTime >= 60000) { // 60 seconds in milliseconds
            // Always show cryptocurrency prices with 4 decimal places for consistency
            console.log(`WebSocket price update for ${symbol}: $${price.toFixed(4)}`);
            state.lastPriceLogTime[symbol] = now;
          }
          
          // Emit event for this specific symbol update
          binanceEvents.emit(`price_update_${symbol}`, price);
          
          // Also emit a general price update event
          binanceEvents.emit('price_update', { symbol, price });
        }
      }
    } else if (message.id && message.result === null) {
      // This is a response to our subscription message
      console.log(`Successfully processed WebSocket control message (id: ${message.id})`);
    }
  } catch (err) {
    console.error('Error parsing WebSocket message:', err);
    console.error('Raw message:', typeof data === 'string' ? data.substring(0, 100) : 'non-string data');
  }
}

/**
 * Handle WebSocket errors
 * @param {Error} error - The error that occurred
 */
function handleWebSocketError(error) {
  console.error('WebSocket error occurred:', error.message);
  
  // Save auto-trading state before disabling trading
  const wasAutoTradingEnabled = state.autoTradingEnabled;
  
  // Update state
  state.isConnected = false;
  state.serviceStatus.wsConnected = false;
  state.tradingEnabled = false; // Disable trading when WebSocket is down
  state.serviceStatus.lastError = error.message;
  
  // If auto-trading was enabled, send notification that it's temporarily disabled
  if (wasAutoTradingEnabled) {
    telegram.sendMessage('⚠️ Auto-trading temporarily disabled due to WebSocket connection error. Will be restored upon reconnection.');
  }
  
  // Notify users
  console.log('Trading has been halted due to WebSocket connection error');
  telegram.sendErrorNotification('Trading halted: WebSocket connection error with Binance');
  notifyConnectionChange(false);
  
  // Schedule reconnection
  scheduleReconnect(null, wasAutoTradingEnabled);
}

/**
 * Handle WebSocket connection close
 * @param {number} code - The close code
 * @param {string} reason - The close reason
 */
function handleWebSocketClose(code, reason) {
  // Save auto-trading state before disabling trading
  const wasAutoTradingEnabled = state.autoTradingEnabled;
  
  // Update state
  state.isConnected = false;
  state.serviceStatus.wsConnected = false;
  state.tradingEnabled = false; // Disable trading when WebSocket is down
  
  // If auto-trading was enabled, send notification that it's temporarily disabled
  if (wasAutoTradingEnabled) {
    telegram.sendMessage('⚠️ Auto-trading temporarily disabled due to WebSocket connection closure. Will be restored upon reconnection.');
  }
  
  // Notify users
  console.log('Trading has been halted due to WebSocket connection closure');
  telegram.sendErrorNotification(`Trading halted: WebSocket connection closed (${code}: ${reason || 'Unknown reason'})`);
  notifyConnectionChange(false);
  
  // Schedule reconnection
  scheduleReconnect(null, wasAutoTradingEnabled);
}

/**
 * Check WebSocket health based on last message time
 */
function checkWebSocketHealth() {
  const now = Date.now();
  const messageAge = now - state.lastMessageTime;
  
  if (messageAge > WS_CONFIG.heartbeatTimeout && state.isConnected) {
    console.warn(`No WebSocket messages received for ${messageAge}ms, reconnecting...`);
    
    // Force reconnection due to stale connection
    closeWebSocketConnection();
    scheduleReconnect(0); // Immediate reconnect
  }
}

/**
 * Close the WebSocket connection if it exists
 */
function closeWebSocketConnection() {
  if (state.websocket) {
    try {
      // Terminate the connection immediately instead of a clean close
      // This avoids hanging connections
      state.websocket.terminate();
    } catch (error) {
      console.error('Error terminating WebSocket connection:', error);
    } finally {
      state.websocket = null;
    }
  }
}

/**
 * Schedule a reconnection attempt with exponential backoff
 * @param {number} delay - Optional delay override (ms)
 * @param {boolean} restoreAutoTrading - Whether to restore auto-trading state after reconnection
 */
function scheduleReconnect(delay = null, restoreAutoTrading = false) {
  // Clear any existing reconnection interval
  if (state.wsReconnectInterval) {
    clearInterval(state.wsReconnectInterval);
  }
  
  // Calculate delay with exponential backoff
  let reconnectDelay = delay;
  if (reconnectDelay === null) {
    const attempts = Math.min(5, Math.floor((Date.now() - state.serviceStatus.lastReconnectAttempt) / 60000));
    reconnectDelay = Math.min(
      WS_CONFIG.maxReconnectDelay,
      WS_CONFIG.reconnectDelay * Math.pow(2, attempts)
    );
  }
  
  console.log(`Scheduling WebSocket reconnection in ${reconnectDelay}ms...`);
  
  // Set up a new reconnection interval
  state.wsReconnectInterval = setTimeout(async () => {
    console.log('Attempting to reconnect to Binance WebSocket...');
    try {
      await initializeWebSocket();
      
      // Re-enable trading if connection is successful
      if (state.isConnected) {
        state.tradingEnabled = true;
        console.log('Trading has been re-enabled as WebSocket connection is established');
        telegram.sendMessage('✅ Trading resumed: WebSocket connection to Binance established');
        
        // Restore auto-trading state if it was previously enabled
        if (restoreAutoTrading) {
          state.autoTradingEnabled = true;
          console.log('Auto-trading has been automatically re-enabled');
          telegram.sendMessage('🤖 Auto-trading has been automatically re-enabled after connection was restored');
          // Notify clients about auto-trading status change
          binanceEvents.emit('auto_trading_status', { enabled: true });
        }
      }
    } catch (error) {
      console.error('Failed to reconnect to Binance WebSocket:', error);
      scheduleReconnect(null, restoreAutoTrading); // Schedule another reconnection attempt, preserving auto-trading flag
    }
  }, reconnectDelay);
}

/**
 * Get current price for a symbol
 * ONLY uses WebSocket data as per PRD.md requirements
 * If WebSocket is disconnected, trading should be halted
 * @param {string} symbol - The trading pair symbol (e.g., "BTCUSDT")
 * @returns {Promise<Object>} The ticker data
 */
async function getSymbolPrice(symbol) {
  // Extract the base symbol if it's a trading pair
  const baseSymbol = symbol.replace('USDT', '');
  
  // Check if WebSocket is connected - this is REQUIRED per PRD.md
  if (!state.isConnected) {
    throw new Error(`Cannot get price for ${symbol} - WebSocket connection is down. Trading halted until reconnection.`);
  }
  
  // Check if we have a price from WebSocket
  if (state.lastPrices.has(baseSymbol)) {
    const currentPrice = state.lastPrices.get(baseSymbol);
    
    // Only log every 60 seconds per symbol to reduce log noise
    const now = Date.now();
    const lastGetPriceLogTime = state.lastGetPriceLogTime || {};
    const lastLogTime = lastGetPriceLogTime[baseSymbol] || 0;
    
    if (now - lastLogTime >= 60000) { // 60 seconds in milliseconds
      console.log(`Using WebSocket price for ${symbol}: $${currentPrice.toFixed(4)}`);
      lastGetPriceLogTime[baseSymbol] = now;
      state.lastGetPriceLogTime = lastGetPriceLogTime;
    }
    
    return {
      symbol: symbol,
      price: currentPrice.toString()
    };
  }
  
  // If we don't have a price yet, wait for WebSocket to provide one (don't fallback to API)
  throw new Error(`No price data available for ${symbol} from WebSocket yet. Try again shortly.`);
}

/**
 * Get exchange information
 * @returns {Promise<Object>} The exchange information
 */
async function getExchangeInfo() {
  try {
    const basePath = process.env.BINANCE_API_BASE_PATH || '/api';
    console.log(`Getting exchange info from Binance API...`);
    const response = await axios.get(`${BINANCE_API_URL}${basePath}/v3/exchangeInfo`, {
      timeout: 10000 // 10 second timeout
    });
    return response.data;
  } catch (error) {
    console.error('Error getting exchange info:', error);
    throw error;
  }
}

/**
 * Create signature for API request
 * @param {Object} params - The request parameters
 * @returns {string} The signature
 */
function createSignature(params) {
  // Convert params to query string
  const queryString = Object.keys(params)
    .map(key => `${key}=${params[key]}`)
    .join('&');
    
  // Create HMAC signature
  return crypto
    .createHmac('sha256', BINANCE_API_SECRET)
    .update(queryString)
    .digest('hex');
}

/**
 * Make a signed API request to Binance
 * @param {string} endpoint - The API endpoint
 * @param {string} method - The HTTP method
 * @param {Object} params - The request parameters
 * @returns {Promise<Object>} The API response
 */
async function signedRequest(endpoint, method, params = {}) {
  try {
    // For testnet, we need to be careful with the timestamp
    // First try to get server time from Binance
    try {
      console.log(`Getting server time from Binance...`);
      const timeResponse = await axios.get(`${BINANCE_API_URL}/api/v3/time`, {
        timeout: 5000 // Short timeout for time sync
      });
      
      // Successful time response
      if (timeResponse.data && timeResponse.data.serverTime) {
        params.timestamp = timeResponse.data.serverTime;
      } else {
        // Fallback to local time
        params.timestamp = Date.now();
        console.log(`Falling back to local time`);
      }
    } catch (timeError) {
      console.error('Error getting server time, using local time:', timeError.message);
      params.timestamp = Date.now();
    }
    
    // For testnet, use a larger recvWindow to prevent timestamp issues
    params.recvWindow = 60000; // Use a large recvWindow for testnet
    
    // Create signature
    const signature = createSignature(params);
    params.signature = signature;
    
    // Make request
    const basePath = process.env.BINANCE_API_BASE_PATH || '/api';
    const config = {
      method,
      url: `${BINANCE_API_URL}${basePath}${endpoint}`,
      timeout: parseInt(process.env.API_TIMEOUT_MS || '10000'),
      headers: {
        'X-MBX-APIKEY': BINANCE_API_KEY
      }
    };
    
    // Add params to query string or body depending on method
    if (method === 'GET') {
      config.params = params;
    } else {
      config.data = new URLSearchParams(params);
    }
    
    // Implement request retries for network issues
    let retries = 2;
    let lastError = null;
    
    while (retries >= 0) {
      try {
        const response = await axios(config);
        return response.data;
      } catch (error) {
        lastError = error;
        console.error(`API request error (retries left: ${retries}):`, error.response ? error.response.data : error.message);
        
        // Only retry for network errors or server errors (5xx)
        const isRetryable = !error.response || error.response.status >= 500;
        if (isRetryable && retries > 0) {
          retries--;
          const delay = 1000 * (2 - retries); // Incremental backoff
          console.log(`Retrying request in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        break;
      }
    }
    
    // If we got here, all retries failed
    throw lastError;
  } catch (error) {
    console.error('API request error:', error.response ? error.response.data : error.message);
    throw error;
  }
}

/**
 * Get account information
 * @returns {Promise<Object>} The account information
 */
async function getAccountInfo() {
  return signedRequest('/v3/account', 'GET');
}

/**
 * Place a market order and verify its execution
 * @param {Object} orderData - The order data
 * @param {string} orderData.symbol - The trading pair symbol (e.g., "BTCUSDT")
 * @param {string} orderData.side - The order side (BUY/SELL)
 * @param {number} orderData.quantity - The quantity to buy/sell
 * @returns {Promise<Object>} The order result
 */
async function placeMarketOrder(orderData) {
  // Check if trading is enabled
  if (!state.tradingEnabled) {
    throw new Error('Trading is currently disabled due to WebSocket connection issues');
  }
  
  // Check if WebSocket is connected
  if (!state.isConnected) {
    throw new Error('Cannot place order: WebSocket connection is down. Trading halted until reconnection.');
  }
  
  try {
    const { symbol, side, quantity } = orderData;
    
    // Create order parameters
    const params = {
      symbol,
      side,
      type: 'MARKET',
      quantity
    };
    
    // Step 1: Execute the order
    const result = await signedRequest('/v3/order', 'POST', params);
    
    // Step 2: Verify the order was executed successfully
    if (!result || !result.status) {
      throw new Error('Invalid order result received from Binance API');
    }
    
    // Check if the order is FILLED (for market orders, should be immediate)
    if (result.status !== 'FILLED') {
      // For market orders, we expect immediate filling
      throw new Error(`Order not filled immediately. Current status: ${result.status}`);
    }
    
    // Step 3: Verify we have fills information
    if (!result.fills || !result.fills.length || !result.fills[0].price) {
      throw new Error('Order executed but no fill information provided');
    }
    
    // Step 4: Verify order execution by checking the order status via a separate API call
    try {
      const orderStatus = await signedRequest(`/v3/order`, 'GET', {
        symbol: symbol,
        orderId: result.orderId
      });
      
      if (orderStatus.status !== 'FILLED') {
        throw new Error(`Order status verification failed. Status: ${orderStatus.status}`);
      }
      
      console.log(`Order verification successful for ${symbol}, orderId: ${result.orderId}`);
    } catch (verificationError) {
      console.error(`Order verification error: ${verificationError.message}`);
      throw new Error(`Could not verify order execution: ${verificationError.message}`);
    }
    
    // Now we're sure the order is executed, log success
    console.log(`Market order executed: ${side} ${quantity} ${symbol}`);
    
    // Calculate USD value
    const price = parseFloat(result.fills[0].price);
    const usdt = price * parseFloat(quantity);
    
    // Step 5: Only after verification, record trade in database
    const baseCurrency = symbol.replace('USDT', '');
    await db.recordTrade({
      symbol: baseCurrency,
      action: side.toLowerCase(),
      quantity: parseFloat(quantity),
      price: price,
      usdt_amount: usdt
    });
    
    // Step 6: Update account balances in database after trade
    try {
      await updateAccountBalances();
      console.log('Account balances updated after trade execution');
    } catch (balanceError) {
      console.error('Failed to update account balances after trade:', balanceError);
      // Continue anyway - this should not invalidate the trade
    }
    
    // Step 7: Send notification
    await telegram.sendTradeNotification({
      symbol: baseCurrency,
      action: side.toLowerCase(),
      quantity: parseFloat(quantity),
      price: price,
      usdt: usdt
    });
    
    // Notify order update handlers
    notifyOrderUpdate(result);
    
    return result;
  } catch (error) {
    console.error('Error placing market order:', error);
    
    // Send error notification
    telegram.sendErrorNotification(`Failed to place ${orderData.side} order for ${orderData.symbol}: ${error.message}`);
    
    throw error;
  }
}

/**
 * Buy cryptocurrency with USDT
 * @param {string} symbol - The cryptocurrency symbol (e.g., "BTC")
 * @param {number} usdtAmount - The amount of USDT to spend
 * @returns {Promise<Object>} The order result
 */
async function buyWithUsdt(symbol, usdtAmount) {
  try {
    // Verify WebSocket connection is active
    if (!state.isConnected || !state.tradingEnabled) {
      throw new Error('Cannot execute trade: WebSocket connection is down. Trading is halted.');
    }
    
    // Get current price from WebSocket (not API)
    const tickerData = await getSymbolPrice(`${symbol}USDT`);
    const currentPrice = parseFloat(tickerData.price);
    
    // Calculate quantity
    const quantity = usdtAmount / currentPrice;
    
    // Format quantity with appropriate precision
    const formattedQuantity = formatQuantity(symbol, quantity);
    
    // Place the order
    return await placeMarketOrder({
      symbol: `${symbol}USDT`,
      side: 'BUY',
      quantity: formattedQuantity
    });
  } catch (error) {
    console.error(`Error buying ${symbol} with USDT:`, error);
    throw error;
  }
}

/**
 * Sell all holdings of a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol (e.g., "BTC")
 * @returns {Promise<Object>} The order result
 */
async function sellAll(symbol) {
  try {
    // Verify WebSocket connection is active
    if (!state.isConnected || !state.tradingEnabled) {
      throw new Error('Cannot execute trade: WebSocket connection is down. Trading is halted.');
    }
    
    // Get account information
    const accountInfo = await getAccountInfo();
    
    // Find the balance for the symbol
    const asset = accountInfo.balances.find(b => b.asset === symbol);
    
    if (!asset || parseFloat(asset.free) <= 0) {
      throw new Error(`No ${symbol} balance available`);
    }
    
    // Format quantity with appropriate precision
    const quantity = parseFloat(asset.free);
    const formattedQuantity = formatQuantity(symbol, quantity);
    
    // Place the order
    return await placeMarketOrder({
      symbol: `${symbol}USDT`,
      side: 'SELL',
      quantity: formattedQuantity
    });
  } catch (error) {
    console.error(`Error selling all ${symbol}:`, error);
    throw error;
  }
}

/**
 * Format quantity with appropriate precision based on Binance LOT_SIZE filter
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} quantity - The quantity to format
 * @returns {string} The formatted quantity
 */
function formatQuantity(symbol, quantity) {
  // LOT_SIZE filters for each trading pair
  // These should ideally be fetched dynamically from exchangeInfo in production
  const lotSizeFilters = {
    'BTC': { minQty: 0.00001, maxQty: 9000, stepSize: 0.00001 },
    'SOL': { minQty: 0.01, maxQty: 9000, stepSize: 0.01 },
    'XRP': { minQty: 1, maxQty: 90000, stepSize: 1 },       // Updated for XRP
    'PENDLE': { minQty: 0.1, maxQty: 90000, stepSize: 0.1 },
    'DOGE': { minQty: 1, maxQty: 90000, stepSize: 1 },      // Updated for DOGE
    'NEAR': { minQty: 0.1, maxQty: 90000, stepSize: 0.1 }
  };
  
  // Get LOT_SIZE filter for this symbol
  const filter = lotSizeFilters[symbol];
  
  if (!filter) {
    console.warn(`No LOT_SIZE filter found for ${symbol}, using default precision`);
    return quantity.toFixed(2);
  }
  
  // Ensure quantity is within min/max bounds
  quantity = Math.max(filter.minQty, Math.min(filter.maxQty, quantity));
  
  // Calculate steps and ensure it adheres to stepSize
  // Formula: floor((quantity - minQty) / stepSize) * stepSize + minQty
  quantity = Math.floor((quantity - filter.minQty) / filter.stepSize) * filter.stepSize + filter.minQty;
  
  // Determine precision from stepSize (count decimal places)
  const stepSizeStr = filter.stepSize.toString();
  let precision = 0;
  if (stepSizeStr.includes('.')) {
    precision = stepSizeStr.split('.')[1].length;
  }
  
  // Format with appropriate precision
  return quantity.toFixed(precision);
}

/**
 * Check if auto-trading should execute
 * This is called when price updates are received
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} currentPrice - The current price
 */
async function checkAutoTrading(symbol, currentPrice) {
  if (!state.autoTradingEnabled || !state.tradingEnabled || !state.isConnected) {
    return;
  }
  
  try {
    // Get trading thresholds
    const thresholds = await db.calculateTradingThresholds(symbol, currentPrice);
    
    // Get current holdings
    const holdings = await db.getCurrentHoldings(symbol);
    
    // Check if we should buy (price below buy threshold)
    if (currentPrice <= thresholds.nextBuyPrice) {
      // Only buy if we have USDT available
      const accountInfo = await getAccountInfo();
      const usdtBalance = accountInfo.balances.find(b => b.asset === 'USDT');
      
      if (usdtBalance && parseFloat(usdtBalance.free) >= 50) {
        console.log(`Auto-trading: Buying ${symbol} at $${currentPrice}`);
        // Use the price from WebSocket directly instead of making a new API call
        await buyWithUsdt(symbol, 50);
      }
    }
    
    // Check if we should sell (price above sell threshold and we have holdings)
    if (currentPrice >= thresholds.nextSellPrice && holdings.quantity > 0) {
      console.log(`Auto-trading: Selling ${symbol} at $${currentPrice}`);
      await sellAll(symbol);
    }
  } catch (error) {
    console.error(`Error in auto-trading check for ${symbol}:`, error);
  }
}

/**
 * Enable auto-trading
 * @param {boolean} enabled - Whether auto-trading should be enabled
 */
function setAutoTrading(enabled) {
  // Only allow enabling if WebSocket is connected
  if (enabled && !state.isConnected) {
    throw new Error('Cannot enable auto-trading: WebSocket connection is down');
  }
  
  // Check if this is actually a change in state
  const isStateChange = state.autoTradingEnabled !== enabled;
  
  // Update state
  state.autoTradingEnabled = enabled;
  console.log(`Auto-trading ${enabled ? 'enabled' : 'disabled'}`);
  
  // Notify via Telegram with different message formats based on enabled state
  if (enabled) {
    telegram.sendMessage(`✅ Auto-trading has been enabled. The bot will now automatically execute trades according to your strategy.`);
  } else {
    // Add more details for disablement - indicate whether it was manual or system-initiated
    const disableReason = isStateChange ? 'manually' : 'already';
    telegram.sendMessage(`🛑 Auto-trading has been ${disableReason} disabled. No automatic trades will be executed until re-enabled.`);
  }
  
  // Emit auto-trading status change event
  binanceEvents.emit('auto_trading_status', { enabled: enabled });
}

/**
 * Register a handler for price updates
 * @param {Function} handler - The handler function(symbol, price)
 */
function onPriceUpdate(handler) {
  if (typeof handler === 'function') {
    binanceEvents.on('price_update', ({ symbol, price }) => {
      try {
        handler(symbol, price);
      } catch (error) {
        console.error('Error in price update handler:', error);
      }
    });
  }
}

/**
 * Register a handler for order updates
 * @param {Function} handler - The handler function(orderData)
 */
function onOrderUpdate(handler) {
  if (typeof handler === 'function') {
    binanceEvents.on('order_update', (orderData) => {
      try {
        handler(orderData);
      } catch (error) {
        console.error('Error in order update handler:', error);
      }
    });
  }
}

/**
 * Register a handler for connection changes
 * @param {Function} handler - The handler function(isConnected)
 */
function onConnectionChange(handler) {
  if (typeof handler === 'function') {
    binanceEvents.on('connection_change', (isConnected) => {
      try {
        handler(isConnected);
      } catch (error) {
        console.error('Error in connection change handler:', error);
      }
    });
  }
}

/**
 * Register a handler for auto-trading status changes
 * @param {Function} handler - The handler function(statusData)
 */
function onAutoTradingStatusChange(handler) {
  if (typeof handler === 'function') {
    binanceEvents.on('auto_trading_status', (statusData) => {
      try {
        handler(statusData);
      } catch (error) {
        console.error('Error in auto-trading status change handler:', error);
      }
    });
  }
}

/**
 * Notify price update handlers
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} price - The current price
 */
function notifyPriceUpdate(symbol, price) {
  // Check auto-trading
  checkAutoTrading(symbol, price);
  
  // Emit the event to all listeners
  binanceEvents.emit('price_update', { symbol, price });
}

/**
 * Notify order update handlers
 * @param {Object} orderData - The order data
 */
function notifyOrderUpdate(orderData) {
  binanceEvents.emit('order_update', orderData);
}

/**
 * Notify connection change handlers
 * @param {boolean} isConnected - Whether the connection is established
 */
function notifyConnectionChange(isConnected) {
  binanceEvents.emit('connection_change', isConnected);
}

/**
 * Get service health status
 * @returns {Object} Health status object
 */
function getHealthStatus() {
  return {
    isConnected: state.isConnected,
    tradingEnabled: state.tradingEnabled,
    autoTradingEnabled: state.autoTradingEnabled,
    wsStatus: state.serviceStatus.wsConnected,
    apiStatus: state.serviceStatus.apiConnected,
    lastError: state.serviceStatus.lastError,
    supportedSymbols: state.supportedSymbols,
    lastMessageTime: state.lastMessageTime ? new Date(state.lastMessageTime).toISOString() : null,
    priceUpdateAge: state.lastMessageTime ? (Date.now() - state.lastMessageTime) : null
  };
}

/**
 * Update account balances in the database
 * Fetches the latest account info from Binance and updates the database
 * @returns {Promise<Object>} The account information
 */
async function updateAccountBalances() {
  try {
    console.log('Fetching and updating account balances from Binance...');
    
    // Get account information from Binance
    const accountInfo = await getAccountInfo();
    
    if (!accountInfo || !accountInfo.balances) {
      throw new Error('Invalid account information received from Binance API');
    }
    
    // Extract balances for all supported symbols and USDT
    const relevantBalances = {};
    
    // First, initialize with all supported symbols (even if zero balance)
    for (const symbol of state.supportedSymbols) {
      relevantBalances[symbol] = 0;
    }
    
    // Add USDT
    relevantBalances['USDT'] = 0;
    
    // Now update with actual balances from account info
    for (const balance of accountInfo.balances) {
      const asset = balance.asset;
      const free = parseFloat(balance.free) || 0;
      const locked = parseFloat(balance.locked) || 0;
      const total = free + locked;
      
      // Only store info for supported symbols and USDT
      if (state.supportedSymbols.includes(asset) || asset === 'USDT') {
        relevantBalances[asset] = total;
      }
    }
    
    // Log balances before database update
    console.log('Balances retrieved from Binance:', 
      Object.fromEntries(
        Object.entries(relevantBalances).map(([key, value]) => 
          [key, parseFloat(value).toFixed(4)]
        )
      )
    );
    
    // Update database with the balances
    await db.updateAccountBalances(relevantBalances);
    
    return accountInfo;
  } catch (error) {
    console.error('Error updating account balances:', error);
    throw error;
  }
}

/**
 * Schedule regular balance updates
 * @param {number} intervalMs - Interval in milliseconds (default: 5 minutes)
 */
let balanceUpdateInterval = null;

function scheduleBalanceUpdates(intervalMs = 300000) {
  // Clear any existing interval
  if (balanceUpdateInterval) {
    clearInterval(balanceUpdateInterval);
  }
  
  // Set up new interval
  balanceUpdateInterval = setInterval(async () => {
    if (state.isConnected && state.serviceStatus.apiConnected) {
      try {
        await updateAccountBalances();
      } catch (error) {
        console.error('Scheduled balance update failed:', error);
      }
    }
  }, intervalMs);
  
  console.log(`Scheduled account balance updates every ${intervalMs/1000} seconds`);
}

/**
 * Close connections and clean up resources
 */
function close() {
  // Clear intervals
  if (state.wsReconnectInterval) {
    clearInterval(state.wsReconnectInterval);
    state.wsReconnectInterval = null;
  }
  
  if (state.wsHeartbeatInterval) {
    clearInterval(state.wsHeartbeatInterval);
    state.wsHeartbeatInterval = null;
  }
  
  if (balanceUpdateInterval) {
    clearInterval(balanceUpdateInterval);
    balanceUpdateInterval = null;
  }
  
  // Close WebSocket connection
  closeWebSocketConnection();
  
  // Reset connection state
  state.isConnected = false;
  state.tradingEnabled = false;
  state.serviceStatus.wsConnected = false;
  
  console.log('Binance connections closed');
  
  // Remove all event listeners
  binanceEvents.removeAllListeners();
}

// Export public API
module.exports = {
  initialize,
  isConnected: () => state.isConnected,
  getSymbolPrice,
  getAccountInfo,
  updateAccountBalances,
  scheduleBalanceUpdates,
  buyWithUsdt,
  sellAll,
  setAutoTrading,
  onPriceUpdate,
  onOrderUpdate,
  onConnectionChange,
  onAutoTradingStatusChange,
  getSupportedSymbols: () => [...state.supportedSymbols],
  getCurrentPrice: (symbol) => state.lastPrices.get(symbol) || 0,
  getHealthStatus,
  close
};