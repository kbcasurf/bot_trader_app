const binanceService = require('./binanceService');
const telegramService = require('./telegramService');
const db = require('../db/connection');

// Supported trading pairs
const SUPPORTED_PAIRS = [
  'BTCUSDT', 'SOLUSDT', 'XRPUSDT', 
  'PENDLEUSDT', 'DOGEUSDT', 'NEARUSDT'
];

// Trading parameters
const PROFIT_THRESHOLD = 0.05; // 5%
const LOSS_THRESHOLD = 0.05; // 5%
const DEFAULT_PURCHASE_AMOUNT = 50; // $50 USD

// Store active trading sessions
const tradingSessions = {};

const tradingBot = {
  // Initialize the trading bot
  async initialize() {
    try {
      console.log('Initializing trading bot...');
      
      // Load active trading sessions from database
      await this.loadTradingSessions();
      
      // Start price monitoring for all supported pairs
      this.startPriceMonitoring();
      
      console.log('Trading bot initialized successfully');
    } catch (error) {
      console.error('Error initializing trading bot:', error);
      throw error;
    }
  },

  // Load active trading sessions from database
  async loadTradingSessions() {
    try {
      const sessions = await db.query(
        'SELECT * FROM trading_sessions WHERE active = 1'
      );
      
      for (const session of sessions) {
        tradingSessions[session.symbol] = {
          active: true,
          initialPrice: session.initial_price,
          initialPurchaseAmount: session.initial_amount,
          totalInvested: session.total_invested,
          totalQuantity: session.total_quantity,
          lastBuyPrice: session.last_buy_price,
          lastSellPrice: session.last_sell_price,
          profitLoss: session.profit_loss
        };
      }
      
      console.log(`Loaded ${sessions.length} active trading sessions`);
    } catch (error) {
      console.error('Error loading trading sessions:', error);
    }
  },

  // Start monitoring prices for all supported pairs
  startPriceMonitoring() {
    console.log('Starting price monitoring for all supported pairs');
    
    // Check prices every 30 seconds
    setInterval(async () => {
      for (const symbol of SUPPORTED_PAIRS) {
        try {
          if (tradingSessions[symbol] && tradingSessions[symbol].active) {
            await this.checkPriceAndTrade(symbol);
          }
        } catch (error) {
          console.error(`Error monitoring ${symbol}:`, error);
        }
      }
    }, 30000); // 30 seconds
  },

  // Check price and execute trading strategy
  async checkPriceAndTrade(symbol) {
    try {
      const currentPrice = await binanceService.getPrice(symbol);
      const session = tradingSessions[symbol];
      
      if (!session) return;
      
      const initialPrice = session.initialPrice;
      const lastBuyPrice = session.lastBuyPrice || initialPrice;
      
      // Calculate price change percentages
      const changeFromInitial = (currentPrice - initialPrice) / initialPrice;
      const changeFromLastBuy = (currentPrice - lastBuyPrice) / lastBuyPrice;
      
      // Update session in memory
      session.currentPrice = currentPrice;
      session.changeFromInitial = changeFromInitial;
      
      // Execute trading strategy
      if (changeFromInitial >= PROFIT_THRESHOLD) {
        // Sell all if price is 5% above initial purchase
        await this.sellAll(symbol);
      } else if (changeFromLastBuy <= -LOSS_THRESHOLD) {
        // Buy more if price is 5% below last buy
        await this.buyMore(symbol, DEFAULT_PURCHASE_AMOUNT);
      }
      
      // Update session in database
      await this.updateSessionInDatabase(symbol);
    } catch (error) {
      console.error(`Error checking price for ${symbol}:`, error);
    }
  },

  // Update session in database
  async updateSessionInDatabase(symbol) {
    try {
      const session = tradingSessions[symbol];
      if (!session) return;
      
      await db.query(
        `UPDATE trading_sessions SET 
          current_price = ?,
          total_invested = ?,
          total_quantity = ?,
          last_buy_price = ?,
          last_sell_price = ?,
          profit_loss = ?,
          updated_at = NOW()
        WHERE symbol = ? AND active = 1`,
        [
          session.currentPrice,
          session.totalInvested,
          session.totalQuantity,
          session.lastBuyPrice,
          session.lastSellPrice,
          session.profitLoss,
          symbol
        ]
      );
    } catch (error) {
      console.error(`Error updating session for ${symbol}:`, error);
    }
  },

  // Start a new trading session
  async startNewSession(symbol, initialAmount) {
    try {
      // Get current price
      const currentPrice = await binanceService.getPrice(symbol);
      
      // Calculate quantity
      const quantity = initialAmount / currentPrice;
      
      // Execute first purchase
      const order = await binanceService.marketBuy(symbol, initialAmount);
      
      // Create session in memory
      tradingSessions[symbol] = {
        active: true,
        initialPrice: currentPrice,
        initialPurchaseAmount: initialAmount,
        totalInvested: initialAmount,
        totalQuantity: quantity,
        lastBuyPrice: currentPrice,
        lastSellPrice: null,
        profitLoss: 0,
        currentPrice: currentPrice
      };
      
      // Save session to database
      await db.query(
        `INSERT INTO trading_sessions 
        (symbol, active, initial_price, initial_amount, total_invested, 
         total_quantity, last_buy_price, created_at, updated_at) 
        VALUES (?, 1, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [symbol, currentPrice, initialAmount, initialAmount, quantity, currentPrice]
      );
      
      // Notify via Telegram
      await telegramService.sendMessage(
        `🚀 New Trading Session Started\nSymbol: ${symbol}\nInitial Price: $${currentPrice}\nAmount: $${initialAmount}\nQuantity: ${quantity}`
      );
      
      return order;
    } catch (error) {
      console.error(`Error starting new session for ${symbol}:`, error);
      throw error;
    }
  },

  // Buy more of a cryptocurrency
  async buyMore(symbol, amount) {
    try {
      const session = tradingSessions[symbol];
      if (!session || !session.active) return;
      
      // Execute buy order
      const order = await binanceService.marketBuy(symbol, amount);
      
      // Update session
      const currentPrice = parseFloat(order.fills[0].price);
      const quantity = amount / currentPrice;
      
      session.totalInvested += amount;
      session.totalQuantity += quantity;
      session.lastBuyPrice = currentPrice;
      
      // Calculate profit/loss
      session.profitLoss = (currentPrice * session.totalQuantity) - session.totalInvested;
      
      // Update database
      await this.updateSessionInDatabase(symbol);
      
      return order;
    } catch (error) {
      console.error(`Error buying more ${symbol}:`, error);
      throw error;
    }
  },

  // Sell all of a cryptocurrency
  async sellAll(symbol) {
    try {
      const session = tradingSessions[symbol];
      if (!session || !session.active || session.totalQuantity <= 0) return;
      
      // Execute sell order
      const order = await binanceService.marketSell(symbol, session.totalQuantity);
      
      // Update session
      const currentPrice = parseFloat(order.fills[0].price);
      const sellTotal = currentPrice * session.totalQuantity;
      
      session.lastSellPrice = currentPrice;
      session.profitLoss = sellTotal - session.totalInvested;
      session.active = false;
      
      // Update database
      await db.query(
        `UPDATE trading_sessions SET 
          active = 0,
          last_sell_price = ?,
          profit_loss = ?,
          updated_at = NOW()
        WHERE symbol = ? AND active = 1`,
        [currentPrice, session.profitLoss, symbol]
      );
      
      // Notify via Telegram
      await telegramService.sendMessage(
        `💰 Trading Session Closed\nSymbol: ${symbol}\nSell Price: $${currentPrice}\nTotal Sold: ${session.totalQuantity}\nProfit/Loss: $${session.profitLoss.toFixed(2)}`
      );
      
      // Remove from active sessions
      delete tradingSessions[symbol];
      
      return order;
    } catch (error) {
      console.error(`Error selling all ${symbol}:`, error);
      throw error;
    }
  },

  // Get all trading sessions
  async getAllSessions() {
    try {
      return await db.query(
        `SELECT * FROM trading_sessions ORDER BY created_at DESC`
      );
    } catch (error) {
      console.error('Error getting all sessions:', error);
      throw error;
    }
  },

  // Get a specific trading session
  async getSession(symbol) {
    try {
      const sessions = await db.query(
        `SELECT * FROM trading_sessions WHERE symbol = ? ORDER BY created_at DESC LIMIT 1`,
        [symbol]
      );
      return sessions[0] || null;
    } catch (error) {
      console.error(`Error getting session for ${symbol}:`, error);
      throw error;
    }
  }
};

module.exports = tradingBot;