const { Telegraf } = require('telegraf');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '/app/.env' });

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
        const result = await bot.telegram.sendMessage(CHAT_ID, message, { parse_mode: 'HTML' });
        console.log('Telegram message sent:', message);
        return result;
    } catch (error) {
        console.error('Failed to send Telegram message:', error.message);
        throw error;
    }
}



// Send notification about trade execution with enhanced formatting
async function sendTradeNotification(tradeInfo) {
    const { symbol, type, price, quantity, investment, timestamp } = tradeInfo;
    
    // Get human-readable symbol (remove USDT suffix if present)
    const displaySymbol = symbol.replace('USDT', '');
    
    // Create a formatted message with HTML
    const message = 
        `<b>${type === 'BUY' ? '🔵 Buy' : '🔴 Sell'} Order Executed</b>\n\n` +
        `<b>Symbol:</b> ${displaySymbol}/USDT\n` +
        `<b>Price:</b> $${parseFloat(price).toFixed(2)}\n` +
        `<b>Quantity:</b> ${parseFloat(quantity).toFixed(6)} ${displaySymbol}\n` +
        `<b>${type === 'BUY' ? 'Investment' : 'Total Value'}:</b> $${parseFloat(investment).toFixed(2)}\n` +
        `<b>Time:</b> ${new Date(timestamp).toLocaleString()}`;
    
    return await sendMessage(message);
}

// Send alert about significant price movement
async function sendPriceAlert(alertInfo) {
    const { symbol, priceChange, currentPrice, previousPrice } = alertInfo;
    
    // Determine if it's an increase or decrease
    const isIncrease = priceChange > 0;
    const emoji = isIncrease ? '📈' : '📉';
    const changePercent = Math.abs(priceChange).toFixed(2);
    
    // Get human-readable symbol (remove USDT suffix if present)
    const displaySymbol = symbol.replace('USDT', '');
    
    // Create a formatted message with HTML
    const message = 
        `<b>${emoji} Price Alert: ${displaySymbol}/USDT</b>\n\n` +
        `${isIncrease ? '<b>Increased</b>' : '<b>Decreased</b>'} by ${changePercent}%\n` +
        `Previous: $${previousPrice.toFixed(2)}\n` +
        `Current: $${currentPrice.toFixed(2)}\n` +
        `Time: ${new Date().toLocaleString()}`;
    
    return await sendMessage(message);
}

// Send trade summary notification
async function sendTradeSummary(summaryInfo) {
    const { symbol, period, trades, totalBuy, totalSell, profitLoss } = summaryInfo;
    
    // Get human-readable symbol (remove USDT suffix if present)
    const displaySymbol = symbol.replace('USDT', '');
    
    // Determine profit/loss emoji
    const plEmoji = profitLoss >= 0 ? '✅' : '❌';
    
    // Create a formatted message with HTML
    const message = 
        `<b>📊 ${displaySymbol}/USDT Trade Summary (${period})</b>\n\n` +
        `<b>Total Trades:</b> ${trades}\n` +
        `<b>Buy Volume:</b> $${totalBuy.toFixed(2)}\n` +
        `<b>Sell Volume:</b> $${totalSell.toFixed(2)}\n` +
        `<b>Profit/Loss:</b> ${plEmoji} $${Math.abs(profitLoss).toFixed(2)} ${profitLoss >= 0 ? 'profit' : 'loss'}`;
    
    return await sendMessage(message);
}

// Send system status alert
async function sendSystemAlert(alertInfo) {
    const { type, message, details } = alertInfo;
    
    // Determine alert emoji based on type
    let emoji = '⚠️';
    if (type === 'error') emoji = '🔴';
    else if (type === 'success') emoji = '✅';
    else if (type === 'warning') emoji = '⚠️';
    else if (type === 'info') emoji = 'ℹ️';
    
    // Create a formatted message with HTML
    const alertMessage = 
        `<b>${emoji} System ${type.charAt(0).toUpperCase() + type.slice(1)}</b>\n\n` +
        `<b>Message:</b> ${message}\n` +
        (details ? `<b>Details:</b> ${details}` : '');
    
    return await sendMessage(alertMessage);
}

module.exports = {
    testConnection,
    sendMessage,
    sendTradeNotification,
    sendPriceAlert,
    sendTradeSummary,
    sendSystemAlert
};