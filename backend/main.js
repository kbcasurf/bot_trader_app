const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const mariadb = require('mariadb');
const binanceAPI = require('./js/binance');
const telegramBot = require('./js/telegram');

// Load environment variables
dotenv.config({ path: '/app/.env' });

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Configure CORS properly
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Add a health check endpoint that returns 200
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Add middleware to parse JSON payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Socket.io with proper CORS settings
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: false
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 30000
});

// Debug middleware for Socket.IO connections
io.use((socket, next) => {
    console.log('New Socket.IO connection attempt:', socket.id);
    next();
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected with ID:', socket.id);
    
    // Send current system status to newly connected client
    socket.emit('database-status', systemStatus.database);
    socket.emit('binance-status', systemStatus.binance);
    socket.emit('telegram-status', systemStatus.telegram);
    socket.emit('trading-status', { active: websocketConnected });
    
    // Handle client disconnection
    socket.on('disconnect', (reason) => {
        console.log(`Client ${socket.id} disconnected. Reason: ${reason}`);
    });
});

// Database connection pool
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 5
});

// System status object
let systemStatus = {
    database: false,
    binance: false,
    telegram: false
};

// WebSocket connection status
let websocketConnected = false;

// Test database connection
async function testDatabaseConnection() {
    let conn;
    try {
        conn = await pool.getConnection();
        console.log('Database connection successful');
        systemStatus.database = true;
        io.emit('database-status', true);
        return true;
    } catch (err) {
        console.error('Database connection error:', err);
        systemStatus.database = false;
        io.emit('database-status', false);
        return false;
    } finally {
        if (conn) conn.release();
    }
}

// Test Binance API connection
async function testBinanceConnection() {
    try {
        await binanceAPI.testConnection();
        console.log('Binance API connection successful');
        systemStatus.binance = true;
        io.emit('binance-status', true);
        return true;
    } catch (err) {
        console.error('Binance API connection error:', err);
        systemStatus.binance = false;
        io.emit('binance-status', false);
        return false;
    }
}

