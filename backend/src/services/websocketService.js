// backend/src/services/websocketService.js
const WebSocket = require('ws');
const logger = require('../utils/logger');

// Avoid importing other services that might import this one
// We'll use function parameters instead

// Single WebSocket connection
let websocket = null;
let reconnectTimeout = null;
let reconnectAttempts = 0;

// Store the latest prices for each symbol
const latestPrices = new Map();

// Connection status
let connectionStatus = {
  status: 'disconnected',
  lastMessageTime: null,
  reconnectAttempts: 0
};

// Health check interval
let healthCheckInterval = null;

/**
 * Initialize a single WebSocket connection for all trading pairs
 */
const initializeWebSocket = async (tradingPairs, wsBaseUrl) => {
  // Clear any existing connection and timeouts
  if (websocket) {
    websocket.terminate();
    websocket = null;
  }
  
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  
  if (!tradingPairs || tradingPairs.length === 0) {
    logger.error('No trading pairs provided for WebSocket initialization');
    return false;
  }
  
  // Create stream parameter for all trading pairs
  const streams = tradingPairs
    .map(pair => `${pair.symbol.toLowerCase()}@bookTicker`)
    .join('/');
  
  // Create WebSocket URL for combined stream
  const url = `${wsBaseUrl}/stream?streams=${streams}`;
  
  logger.info(`Initializing combined WebSocket connection at ${url}`);
  
  try {
    // Create new WebSocket connection
    websocket = new WebSocket(url);
    
    // Set up handlers
    websocket.on('open', handleOpen);
    websocket.on('message', data => handleMessage(data));
    websocket.on('error', handleError);
    websocket.on('close', handleClose);
    
    // Start health check interval
    setupHealthCheck();
    
    return true;
  } catch (error) {
    logger.error('Error initializing WebSocket connection:', error);
    scheduleReconnect(tradingPairs, wsBaseUrl);
    return false;
  }
};

/**
 * Handle WebSocket open event
 */
const handleOpen = () => {
  logger.info('Combined WebSocket connection established');
  
  // Reset reconnect attempts on successful connection
  reconnectAttempts = 0;
  
  // Update connection status
  connectionStatus = {
    status: 'connected',
    lastMessageTime: Date.now(),
    reconnectAttempts: 0
  };
  
  // Broadcast connection status to clients
  broadcastConnectionStatus();
};

/**
 * Handle WebSocket message event
 */
const handleMessage = async (data) => {
  try {
    const message = JSON.parse(data);
    
    // Update connection status
    connectionStatus.lastMessageTime = Date.now();
    
    // Process message from combined stream
    // For combined streams, the message format is { stream: "symbol@bookTicker", data: {...} }
    if (message.stream && message.data) {
      // Extract symbol and price from bookTicker data
      const streamData = message.data;
      const symbol = streamData.s; // Symbol in uppercase (e.g., "BTCUSDT")
      const askPrice = parseFloat(streamData.a); // Best ask price as our current price
      
      // Update latest price
      const previousPrice = latestPrices.get(symbol);
      latestPrices.set(symbol, askPrice);
      
      // Log price update (debug level to avoid flooding logs)
      logger.debug(`Price update for ${symbol}: ${askPrice} (previous: ${previousPrice || 'none'})`);
      
      // Broadcast price update to connected clients
      broadcastPriceUpdate(symbol, askPrice);
    }
  } catch (error) {
    logger.error('Error processing WebSocket message:', error);
  }
};

/**
 * Handle WebSocket error event
 */
  handleError = (error) => {
    logger.error('WebSocket error:', error);
    connectionStatus.status = 'error';
    broadcastConnectionStatus();
  
  // Force reconnection on certain errors
  if (websocket) {
    try {
      websocket.terminate();
    } catch (e) {
      // Ignore terminate errors
    }
    websocket = null;
    
    // Schedule reconnection
    const binanceService = require('./binanceService');
    scheduleReconnect(null, binanceService.WEBSOCKET_URL);
  }
}; 

/**
 * Handle WebSocket close event
 */
