// backend/main.js
// Main application entry point
// Responsible for setting up the server and initializing all modules

// Import required modules
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Import our custom modules
const dbconns = require('./js/dbconns.js');
const binanceAPI = require('./js/binance.js');
const telegramAPI = require('./js/telegram.js');
const tradingEngine = require('./js/trading.js');
const healthMonitor = require('./js/health.js');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up server with proper error handling
const server = http.createServer(app);

// Configure middleware
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Socket.io with appropriate settings
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: false
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Track module initialization status
const moduleStatus = {
    database: false,
    binance: false,
    telegram: false,
    trading: false,
    health: false
};

// ======================================================
// API Routes
// ======================================================

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        // Use the health module to get status if available
        let healthStatus = { overall: false };
        
        if (moduleStatus.health && typeof healthMonitor.getHealthStatus === 'function') {
            healthStatus = healthMonitor.getHealthStatus();
        } else {
            // Basic status check if health module isn't available
            healthStatus = {
                overall: moduleStatus.database && moduleStatus.binance,
                database: moduleStatus.database,
                binance: moduleStatus.binance,
                telegram: moduleStatus.telegram,
                trading: moduleStatus.trading
            };
        }
        
        if (healthStatus.overall) {
            res.status(200).json({
                status: 'ok',
                uptime: process.uptime(),
                services: healthStatus,
                timestamp: Date.now()
            });
        } else {
            res.status(503).json({
                status: 'degraded',
                uptime: process.uptime(),
                services: healthStatus,
                message: 'One or more critical services are unhealthy',
                timestamp: Date.now()
            });
        }
    } catch (error) {
        console.error('Error in health check endpoint:', error);
        res.status(500).json({
            status: 'error',
            message: 'Error performing health check',
            error: error.message,
            timestamp: Date.now()
        });
    }
});

// Basic root endpoint
app.get('/', (req, res) => {
    res.send('Crypto Trading Bot Backend is running!');
});

