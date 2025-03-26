const { Telegraf } = require('telegraf');
const config = require('../config');

// Initialize Telegram bot
let bot;

// Try to initialize Telegram bot if configuration is available
try {
  if (config.telegram.botToken) {
    bot = new Telegraf(config.telegram.botToken);
    console.log('Telegram bot initialized successfully');
  } else {
    console.log('Telegram bot not initialized: Missing bot token');
  }
} catch (error) {
  console.error('Failed to initialize Telegram bot:', error);
}

// Send notification via Telegram
exports.sendNotification = async (message) => {
  try {
    if (!bot || !config.telegram.chatId) {
      console.log('Telegram notification not sent: Bot not initialized or chat ID missing');
      return false;
    }
    
    await bot.telegram.sendMessage(config.telegram.chatId, message);
    console.log('Telegram notification sent successfully');
    return true;
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
    return false;
  }
};