// Test Telegram Bot connection
async function testTelegramConnection() {
    try {
        await telegramBot.testConnection();
        console.log('Telegram Bot connection successful');
        systemStatus.telegram = true;
        io.emit('telegram-status', true);
        return true;
    } catch (err) {
        console.error('Telegram Bot connection error:', err);
        systemStatus.telegram = false;
        io.emit('telegram-status', false);
        return false;
    }
}

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('New client connected');
    
    // Send current system status to newly connected client
    socket.emit('database-status', systemStatus.database);
    socket.emit('binance-status', systemStatus.binance);
    socket.emit('telegram-status', systemStatus.telegram);
    socket.emit('trading-status', { active: websocketConnected });
    
    // Handle client disconnection
    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
    
    // Handle system status request
    socket.on('get-system-status', async () => {
        await testDatabaseConnection();
        await testBinanceConnection();
        await testTelegramConnection();
    });
    
    // Handle Telegram test
    socket.on('test-telegram', async () => {
        try {
            await telegramBot.sendMessage('Test message from Crypto Trading Bot');
            socket.emit('telegram-test-result', { success: true });
        } catch (err) {
            console.error('Telegram test error:', err);
            socket.emit('telegram-test-result', { success: false, error: err.message });
        }
    });
    
    // Handle Binance stream test
    socket.on('test-binance-stream', async () => {
        try {
            binanceAPI.subscribeToTickerStream(['BTCUSDT'], (data) => {
                io.emit('price-update', {
                    symbol: data.s,
                    price: data.a
                });
            });
            socket.emit('binance-test-result', { success: true });
        } catch (err) {
            console.error('Binance stream test error:', err);
            socket.emit('binance-test-result', { 
                success: false, 
                error: err.message,
                message: 'WebSocket connection failed. Trading is paused until connection is restored.'
            });
            websocketConnected = false;
            io.emit('trading-status', { active: websocketConnected });
        }
    });
    
    // Listen for WebSocket status updates
    socket.on('websocket-status', (status) => {
        websocketConnected = status.connected;
        io.emit('trading-status', { active: websocketConnected });
        
        if (!websocketConnected) {
            console.log('WebSocket disconnected. Trading is paused until connection is restored.');
        } else {
            console.log('WebSocket connected. Trading has resumed.');
        }
    });
    
    // Handle first purchase
    socket.on('first-purchase', async (data) => {
        try {
            // Check if WebSocket is connected
            if (!websocketConnected) {
                socket.emit('first-purchase-result', { 
                    success: false, 
                    error: 'Trading is paused due to WebSocket connection issues. Please try again later.'
                });
                return;
            }
            
            console.log(`First purchase request: ${JSON.stringify(data)}`);
            
            // Get current price
            const priceData = await binanceAPI.getTickerPrice(data.symbol);
            const currentPrice = parseFloat(priceData.price);
            
            // Calculate quantity based on investment amount
            const quantity = parseFloat(data.investment) / currentPrice;
            
            // Execute buy order (simulated for now)
            console.log(`Simulating buy order: ${quantity} ${data.symbol} at $${currentPrice}`);
            
            // Store transaction in database
            const conn = await pool.getConnection();
            try {
                await conn.query(
                    'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                    [data.symbol, 'BUY', currentPrice, quantity, data.investment]
                );
                
                // Update holdings
                await conn.query(
                    'INSERT INTO holdings (symbol, quantity, avg_price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?, avg_price = ((avg_price * quantity) + (? * ?)) / (quantity + ?)',
                    [data.symbol, quantity, currentPrice, quantity, currentPrice, quantity, quantity]
                );
            } finally {
                conn.release();
            }
            
            // Send Telegram notification
            await telegramBot.sendMessage(
                `🔵 Buy Order Executed\n` +
                `Symbol: ${data.symbol}\n` +
                `Price: $${currentPrice.toFixed(2)}\n` +
                `Quantity: ${quantity.toFixed(6)}\n` +
                `Investment: $${data.investment}`
            );
            
            // Send transaction update to clients
            const transactions = await getTransactions(data.symbol);
            io.emit('transaction-update', {
                symbol: data.symbol.replace('USDT', ''),
                transactions: transactions
            });
            
            // Send holdings update to clients
            const holdings = await getHoldings(data.symbol);
            io.emit('holdings-update', {
                symbol: data.symbol.replace('USDT', ''),
                amount: holdings.quantity,
                profitLossPercent: ((currentPrice - holdings.avg_price) / holdings.avg_price) * 100
            });
            
            // Begin monitoring price for trading strategy
            startTradingStrategy(data.symbol);
            
            socket.emit('first-purchase-result', { success: true });
        } catch (err) {
            console.error('First purchase error:', err);
            socket.emit('first-purchase-result', { success: false, error: err.message });
        }
    });
    
    // Handle sell all
    socket.on('sell-all', async (data) => {
        try {
            // Check if WebSocket is connected
            if (!websocketConnected) {
                socket.emit('sell-all-result', { 
                    success: false, 
                    error: 'Trading is paused due to WebSocket connection issues. Please try again later.'
                });
                return;
            }
            
            console.log(`Sell all request: ${JSON.stringify(data)}`);
            
            // Get current holdings
            const holdings = await getHoldings(data.symbol);
            
            if (!holdings || holdings.quantity <= 0) {
                throw new Error('No holdings to sell');
            }
            
            // Get current price
            const priceData = await binanceAPI.getTickerPrice(data.symbol);
            const currentPrice = parseFloat(priceData.price);
            
            // Calculate total value
            const totalValue = holdings.quantity * currentPrice;
            
            // Execute sell order (simulated for now)
            console.log(`Simulating sell order: ${holdings.quantity} ${data.symbol} at $${currentPrice}`);
            
            // Store transaction in database
            const conn = await pool.getConnection();
            try {
                await conn.query(
                    'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                    [data.symbol, 'SELL', currentPrice, holdings.quantity, totalValue]
                );
                
                // Update holdings
                await conn.query(
                    'UPDATE holdings SET quantity = 0, avg_price = 0 WHERE symbol = ?',
                    [data.symbol]
                );
            } finally {
                conn.release();
            }
            
            // Send Telegram notification
            await telegramBot.sendMessage(
                `🔴 Sell Order Executed\n` +
                `Symbol: ${data.symbol}\n` +
                `Price: $${currentPrice.toFixed(2)}\n` +
                `Quantity: ${holdings.quantity.toFixed(6)}\n` +
                `Total Value: $${totalValue.toFixed(2)}`
            );
            
            // Send transaction update to clients
            const transactions = await getTransactions(data.symbol);
            io.emit('transaction-update', {
                symbol: data.symbol.replace('USDT', ''),
                transactions: transactions
            });
            
            // Send holdings update to clients
            io.emit('holdings-update', {
                symbol: data.symbol.replace('USDT', ''),
                amount: 0,
                profitLossPercent: 0
            });
            
            socket.emit('sell-all-result', { success: true });
        } catch (err) {
            console.error('Sell all error:', err);
            socket.emit('sell-all-result', { success: false, error: err.message });
        }
    });
});