// ======================================================
// Socket.io Event Handlers
// ======================================================

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    // Handle ping-pong for heartbeat
    socket.on('ping', (data, callback) => {
        const response = { 
            pong: true, 
            timestamp: Date.now(), 
            received: data 
        };
        
        if (typeof callback === 'function') {
            callback(response);
        } else {
            socket.emit('pong', response);
        }
    });
    
    // System status request
    socket.on('get-system-status', async () => {
        // Emit current status of all services
        socket.emit('database-status', moduleStatus.database);
        socket.emit('binance-status', moduleStatus.binance);
        socket.emit('telegram-status', moduleStatus.telegram);
        
        // Get trading status from the trading module if available
        let tradingStatus = { active: false };
        if (moduleStatus.trading && typeof tradingEngine.getTradingStatus === 'function') {
            tradingStatus = tradingEngine.getTradingStatus();
        }
        socket.emit('trading-status', tradingStatus);
        
        // Get WebSocket status from Binance API if available
        let wsStatus = { connected: false };
        if (moduleStatus.binance && typeof binanceAPI.getWebSocketStatus === 'function') {
            const fullStatus = binanceAPI.getWebSocketStatus();
            wsStatus = { 
                connected: fullStatus.totalConnections > 0,
                pollingActive: fullStatus.pollingActive || false 
            };
        }
        socket.emit('websocket-status', wsStatus);
    });
    
    // Transaction data requests
    socket.on('get-transactions', async (data) => {
        try {
            if (!data || !data.symbol) {
                socket.emit('transaction-update', { 
                    success: false, 
                    error: 'Missing symbol parameter' 
                });
                return;
            }
            
            // Skip if database isn't connected
            if (!moduleStatus.database) {
                socket.emit('transaction-update', { 
                    success: false, 
                    error: 'Database not connected' 
                });
                return;
            }
            
            // Get transaction data from database
            const symbol = data.symbol.toUpperCase();
            const fullSymbol = symbol.endsWith('USDT') ? symbol : symbol + 'USDT';
            
            const transactions = await dbconns.getTransactions(fullSymbol);
            const holdings = await dbconns.getHoldings(fullSymbol);
            const refPrices = await dbconns.getReferencePrice(fullSymbol);
            
            // Get current price if Binance is connected
            let currentPrice = 0;
            if (moduleStatus.binance) {
                try {
                    const priceData = await binanceAPI.getTickerPrice(fullSymbol);
                    currentPrice = parseFloat(priceData.price);
                } catch (priceError) {
                    console.error(`Error getting price for ${fullSymbol}:`, priceError);
                }
            }
            
            // Calculate profit/loss percentage
            let profitLossPercent = 0;
            if (holdings.quantity > 0 && holdings.avg_price > 0 && currentPrice > 0) {
                profitLossPercent = ((currentPrice - holdings.avg_price) / holdings.avg_price) * 100;
            }
            
            // Send transaction data to client
            socket.emit('transaction-update', {
                symbol: symbol,
                transactions: transactions,
                refPrices: refPrices,
                success: true
            });
            
            // Send holdings data to client
            socket.emit('holdings-update', {
                symbol: symbol,
                amount: holdings.quantity,
                avgPrice: holdings.avg_price,
                currentPrice: currentPrice,
                initialPrice: refPrices.initial_purchase_price,
                lastBuyPrice: refPrices.last_purchase_price,
                nextBuyThreshold: refPrices.next_buy_threshold,
                nextSellThreshold: refPrices.next_sell_threshold,
                profitLossPercent: profitLossPercent
            });
        } catch (error) {
            console.error('Error processing get-transactions request:', error);
            socket.emit('transaction-update', { 
                success: false, 
                error: 'Server error' 
            });
        }
    });
    
    // Batch data request - more efficient than individual requests
    socket.on('batch-get-data', async (data) => {
        try {
            if (!data || !data.symbols || !Array.isArray(data.symbols)) {
                socket.emit('batch-data-update', { 
                    success: false, 
                    error: 'Invalid request format - symbols array required' 
                });
                return;
            }
            
            // Skip if database isn't connected
            if (!moduleStatus.database) {
                socket.emit('batch-data-update', { 
                    success: false, 
                    error: 'Database not connected' 
                });
                return;
            }
            
            // Format symbols properly
            const symbols = data.symbols.map(s => {
                const upperSymbol = s.toUpperCase();
                return upperSymbol.endsWith('USDT') ? upperSymbol : upperSymbol + 'USDT';
            });
            
            // Get batch data from database
            const batchData = await dbconns.getBatchData(symbols);
            
            // If Binance is connected, add current prices
            if (moduleStatus.binance) {
                try {
                    const prices = await binanceAPI.getMultipleTickers(symbols);
                    
                    // Add prices to batch data
                    Object.keys(batchData).forEach(symbol => {
                        const priceInfo = prices.find(p => p.symbol === symbol);
                        if (priceInfo && batchData[symbol]) {
                            batchData[symbol].currentPrice = parseFloat(priceInfo.price);
                        }
                    });
                } catch (priceError) {
                    console.error('Error getting prices for batch data:', priceError);
                }
            }
            
            // Send batch data to client
            socket.emit('batch-data-update', {
                success: true,
                data: batchData
            });
        } catch (error) {
            console.error('Error processing batch-get-data request:', error);
            socket.emit('batch-data-update', { 
                success: false, 
                error: 'Server error' 
            });
        }
    });
    
    // Account info request
    socket.on('get-account-info', async () => {
        try {
            // Skip if Binance isn't connected
            if (!moduleStatus.binance) {
                socket.emit('account-info', { error: 'Binance API not connected' });
                return;
            }
            
            const accountInfo = await binanceAPI.getAccountInfo();
            socket.emit('account-info', accountInfo);
        } catch (error) {
            console.error('Error getting account info:', error);
            socket.emit('account-info', { error: error.message });
        }
    });
    
    // First purchase (buy) handler
    socket.on('first-purchase', async (data) => {
        try {
            if (!data || !data.symbol || !data.investment) {
                socket.emit('first-purchase-result', {
                    success: false,
                    error: 'Missing required parameters (symbol or investment)'
                });
                return;
            }
            
            // Skip if trading module isn't initialized
            if (!moduleStatus.trading) {
                socket.emit('first-purchase-result', {
                    success: false,
                    error: 'Trading engine not available'
                });
                return;
            }
            
            // Process first purchase through trading engine
            const result = await tradingEngine.processFirstPurchase(data.symbol, data.investment);
            
            // Send result to client
            socket.emit('first-purchase-result', result);
        } catch (error) {
            console.error('Error processing first purchase:', error);
            socket.emit('first-purchase-result', {
                success: false,
                error: error.message
            });
        }
    });
    
    // Sell all handler
    socket.on('sell-all', async (data) => {
        try {
            if (!data || !data.symbol) {
                socket.emit('sell-all-result', {
                    success: false,
                    error: 'Missing required parameter (symbol)'
                });
                return;
            }
            
            // Skip if trading module isn't initialized
            if (!moduleStatus.trading) {
                socket.emit('sell-all-result', {
                    success: false,
                    error: 'Trading engine not available'
                });
                return;
            }
            
            // Process sell all through trading engine
            const result = await tradingEngine.processSellAll(data.symbol);
            
            // Send result to client
            socket.emit('sell-all-result', result);
        } catch (error) {
            console.error('Error processing sell all:', error);
            socket.emit('sell-all-result', {
                success: false,
                error: error.message
            });
        }
    });
    
    // Test Binance WebSocket connection
    socket.on('test-binance-stream', async () => {
        try {
            // Skip if Binance isn't connected
            if (!moduleStatus.binance) {
                socket.emit('binance-test-result', {
                    success: false,
                    error: 'Binance API not connected'
                });
                return;
            }
            
            // Reinitialize WebSocket connections
            binanceAPI.initializeWebSockets(io);
            
            socket.emit('binance-test-result', {
                success: true,
                message: 'WebSocket connection test initiated'
            });
        } catch (error) {
            console.error('Error testing Binance stream:', error);
            socket.emit('binance-test-result', {
                success: false,
                error: error.message
            });
        }
    });
    
    // Handle client errors (sent from frontend)
    socket.on('client-error', (errorData) => {
        console.error('Received client error:', errorData);
        
        // Log to Telegram if connected and error reporting is enabled
        if (moduleStatus.telegram && process.env.TELEGRAM_ERROR_REPORTING === 'true') {
            try {
                telegramAPI.sendSystemAlert({
                    type: 'error',
                    message: 'Client-side error reported',
                    details: errorData.message
                });
            } catch (telegramError) {
                console.error('Error sending error to Telegram:', telegramError);
            }
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
        console.log(`Client disconnected: ${socket.id}, Reason: ${reason}`);
    });
});

