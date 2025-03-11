const Binance = require('binance-api-node').default;
const telegramService = require('./telegramService');
const db = require('../db/connection');

// Initialize Binance client
const client = Binance({
  apiKey: process.env.BINANCE_API_KEY,
  apiSecret: process.env.BINANCE_API_SECRET,
  // Use test: true for testnet
  // test: true
});

const binanceService = {
  // Get current price for a symbol
  async getPrice(symbol) {
    try {
      const ticker = await client.prices({ symbol });
      return parseFloat(ticker[symbol]);
    } catch (error) {
      console.error(`Error getting price for ${symbol}:`, error);
      throw error;
    }
  },

  // Place a market buy order
  async marketBuy(symbol, quoteAmount) {
    try {
      // Get current price to calculate quantity
      const price = await this.getPrice(symbol);
      const quantity = (quoteAmount / price).toFixed(5); // Adjust precision as needed
      
      const order = await client.order({
        symbol: symbol,
        side: 'BUY',
        type: 'MARKET',
        quantity: quantity
      });
      
      // Save order to database
      await this.saveOrder({
        symbol,
        side: 'BUY',
        price: parseFloat(order.fills[0].price),
        quantity: parseFloat(quantity),
        total: quoteAmount,
        orderId: order.orderId,
        status: order.status,
        timestamp: new Date()
      });
      
      // Notify via Telegram
      await telegramService.sendMessage(
        `🟢 BUY Order Executed\nSymbol: ${symbol}\nPrice: $${order.fills[0].price}\nQuantity: ${quantity}\nTotal: $${quoteAmount}`
      );
      
      return order;
    } catch (error) {
      console.error(`Error placing market buy for ${symbol}:`, error);
      throw error;
    }
  },

  // Place a market sell order
  async marketSell(symbol, quantity) {
    try {
      const order = await client.order({
        symbol: symbol,
        side: 'SELL',
        type: 'MARKET',
        quantity: quantity.toFixed(5) // Adjust precision as needed
      });
      
      // Calculate total
      const total = parseFloat(order.fills[0].price) * parseFloat(quantity);
      
      // Save order to database
      await this.saveOrder({
        symbol,
        side: 'SELL',
        price: parseFloat(order.fills[0].price),
        quantity: parseFloat(quantity),
        total: total,
        orderId: order.orderId,
        status: order.status,
        timestamp: new Date()
      });
      
      // Notify via Telegram
      await telegramService.sendMessage(
        `🔴 SELL Order Executed\nSymbol: ${symbol}\nPrice: $${order.fills[0].price}\nQuantity: ${quantity}\nTotal: $${total.toFixed(2)}`
      );
      
      return order;
    } catch (error) {
      console.error(`Error placing market sell for ${symbol}:`, error);
      throw error;
    }
  },

  // Save order to database
  async saveOrder(orderData) {
    try {
      await db.query(
        `INSERT INTO orders 
        (symbol, side, price, quantity, total, order_id, status, timestamp) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          orderData.symbol,
          orderData.side,
          orderData.price,
          orderData.quantity,
          orderData.total,
          orderData.orderId,
          orderData.status,
          orderData.timestamp
        ]
      );
    } catch (error) {
      console.error('Error saving order to database:', error);
      throw error;
    }
  },

  // Get account information
  async getAccountInfo() {
    try {
      return await client.accountInfo();
    } catch (error) {
      console.error('Error getting account info:', error);
      throw error;
    }
  },

  // Get order history for a symbol
  async getOrderHistory(symbol) {
    try {
      return await db.query(
        'SELECT * FROM orders WHERE symbol = ? ORDER BY timestamp DESC',
        [symbol]
      );
    } catch (error) {
      console.error(`Error getting order history for ${symbol}:`, error);
      throw error;
    }
  }
};

module.exports = binanceService;