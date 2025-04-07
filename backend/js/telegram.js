// backend/js/telegram.js
// Telegram Bot Integration Module
// Responsible for sending notifications about trading activities via Telegram

const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: require('path').resolve(__dirname, '../../.env') });

// Telegram bot configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Initialize bot only if token is available
let bot = null;
let isInitialized = false;
let isConfigured = false;

/**
 * Initialize the Telegram bot
 * @returns {boolean} True if initialization was successful
 */
function initialize() {
  if (isInitialized) {
    console.log('Telegram bot already initialized');
    return true;
  }

  try {
    // Check if required environment variables are present
    if (!TELEGRAM_BOT_TOKEN) {
      console.warn('TELEGRAM_BOT_TOKEN not found in environment variables');
      return false;
    }

    // Create bot instance
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    
    // Set up basic error handling
    bot.catch((err, ctx) => {
      console.error('Telegram bot error:', err);
    });
    
    // Check if we have a chat ID immediately to set isConfigured
    if (TELEGRAM_CHAT_ID) {
      isConfigured = true;
    } else {
      console.warn('TELEGRAM_CHAT_ID not found in environment variables');
    }

    // Start bot
    bot.launch().then(() => {
      console.log('Telegram bot launched successfully');
      
      // Send a startup message only if configured
      if (isConfigured) {
        sendMessage('> Crypto Trading Bot started and ready to go!');
      }
    }).catch(error => {
      console.error('Failed to launch Telegram bot:', error);
      bot = null;
      isInitialized = false;
      return false;
    });

    isInitialized = true;
    return true;
  } catch (error) {
    console.error('Error initializing Telegram bot:', error);
    return false;
  }
}

/**
 * Send a text message to the configured chat
 * @param {string} message - The message to send
 * @returns {Promise<boolean>} True if the message was sent
 */
async function sendMessage(message) {
  if (!isInitialized || !bot || !isConfigured) {
    // This is a more informative error that will only be logged once per run
    if (!global.telegramWarningLogged) {
      console.error('TELEGRAM NOTIFICATION ERROR: Bot not initialized or configured properly. Check TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your .env file.');
      global.telegramWarningLogged = true;
    } else {
      // Use debug level for repeated warnings to reduce log noise
      console.debug('Telegram bot not initialized or configured properly');
    }
    return false;
  }

  try {
    // Make sure we have a chat ID
    if (!TELEGRAM_CHAT_ID) {
      if (!global.chatIdWarningLogged) {
        console.error('TELEGRAM NOTIFICATION ERROR: No TELEGRAM_CHAT_ID configured in your .env file.');
        global.chatIdWarningLogged = true;
      }
      return false;
    }

    // Send the message
    await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'HTML' });
    return true;
  } catch (error) {
    console.error('Error sending Telegram message:', error);
    return false;
  }
}

/**
 * Send a trading notification
 * @param {Object} tradeInfo - Information about the trade
 * @param {string} tradeInfo.symbol - The cryptocurrency symbol
 * @param {string} tradeInfo.action - The action (buy/sell)
 * @param {number} tradeInfo.quantity - The amount of cryptocurrency
 * @param {number} tradeInfo.price - The price at which the trade occurred
 * @param {number} tradeInfo.usdt - The USDT value of the trade
 * @returns {Promise<boolean>} True if the notification was sent
 */
async function sendTradeNotification(tradeInfo) {
  if (!tradeInfo) {
    console.warn('No trade information provided for notification');
    return false;
  }

  const { symbol, action, quantity, price, usdt } = tradeInfo;
  
  // Format the message
  const emoji = action.toLowerCase() === 'buy' ? '=� BUY' : '=4 SELL';
  const message = `
<b>${emoji}: ${symbol}</b>

Quantity: ${quantity} ${symbol}
Price: $${price.toFixed(4)}
Value: $${usdt.toFixed(4)}
Time: ${new Date().toLocaleString()}
  `;
  
  return sendMessage(message);
}

/**
 * Send an error notification
 * @param {string} errorMessage - The error message
 * @returns {Promise<boolean>} True if the notification was sent
 */
async function sendErrorNotification(errorMessage) {
  const message = `
L <b>ERROR</b>

${errorMessage}
Time: ${new Date().toLocaleString()}
  `;
  
  return sendMessage(message);
}

/**
 * Send a system status notification
 * @param {Object} status - System status information
 * @param {boolean} status.serverRunning - Whether the server is running
 * @param {boolean} status.dbConnected - Whether the database is connected
 * @param {boolean} status.binanceConnected - Whether Binance API is connected
 * @param {Object} status.balances - Account balances
 * @returns {Promise<boolean>} True if the notification was sent
 */
async function sendStatusNotification(status) {
  if (!status) {
    console.warn('No status information provided for notification');
    return false;
  }

  const { serverRunning, dbConnected, binanceConnected, balances } = status;
  
  // Format the message
  let balanceInfo = '';
  if (balances) {
    balanceInfo = '\n<b>Balances:</b>\n';
    Object.entries(balances).forEach(([symbol, amount]) => {
      balanceInfo += `${symbol}: ${amount}\n`;
    });
  }
  
  const message = `
= <b>SYSTEM STATUS</b>

Server: ${serverRunning ? '' : 'L'}
Database: ${dbConnected ? '' : 'L'}
Binance API: ${binanceConnected ? '' : 'L'}
${balanceInfo}
Time: ${new Date().toLocaleString()}
  `;
  
  return sendMessage(message);
}

/**
 * Stop the Telegram bot gracefully
 */
function stop() {
  if (bot) {
    bot.stop('Bot stopping due to application shutdown');
    console.log('Telegram bot stopped');
  }
}

// Export public API
module.exports = {
  initialize,
  sendMessage,
  sendTradeNotification,
  sendErrorNotification,
  sendStatusNotification,
  stop
};