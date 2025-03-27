const { Telegraf } = require('telegraf');
const logger = require('../utils/logger');

// Initialize variables for bot connection
let bot = null;
let chatId = null;
let isInitialized = false;

/**
 * Initialize connection to the Telegram bot
 */
const initializeBot = async () => {
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    chatId = process.env.TELEGRAM_CHAT_ID;
    
    if (!botToken) {
      logger.warn('Telegram bot not initialized: TELEGRAM_BOT_TOKEN not provided in environment variables');
      return false;
    }
    
    if (!chatId) {
      logger.warn('Telegram notifications disabled: TELEGRAM_CHAT_ID not provided in environment variables');
    }
    
    // Create Telegraf instance with the provided token
    bot = new Telegraf(botToken);
    
    // Simple launch without setting up command handlers - we just want to send messages
    await bot.launch();
    
    isInitialized = true;
    logger.info('Telegram bot connection initialized successfully');
    
    // Send startup notification if chat ID is available
    if (chatId) {
      await sendNotification('🚀 Crypto Trading Bot is now online!');
    }
    
    return true;
  } catch (error) {
    logger.error('Failed to initialize Telegram bot connection:', error);
    return false;
  }
};

/**
 * Send notification via Telegram
 */
const sendNotification = async (message) => {
  try {
    if (!isInitialized || !bot) {
      logger.warn('Telegram notification not sent: Bot not initialized');
      return false;
    }
    
    if (!chatId) {
      logger.warn('Telegram notification not sent: Chat ID not provided');
      return false;
    }
    
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    logger.debug('Telegram notification sent successfully');
    return true;
  } catch (error) {
    logger.error('Error sending Telegram notification:', error);
    return false;
  }
};

/**
 * Send error notification via Telegram
 */
const sendErrorNotification = async (error, context) => {
  try {
    if (!isInitialized || !bot || !chatId) {
      return false;
    }
    
    const message = `
⚠️ *Error Alert*

${context ? `*Context:* ${context}\n` : ''}
*Error:* ${error.message || 'Unknown error'}
*Time:* ${new Date().toISOString()}
    `;
    
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    return true;
  } catch (notificationError) {
    logger.error('Error sending error notification:', notificationError);
    return false;
  }
};

/**
 * Send trade notification via Telegram
 */
const sendTradeNotification = async (tradeData) => {
  try {
    if (!isInitialized || !bot || !chatId) {
      return false;
    }
    
    const { tradingPair, type, quantity, price, totalAmount, profit, reason } = tradeData;
    const profitPercentage = profit ? profit.percentage : null;
    
    let emoji;
    if (type === 'BUY') {
      emoji = '🔵';
    } else if (type === 'SELL' && profitPercentage && profitPercentage > 0) {
      emoji = '🟢';
    } else if (type === 'SELL' && profitPercentage && profitPercentage < 0) {
      emoji = '🔴';
    } else {
      emoji = '⚪';
    }
    
    let reasonText = '';
    if (reason === 'PROFIT_TARGET') {
      reasonText = 'Profit Target Reached';
    } else if (reason === 'DIP_STRATEGY') {
      reasonText = 'Dip Purchase Strategy';
    } else if (reason === 'MANUAL') {
      reasonText = 'Manual Trade';
    } else if (reason === 'STOP_LOSS') {
      reasonText = 'Stop Loss Triggered';
    }
    
    const message = `
${emoji} *${type} EXECUTED* ${reasonText ? `(${reasonText})` : ''}

*Pair:* ${tradingPair.displayName}
*Price:* $${price.toFixed(2)}
*Quantity:* ${quantity.toFixed(6)}
*Total:* $${totalAmount.toFixed(2)}
${profitPercentage ? `*Profit:* ${profitPercentage > 0 ? '+' : ''}${profitPercentage.toFixed(2)}%` : ''}
*Time:* ${new Date().toISOString()}
    `;
    
    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
    return true;
  } catch (error) {
    logger.error('Error sending trade notification:', error);
    return false;
  }
};

// Get bot instance (for shutdown handling)
const getBot = () => bot;

// Handle bot shutdown
process.once('SIGINT', () => bot && bot.stop('SIGINT'));
process.once('SIGTERM', () => bot && bot.stop('SIGTERM'));

module.exports = {
  initializeBot,
  sendNotification,
  sendErrorNotification,
  sendTradeNotification,
  getBot
};