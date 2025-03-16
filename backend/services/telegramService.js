const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Telegram API configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const TELEGRAM_API_URL = TELEGRAM_BOT_TOKEN ? `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}` : null;

// Send a message to Telegram
async function sendMessage(message) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
    });
    return response.data;
  } catch (error) {
    console.error('Error sending Telegram message:', error.message);
    throw error;
  }
}

// Get information about the Telegram bot
async function getBotInfo() {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe`;
    const response = await axios.get(url);
    
    // Return bot information with status
    return {
      success: true,
      bot: response.data.result,
      chat_id: TELEGRAM_CHAT_ID,
      is_configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
    };
  } catch (error) {
    console.error('Error getting Telegram bot info:', error.message);
    return {
      success: false,
      error: error.message,
      is_configured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID)
    };
  }
}

module.exports = {
  sendMessage,
  getBotInfo
};