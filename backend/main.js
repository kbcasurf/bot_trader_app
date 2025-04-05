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
const tradingsAPI = require('./js/tradings.js');
const healthAPI = require('./js/health.js');

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Create Express app
const app = express();
const PORT = process.env.PORT;

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
        const healthStatus = healthAPI.getHealthStatus();
        
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
        socket.emit('trading-status', { active: tradingsAPI.getTradingStatus().isActive });
        
        // Also get WebSocket status
        const wsStatus = binanceAPI.getWebSocketStatus();
        socket.emit('websocket-status', { 
            connected: wsStatus.totalConnections > 0 
        });
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
            
            // Get transaction data from database
            const symbol = data.symbol.toUpperCase();
            const transactions = await dbconns.getTransactions(symbol);
            const holdings = await dbconns.getHoldings(symbol);
            const refPrices = await dbconns.getReferencePrice(symbol);
            
            // Get current price
            const priceData = await binanceAPI.getTickerPrice(symbol);
            const currentPrice = parseFloat(priceData.price);
            
            // Calculate profit/loss percentage
            let profitLossPercent = 0;
            if (holdings.quantity > 0 && holdings.avg_price > 0 && currentPrice > 0) {
                profitLossPercent = ((currentPrice - holdings.avg_price) / holdings.avg_price) * 100;
            }
            
            // Send transaction data to client
            socket.emit('transaction-update', {
                symbol: symbol.replace('USDT', ''),
                transactions: transactions,
                refPrices: refPrices,
                success: true
            });
            
            // Send holdings data to client
            socket.emit('holdings-update', {
                symbol: symbol.replace('USDT', ''),
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
            
            // Format symbols properly
            const symbols = data.symbols.map(s => {
                const upperSymbol = s.toUpperCase();
                return upperSymbol.endsWith('USDT') ? upperSymbol : upperSymbol + 'USDT';
            });
            
            // Get batch data from database
            const batchData = await dbconns.getBatchData(symbols);
            
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
            
            // Process first purchase through trading engine
            const result = await tradingsAPI.processFirstPurchase(data.symbol, data.investment);
            
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
            
            // Process sell all through trading engine
            const result = await tradingsAPI.processSellAll(data.symbol);
            
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
        const dbConnected = await dbconns.testConnection();
        moduleStatus.database = dbConnected;
        console.log(`Database connection: ${dbConnected ? 'SUCCESS' : 'FAILED'}`);
        
        // 2. Test Binance API connection
        const binanceConnected = await binanceAPI.testConnection();
        moduleStatus.binance = binanceConnected;
        console.log(`Binance API connection: ${binanceConnected ? 'SUCCESS' : 'FAILED'}`);
        
        // 3. Test Telegram bot connection
        const telegramConnected = await telegramAPI.testConnection();
        moduleStatus.telegram = telegramConnected;
        console.log(`Telegram bot connection: ${telegramConnected ? 'SUCCESS' : 'FAILED'}`);
        
        // 4. Initialize Binance WebSocket connections if API is connected
        if (binanceConnected) {
            await binanceAPI.initializeWebSockets(io);
            console.log('Binance WebSocket connections initialized');
        }
        
        // 5. Initialize trading engine
        const tradingInitialized = await tradingsAPI.initialize(io);
        moduleStatus.trading = tradingInitialized;
        console.log(`Trading engine initialization: ${tradingInitialized ? 'SUCCESS' : 'FAILED'}`);
        
        // 6. Initialize health monitoring system
        const healthInitialized = await healthAPI.initialize(io);
        moduleStatus.health = healthInitialized;
        console.log(`Health monitoring initialization: ${healthInitialized ? 'SUCCESS' : 'FAILED'}`);
        
        console.log('All modules initialized');
        
        // Emit initial status to all connected clients
        io.emit('database-status', moduleStatus.database);
        io.emit('binance-status', moduleStatus.binance);
        io.emit('telegram-status', moduleStatus.telegram);
        io.emit('trading-status', { active: tradingsAPI.getTradingStatus().isActive });
        
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
    try {
        await binanceAPI.closeAllConnections();
        console.log('All WebSocket connections closed');
    } catch (error) {
        console.error('Error closing WebSocket connections:', error);
    }
    
    // Other cleanup tasks if needed
    
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
});

// Uncaught exception handling
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});