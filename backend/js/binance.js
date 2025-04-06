// backend/js/binance.js
// Binance API Integration Module
// Responsible for connecting to Binance API for trading operations and price updates

const WebSocket = require('ws');
const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');

// Import internal modules
const db = require('./dbconns');
const telegram = require('./telegram');

// Load environment variables
dotenv.config();

// Binance API configuration
const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
const BINANCE_API_SECRET = process.env.BINANCE_API_SECRET;
const BINANCE_API_URL = 'https://testnet.binance.vision/api'; // Use testnet API URL
const BINANCE_WS_URL = 'wss://stream.binance.com:9443/ws';

// Module state
const state = {
  websocket: null,
  isConnected: false,
  subscriptions: new Map(), // Map of symbol -> callback
  lastPrices: new Map(), // Map of symbol -> price
  pricePollInterval: null,
  tradingEnabled: false,
  autoTradingEnabled: false,
  supportedSymbols: ['BTC', 'SOL', 'XRP', 'PENDLE', 'DOGE', 'NEAR']
};

// Event handlers
const eventHandlers = {
  priceUpdate: new Set(),
  orderUpdate: new Set(),
  connectionChange: new Set()
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
    await getExchangeInfo();
    console.log('Binance API connection successful');
    
    // Initialize WebSocket connection
    initializeWebSocket();
    
    // Start price polling as a fallback
    startPricePolling();
    
    state.tradingEnabled = true;
    
    // Notify via Telegram
    telegram.sendMessage('= Connected to Binance API successfully');
    
    return true;
  } catch (error) {
    console.error('Failed to initialize Binance API:', error);
    telegram.sendErrorNotification('Failed to connect to Binance API: ' + error.message);
    return false;
  }
}

/**
 * Initialize WebSocket connection for price updates
 */
function initializeWebSocket() {
  try {
    // Close existing connection if needed
    if (state.websocket) {
      state.websocket.terminate();
    }
    
    // Create streams for all supported symbols
    const streams = state.supportedSymbols.map(symbol => 
      `${symbol.toLowerCase()}usdt@bookTicker`
    );
    
    // Create WebSocket connection with multiple streams
    const wsUrl = `${BINANCE_WS_URL}/stream?streams=${streams.join('/')}`;
    state.websocket = new WebSocket(wsUrl);
    
    // Set up WebSocket event handlers
    state.websocket.on('open', () => {
      console.log('Binance WebSocket connection opened');
      state.isConnected = true;
      
      // Notify connection status change
      notifyConnectionChange(true);
    });
    
    state.websocket.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        // Handle multi-stream message format
        if (message.data && message.stream) {
          const streamData = message.data;
          const streamName = message.stream;
          
          // Parse symbol from stream name (e.g., "btcusdt@bookTicker" -> "BTC")
          const symbolMatch = streamName.match(/([a-z]+)usdt@bookTicker/);
          if (symbolMatch && symbolMatch[1]) {
            const symbol = symbolMatch[1].toUpperCase();
            
            // Extract price from data
            const price = parseFloat(streamData.a); // Best ask price
            
            // Update last price
            state.lastPrices.set(symbol, price);
            
            // Call price update handlers
            notifyPriceUpdate(symbol, price);
          }
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    });
    
    state.websocket.on('error', (error) => {
      console.error('Binance WebSocket error:', error);
      notifyConnectionChange(false);
    });
    
    state.websocket.on('close', () => {
      console.log('Binance WebSocket connection closed');
      state.isConnected = false;
      notifyConnectionChange(false);
      
      // Reconnect after 5 seconds
      setTimeout(() => {
        if (!state.isConnected) {
          console.log('Reconnecting to Binance WebSocket...');
          initializeWebSocket();
        }
      }, 5000);
    });
    
    // Set up ping to keep connection alive
    setInterval(() => {
      if (state.websocket && state.websocket.readyState === WebSocket.OPEN) {
        state.websocket.ping();
      }
    }, 30000);
    
  } catch (error) {
    console.error('Error initializing WebSocket:', error);
    notifyConnectionChange(false);
  }
}

/**
 * Start polling for price updates as a fallback
 */
function startPricePolling() {
  // Clear existing interval if needed
  if (state.pricePollInterval) {
    clearInterval(state.pricePollInterval);
  }
  
  // Set up polling interval (every 10 seconds)
  state.pricePollInterval = setInterval(async () => {
    // Only poll if WebSocket is not connected
    if (!state.isConnected) {
      try {
        for (const symbol of state.supportedSymbols) {
          const ticker = await getSymbolPrice(`${symbol}USDT`);
          if (ticker && ticker.price) {
            const price = parseFloat(ticker.price);
            state.lastPrices.set(symbol, price);
            notifyPriceUpdate(symbol, price);
          }
        }
      } catch (error) {
        console.error('Error polling prices:', error);
      }
    }
  }, 10000);
}

/**
 * Get current price for a symbol
 * @param {string} symbol - The trading pair symbol (e.g., "BTCUSDT")
 * @returns {Promise<Object>} The ticker data
 */
