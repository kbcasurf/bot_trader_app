import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import Binance from 'node-binance-api'
import TelegramBot from 'node-telegram-bot-api'
import mysql from 'mysql2/promise'
import winston from 'winston'

dotenv.config()

// Initialize logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
})

// Initialize Express app
const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
})

// Middleware
app.use(cors())
app.use(helmet())
app.use(express.json())

// Initialize Binance API
const binance = new Binance().options({
  APIKEY: process.env.BINANCE_API_KEY,
  APISECRET: process.env.BINANCE_API_SECRET
})

// Initialize Telegram Bot
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false })

// Initialize MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
})

// Trading pairs configuration
const TRADING_PAIRS = [
  'BTCUSDT', 'SOLUSDT', 'XRPUSDT',
  'PENDLEUSDT', 'DOGEUSDT', 'NEARUSDT'
]

// Helper function to send Telegram notifications
const sendTelegramMessage = async (message) => {
  try {
    await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message)
  } catch (error) {
    logger.error('Telegram notification failed:', error)
  }
}

// Helper function to save trade to database
const saveTrade = async (symbol, type, price, amount) => {
  try {
    const [result] = await pool.execute(
      'INSERT INTO trades (symbol, type, price, amount) VALUES (?, ?, ?, ?)',
      [symbol, type, price, amount]
    )
    return result
  } catch (error) {
    logger.error('Failed to save trade:', error)
    throw error
  }
}

// Trading strategy implementation
const checkAndExecuteTrades = async (symbol, currentPrice) => {
  try {
    const [trades] = await pool.execute(
      'SELECT * FROM trades WHERE symbol = ? ORDER BY created_at DESC',
      [symbol]
    )

    if (trades.length === 0) return

    const firstBuyPrice = trades[0].price
    const priceChange = ((currentPrice - firstBuyPrice) / firstBuyPrice) * 100

    if (priceChange >= 5) {
      // Sell all holdings
      const totalHoldings = trades.reduce((sum, trade) => 
        sum + (trade.type === 'buy' ? trade.amount : -trade.amount), 0)

      if (totalHoldings > 0) {
        await binance.marketSell(symbol, totalHoldings)
        await saveTrade(symbol, 'sell', currentPrice, totalHoldings)
        await sendTelegramMessage(
          `🔔 Sold ${totalHoldings} ${symbol} at $${currentPrice}\n` +
          `Profit: ${priceChange.toFixed(2)}%`
        )
      }
    } else if (priceChange <= -5) {
      // Buy more on dip
      const buyAmount = 50 // USD
      await binance.marketBuy(symbol, buyAmount)
      await saveTrade(symbol, 'buy', currentPrice, buyAmount)
      await sendTelegramMessage(
        `🔔 Bought $${buyAmount} of ${symbol} at $${currentPrice}\n` +
        `Price down: ${Math.abs(priceChange).toFixed(2)}%`
      )
    }
  } catch (error) {
    logger.error('Trading strategy execution failed:', error)
  }
}

// WebSocket connection for real-time price updates
io.on('connection', (socket) => {
  logger.info('Client connected')

  TRADING_PAIRS.forEach(symbol => {
    binance.websockets.trades(symbol, async (trades) => {
      const { s: sym, p: price } = trades
      socket.emit('priceUpdate', { symbol: sym, price: parseFloat(price) })
      await checkAndExecuteTrades(sym, parseFloat(price))
    })
  })

  socket.on('disconnect', () => {
    logger.info('Client disconnected')
  })
})

// API endpoint for initial purchase
app.post('/api/trade', async (req, res) => {
  try {
    const { symbol, amount, type } = req.body

    if (type === 'buy') {
      const order = await binance.marketBuy(symbol.replace('/', ''), amount)
      await saveTrade(symbol, 'buy', order.price, amount)
      await sendTelegramMessage(
        `🔔 Initial purchase: Bought $${amount} of ${symbol} at $${order.price}`
      )
      res.json({ success: true, order })
    } else {
      res.status(400).json({ error: 'Invalid trade type' })
    }
  } catch (error) {
    logger.error('Trade execution failed:', error)
    res.status(500).json({ error: 'Failed to execute trade' })
  }
})

// Start server
const PORT = process.env.PORT || 4000
httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
})