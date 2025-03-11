const axios = require('axios');
require('dotenv').config();

// Telegram credentials from environment variables
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

const telegramService = {
  // Send message to Telegram chat
  async sendMessage(message) {
    try {
      if (!BOT_TOKEN || !CHAT_ID) {
        console.warn('Telegram credentials not configured. Message not sent.');
        return;
      }
      
      const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
      await axios.post(url, {
        chat_id: CHAT_ID,
        text: message,
        parse_mode: 'HTML'
      });
      
      console.log('Telegram notification sent successfully');
    } catch (error) {
      console.error('Error sending Telegram notification:', error.message);
    }
  }
};

module.exports = telegramService;