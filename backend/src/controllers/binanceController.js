const binanceService = require('../services/binanceService');
const telegramService = require('../services/telegramService');

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
    const price = await binanceService.getCurrentPrice(symbol);
    res.json({ symbol, price });
  } catch (error) {
    next(error);
  }
};

// Get holdings for a trading pair
exports.getHoldings = async (req, res, next) => {
  try {
    const { tradingPairId } = req.params;
    const holdings = await binanceService.getHoldings(tradingPairId);
    res.json(holdings);
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
    
    // Send notification via Telegram
    const tradingPair = await binanceService.getTradingPairById(tradingPairId);
    await telegramService.sendNotification(
      `✅ BUY Order Executed\n` +
      `Pair: ${tradingPair.displayName}\n` +
      `Amount: $${amount}\n` +
      `Quantity: ${transaction.quantity}\n` +
      `Price: $${transaction.price}\n` +
      `Time: ${new Date().toLocaleString()}`
    );
    
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
    
    const transaction = await binanceService.executeSellAllOrder(tradingPairId);
    
    // Send notification via Telegram
    const tradingPair = await binanceService.getTradingPairById(tradingPairId);
    await telegramService.sendNotification(
      `🔴 SELL ALL Order Executed\n` +
      `Pair: ${tradingPair.displayName}\n` +
      `Quantity: ${transaction.quantity}\n` +
      `Price: ${transaction.price}\n` +
      `Total Amount: ${(transaction.quantity * transaction.price).toFixed(2)}\n` +
      `Time: ${new Date().toLocaleString()}`
    );
    
    res.json(transaction);
  } catch (error) {
    next(error);
  }
};