const WebSocket = require('ws');
const logger = require('../utils/logger');
const config = require('../../config');

// Store active WebSocket connections
const activeConnections = new Map();

// Store the latest prices for each symbol
const latestPrices = new Map();

// Connection status checker interval
let statusCheckInterval;

/**
 * Initialize WebSocket connection for a trading pair
 */
const initializeWebSocket = (symbol) => {
  if (activeConnections.has(symbol)) {
    logger.info(`WebSocket connection for ${symbol} already exists`);
    return;
  }
  
  // Format symbol for Binance WebSocket (lowercase)
  const formattedSymbol = symbol.toLowerCase();
  
  // Create WebSocket URL
  // Binance WebSocket API provides real-time market data
  // We're using the aggTrade stream which provides trade level data
  const wsBaseUrl = config.binance?.websocketUrl || 'wss://stream.binance.com:9443';
  const url = `${wsBaseUrl}/ws/${formattedSymbol}@aggTrade`;
  
  logger.info(`Initializing WebSocket connection for ${symbol} at ${url}`);
  
  const ws = new WebSocket(url);
  
  ws.on('open', () => {
    logger.info(`WebSocket connection opened for ${symbol}`);
    activeConnections.set(symbol, {
      ws,
      status: 'connected',
      lastMessageTime: Date.now(),
      reconnectAttempts: 0
    });
    
    // Log successful connection
    logger.info(`WebSocket connection established for ${symbol}`);
  });
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data);
      
      // Update connection status
      const connection = activeConnections.get(symbol);
      if (connection) {
        connection.lastMessageTime = Date.now();
        connection.status = 'connected';
      }
      
      // For aggTrade stream, price is in 'p' field
      if (message.p) {
        // Update latest price
        const price = parseFloat(message.p);
        const previousPrice = latestPrices.get(symbol);
        latestPrices.set(symbol, price);
        
        // Log price update (debug level to avoid flooding logs)
        logger.debug(`Price update for ${symbol}: ${price} (previous: ${previousPrice || 'none'})`);
        
        // Emit price update to connected clients if socket.io is available
        const io = global.io;
        if (io) {
          io.emit('priceUpdate', {
            symbol,
            price,
            timestamp: new Date().toISOString()
          });
        }
        
        // The trading algorithm processing will happen from binanceController
        // We don't directly import tradingService here to avoid circular dependencies
      }
    } catch (error) {
      logger.error(`Error processing WebSocket message for ${symbol}:`, error);
    }
  });
  
  ws.on('error', (error) => {
    logger.error(`WebSocket error for ${symbol}:`, error);
    
    const connection = activeConnections.get(symbol);
    if (connection) {
      connection.status = 'error';
    }
    
    closeWebSocket(symbol);
    
    // Try to reconnect after a delay
    setTimeout(() => {
      reconnectWebSocket(symbol);
    }, 5000);
  });
  
  ws.on('close', () => {
    logger.info(`WebSocket connection closed for ${symbol}`);
    
    const connection = activeConnections.get(symbol);
    if (connection) {
      connection.status = 'closed';
    }
    
    // Try to reconnect after a delay
    setTimeout(() => {
      reconnectWebSocket(symbol);
    }, 5000);
  });
  
  // Set a ping interval to keep the connection alive
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    } else {
      clearInterval(pingInterval);
    }
  }, 30000);
};

/**
 * Reconnect WebSocket with exponential backoff
 */
const reconnectWebSocket = (symbol) => {
  const connection = activeConnections.get(symbol);
  
  // If no connection record or connection is already active, do nothing
  if (!connection || (connection.ws && connection.ws.readyState === WebSocket.OPEN)) {
    return;
  }
  
  // Increment reconnect attempts
  connection.reconnectAttempts = (connection.reconnectAttempts || 0) + 1;
  
  // Calculate backoff delay (exponential with jitter)
  // Max delay of 60 seconds
  const baseDelay = Math.min(30000, Math.pow(2, connection.reconnectAttempts) * 1000);
  const jitter = Math.random() * 1000;
  const delay = baseDelay + jitter;
  
  logger.info(`Attempting to reconnect ${symbol} in ${Math.floor(delay / 1000)} seconds (attempt ${connection.reconnectAttempts})`);
  
  // Update connection status
  connection.status = 'reconnecting';
  activeConnections.set(symbol, connection);
  
  // Schedule reconnection
  setTimeout(() => {
    // Only reconnect if still not connected
    if (!connection.ws || connection.ws.readyState !== WebSocket.OPEN) {
      initializeWebSocket(symbol);
    }
  }, delay);
};

/**
 * Close WebSocket connection for a trading pair
 */
const closeWebSocket = (symbol) => {
  const connection = activeConnections.get(symbol);
  if (connection && connection.ws) {
    connection.ws.terminate();
    activeConnections.delete(symbol);
    logger.info(`WebSocket connection terminated for ${symbol}`);
  }
};

/**
 * Get the latest price for a symbol
 */
const getLatestPrice = (symbol) => {
  return latestPrices.get(symbol);
};

/**
 * Initialize WebSocket connections for all supported trading pairs
 */
const initializeAllWebSockets = async () => {
  try {
    // Import services dynamically to avoid circular dependencies
    const binanceService = require('./binanceService');
    
    // Get all trading pairs from database
    const tradingPairs = await binanceService.getTradingPairs();
    
    logger.info(`Initializing WebSocket connections for ${tradingPairs.length} trading pairs`);
    
    // Initialize connection for each pair
    for (const pair of tradingPairs) {
      initializeWebSocket(pair.symbol);
    }
    
    // Set up connection status checker
    setupConnectionStatusChecker();
    
    return { success: true, count: tradingPairs.length };
  } catch (error) {
    logger.error('Error initializing WebSocket connections:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Set up periodic connection status checker
 */
const setupConnectionStatusChecker = () => {
  // Clear existing interval if any
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }
  
  // Check connections every minute
  statusCheckInterval = setInterval(() => {
    const now = Date.now();
    
    activeConnections.forEach((connection, symbol) => {
      // If no message received in the last 5 minutes, consider the connection stale
      if (connection.lastMessageTime && now - connection.lastMessageTime > 5 * 60 * 1000) {
        logger.warn(`WebSocket connection for ${symbol} appears stale. Last message: ${new Date(connection.lastMessageTime).toISOString()}`);
        
        // Force reconnection
        closeWebSocket(symbol);
        reconnectWebSocket(symbol);
      }
    });
  }, 60000);
};

/**
 * Get status of all WebSocket connections
 */
const getConnectionStatus = () => {
  const status = {};
  
  activeConnections.forEach((connection, symbol) => {
    status[symbol] = {
      status: connection.status,
      lastMessageTime: connection.lastMessageTime ? new Date(connection.lastMessageTime).toISOString() : null,
      reconnectAttempts: connection.reconnectAttempts || 0
    };
  });
  
  return status;
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

module.exports = {
  initializeWebSocket,
  closeWebSocket,
  getLatestPrice,
  initializeAllWebSockets,
  getConnectionStatus,
  broadcastPriceUpdate
};