const Binance = require('node-binance-api');
const crypto = require('crypto');
const axios = require('axios');
const db = require('../../config/database');
const logger = require('../utils/logger');
const telegramService = require('./telegramService');

// Environment variables
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;
const API_URL = process.env.BINANCE_API_URL || 'https://testnet.binance.vision';

// Initialize Binance API client
const binance = new Binance().options({
  APIKEY: API_KEY,
  APISECRET: API_SECRET,
  urls: {
    base: API_URL
  },
  // Enable test mode for Phase 2 (disable in production)
  test: true
});

/**
 * Utility function to sign a request for Binance API
 */
const signRequest = (queryString) => {
  return crypto
    .createHmac('sha256', API_SECRET)
    .update(queryString)
    .digest('hex');
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
 * Get current price for a symbol from Binance
 */
exports.getCurrentPrice = async (symbol) => {
  try {
    // In Phase 2, we'll use Binance API for real price data but with some error handling
    try {
      // Try getting price from Binance API
      const ticker = await binance.prices(symbol);
      return parseFloat(ticker[symbol]);
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
    
    // Start transaction
    await conn.beginTransaction();
    
    // Insert transaction record
    const transactionResult = await conn.query(
      `INSERT INTO transactions 
       (trading_pair_id, transaction_type, quantity, price, total_amount, status, binance_order_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tradingPairId, 'BUY', quantity, currentPrice, amount, 'PENDING', null]
    );
    
    const transactionId = transactionResult.insertId;
    
    // Try to execute order on Binance
    let binanceOrderId = null;
    let orderStatus = 'COMPLETED'; // Default for test mode
    
    try {
      if (!options.skipBinanceOrder) {
        // Format symbol and quantity according to Binance requirements
        const formattedSymbol = tradingPair.symbol;
        
        // Get symbol info for precision
        const exchangeInfo = await binance.exchangeInfo();
        const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === formattedSymbol);
        
        // Format quantity with proper precision
        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        const stepSize = parseFloat(lotSizeFilter.stepSize);
        const precision = Math.log10(1 / stepSize);
        const formattedQuantity = parseFloat(quantity.toFixed(Math.floor(precision)));
        
        // Execute market order
        const order = await binance.marketBuy(formattedSymbol, formattedQuantity);
        
        binanceOrderId = order.orderId;
        orderStatus = 'COMPLETED';
        
        logger.info(`Binance BUY order executed: ${tradingPair.symbol}, ${quantity}, $${currentPrice}, OrderID: ${binanceOrderId}`);
      } else {
        logger.info(`Simulated BUY order: ${tradingPair.symbol}, ${quantity}, $${currentPrice}`);
      }
    } catch (orderError) {
      logger.error(`Error executing Binance BUY order:`, orderError);
      
      // Even if Binance order fails, we proceed with local transaction for simulation purposes
      orderStatus = 'FAILED';
      
      // Send error notification
      await telegramService.sendErrorNotification(
        orderError, 
        `Failed to execute BUY order for ${tradingPair.displayName}`
      );
    }
    
    // Update transaction status
    await conn.query(
      `UPDATE transactions SET status = ?, binance_order_id = ? WHERE id = ?`,
      [orderStatus, binanceOrderId, transactionId]
    );
    
    // If order failed on Binance but we're in test mode, still update holdings for simulation
    if (orderStatus === 'COMPLETED' || options.forceUpdateHoldings) {
      // Update or insert holdings
      const existingHoldings = await conn.query(
        'SELECT * FROM holdings WHERE trading_pair_id = ?',
        [tradingPairId]
      );
      
      if (existingHoldings.length > 0) {
        // Update existing holdings
        const currentHoldings = existingHoldings[0];
        const currentQuantity = parseFloat(currentHoldings.quantity);
        const newQuantity = currentQuantity + quantity;
        
        // Calculate new average buy price
        const currentValue = currentQuantity * parseFloat(currentHoldings.average_buy_price || 0);
        const newValue = quantity * currentPrice;
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
          [tradingPairId, quantity, currentPrice, currentPrice]
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
        quantity,
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
      quantity: parseFloat(quantity.toFixed(8)),
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
 * Execute a sell order for a specific quantity
 */
exports.executeSellOrder = async (tradingPairId, quantity, options = {}) => {
  let conn;
  try {
    conn = await db.getConnection();
    
    // Get trading pair information
    const tradingPair = await exports.getTradingPairById(tradingPairId);
    
    // Get current price from Binance
    const currentPrice = await exports.getCurrentPrice(tradingPair.symbol);
    
    // Calculate total amount
    const totalAmount = quantity * currentPrice;
    
    // Start transaction
    await conn.beginTransaction();
    
    // Insert transaction record
    const transactionResult = await conn.query(
      `INSERT INTO transactions 
       (trading_pair_id, transaction_type, quantity, price, total_amount, status, binance_order_id) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [tradingPairId, 'SELL', quantity, currentPrice, totalAmount, 'PENDING', null]
    );
    
    const transactionId = transactionResult.insertId;
    
    // Try to execute order on Binance
    let binanceOrderId = null;
    let orderStatus = 'COMPLETED'; // Default for test mode
    
    try {
      if (!options.skipBinanceOrder) {
        // Format symbol and quantity according to Binance requirements
        const formattedSymbol = tradingPair.symbol;
        
        // Get symbol info for precision
        const exchangeInfo = await binance.exchangeInfo();
        const symbolInfo = exchangeInfo.symbols.find(s => s.symbol === formattedSymbol);
        
        // Format quantity with proper precision
        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        const stepSize = parseFloat(lotSizeFilter.stepSize);
        const precision = Math.log10(1 / stepSize);
        const formattedQuantity = parseFloat(quantity.toFixed(Math.floor(precision)));
        
        // Execute market order
        const order = await binance.marketSell(formattedSymbol, formattedQuantity);
        
        binanceOrderId = order.orderId;
        orderStatus = 'COMPLETED';
        
        logger.info(`Binance SELL order executed: ${tradingPair.symbol}, ${quantity}, $${currentPrice}, OrderID: ${binanceOrderId}`);
      } else {
        logger.info(`Simulated SELL order: ${tradingPair.symbol}, ${quantity}, $${currentPrice}`);
      }
    } catch (orderError) {
      logger.error(`Error executing Binance SELL order:`, orderError);
      
      // Even if Binance order fails, we proceed with local transaction for simulation purposes
      orderStatus = 'FAILED';
      
      // Send error notification
      await telegramService.sendErrorNotification(
        orderError, 
        `Failed to execute SELL order for ${tradingPair.displayName}`
      );
    }
    
    // Update transaction status
    await conn.query(
      `UPDATE transactions SET status = ?, binance_order_id = ? WHERE id = ?`,
      [orderStatus, binanceOrderId, transactionId]
    );
    
    // If order failed on Binance but we're in test mode, still update holdings for simulation
    if (orderStatus === 'COMPLETED' || options.forceUpdateHoldings) {
      // Update holdings
      const [currentHoldings] = await conn.query(
        'SELECT * FROM holdings WHERE trading_pair_id = ?',
        [tradingPairId]
      );
      
      if (currentHoldings.length > 0) {
        const remainingQuantity = Math.max(0, parseFloat(currentHoldings[0].quantity) - quantity);
        
        // If remaining quantity is zero, reset average buy price
        if (remainingQuantity === 0) {
          await conn.query(
            `UPDATE holdings 
             SET quantity = 0, average_buy_price = 0, last_buy_price = 0 
             WHERE trading_pair_id = ?`,
            [tradingPairId]
          );
        } else {
          // Just update the quantity, keep the average buy price
          await conn.query(
            `UPDATE holdings 
             SET quantity = ? 
             WHERE trading_pair_id = ?`,
            [remainingQuantity, tradingPairId]
          );
        }
      }
    }
    
    // Commit transaction
    await conn.commit();
    
    // Calculate profit if available
    let profit = null;
    try {
      if (currentHoldings && currentHoldings.length > 0) {
        const avgBuyPrice = parseFloat(currentHoldings[0].average_buy_price || 0);
        if (avgBuyPrice > 0) {
          const profitAmount = (currentPrice - avgBuyPrice) * quantity;
          const profitPercentage = ((currentPrice - avgBuyPrice) / avgBuyPrice) * 100;
          profit = {
            amount: profitAmount,
            percentage: profitPercentage
          };
        }
      }
    } catch (profitError) {
      logger.error('Error calculating profit:', profitError);
    }
    
    // Send Telegram notification
    try {
      await telegramService.sendTradeNotification({
        tradingPair,
        type: 'SELL',
        quantity,
        price: currentPrice,
        totalAmount,
        profit,
        reason: options.reason || 'MANUAL'
      });
    } catch (notificationError) {
      logger.error('Failed to send trade notification:', notificationError);
    }
    
    // Return transaction details
    return {
      id: transactionId,
      tradingPairId: parseInt(tradingPairId),
      type: 'SELL',
      quantity: parseFloat(quantity),
      price: currentPrice,
      totalAmount: parseFloat(totalAmount.toFixed(2)),
      status: orderStatus,
      binanceOrderId,
      profit,
      timestamp: new Date()
    };
  } catch (error) {
    if (conn) await conn.rollback();
    logger.error('Error executing sell order:', error);
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
    const balances = await binance.balance();
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
    const exchangeInfo = await binance.exchangeInfo();
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