// ======================================================
// Module Initialization
// ======================================================

/**
 * Initialize all modules in sequence
 */
async function initializeModules() {
    try {
        console.log('Initializing modules...');
        
        // 1. Initialize database connection
        let dbConnected = false;
        try {
            dbConnected = await dbconns.testConnection();
            moduleStatus.database = dbConnected;
            console.log(`Database connection: ${dbConnected ? 'SUCCESS' : 'FAILED'}`);
        } catch (dbError) {
            console.error('Database initialization error:', dbError);
        }
        
        // 2. Test Binance API connection
        let binanceConnected = false;
        try {
            if (process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET) {
                binanceConnected = await binanceAPI.testConnection();
                moduleStatus.binance = binanceConnected;
                console.log(`Binance API connection: ${binanceConnected ? 'SUCCESS' : 'FAILED'}`);
            } else {
                console.warn('Binance API credentials not provided in environment variables');
            }
        } catch (binanceError) {
            console.error('Binance API initialization error:', binanceError);
        }
        
        // 3. Test Telegram bot connection
        let telegramConnected = false;
        try {
            if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
                telegramConnected = await telegramAPI.testConnection();
                moduleStatus.telegram = telegramConnected;
                console.log(`Telegram bot connection: ${telegramConnected ? 'SUCCESS' : 'FAILED'}`);
            } else {
                console.warn('Telegram credentials not provided in environment variables');
            }
        } catch (telegramError) {
            console.error('Telegram initialization error:', telegramError);
        }
        
        // 4. Initialize Binance WebSocket connections if API is connected
        if (binanceConnected) {
            try {
                await binanceAPI.initializeWebSockets(io);
                console.log('Binance WebSocket connections initialized');
            } catch (wsError) {
                console.error('Binance WebSocket initialization error:', wsError);
            }
        }
        
        // 5. Initialize trading engine if dependencies are available
        let tradingInitialized = false;
        try {
            if (moduleStatus.database && moduleStatus.binance) {
                // Check if trading module exists and has initialize method
                if (typeof tradingEngine.initialize === 'function') {
                    tradingInitialized = await tradingEngine.initialize(io);
                    moduleStatus.trading = tradingInitialized;
                    console.log(`Trading engine initialization: ${tradingInitialized ? 'SUCCESS' : 'FAILED'}`);
                } else {
                    console.warn('Trading engine module not properly defined');
                }
            } else {
                console.warn('Skipping trading engine initialization due to missing dependencies');
            }
        } catch (tradingError) {
            console.error('Trading engine initialization error:', tradingError);
        }
        
        // 6. Initialize health monitoring system
        let healthInitialized = false;
        try {
            // Check if health module exists and has initialize method
            if (typeof healthMonitor.initialize === 'function') {
                healthInitialized = await healthMonitor.initialize(io);
                moduleStatus.health = healthInitialized;
                console.log(`Health monitoring initialization: ${healthInitialized ? 'SUCCESS' : 'FAILED'}`);
            } else {
                console.warn('Health monitor module not properly defined');
            }
        } catch (healthError) {
            console.error('Health monitoring initialization error:', healthError);
        }
        
        console.log('All modules initialized');
        
        // Emit initial status to all connected clients
        io.emit('database-status', moduleStatus.database);
        io.emit('binance-status', moduleStatus.binance);
        io.emit('telegram-status', moduleStatus.telegram);
        
        // Emit trading status if available
        let tradingStatus = { active: false };
        if (moduleStatus.trading && typeof tradingEngine.getTradingStatus === 'function') {
            tradingStatus = tradingEngine.getTradingStatus();
        }
        io.emit('trading-status', tradingStatus);
        
        return true;
    } catch (error) {
        console.error('Error during module initialization:', error);
        return false;
    }
}