async function getSymbolPrice(symbol) {
  try {
    const response = await axios.get(`${BINANCE_API_URL}/v3/ticker/price`, {
      params: { symbol }
    });
    return response.data;
  } catch (error) {
    console.error(`Error getting price for ${symbol}:`, error);
    throw error;
  }
}

/**
 * Get exchange information
 * @returns {Promise<Object>} The exchange information
 */
async function getExchangeInfo() {
  try {
    const response = await axios.get(`${BINANCE_API_URL}/v3/exchangeInfo`);
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
    // Add timestamp parameter
    params.timestamp = Date.now();
    
    // Create signature
    const signature = createSignature(params);
    params.signature = signature;
    
    // Make request
    const config = {
      method,
      url: `${BINANCE_API_URL}${endpoint}`,
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
    
    const response = await axios(config);
    return response.data;
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
 * Place a market order
 * @param {Object} orderData - The order data
 * @param {string} orderData.symbol - The trading pair symbol (e.g., "BTCUSDT")
 * @param {string} orderData.side - The order side (BUY/SELL)
 * @param {number} orderData.quantity - The quantity to buy/sell
 * @returns {Promise<Object>} The order result
 */
async function placeMarketOrder(orderData) {
  if (!state.tradingEnabled) {
    throw new Error('Trading is currently disabled');
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
    
    // Execute the order
    const result = await signedRequest('/v3/order', 'POST', params);
    
    // Log and notify
    console.log(`Market order executed: ${side} ${quantity} ${symbol}`);
    
    // Calculate USD value
    const price = parseFloat(result.fills[0].price);
    const usdt = price * parseFloat(quantity);
    
    // Record trade in database
    const baseCurrency = symbol.replace('USDT', '');
    await db.recordTrade({
      symbol: baseCurrency,
      action: side.toLowerCase(),
      quantity: parseFloat(quantity),
      price: price,
      usdt_amount: usdt
    });
    
    // Send notification
    telegram.sendTradeNotification({
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
    // Get current price
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
 * Format quantity with appropriate precision
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} quantity - The quantity to format
 * @returns {string} The formatted quantity
 */
function formatQuantity(symbol, quantity) {
  // Default precisions (these can be fetched from exchangeInfo in a production environment)
  const precisions = {
    'BTC': 5,
    'SOL': 2,
    'XRP': 1,
    'PENDLE': 1,
    'DOGE': 0,
    'NEAR': 1
  };
  
  const precision = precisions[symbol] || 2;
  
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
  if (!state.autoTradingEnabled) {
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
  state.autoTradingEnabled = enabled;
  console.log(`Auto-trading ${enabled ? 'enabled' : 'disabled'}`);
  
  // Notify via Telegram
  telegram.sendMessage(`> Auto-trading has been ${enabled ? 'enabled' : 'disabled'}`);
}

/**
 * Register a handler for price updates
 * @param {Function} handler - The handler function(symbol, price)
 */
function onPriceUpdate(handler) {
  if (typeof handler === 'function') {
    eventHandlers.priceUpdate.add(handler);
  }
}

/**
 * Register a handler for order updates
 * @param {Function} handler - The handler function(orderData)
 */
function onOrderUpdate(handler) {
  if (typeof handler === 'function') {
    eventHandlers.orderUpdate.add(handler);
  }
}

/**
 * Register a handler for connection changes
 * @param {Function} handler - The handler function(isConnected)
 */
function onConnectionChange(handler) {
  if (typeof handler === 'function') {
    eventHandlers.connectionChange.add(handler);
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
  
  // Notify handlers
  eventHandlers.priceUpdate.forEach(handler => {
    try {
      handler(symbol, price);
    } catch (error) {
      console.error('Error in price update handler:', error);
    }
  });
}

/**
 * Notify order update handlers
 * @param {Object} orderData - The order data
 */
function notifyOrderUpdate(orderData) {
  eventHandlers.orderUpdate.forEach(handler => {
    try {
      handler(orderData);
    } catch (error) {
      console.error('Error in order update handler:', error);
    }
  });
}

/**
 * Notify connection change handlers
 * @param {boolean} isConnected - Whether the connection is established
 */
function notifyConnectionChange(isConnected) {
  eventHandlers.connectionChange.forEach(handler => {
    try {
      handler(isConnected);
    } catch (error) {
      console.error('Error in connection change handler:', error);
    }
  });
}

/**
 * Close connections and clean up resources
 */
function close() {
  // Close WebSocket
  if (state.websocket) {
    state.websocket.terminate();
    state.websocket = null;
  }
  
  // Clear price polling interval
  if (state.pricePollInterval) {
    clearInterval(state.pricePollInterval);
    state.pricePollInterval = null;
  }
  
  console.log('Binance connections closed');
}

// Export public API
module.exports = {
  initialize,
  isConnected: () => state.isConnected,
  getSymbolPrice,
  getAccountInfo,
  buyWithUsdt,
  sellAll,
  setAutoTrading,
  onPriceUpdate,
  onOrderUpdate,
  onConnectionChange,
  getSupportedSymbols: () => [...state.supportedSymbols],
  getCurrentPrice: (symbol) => state.lastPrices.get(symbol) || 0,
  close
};