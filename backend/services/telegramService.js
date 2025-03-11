const TelegramBot = require('node-telegram-bot-api');

// Create a bot instance
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const telegramService = {
  // Send a message to the configured chat ID
  async sendMessage(message) {
    try {
      await bot.sendMessage(CHAT_ID, message);
      console.log('Telegram message sent successfully');
      return true;
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      return false;
    }
  },

  // Send a message with a chart image
  async sendChart(symbol, imageBuffer) {
    try {
      await bot.sendPhoto(CHAT_ID, imageBuffer, {
        caption: `Chart for ${symbol}`
      });
      console.log('Telegram chart sent successfully');
      return true;
    } catch (error) {
      console.error('Error sending Telegram chart:', error);
      return false;
    }
  }
};

module.exports = telegramService;