const handleClose = (code, reason) => {
  logger.warn(`WebSocket connection closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
  connectionStatus.status = 'disconnected';
  broadcastConnectionStatus();
  
  // Schedule reconnection - pass everything needed as parameters to avoid circular dependencies
  const binanceService = require('./binanceService');
  scheduleReconnect(null, binanceService.WEBSOCKET_URL);
};

/**
 * Schedule WebSocket reconnection with exponential backoff
 */
const scheduleReconnect = (tradingPairs, wsBaseUrl) => {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
  }
  
  reconnectAttempts++;
  
  // Calculate backoff delay (exponential with jitter)
  // Max delay of 60 seconds
  const baseDelay = Math.min(30000, Math.pow(2, reconnectAttempts) * 1000);
  const jitter = Math.random() * 1000;
  const delay = baseDelay + jitter;
  
  logger.info(`Scheduling WebSocket reconnection in ${Math.floor(delay / 1000)} seconds (attempt ${reconnectAttempts})`);
  
  // Update connection status
  connectionStatus = {
    status: 'reconnecting',
    lastMessageTime: connectionStatus.lastMessageTime,
    reconnectAttempts: reconnectAttempts
  };
  
  broadcastConnectionStatus();
  
  // Schedule reconnection
  reconnectTimeout = setTimeout(async () => {
    // Get fresh trading pairs for reconnection
    try {
      // If trading pairs weren't provided, fetch them
      let pairs = tradingPairs;
      if (!pairs) {
        const binanceService = require('./binanceService');
        pairs = await binanceService.getTradingPairs();
      }
      await initializeWebSocket(pairs, wsBaseUrl);
    } catch (error) {
      logger.error('Error getting trading pairs for reconnection:', error);
      // Try to reconnect with empty pairs as a fallback
      await initializeWebSocket([], wsBaseUrl);
    }
  }, delay);
};

/**
 * Set up health check interval to monitor connection
 */
const setupHealthCheck = () => {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
  }
  
  // Check connection health every 30 seconds
  healthCheckInterval = setInterval(() => {
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      logger.warn('WebSocket health check failed: Connection not open');
      return;
    }
    
    const now = Date.now();
    const lastMessageAge = now - (connectionStatus.lastMessageTime || 0);
    
    // If no message received in the last 2 minutes, consider the connection stale
    if (lastMessageAge > 2 * 60 * 1000) {
      logger.warn(`WebSocket connection appears stale. Last message received ${Math.floor(lastMessageAge / 1000)} seconds ago`);
      
      // Force reconnection
      if (websocket) {
        websocket.terminate();
        websocket = null;
      }
      
      const binanceService = require('./binanceService');
      scheduleReconnect(null, binanceService.WEBSOCKET_URL);
    } else {
      // Send ping to keep connection alive
      if (websocket.readyState === WebSocket.OPEN) {
        websocket.ping();
      }
    }
  }, 30000);
};

/**
 * Get the latest price for a symbol
 */
const getLatestPrice = (symbol) => {
  // Ensure symbol is in uppercase
  const normalizedSymbol = symbol.toUpperCase();
  
  // Get price from cache
  const price = latestPrices.get(normalizedSymbol);
  
  if (price === undefined) {
    throw new Error(`No price available for ${normalizedSymbol} from WebSocket`);
  }
  
  return price;
};

/**
 * Get status of the WebSocket connection
 */
const getConnectionStatus = () => {
  const status = {
    ...connectionStatus,
    lastMessageTime: connectionStatus.lastMessageTime 
      ? new Date(connectionStatus.lastMessageTime).toISOString() 
      : null,
    symbolsWithPrices: Array.from(latestPrices.keys()),
    priceCount: latestPrices.size,
    connectionState: websocket ? websocket.readyState : -1
  };
  
  return status;
};

/**
 * Initialize WebSocket connection for all supported trading pairs
 */
const initializeAllWebSockets = async () => {
  try {
    // Import modules here to avoid circular dependencies
    const binanceService = require('./binanceService');
    
    // Get all trading pairs from database
    const tradingPairs = await binanceService.getTradingPairs();
    
    logger.info(`Initializing WebSocket connection for ${tradingPairs.length} trading pairs`);
    
    // Initialize single connection for all pairs
    const success = await initializeWebSocket(tradingPairs, binanceService.WEBSOCKET_URL);
    
    return { success, count: tradingPairs.length };
  } catch (error) {
    logger.error('Error initializing WebSocket connection:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Broadcast price update to all clients
 */
const broadcastPriceUpdate = (symbol, price) => {
  const io = global.io;
  
  if (!io) {
    logger.warn('Socket.IO instance not available for broadcasting price update');
    return;
  }
  
  io.emit('priceUpdate', {
    symbol,
    price,
    timestamp: new Date().toISOString()
  });
};

/**
 * Broadcast connection status to all clients
 */
const broadcastConnectionStatus = () => {
  const io = global.io;
  
  if (!io) {
    logger.warn('Socket.IO instance not available for broadcasting connection status');
    return;
  }
  
  io.emit('websocketStatus', {
    ...connectionStatus,
    lastMessageTime: connectionStatus.lastMessageTime 
      ? new Date(connectionStatus.lastMessageTime).toISOString() 
      : null
  });
};

// Module exports
module.exports = {
  initializeWebSocket,
  getLatestPrice,
  initializeAllWebSockets,
  getConnectionStatus,
  broadcastPriceUpdate
};