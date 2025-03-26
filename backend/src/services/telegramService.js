const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const db = require('../config/database');

// Telegram Bot configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Initialize the bot
let bot;
try {
  if (TELEGRAM_BOT_TOKEN) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
    logger.info('Telegram bot initialized successfully');
  } else {
    logger.warn('Telegram bot not initialized: Missing bot token');
  }
} catch (error) {
  logger.error('Error initializing Telegram bot:', error);
}

/**
 * Send a notification message to Telegram
 * @param {string} type - Notification type ('TRANSACTION', 'ERROR', 'SYSTEM')
 * @param {string} message - Message content
 */
async function sendNotification(type, message) {
  try {
    if (!bot || !TELEGRAM_CHAT_ID) {
      logger.warn('Telegram notification not sent: Bot or chat ID not configured');
      // Still log the notification in the database
      await logNotification(type, message, false);
      return false;
    }
    
    // Format message with emoji indicator based on type
    let formattedMessage = '';
    switch (type) {
      case 'TRANSACTION':
        formattedMessage = `🤖 *TRADING BOT - TRANSACTION*\n\n${message}`;
        break;
      case 'ERROR':
        formattedMessage = `🤖 *TRADING BOT - ERROR*\n\n⚠️ ${message}`;
        break;
      case 'SYSTEM':
        formattedMessage = `🤖 *TRADING BOT - SYSTEM*\n\n🔧 ${message}`;
        break;
      default:
        formattedMessage = `🤖 *TRADING BOT*\n\n${message}`;
    }
    
    // Add timestamp
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    formattedMessage += `\n\n⏱️ ${timestamp}`;
    
    // Send message with Markdown formatting
    const result = await bot.sendMessage(TELEGRAM_CHAT_ID, formattedMessage, {
      parse_mode: 'Markdown'
    });
    
    // Log notification to database
    await logNotification(type, message, true, result.message_id.toString());
    
    logger.info(`Telegram notification sent: ${type}`);
    return true;
  } catch (error) {
    logger.error('Error sending Telegram notification:', error);
    // Still try to log the notification in the database
    await logNotification(type, message, false, null, error.message);
    return false;
  }
}

/**
 * Log notification to database
 * @param {string} type - Notification type
 * @param {string} message - Message content
 * @param {boolean} delivered - Whether the notification was delivered
 * @param {string} messageId - Telegram message ID if delivered
 * @param {string} errorMessage - Error message if delivery failed
 */
async function logNotification(type, message, delivered, messageId = null, errorMessage = null) {
  try {
    // Use direct pool query instead of getting a connection
    await db.query(`
      INSERT INTO notification_logs
      (notification_type, message, delivered, telegram_message_id)
      VALUES (?, ?, ?, ?)
    `, [type, message, delivered, messageId]);
    return true;
  } catch (error) {
    logger.error('Error logging notification to database:', error);
    return false;
  }
}

/**
 * Get recent notification logs
 * @param {number} limit - Maximum number of logs to return
 */
async function getRecentNotifications(limit = 20) {
  try {
    // Use direct pool query
    const rows = await db.query(`
      SELECT * FROM notification_logs
      ORDER BY created_at DESC
      LIMIT ?
    `, [limit]);
    return rows;
  } catch (error) {
    logger.error('Error fetching notification logs:', error);
    throw error;
  }
}

/**
 * Test Telegram bot connection
 */
async function testConnection() {
  try {
    if (!bot || !TELEGRAM_CHAT_ID) {
      return { success: false, message: 'Telegram bot not configured' };
    }
    
    const message = '🤖 *TRADING BOT - TEST*\n\nTest message from the Cryptocurrency Trading Bot. If you can see this message, the bot is configured correctly.';
    const result = await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: 'Markdown'
    });
    
    return { 
      success: true, 
      message: 'Telegram bot connection successful',
      messageId: result.message_id
    };
  } catch (error) {
    logger.error('Error testing Telegram connection:', error);
    return { 
      success: false, 
      message: `Telegram bot connection failed: ${error.message}` 
    };
  }
}

module.exports = {
  sendNotification,
  getRecentNotifications,
  testConnection
};