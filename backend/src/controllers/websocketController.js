// backend/src/controllers/websocketController.js
const websocketService = require('../services/websocketService');
const logger = require('../utils/logger');

/**
 * Initialize WebSocket connections for all supported trading pairs
 */
exports.initializeWebSockets = async (io) => {
  try {
    logger.info('Initializing WebSocket connections for price updates');
    
    // Store socket.io instance for later use
    global.io = io;
    
    // Initialize WebSocket connections
    const result = await websocketService.initializeAllWebSockets();
    
    logger.info(`WebSocket connections initialized for ${result.count} trading pairs`);
    
    return result;
  } catch (error) {
    logger.error('Error initializing WebSocket connections:', error);
    throw error;
  }
};

/**
 * Handle WebSocket connection
 */
exports.handleConnection = (socket) => {
  logger.info(`Client connected: ${socket.id}`);
  
  // Send initial data to client
  sendInitialData(socket);
  
  // Subscribe to trading pairs
  socket.on('subscribeTradingPair', async (tradingPairId) => {
    try {
      logger.info(`Client ${socket.id} subscribed to trading pair ${tradingPairId}`);
      
      // Join room for this trading pair
      socket.join(`tradingPair-${tradingPairId}`);
      
      // Send current data for this trading pair
      // Import services dynamically to avoid circular dependencies
      const binanceService = require('../services/binanceService');
      
      const tradingPair = await binanceService.getTradingPairById(tradingPairId);
      
      // Get holdings data
      const holdings = await binanceService.getHoldings(tradingPairId);
      const transactions = await binanceService.getTransactions(tradingPairId);
      
      // Try to get current price
      let currentPrice = null;
      try {
        currentPrice = websocketService.getLatestPrice(tradingPair.symbol);
      } catch (priceError) {
        logger.warn(`No price data available for ${tradingPair.symbol} when client subscribed`);
      }
      
      socket.emit('tradingPairData', {
        tradingPair,
        currentPrice,
        holdings,
        transactions
      });
    } catch (error) {
      logger.error(`Error handling tradingPair subscription for ${tradingPairId}:`, error);
      socket.emit('error', { message: 'Error subscribing to trading pair' });
    }
  });
  
  // Unsubscribe from trading pairs
  socket.on('unsubscribeTradingPair', (tradingPairId) => {
    logger.info(`Client ${socket.id} unsubscribed from trading pair ${tradingPairId}`);
    socket.leave(`tradingPair-${tradingPairId}`);
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
};

/**
 * Send initial data to client upon connection
 */
const sendInitialData = async (socket) => {
  try {
    // Import services dynamically to avoid circular dependencies
    const binanceService = require('../services/binanceService');
    const tradingService = require('../services/tradingService');
    
    // Get all trading pairs
    const tradingPairs = await binanceService.getTradingPairs();
    
    // Get trading status
    const tradingStatus = await tradingService.getTradingStatus();
    
    // Send data to client
    socket.emit('initialData', {
      tradingPairs,
      tradingStatus
    });
  } catch (error) {
    logger.error('Error sending initial data to client:', error);
    socket.emit('error', { message: 'Error loading initial data' });
  }
};

/**
 * Broadcast price update to all clients
 */
exports.broadcastPriceUpdate = (symbol, price) => {
  const io = global.io;
  if (!io) return;
  
  io.emit('priceUpdate', { symbol, price, timestamp: new Date().toISOString() });
};
/**
 * Broadcast transaction update to all clients
 */
exports.broadcastTransactionUpdate = async (tradingPairId, transaction) => {
  const io = global.io;
  
  if (!io) {
    logger.warn('Socket.IO instance not available for broadcasting transaction update');
    return;
  }
  
  try {
    // Import services dynamically to avoid circular dependencies
    const binanceService = require('../services/binanceService');
    
    // Get updated holdings
    const holdings = await binanceService.getHoldings(tradingPairId);
    
    // Broadcast to the specific room for this trading pair
    io.to(`tradingPair-${tradingPairId}`).emit('transactionUpdate', {
      tradingPairId,
      transaction,
      holdings
    });
    
    // Also broadcast to everyone
    io.emit('globalTransactionUpdate', {
      tradingPairId,
      transaction
    });
  } catch (error) {
    logger.error('Error broadcasting transaction update:', error);
  }
};