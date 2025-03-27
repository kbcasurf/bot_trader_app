const db = require('../../config/database');
const logger = require('../utils/logger');

// Trading algorithm constants
const PROFIT_THRESHOLD = parseFloat(process.env.PROFIT_THRESHOLD); // profit target setting in .env file
const LOSS_THRESHOLD = parseFloat(process.env.LOSS_THRESHOLD);   // loss threshold for additional purchases
const ADDITIONAL_PURCHASE_AMOUNT = parseFloat(process.env.ADDITIONAL_PURCHASE_AMOUNT); // for additional purchases


/**
 * Process price update for a trading pair
 * This is the main trading algorithm implementation
 */
exports.processPriceUpdate = async (tradingPairId, currentPrice) => {
  let conn;
  try {
    conn = await db.getConnection();
    
    // Dynamically import to avoid circular dependencies
    const binanceService = require('./binanceService');
    const telegramService = require('./telegramService');
    
    // Get trading pair information
    const tradingPair = await binanceService.getTradingPairById(tradingPairId);
    if (!tradingPair) {
      throw new Error(`Trading pair with ID ${tradingPairId} not found`);
    }
    
    // Get current trading configuration
    const [config] = await conn.query(
      'SELECT * FROM trading_configurations WHERE trading_pair_id = ? AND active = true',
      [tradingPairId]
    );
    
    // If no active trading configuration, skip
    if (!config || config.length === 0) {
      return null;
    }
    
    // Get current holdings
    const holdings = await binanceService.getHoldings(tradingPairId);
    
    // Log the price update
    await conn.query(
      'INSERT INTO price_history (trading_pair_id, price) VALUES (?, ?)',
      [tradingPairId, currentPrice]
    );
    
    // No holdings, nothing to process
    if (!holdings || holdings.quantity <= 0) {
      return null;
    }
    
    // Calculate profit percentage based on average buy price
    const profitPercentage = ((currentPrice - holdings.averageBuyPrice) / holdings.averageBuyPrice) * 100;
    
    // Calculate loss percentage based on last buy price
    const lossPercentage = ((holdings.lastBuyPrice - currentPrice) / holdings.lastBuyPrice) * 100;
    
    logger.debug(`Processing ${tradingPair.symbol}: Current price: $${currentPrice}, Avg Buy: $${holdings.averageBuyPrice}, Last Buy: $${holdings.lastBuyPrice}, Profit: ${profitPercentage.toFixed(2)}%, Loss: ${lossPercentage.toFixed(2)}%`);
    
    // Check if we should sell (profit >= PROFIT_THRESHOLD)
    if (profitPercentage >= PROFIT_THRESHOLD) {
      logger.info(`Sell condition met for ${tradingPair.symbol}: Profit ${profitPercentage.toFixed(2)}% >= ${PROFIT_THRESHOLD}%`);
      
      // Execute sell order
      const transaction = await binanceService.executeSellAllOrder(tradingPairId, {
        reason: 'PROFIT_TARGET'
      });
      
      // Send Telegram notification
      await telegramService.sendNotification(
        `🟢 SELL EXECUTED (Profit Target)\n` +
        `Pair: ${tradingPair.display_name}\n` +
        `Price: $${currentPrice}\n` +
        `Quantity: ${holdings.quantity}\n` +
        `Profit: ${profitPercentage.toFixed(2)}%\n` +
        `Total Value: $${(holdings.quantity * currentPrice).toFixed(2)}`
      );
      
      return {
        action: 'SELL',
        tradingPair,
        transaction,
        reason: 'PROFIT_TARGET'
      };
    }
    
    // Check if we should buy more (loss >= LOSS_THRESHOLD)
    if (lossPercentage >= LOSS_THRESHOLD) {
      logger.info(`Buy condition met for ${tradingPair.symbol}: Loss ${lossPercentage.toFixed(2)}% >= ${LOSS_THRESHOLD}%`);
      
      // Execute buy order
      const transaction = await binanceService.executeBuyOrder(tradingPairId, ADDITIONAL_PURCHASE_AMOUNT, {
        reason: 'DIP_STRATEGY'
      });
      
      // Send Telegram notification
      await telegramService.sendNotification(
        `🔵 BUY EXECUTED (Dip Strategy)\n` +
        `Pair: ${tradingPair.display_name}\n` +
        `Price: $${currentPrice}\n` +
        `Amount: $${ADDITIONAL_PURCHASE_AMOUNT}\n` +
        `Loss from last buy: ${lossPercentage.toFixed(2)}%`
      );
      
      return {
        action: 'BUY',
        tradingPair,
        transaction,
        reason: 'DIP_STRATEGY'
      };
    }
    
    // No action taken
    return {
      action: 'NONE',
      tradingPair
    };
  } catch (error) {
    logger.error(`Error processing price update for trading pair ${tradingPairId}:`, error);
    
    // Try to send error notification via Telegram
    try {
      const binanceService = require('./binanceService');
      const telegramService = require('./telegramService');
      
      const tradingPair = await binanceService.getTradingPairById(tradingPairId);
      await telegramService.sendNotification(
        `⚠️ ERROR PROCESSING PRICE UPDATE\n` +
        `Pair: ${tradingPair ? tradingPair.display_name : `ID: ${tradingPairId}`}\n` +
        `Error: ${error.message}`
      );
    } catch (notificationError) {
      logger.error('Failed to send error notification:', notificationError);
    }
    
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Initialize trading for a trading pair
 */
exports.initializeTrading = async (tradingPairId, initialInvestment) => {
  let conn;
  try {
    conn = await db.getConnection();
    
    // Check if trading is already active for this pair
    const [existingConfig] = await conn.query(
      'SELECT * FROM trading_configurations WHERE trading_pair_id = ? AND active = true',
      [tradingPairId]
    );
    
    if (existingConfig && existingConfig.length > 0) {
      return { success: false, message: 'Trading already active for this pair' };
    }
    
    // Start transaction
    await conn.beginTransaction();
    
    // Insert or update trading configuration
    await conn.query(
      `INSERT INTO trading_configurations 
       (trading_pair_id, initial_investment, active) 
       VALUES (?, ?, true)
       ON DUPLICATE KEY UPDATE initial_investment = ?, active = true`,
      [tradingPairId, initialInvestment, initialInvestment]
    );
    
    // Commit transaction
    await conn.commit();
    
    // Dynamically import to avoid circular dependencies
    const binanceService = require('./binanceService');
    const telegramService = require('./telegramService');
    
    // Get trading pair information for notification
    const tradingPair = await binanceService.getTradingPairById(tradingPairId);
    
    // Send Telegram notification
    await telegramService.sendNotification(
      `🚀 TRADING INITIALIZED\n` +
      `Pair: ${tradingPair.display_name}\n` +
      `Initial Investment: $${initialInvestment}`
    );
    
    return { 
      success: true, 
      message: `Trading initialized for ${tradingPair.symbol} with $${initialInvestment}` 
    };
  } catch (error) {
    if (conn) await conn.rollback();
    logger.error(`Error initializing trading for pair ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Stop trading for a trading pair
 */
exports.stopTrading = async (tradingPairId) => {
  let conn;
  try {
    conn = await db.getConnection();
    
    // Start transaction
    await conn.beginTransaction();
    
    // Update trading configuration
    await conn.query(
      'UPDATE trading_configurations SET active = false WHERE trading_pair_id = ?',
      [tradingPairId]
    );
    
    // Commit transaction
    await conn.commit();
    
    // Dynamically import to avoid circular dependencies
    const binanceService = require('./binanceService');
    const telegramService = require('./telegramService');
    
    // Get trading pair information for notification
    const tradingPair = await binanceService.getTradingPairById(tradingPairId);
    
    // Send Telegram notification
    await telegramService.sendNotification(
      `⏹️ TRADING STOPPED\n` +
      `Pair: ${tradingPair.display_name}`
    );
    
    return { 
      success: true, 
      message: `Trading stopped for ${tradingPair.symbol}` 
    };
  } catch (error) {
    if (conn) await conn.rollback();
    logger.error(`Error stopping trading for pair ${tradingPairId}:`, error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};

/**
 * Get trading status for all pairs
 */
exports.getTradingStatus = async () => {
  let conn;
  try {
    conn = await db.getConnection();
    
    const result = await conn.query(`
      SELECT 
        tp.id,
        tp.symbol,
        tp.display_name,
        tc.active,
        tc.initial_investment,
        h.quantity,
        h.average_buy_price,
        h.last_buy_price,
        (SELECT price FROM price_history WHERE trading_pair_id = tp.id ORDER BY timestamp DESC LIMIT 1) as current_price
      FROM 
        trading_pairs tp
      LEFT JOIN 
        trading_configurations tc ON tp.id = tc.trading_pair_id
      LEFT JOIN 
        holdings h ON tp.id = h.trading_pair_id
    `);
    
    return result;
  } catch (error) {
    logger.error('Error getting trading status:', error);
    throw error;
  } finally {
    if (conn) conn.release();
  }
};