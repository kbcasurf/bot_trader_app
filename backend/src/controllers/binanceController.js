const binanceService = require('../services/binanceService');
const tradingService = require('../services/tradingService');
const websocketService = require('../services/websocketService');
const telegramService = require('../services/telegramService');
const logger = require('../utils/logger');

// Get all supported trading pairs
exports.getTradingPairs = async (req, res, next) => {
  try {
    const tradingPairs = await binanceService.getTradingPairs();
    res.json(tradingPairs);
  } catch (error) {
    next(error);
  }
};

// Get current price for a symbol
exports.getCurrentPrice = async (req, res, next) => {
  try {
    const { symbol } = req.params;
    
    // First try to get price from WebSocket cache if available
    let price = null;
    try {
      price = websocketService.getLatestPrice(symbol);
    } catch (error) {
      logger.debug(`WebSocket price not available for ${symbol}. Falling back to API.`);
    }
    
    // If not available in WebSocket cache, fetch from Binance API
    if (!price) {
      price = await binanceService.getCurrentPrice(symbol);
    }
    
    res.json({ symbol, price });
  } catch (error) {
    logger.error(`Error getting current price for ${req.params.symbol}:`, error);
    next(error);
  }
};

// Get holdings for a trading pair
exports.getHoldings = async (req, res, next) => {
  try {
    const { tradingPairId } = req.params;
    const holdings = await binanceService.getHoldings(tradingPairId);
    
    // Get current price to calculate current value
    const tradingPair = await binanceService.getTradingPairById(tradingPairId);
    const currentPrice = await binanceService.getCurrentPrice(tradingPair.symbol);
    
    // Add current value and profit/loss information
    const result = {
      ...holdings,
      currentPrice,
      currentValue: holdings.quantity * currentPrice,
      profitLoss: holdings.averageBuyPrice > 0 
        ? ((currentPrice - holdings.averageBuyPrice) / holdings.averageBuyPrice) * 100 
        : 0
    };
    
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// Get transaction history for a trading pair
exports.getTransactions = async (req, res, next) => {
  try {
    const { tradingPairId } = req.params;
    const transactions = await binanceService.getTransactions(tradingPairId);
    res.json(transactions);
  } catch (error) {
    next(error);
  }
};

// Execute a buy order
exports.buyOrder = async (req, res, next) => {
  try {
    const { tradingPairId, amount } = req.body;
    
    if (!tradingPairId || !amount) {
      return res.status(400).json({ error: 'Trading pair ID and amount are required' });
    }
    
    const transaction = await binanceService.executeBuyOrder(tradingPairId, amount);
    
    // Initialize trading if this is the first purchase
    try {
      await tradingService.initializeTrading(tradingPairId, amount);
    } catch (initError) {
      logger.error(`Error initializing trading for pair ${tradingPairId}:`, initError);
    }
    
    res.json(transaction);
  } catch (error) {
    next(error);
  }
};

// Execute a sell all order
exports.sellAllOrder = async (req, res, next) => {
  try {
    const { tradingPairId } = req.body;
    
    if (!tradingPairId) {
      return res.status(400).json({ error: 'Trading pair ID is required' });
    }
    
    const transaction = await binanceService.executeSellAllOrder(tradingPairId, { reason: 'MANUAL_SELL_ALL' });
    
    // Stop trading for this pair
    try {
      await tradingService.stopTrading(tradingPairId);
    } catch (stopError) {
      logger.error(`Error stopping trading for pair ${tradingPairId}:`, stopError);
    }
    
    res.json(transaction);
  } catch (error) {
    next(error);
  }
};

// Get trading status for all pairs
exports.getTradingStatus = async (req, res, next) => {
  try {
    const status = await tradingService.getTradingStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
};

// Start trading for a pair
exports.startTrading = async (req, res, next) => {
  try {
    const { tradingPairId, initialInvestment } = req.body;
    
    if (!tradingPairId || !initialInvestment) {
      return res.status(400).json({ error: 'Trading pair ID and initial investment are required' });
    }
    
    const result = await tradingService.initializeTrading(tradingPairId, initialInvestment);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// Stop trading for a pair
exports.stopTrading = async (req, res, next) => {
  try {
    const { tradingPairId } = req.body;
    
    if (!tradingPairId) {
      return res.status(400).json({ error: 'Trading pair ID is required' });
    }
    
    const result = await tradingService.stopTrading(tradingPairId);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

// Get WebSocket connection status
exports.getWebSocketStatus = async (req, res, next) => {
  try {
    let status = {};
    
    try {
      status = websocketService.getConnectionStatus();
    } catch (wsError) {
      logger.error('Error getting WebSocket connection status:', wsError);
      status = { error: wsError.message };
    }
    
    res.json(status);
  } catch (error) {
    next(error);
  }
};

// Restart WebSocket connections
exports.restartWebSockets = async (req, res, next) => {
  try {
    let result = {};
    
    try {
      result = await websocketService.initializeAllWebSockets();
    } catch (wsError) {
      logger.error('Error restarting WebSocket connections:', wsError);
      result = { success: false, error: wsError.message };
    }
    
    res.json(result);
  } catch (error) {
    next(error);
  }
};