// ======================================================
// Server Startup
// ======================================================

// Start the server
server.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
    
    // Initialize all modules after server is running
    await initializeModules();
    
    // Setup heartbeat
    setInterval(() => {
        io.emit('heartbeat', { timestamp: Date.now() });
    }, 30000); // Every 30 seconds
});

// ======================================================
// Graceful Shutdown
// ======================================================

// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    
    // Close all WebSocket connections
    if (moduleStatus.binance && typeof binanceAPI.closeAllConnections === 'function') {
        try {
            await binanceAPI.closeAllConnections();
            console.log('All WebSocket connections closed');
        } catch (error) {
            console.error('Error closing WebSocket connections:', error);
        }
    }
    
    // Clean up database connections if connected
    if (moduleStatus.database && dbconns.pool) {
        try {
            await dbconns.pool.end();
            console.log('Database connections closed');
        } catch (error) {
            console.error('Error closing database connections:', error);
        }
    }
    
    // Close server
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
    
    // Force exit after timeout
    setTimeout(() => {
        console.error('Forcing server shutdown after timeout');
        process.exit(1);
    }, 5000);
});

// Unhandled rejection handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    
    // Log to Telegram if connected and error reporting is enabled
    if (moduleStatus.telegram && process.env.TELEGRAM_ERROR_REPORTING === 'true') {
        telegramAPI.sendSystemAlert({
            type: 'error',
            message: 'Unhandled Promise Rejection',
            details: reason ? reason.toString() : 'Unknown reason'
        }).catch(telegramError => {
            console.error('Error sending unhandled rejection to Telegram:', telegramError);
        });
    }
});

// Uncaught exception handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    
    // Log to Telegram if connected and error reporting is enabled
    if (moduleStatus.telegram && process.env.TELEGRAM_ERROR_REPORTING === 'true') {
        telegramAPI.sendSystemAlert({
            type: 'error',
            message: 'Uncaught Exception',
            details: error.message
        }).catch(telegramError => {
            console.error('Error sending uncaught exception to Telegram:', telegramError);
        });
    }
    
    // For uncaught exceptions, we should exit after cleanup
    // but give a chance to log and notify
    setTimeout(() => {
        process.exit(1);
    }, 1000);
});