// Helper function to get transactions for a symbol
async function getTransactions(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC',
            [symbol]
        );
        return rows;
    } catch (err) {
        console.error('Error getting transactions:', err);
        return [];
    } finally {
        if (conn) conn.release();
    }
}

// Helper function to get holdings for a symbol
async function getHoldings(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM holdings WHERE symbol = ?',
            [symbol]
        );
        return rows[0] || { symbol, quantity: 0, avg_price: 0 };
    } catch (err) {
        console.error('Error getting holdings:', err);
        return { symbol, quantity: 0, avg_price: 0 };
    } finally {
        if (conn) conn.release();
    }
}

// Trading strategy logic
function startTradingStrategy(symbol) {
    console.log(`Starting trading strategy for ${symbol}`);
    
    // Create a handler function for price updates
    const priceUpdateHandler = async (data) => {
        try {
            // Get current price
            const currentPrice = parseFloat(data.a);
            
            // Get current holdings
            const holdings = await getHoldings(symbol);
            
            // If no holdings, nothing to do
            if (!holdings || holdings.quantity <= 0) {
                return;
            }
            
            // Get initial purchase price (avg_price)
            const initialPrice = holdings.avg_price;
            
            // Calculate current profit/loss percentage
            const profitLossPercent = ((currentPrice - initialPrice) / initialPrice) * 100;
            
            // Emit holdings update with current profit/loss
            io.emit('holdings-update', {
                symbol: symbol.replace('USDT', ''),
                amount: holdings.quantity,
                profitLossPercent: profitLossPercent
            });
            
            // Implement trading strategy
            // For phase 1, we'll just log the strategy action but not execute it
            if (profitLossPercent >= 5) {
                console.log(`${symbol} has increased by ${profitLossPercent.toFixed(2)}% - Strategy suggests SELL`);
            } else if (profitLossPercent <= -5) {
                console.log(`${symbol} has decreased by ${Math.abs(profitLossPercent).toFixed(2)}% - Strategy suggests BUY`);
            }
        } catch (err) {
            console.error(`Error in trading strategy for ${symbol}:`, err);
        }
    };
    
    // Subscribe to ticker updates using Socket.io
    try {
        const socket = binanceAPI.subscribeToTickerStream([symbol], priceUpdateHandler);
        
        // Set up WebSocket status handling
        socket.on('websocket-status', (status) => {
            websocketConnected = status.connected;
            io.emit('trading-status', { active: websocketConnected });
            
            if (!websocketConnected) {
                console.log(`WebSocket disconnected for ${symbol}. Trading is paused until connection is restored.`);
            } else {
                console.log(`WebSocket connected for ${symbol}. Trading has resumed.`);
            }
        });
        
    } catch (err) {
        console.error(`Error subscribing to ticker stream for ${symbol}:`, err);
        websocketConnected = false;
        io.emit('trading-status', { active: websocketConnected });
    }
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Test connections on startup
    testDatabaseConnection();
    testBinanceConnection();
    testTelegramConnection();
});