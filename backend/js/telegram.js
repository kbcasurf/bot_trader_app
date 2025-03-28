const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '../../.env' });

// Telegram Bot credentials
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// Initialize Telegram Bot
const bot = new Telegraf(BOT_TOKEN);

// Start bot
bot.launch().catch(err => {
    console.error('Failed to launch Telegram bot:', err);
});

// Handle graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// Test Telegram Bot connection
async function testConnection() {
    try {
        // Try to get bot info as a simple check
        const botInfo = await bot.telegram.getMe();
        return !!botInfo.id;
    } catch (error) {
        console.error('Telegram Bot connection test failed:', error.message);
        throw error;
    }
}

// Send message to configured chat ID
async function sendMessage(message) {
    try {
        const result = await bot.telegram.sendMessage(CHAT_ID, message);
        console.log('Telegram message sent:', message);
        return result;
    } catch (error) {
        console.error('Failed to send Telegram message:', error.message);
        throw error;
    }
}

// Send notification about trade execution
async function sendTradeNotification(tradeInfo) {
    const { symbol, type, price, quantity, investment, timestamp } = tradeInfo;
    
    // Create a formatted message
    const message = 
        `${type === 'BUY' ? '🔵 Buy' : '🔴 Sell'} Order Executed\n` +
        `Symbol: ${symbol}\n` +
        `Price: $${price.toFixed(2)}\n` +
        `Quantity: ${quantity.toFixed(6)}\n` +
        `${type === 'BUY' ? 'Investment' : 'Total Value'}: $${investment.toFixed(2)}\n` +
        `Time: ${new Date(timestamp).toLocaleString()}`;
    
    return await sendMessage(message);
}

// Send alert about significant price movement
async function sendPriceAlert(alertInfo) {
    const { symbol, priceChange, currentPrice, previousPrice } = alertInfo;
    
    // Determine if it's an increase or decrease
    const isIncrease = priceChange > 0;
    const emoji = isIncrease ? '📈' : '📉';
    const changePercent = Math.abs(priceChange).toFixed(2);
    
    // Create a formatted message
    const message = 
        `${emoji} Price Alert: ${symbol}\n` +
        `${isIncrease ? 'Increased' : 'Decreased'} by ${changePercent}%\n` +
        `Previous: ${previousPrice.toFixed(2)}\n` +
        `Current: ${currentPrice.toFixed(2)}\n` +
        `Time: ${new Date().toLocaleString()}`;
    
    return await sendMessage(message);
}