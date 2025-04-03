// backend/main.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const mariadb = require('mariadb');
const binanceAPI = require('./js/binance');
const telegramBot = require('./js/telegram');
const tradingEngine = require('./js/trading-engine');

// Load environment variables
dotenv.config({ path: '/app/.env' });

// Initialize Express app
const app = express();
// Create HTTP server - THIS NEEDS TO HAPPEN BEFORE TRYING TO USE THE SERVER VARIABLE
const server = http.createServer(app);

// PORT variable needs to be defined
const PORT = process.env.PORT;

// Add a cache for price calculation timestamps to avoid unnecessary DB calls
const priceCalculationCache = {};


// Start the server
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    
    // Test connections on startup
    (async () => {
        await testDatabaseConnection();
        const binanceConnected = await testBinanceConnection();
        await testTelegramConnection();
        
        // Initialize WebSockets if Binance is connected
        if (binanceConnected) {
            await initializeWebSockets();
        }
        
        // Setup heartbeat mechanism
        setupHeartbeat();
    })();
});

// Initialize Socket.io with proper CORS settings
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'OPTIONS'],
        credentials: false
    },
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000,
    connectTimeout: 30000,
    allowUpgrades: true,
    perMessageDeflate: {
        threshold: 1024 // Compress data if it exceeds 1KB
    }
});

// Circuit breaker settings to prevent excessive trading during errors
const CIRCUIT_BREAKER = {
    maxErrorCount: 3,         // Max consecutive errors before breaking the circuit
    resetTimeoutMs: 60000,    // Reset circuit breaker after 1 minute
    errorCount: 0,            // Current error count
    tripped: false,           // Whether circuit is tripped
    lastErrorTime: 0          // Last error timestamp
};

// Configure CORS properly
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.get('/health', async (req, res) => {
    // Collect health information
    const health = {
        uptime: process.uptime(),
        timestamp: Date.now(),
        services: {
            database: systemStatus.database,
            binance: systemStatus.binance,
            telegram: systemStatus.telegram,
            websocket: websocketConnected
        }
    };
    
    try {
        // Do a quick database connection test
        let dbHealthy = false;
        try {
            const conn = await pool.getConnection();
            await conn.query('SELECT 1 AS health_check');
            await conn.release();
            dbHealthy = true;
        } catch (dbError) {
            console.error('Health check database error:', dbError);
            health.databaseError = dbError.message;
        }
        
        // Update database status
        health.services.database = dbHealthy;
        systemStatus.database = dbHealthy;
        
        // Send health status with appropriate HTTP status
        if (dbHealthy && systemStatus.binance) {
            res.status(200).json(health);
        } else {
            res.status(503).json({
                ...health,
                message: 'One or more critical services are unhealthy',
                recommendations: [
                    'Check database connection',
                    'Verify Binance API credentials',
                    'Ensure all containers are running'
                ]
            });
        }
    } catch (error) {
        console.error('Error in health check endpoint:', error);
        res.status(500).json({
            uptime: process.uptime(),
            message: 'Error performing health check',
            error: error.message,
            timestamp: Date.now()
        });
    }
});

// Add a simple endpoint
app.get('/', (req, res) => {
    res.send('Crypto Trading Bot Backend is running!');
});

// Add middleware to parse JSON payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug middleware for Socket.IO connections
io.use((socket, next) => {
    console.log('New Socket.IO connection attempt:', socket.id);
    next();
});

// Database connection pool with more robust configuration
const pool = mariadb.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionLimit: 20,        // Keep at 20 but manage them better
    acquireTimeout: 30000,      // Increased timeout for busy periods
    idleTimeout: 60000,         // Release idle connections after 1 minute
    resetAfterUse: true,        // Reset connection state after use
    connReleaseTimeout: 5000,   // Ensure connections are released if query idle
    trace: true,                // Set to true only for debugging
    multipleStatements: false,  // Safety measure to prevent SQL injection
    connectTimeout: 20000,      // Connection timeout
    socketTimeout: 60000,       // Socket timeout
    // Make sure the pool object has the required methods for monitoring
    activeConnections: function() {
        return this.activeConnections ? this.activeConnections() : 0;
    },
    totalConnections: function() {
        return this.totalConnections ? this.totalConnections() : 0;
    }
});

// Log pool creation success
console.log('Database connection pool created with configuration:', {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    database: process.env.DB_NAME,
    connectionLimit: 20
});

// Add error handling for the pool
pool.on('connection', (conn) => {
    console.log('New database connection established');
    
    conn.on('error', (err) => {
        console.error('Database connection error:', err);
    });
});

pool.on('acquire', (conn) => {
    console.log('Database connection acquired');
});

pool.on('release', (conn) => {
    console.log('Database connection released');
});

pool.on('enqueue', () => {
    console.warn('Waiting for available database connection slot');
});

// Initialize trading engine with dependencies
tradingEngine.initialize(pool, binanceAPI, telegramBot, io);
setupDatabaseMonitoring();


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
        if (conn) {
            conn.release();
        }
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

// Initialize WebSocket connections if Binance is connected
async function initializeWebSockets() {
    if (systemStatus.binance) {
        try {
            // Initialize WebSocket connections
            binanceAPI.initializeWebSockets(io);
            websocketConnected = true;
            io.emit('trading-status', { active: websocketConnected });
            console.log('WebSocket connections initialized successfully');
            return true;
        } catch (error) {
            console.error('Failed to initialize WebSockets:', error);
            websocketConnected = false;
            io.emit('trading-status', { active: websocketConnected });
            return false;
        }
    } else {
        console.log('Cannot initialize WebSockets - Binance API not connected');
        websocketConnected = false;
        io.emit('trading-status', { active: websocketConnected });
        return false;
    }
}

// Add a heartbeat mechanism to keep connections alive
function setupHeartbeat() {
    // Periodically send a heartbeat event to all connected clients
    setInterval(() => {
        io.emit('heartbeat', { timestamp: Date.now() });
    }, 30000); // Every 30 seconds
}

// Function to check and update the circuit breaker
function checkCircuitBreaker(success) {
    const now = Date.now();
    
    // Reset circuit breaker after timeout
    if (CIRCUIT_BREAKER.tripped && (now - CIRCUIT_BREAKER.lastErrorTime > CIRCUIT_BREAKER.resetTimeoutMs)) {
        console.log('Circuit breaker timeout elapsed, resetting');
        CIRCUIT_BREAKER.tripped = false;
        CIRCUIT_BREAKER.errorCount = 0;
    }
    
    if (success) {
        // Reset error count on success
        CIRCUIT_BREAKER.errorCount = 0;
    } else {
        // Increment error count and check if circuit should trip
        CIRCUIT_BREAKER.errorCount++;
        CIRCUIT_BREAKER.lastErrorTime = now;
        
        if (CIRCUIT_BREAKER.errorCount >= CIRCUIT_BREAKER.maxErrorCount) {
            CIRCUIT_BREAKER.tripped = true;
            console.error(`Circuit breaker tripped after ${CIRCUIT_BREAKER.errorCount} consecutive errors.`);
            
            // Notify via Telegram if configured
            if (systemStatus.telegram) {
                telegramBot.sendMessage('⚠️ WARNING: Trading circuit breaker has been tripped due to multiple consecutive errors. Trading operations have been suspended temporarily.');
            }
            
            io.emit('trading-status', { 
                active: false, 
                circuitBreaker: true, 
                message: 'Trading suspended due to multiple consecutive errors'
            });
        }
    }
    
    return CIRCUIT_BREAKER.tripped;
}



// Helper function to get transactions for a symbol
async function getTransactions(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC',
            [symbol]
        );
        
        console.log(`Found ${rows.length} transactions for ${symbol}`);
        
        return rows;
    } catch (err) {
        console.error('Error querying transactions:', err);
        return [];
    } finally {
        if (conn) {
            // Always release the connection back to the pool
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
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
        
        // Release connection immediately after query
        await conn.release();
        
        return rows[0] || { symbol, quantity: 0, avg_price: 0 };
    } catch (err) {
        console.error('Error getting holdings:', err);
        return { symbol, quantity: 0, avg_price: 0 };
    } finally {
        // Double-check connection release in finally block
        if (conn && conn.isValid()) {
            try {
                await conn.release();
            } catch (releaseError) {
                // Already released, ignore
            }
        }
    }
}

// New batch function to get data for multiple symbols with a single connection
async function batchGetData(symbols) {
    if (!symbols || !symbols.length) {
        return {};
    }
    
    let conn;
    try {
        conn = await pool.getConnection();
        
        const results = {};
        
        // Get transactions for all symbols in one connection
        for (const symbol of symbols) {
            try {
                // Get transactions
                const txRows = await conn.query(
                    'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC',
                    [symbol]
                );
                
                // Get holdings
                const holdingsRows = await conn.query(
                    'SELECT * FROM holdings WHERE symbol = ?',
                    [symbol]
                );
                
                // Get reference prices
                const refPriceRows = await conn.query(
                    'SELECT * FROM reference_prices WHERE symbol = ?',
                    [symbol]
                );
                
                // Store all data
                results[symbol] = {
                    transactions: txRows,
                    holdings: holdingsRows[0] || { symbol, quantity: 0, avg_price: 0 },
                    refPrices: refPriceRows[0] || { 
                        initial_purchase_price: 0, 
                        last_purchase_price: 0, 
                        next_buy_threshold: 0, 
                        next_sell_threshold: 0 
                    }
                };
            } catch (error) {
                console.error(`Error processing batch data for ${symbol}:`, error);
                results[symbol] = { error: true };
            }
        }
        
        return results;
    } catch (error) {
        console.error('Error in batch data processing:', error);
        return {};
    } finally {
        if (conn) {
            try {
                await conn.release();
            } catch (releaseError) {
                console.error('Error releasing connection:', releaseError);
            }
        }
    }
}



// Validate trading parameters
function validateTradeParams(params) {
    // Check if symbol is valid
    if (!params || !params.symbol) {
        return { valid: false, error: 'Missing symbol in request' };
    }
    
    // Check amount value
    if (params.amount === undefined || params.amount === null) {
        return { valid: false, error: 'Missing amount parameter' };
    }
    
    const amount = parseFloat(params.amount);
    if (isNaN(amount) || amount <= 0) {
        return { valid: false, error: 'Invalid amount value' };
    }
    
    // Validate amountType
    const validAmountTypes = ['amount', 'usdt'];
    if (params.amountType && !validAmountTypes.includes(params.amountType)) {
        return { valid: false, error: 'Invalid amountType. Must be "amount" or "usdt"' };
    }
    
    return { valid: true, params: {
        symbol: params.symbol,
        amount: amount,
        amountType: params.amountType || 'amount'
    }};
}


// Add this pool monitoring function to track and manage connections
function setupDatabaseMonitoring() {
    setInterval(async () => {
        try {
            // Get pool status
            const activeConnections = pool.activeConnections();
            const totalConnections = pool.totalConnections();
            
            console.log(`Database pool status: Active=${activeConnections}, Total=${totalConnections}`);
            
            if (activeConnections > (pool.config.connectionLimit * 0.8)) {
                console.warn(`High number of active connections (${activeConnections}/${pool.config.connectionLimit}) - forcing reset`);
                
                // Force reset some connections if too many are active
                try {
                    await pool.query('SELECT 1 AS reset');
                } catch (error) {
                    console.error('Error during connection reset query:', error);
                }
            }
        } catch (error) {
            console.error('Error monitoring database connections:', error);
        }
    }, 30000); // Check every 30 seconds
}



// Socket.io connection handling
io.on('connection', (socket) => {
    // Add ping handler for connection testing
    socket.on('ping', (data, callback) => {
        if (typeof callback === 'function') {
            callback({ 
                pong: true, 
                timestamp: Date.now(), 
                received: data 
            });
        } else {
            socket.emit('pong', { 
                timestamp: Date.now(), 
                received: data 
            });
        }
    });

    // Handle client disconnection
    socket.on('disconnect', (reason) => {
        console.log(`Client ${socket.id} disconnected. Reason: ${reason}`);
    });
    
    // Handle system status request
    socket.on('get-system-status', async () => {
        await testDatabaseConnection();
        await testBinanceConnection();
        await testTelegramConnection();
        
        // If Binance is connected, initialize WebSockets
        if (systemStatus.binance && !websocketConnected) {
            await initializeWebSockets();
        }
    });
    
    // Add a new socket.io event handler for checking WebSocket status
    socket.on('get-websocket-status', async () => {
        try {
            const status = binanceAPI.getWebSocketStatus();
            socket.emit('websocket-status-details', {
                status,
                success: true
            });
        } catch (error) {
            console.error('Error getting WebSocket status:', error);
            socket.emit('websocket-status-details', {
                success: false,
                error: error.message
            });
        }
    });


    // Add this implementation for batch data request handling
    socket.on('batch-get-data', async (data) => {
        try {
            if (!data || !data.symbols || !Array.isArray(data.symbols)) {
                socket.emit('batch-data-update', { 
                    success: false, 
                    error: 'Invalid request format - symbols array required' 
                });
                return;
            }
            
            // Get all data for these symbols using a single connection
            const batchResults = {};
            
            // Use a single connection for all operations
            let conn;
            
            try {
                conn = await pool.getConnection();
                
                // Process each symbol
                for (const symbol of data.symbols) {
                    try {
                        // Get transactions
                        const transactions = await conn.query(
                            'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC',
                            [symbol]
                        );
                        
                        // Get holdings
                        const holdingsRows = await conn.query(
                            'SELECT * FROM holdings WHERE symbol = ?',
                            [symbol]
                        );
                        
                        // Get reference prices
                        const refPriceRows = await conn.query(
                            'SELECT * FROM reference_prices WHERE symbol = ?',
                            [symbol]
                        );
                        
                        // Store all data for this symbol
                        batchResults[symbol] = {
                            transactions: transactions,
                            holdings: holdingsRows[0] || { symbol, quantity: 0, avg_price: 0 },
                            refPrices: refPriceRows[0] || { 
                                symbol,
                                initial_purchase_price: 0,
                                last_purchase_price: 0,
                                last_sell_price: 0,
                                next_buy_threshold: 0,
                                next_sell_threshold: 0
                            }
                        };
                    } catch (err) {
                        console.error(`Error processing batch data for ${symbol}:`, err);
                        batchResults[symbol] = { error: err.message };
                    }
                }
            } catch (error) {
                console.error('Error getting batch data:', error);
                socket.emit('batch-data-update', { 
                    success: false, 
                    error: 'Database error' 
                });
                return;
            } finally {
                // Always release the connection
                if (conn) {
                    try {
                        await conn.release();
                    } catch (releaseError) {
                        console.error('Error releasing connection:', releaseError);
                    }
                }
            }
            
            // Send all results back in a single response
            socket.emit('batch-data-update', {
                success: true,
                data: batchResults
            });
        } catch (error) {
            console.error('Error processing batch data request:', error);
            socket.emit('batch-data-update', { 
                success: false, 
                error: 'Server error' 
            });
        }
    });


    // Handle get account info request
    socket.on('get-account-info', async () => {
        try {
            console.log('Fetching account info from Binance');
            const accountInfo = await binanceAPI.getAccountInfo();
            socket.emit('account-info', accountInfo);
        } catch (error) {
            console.error('Error getting account info:', error);
            socket.emit('account-info', { error: error.message });
        }
    });




    // Handle get transactions request
    socket.on('get-transactions', async (data) => {
        try {
            console.log('Received get-transactions request:', data);
            
            if (!data || !data.symbol) {
                socket.emit('transaction-update', { 
                    symbol: 'unknown',
                    transactions: [],
                    success: false,
                    error: 'Missing symbol in request'
                });
                return;
            }
            
            // Extract base symbol without USDT
            const baseSymbol = data.symbol.replace('USDT', '');
            const fullSymbol = data.symbol.endsWith('USDT') ? data.symbol : data.symbol + 'USDT';
            
            // Get transactions for the symbol from database
            let conn;
            try {
                conn = await pool.getConnection();
                const rows = await conn.query(
                    'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC LIMIT 10',
                    [fullSymbol]
                );
                
                console.log(`Found ${rows.length} transactions for ${fullSymbol}`);
                await conn.release();
                conn = null;
                
                // Get reference prices - PASS THE POOL HERE
                const refPrices = await tradingEngine.getReferencePrices(fullSymbol, pool);
                
                // Send transaction history to client
                socket.emit('transaction-update', {
                    symbol: baseSymbol,
                    transactions: rows,
                    success: true,
                    refPrices: refPrices
                });
                
                // Also recalculate and send holdings - PASS THE POOL HERE
                const holdings = await tradingEngine.getHoldings(fullSymbol, pool);
                
                // Get current price to calculate profit/loss
                const priceData = await binanceAPI.getTickerPrice(fullSymbol);
                const currentPrice = parseFloat(priceData.price);
                
                // Calculate profit/loss percentage if we have holdings and price
                let profitLossPercent = 0;
                if (holdings.quantity > 0 && holdings.avg_price > 0 && currentPrice > 0) {
                    profitLossPercent = tradingEngine.calculateProfitLoss(holdings.avg_price, currentPrice);
                }
                
                socket.emit('holdings-update', {
                    symbol: baseSymbol,
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
                console.error('Error querying transactions:', error);
                socket.emit('transaction-update', { 
                    symbol: baseSymbol,
                    transactions: [],
                    success: false,
                    error: 'Database error'
                });
            } finally {
                if (conn) {
                    try {
                        await conn.release();
                    } catch (releaseError) {
                        console.error('Error releasing connection:', releaseError);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing get-transactions request:', error);
            socket.emit('transaction-update', { 
                success: false,
                error: 'Server error'
            });
        }
    });





    // Handle buy order
    socket.on('buy-order', async (data) => {
        try {
            console.log('Buy order received:', data);
            
            // Check if circuit breaker is tripped
            if (CIRCUIT_BREAKER.tripped) {
                socket.emit('buy-result', { 
                    success: false, 
                    error: 'Trading is currently suspended due to multiple consecutive errors. Please try again later.' 
                });
                return;
            }
            
            // Validate parameters
            const validation = validateTradeParams(data);
            if (!validation.valid) {
                socket.emit('buy-result', { 
                    success: false, 
                    error: validation.error
                });
                return;
            }
            
            // Execute the buy order
            const result = await binanceAPI.executeBuyOrder(
                validation.params.symbol, 
                validation.params.amount, 
                validation.params.amountType
            );
            
            // Update circuit breaker status
            checkCircuitBreaker(result.success);
            
            // Emit the result
            socket.emit('buy-result', result);
            
            // Also broadcast price update if we got a price
            if (result.success && result.price) {
                io.emit('price-update', {
                    symbol: data.symbol,
                    price: result.price,
                    source: 'order'
                });
                
                // Send Telegram notification for successful order
                if (systemStatus.telegram) {
                    try {
                        await telegramBot.sendTradeNotification({
                            symbol: data.symbol,
                            type: 'BUY',
                            price: result.price,
                            quantity: result.amount,
                            investment: validation.params.amount,
                            timestamp: Date.now()
                        });
                        console.log('Telegram notification sent for buy order');
                    } catch (telegramError) {
                        console.error('Error sending Telegram notification:', telegramError);
                    }
                }
                
                // Store transaction in database if connection is available
                if (systemStatus.database) {
                    try {
                        const conn = await pool.getConnection();
                        await conn.query(
                            'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                            [data.symbol, 'BUY', result.price, result.amount, validation.params.amount]
                        );
                        
                        // Update holdings
                        await tradingEngine.updateHoldings(data.symbol);
                        
                        // Update reference prices
                        await tradingEngine.updateReferencePrices(data.symbol, result.price);
                        
                        conn.release();
                        
                        // Send transaction update to clients
                        const transactions = await getTransactions(data.symbol);
                        io.emit('transaction-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            transactions: transactions,
                            refPrices: await tradingEngine.getReferencePrices(data.symbol)
                        });
                        
                        // Send holdings update to clients
                        const holdings = await getHoldings(data.symbol);
                        const refPrices = await tradingEngine.getReferencePrices(data.symbol);
                        
                        io.emit('holdings-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            amount: holdings.quantity,
                            avgPrice: holdings.avg_price,
                            initialPrice: refPrices.initial_purchase_price,
                            lastBuyPrice: refPrices.last_purchase_price,
                            nextBuyThreshold: refPrices.next_buy_threshold,
                            nextSellThreshold: refPrices.next_sell_threshold,
                            profitLossPercent: ((result.price - holdings.avg_price) / holdings.avg_price) * 100
                        });
                    } catch (dbError) {
                        console.error('Error storing transaction in database:', dbError);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing buy order:', error);
            socket.emit('buy-result', { 
                success: false, 
                error: error.message 
            });
            
            // Update circuit breaker
            checkCircuitBreaker(false);
        }
    });
    
    // Handle sell order
    socket.on('sell-order', async (data) => {
        try {
            console.log('Sell order received:', data);
            
            // Check if circuit breaker is tripped
            if (CIRCUIT_BREAKER.tripped) {
                socket.emit('sell-result', { 
                    success: false, 
                    error: 'Trading is currently suspended due to multiple consecutive errors. Please try again later.' 
                });
                return;
            }
            
            // Validate parameters
            const validation = validateTradeParams(data);
            if (!validation.valid) {
                socket.emit('sell-result', { 
                    success: false, 
                    error: validation.error
                });
                return;
            }
            
            // Execute the sell order
            const result = await binanceAPI.executeSellOrder(
                validation.params.symbol, 
                validation.params.amount, 
                validation.params.amountType
            );
            
            // Update circuit breaker status
            checkCircuitBreaker(result.success);
            
            // Emit the result
            socket.emit('sell-result', result);
            
            // Also broadcast price update if we got a price
            if (result.success && result.price) {
                io.emit('price-update', {
                    symbol: data.symbol,
                    price: result.price,
                    source: 'order'
                });
                
                // Send Telegram notification for successful order
                if (systemStatus.telegram) {
                    try {
                        await telegramBot.sendTradeNotification({
                            symbol: data.symbol,
                            type: 'SELL',
                            price: result.price,
                            quantity: result.amount,
                            investment: validation.params.amount * result.price, // Approximate value of the sale
                            timestamp: Date.now()
                        });
                        console.log('Telegram notification sent for sell order');
                    } catch (telegramError) {
                        console.error('Error sending Telegram notification:', telegramError);
                    }
                }
                
                // Store transaction in database if connection is available
                if (systemStatus.database) {
                    try {
                        const conn = await pool.getConnection();
                        await conn.query(
                            'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                            [data.symbol, 'SELL', result.price, result.amount, validation.params.amount * result.price]
                        );
                        
                        // Update holdings
                        await tradingEngine.updateHoldings(data.symbol);
                        
                        // Update reference prices
                        await tradingEngine.updateReferencePrices(data.symbol, result.price);
                        
                        conn.release();
                        
                        // Send transaction update to clients
                        const transactions = await getTransactions(data.symbol);
                        io.emit('transaction-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            transactions: transactions,
                            refPrices: await tradingEngine.getReferencePrices(data.symbol)
                        });
                        
                        // Send holdings update to clients
                        const holdings = await getHoldings(data.symbol);
                        const refPrices = await tradingEngine.getReferencePrices(data.symbol);
                        
                        io.emit('holdings-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            amount: holdings.quantity,
                            avgPrice: holdings.avg_price,
                            initialPrice: refPrices.initial_purchase_price,
                            lastBuyPrice: refPrices.last_purchase_price,
                            nextBuyThreshold: refPrices.next_buy_threshold,
                            nextSellThreshold: refPrices.next_sell_threshold,
                            profitLossPercent: holdings.quantity > 0 ? ((result.price - holdings.avg_price) / holdings.avg_price) * 100 : 0
                        });
                    } catch (dbError) {
                        console.error('Error storing transaction in database:', dbError);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing sell order:', error);
            socket.emit('sell-result', { 
                success: false, 
                error: error.message 
            });
            
            // Update circuit breaker
            checkCircuitBreaker(false);
        }
    });
    
    // Handle test Binance WebSocket stream
    socket.on('test-binance-stream', async () => {
        try {
            console.log('Testing Binance WebSocket stream');
            
            // First, check current WebSocket status
            const status = binanceAPI.getWebSocketStatus();
            
            // If no active connections, initialize WebSockets
            if (status.totalConnections === 0) {
                binanceAPI.initializeWebSockets(io);
            }
 
            socket.emit('binance-test-result', {
                success: true,
                message: 'WebSocket test initiated',
                websocketStatus: status
            });
        } catch (error) {
            console.error('Error in test-binance-stream:', error);
            socket.emit('binance-test-result', {
                success: false,
                error: error.message
            });
        }
    });
    
    // Listen for WebSocket status updates
    socket.on('websocket-status', (status) => {
        websocketConnected = status.connected;
        io.emit('trading-status', { 
            active: websocketConnected && !CIRCUIT_BREAKER.tripped,
            circuitBreaker: CIRCUIT_BREAKER.tripped
        });
        
        if (!websocketConnected) {
            console.log('WebSocket disconnected. Trading is paused until connection is restored.');
        } else {
            console.log('WebSocket connected. Trading has resumed.');
        }
    });
    
    


    // 1. First Purchase Handler Fix
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
            
            // Check if circuit breaker is tripped
            if (CIRCUIT_BREAKER.tripped) {
                socket.emit('first-purchase-result', { 
                    success: false, 
                    error: 'Trading is currently suspended due to multiple consecutive errors. Please try again later.' 
                });
                return;
            }
            
            console.log(`First purchase request: ${JSON.stringify(data)}`);
            
            if (!data.symbol || !data.investment) {
                socket.emit('first-purchase-result', {
                    success: false,
                    error: 'Missing required parameters (symbol or investment)'
                });
                return;
            }
            
            // Validate investment amount
            const investment = parseFloat(data.investment);
            if (isNaN(investment) || investment <= 0) {
                socket.emit('first-purchase-result', {
                    success: false,
                    error: 'Invalid investment amount'
                });
                return;
            }
            
            // Get current price
            const priceData = await binanceAPI.getTickerPrice(data.symbol);
            const currentPrice = parseFloat(priceData.price);
            
            // Execute buy order
            console.log(`Executing buy order: ${investment} USDT worth of ${data.symbol} at $${currentPrice}`);
            const result = await binanceAPI.executeBuyOrder(data.symbol, investment, 'usdt');
            
            // Update circuit breaker status
            checkCircuitBreaker(result.success);
            
            if (!result.success) {
                socket.emit('first-purchase-result', {
                    success: false,
                    error: result.error || 'Failed to execute buy order'
                });
                return;
            }
            
            // Send transaction to database if connected
            if (systemStatus.database) {
                const conn = await pool.getConnection();
                try {
                    await conn.query(
                        'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                        [data.symbol, 'BUY', currentPrice, result.amount, investment]
                    );
                    
                    // Update holdings - PASS THE POOL HERE
                    await tradingEngine.updateHoldings(data.symbol, pool);
                    
                    // Update reference prices - PASS THE POOL HERE
                    await tradingEngine.updateReferencePrices(data.symbol, currentPrice, pool);
                } finally {
                    conn.release();
                }
            }
            
            // Send Telegram notification
            if (systemStatus.telegram) {
                try {
                    await telegramBot.sendTradeNotification({
                        symbol: data.symbol,
                        type: 'BUY',
                        price: currentPrice,
                        quantity: result.amount,
                        investment: investment,
                        timestamp: Date.now()
                    });
                    console.log('Telegram notification sent for first purchase');
                } catch (telegramError) {
                    console.error('Error sending Telegram notification:', telegramError);
                }
            }
            
            // Send transaction update to clients
            const transactions = await getTransactions(data.symbol);
            io.emit('transaction-update', {
                symbol: data.symbol.replace('USDT', ''),
                transactions: transactions,
                refPrices: await tradingEngine.getReferencePrices(data.symbol, pool)  // PASS THE POOL HERE
            });
            
            // Send holdings update to clients
            const holdings = await getHoldings(data.symbol);
            const refPrices = await tradingEngine.getReferencePrices(data.symbol, pool);  // PASS THE POOL HERE
            
            io.emit('holdings-update', {
                symbol: data.symbol.replace('USDT', ''),
                amount: holdings.quantity,
                avgPrice: holdings.avg_price,
                initialPrice: refPrices.initial_purchase_price,
                lastBuyPrice: refPrices.last_purchase_price,
                nextBuyThreshold: refPrices.next_buy_threshold,
                nextSellThreshold: refPrices.next_sell_threshold,
                profitLossPercent: ((currentPrice - holdings.avg_price) / holdings.avg_price) * 100
            });
            
            socket.emit('first-purchase-result', { success: true });
        } catch (err) {
            console.error('First purchase error:', err);
            socket.emit('first-purchase-result', { success: false, error: err.message });
            
            // Update circuit breaker
            checkCircuitBreaker(false);
        }
    });

    // 2. Sell All Handler Fix
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

            // Check if circuit breaker is tripped
            if (CIRCUIT_BREAKER.tripped) {
                socket.emit('sell-all-result', {
                    success: false,
                    error: 'Trading is currently suspended due to multiple consecutive errors. Please try again later.'
                });
                return;
            }

            console.log(`Sell all request: ${JSON.stringify(data)}`);

            if (!data.symbol) {
                socket.emit('sell-all-result', {
                    success: false,
                    error: 'Missing required parameter (symbol)'
                });
                return;
            }

            // Get current holdings - PASS THE POOL HERE
            const holdings = await tradingEngine.getHoldings(data.symbol, pool);
            console.log(`Current holdings for ${data.symbol}:`, holdings);

            if (!holdings || parseFloat(holdings.quantity) <= 0) {
                socket.emit('sell-all-result', {
                    success: false,
                    error: 'No holdings to sell'
                });
                return;
            }

            // Get current price
            const priceData = await binanceAPI.getTickerPrice(data.symbol);
            const currentPrice = parseFloat(priceData.price);

            // Calculate total value
            const totalValue = holdings.quantity * currentPrice;

            // Execute sell order using executeSellOrder instead of createMarketSellOrder directly
            console.log(`Executing sell order: ${holdings.quantity} ${data.symbol} at ${currentPrice.toFixed(4)}`);
            const result = await binanceAPI.executeSellOrder(data.symbol, holdings.quantity, 'amount');

            // Check if the sell operation was successful
            if (!result || !result.success) {
                socket.emit('sell-all-result', {
                    success: false,
                    error: result?.error || 'Failed to execute sell order'
                });
                
                // Update circuit breaker status
                checkCircuitBreaker(false);
                return;
            }

            // Update circuit breaker status
            checkCircuitBreaker(true);

            // Store transaction in database if connected
            if (systemStatus.database) {
                const conn = await pool.getConnection();
                try {
                    await conn.query(
                        'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                        [data.symbol, 'SELL', currentPrice, holdings.quantity, totalValue]
                    );

                    // Update holdings - PASS THE POOL HERE
                    await tradingEngine.updateHoldings(data.symbol, pool);
                    
                    // Update reference prices - PASS THE POOL HERE
                    await tradingEngine.updateReferencePrices(data.symbol, currentPrice, pool);
                } finally {
                    conn.release();
                }
            }

            // Send Telegram notification
            if (systemStatus.telegram) {
                try {
                    await telegramBot.sendTradeNotification({
                        symbol: data.symbol,
                        type: 'SELL',
                        price: currentPrice,
                        quantity: holdings.quantity,
                        investment: totalValue,
                        timestamp: Date.now()
                    });
                    console.log('Telegram notification sent for sell all');
                } catch (telegramError) {
                    console.error('Error sending Telegram notification:', telegramError);
                }
            }

            // Send transaction update to clients
            const transactions = await getTransactions(data.symbol);
            io.emit('transaction-update', {
                symbol: data.symbol.replace('USDT', ''),
                transactions: transactions,
                refPrices: await tradingEngine.getReferencePrices(data.symbol, pool)  // PASS THE POOL HERE
            });

            // Send holdings update to clients
            const refPrices = await tradingEngine.getReferencePrices(data.symbol, pool);  // PASS THE POOL HERE
            io.emit('holdings-update', {
                symbol: data.symbol.replace('USDT', ''),
                amount: 0,
                avgPrice: 0,
                initialPrice: refPrices.initial_purchase_price,
                lastBuyPrice: refPrices.last_purchase_price,
                nextBuyThreshold: refPrices.next_buy_threshold,
                nextSellThreshold: refPrices.next_sell_threshold,
                profitLossPercent: 0
            });

            socket.emit('sell-all-result', { success: true });
        } catch (err) {
            console.error('Sell all error:', err);
            socket.emit('sell-all-result', { success: false, error: err.message });

            // Update circuit breaker
            checkCircuitBreaker(false);
        }
    });

    // 3. Buy Order Handler Fix
    socket.on('buy-order', async (data) => {
        try {
            console.log('Buy order received:', data);
            
            // Check if circuit breaker is tripped
            if (CIRCUIT_BREAKER.tripped) {
                socket.emit('buy-result', { 
                    success: false, 
                    error: 'Trading is currently suspended due to multiple consecutive errors. Please try again later.' 
                });
                return;
            }
            
            // Validate parameters
            const validation = validateTradeParams(data);
            if (!validation.valid) {
                socket.emit('buy-result', { 
                    success: false, 
                    error: validation.error
                });
                return;
            }
            
            // Execute the buy order
            const result = await binanceAPI.executeBuyOrder(
                validation.params.symbol, 
                validation.params.amount, 
                validation.params.amountType
            );
            
            // Update circuit breaker status
            checkCircuitBreaker(result.success);
            
            // Emit the result
            socket.emit('buy-result', result);
            
            // Also broadcast price update if we got a price
            if (result.success && result.price) {
                io.emit('price-update', {
                    symbol: data.symbol,
                    price: result.price,
                    source: 'order'
                });
                
                // Send Telegram notification for successful order
                if (systemStatus.telegram) {
                    try {
                        await telegramBot.sendTradeNotification({
                            symbol: data.symbol,
                            type: 'BUY',
                            price: result.price,
                            quantity: result.amount,
                            investment: validation.params.amount,
                            timestamp: Date.now()
                        });
                        console.log('Telegram notification sent for buy order');
                    } catch (telegramError) {
                        console.error('Error sending Telegram notification:', telegramError);
                    }
                }
                
                // Store transaction in database if connection is available
                if (systemStatus.database) {
                    try {
                        const conn = await pool.getConnection();
                        await conn.query(
                            'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                            [data.symbol, 'BUY', result.price, result.amount, validation.params.amount]
                        );
                        
                        // Update holdings - PASS THE POOL HERE
                        await tradingEngine.updateHoldings(data.symbol, pool);
                        
                        // Update reference prices - PASS THE POOL HERE
                        await tradingEngine.updateReferencePrices(data.symbol, result.price, pool);
                        
                        conn.release();
                        
                        // Send transaction update to clients
                        const transactions = await getTransactions(data.symbol);
                        io.emit('transaction-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            transactions: transactions,
                            refPrices: await tradingEngine.getReferencePrices(data.symbol, pool) // PASS THE POOL HERE
                        });
                        
                        // Send holdings update to clients
                        const holdings = await getHoldings(data.symbol);
                        const refPrices = await tradingEngine.getReferencePrices(data.symbol, pool); // PASS THE POOL HERE
                        
                        io.emit('holdings-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            amount: holdings.quantity,
                            avgPrice: holdings.avg_price,
                            initialPrice: refPrices.initial_purchase_price,
                            lastBuyPrice: refPrices.last_purchase_price,
                            nextBuyThreshold: refPrices.next_buy_threshold,
                            nextSellThreshold: refPrices.next_sell_threshold,
                            profitLossPercent: ((result.price - holdings.avg_price) / holdings.avg_price) * 100
                        });
                    } catch (dbError) {
                        console.error('Error storing transaction in database:', dbError);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing buy order:', error);
            socket.emit('buy-result', { 
                success: false, 
                error: error.message 
            });
            
            // Update circuit breaker
            checkCircuitBreaker(false);
        }
    });

    // 4. Sell Order Handler Fix
    socket.on('sell-order', async (data) => {
        try {
            console.log('Sell order received:', data);
            
            // Check if circuit breaker is tripped
            if (CIRCUIT_BREAKER.tripped) {
                socket.emit('sell-result', { 
                    success: false, 
                    error: 'Trading is currently suspended due to multiple consecutive errors. Please try again later.' 
                });
                return;
            }
            
            // Validate parameters
            const validation = validateTradeParams(data);
            if (!validation.valid) {
                socket.emit('sell-result', { 
                    success: false, 
                    error: validation.error
                });
                return;
            }
            
            // Execute the sell order
            const result = await binanceAPI.executeSellOrder(
                validation.params.symbol, 
                validation.params.amount, 
                validation.params.amountType
            );
            
            // Update circuit breaker status
            checkCircuitBreaker(result.success);
            
            // Emit the result
            socket.emit('sell-result', result);
            
            // Also broadcast price update if we got a price
            if (result.success && result.price) {
                io.emit('price-update', {
                    symbol: data.symbol,
                    price: result.price,
                    source: 'order'
                });
                
                // Send Telegram notification for successful order
                if (systemStatus.telegram) {
                    try {
                        await telegramBot.sendTradeNotification({
                            symbol: data.symbol,
                            type: 'SELL',
                            price: result.price,
                            quantity: result.amount,
                            investment: validation.params.amount * result.price, // Approximate value of the sale
                            timestamp: Date.now()
                        });
                        console.log('Telegram notification sent for sell order');
                    } catch (telegramError) {
                        console.error('Error sending Telegram notification:', telegramError);
                    }
                }
                
                // Store transaction in database if connection is available
                if (systemStatus.database) {
                    try {
                        const conn = await pool.getConnection();
                        await conn.query(
                            'INSERT INTO transactions (symbol, type, price, quantity, investment) VALUES (?, ?, ?, ?, ?)',
                            [data.symbol, 'SELL', result.price, result.amount, validation.params.amount * result.price]
                        );
                        
                        // Update holdings - PASS THE POOL HERE
                        await tradingEngine.updateHoldings(data.symbol, pool);
                        
                        // Update reference prices - PASS THE POOL HERE
                        await tradingEngine.updateReferencePrices(data.symbol, result.price, pool);
                        
                        conn.release();
                        
                        // Send transaction update to clients
                        const transactions = await getTransactions(data.symbol);
                        io.emit('transaction-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            transactions: transactions,
                            refPrices: await tradingEngine.getReferencePrices(data.symbol, pool) // PASS THE POOL HERE
                        });
                        
                        // Send holdings update to clients
                        const holdings = await getHoldings(data.symbol);
                        const refPrices = await tradingEngine.getReferencePrices(data.symbol, pool); // PASS THE POOL HERE
                        
                        io.emit('holdings-update', {
                            symbol: data.symbol.replace('USDT', ''),
                            amount: holdings.quantity,
                            avgPrice: holdings.avg_price,
                            initialPrice: refPrices.initial_purchase_price,
                            lastBuyPrice: refPrices.last_purchase_price,
                            nextBuyThreshold: refPrices.next_buy_threshold,
                            nextSellThreshold: refPrices.next_sell_threshold,
                            profitLossPercent: holdings.quantity > 0 ? ((result.price - holdings.avg_price) / holdings.avg_price) * 100 : 0
                        });
                    } catch (dbError) {
                        console.error('Error storing transaction in database:', dbError);
                    }
                }
            }
        } catch (error) {
            console.error('Error processing sell order:', error);
            socket.emit('sell-result', { 
                success: false, 
                error: error.message 
            });
            
            // Update circuit breaker
            checkCircuitBreaker(false);
        }
    });

    // 5. Price Update Handler Fix - if you use trading engine functions here
    socket.on('price-update', async (data) => {
        if (!data.symbol || !data.price) {
            return;
        }
        
        try {
            const symbol = data.symbol;
            const price = parseFloat(data.price);
            
            // Process price update through trading engine (this is your existing logic)
            tradingEngine.processPriceUpdate(io, symbol, price);
            
            // We'll add optimization to avoid the frontend making separate DB calls
            // Let's send holdings and P/L data with the price update when appropriate
            
            // Only do this calculation periodically (once per minute per symbol)
            const cacheKey = `price_calc_${symbol}`;
            const now = Date.now();
            const lastCalc = priceCalculationCache[cacheKey] || 0;
            
            // If it's been at least 60 seconds since the last calculation
            if (now - lastCalc >= 60000) {
                priceCalculationCache[cacheKey] = now;
                
                // Get holdings and reference prices from the database using a single connection
                let conn;
                try {
                    conn = await pool.getConnection();
                    
                    // Get holdings
                    const holdingsRows = await conn.query(
                        'SELECT * FROM holdings WHERE symbol = ?',
                        [symbol]
                    );
                    
                    // Get reference prices
                    const refPriceRows = await conn.query(
                        'SELECT * FROM reference_prices WHERE symbol = ?',
                        [symbol]
                    );
                    
                    // Release connection as soon as we have the data
                    await conn.release();
                    conn = null;
                    
                    const holdings = holdingsRows[0] || { symbol, quantity: 0, avg_price: 0 };
                    const refPrices = refPriceRows[0] || { 
                        initial_purchase_price: 0, 
                        last_purchase_price: 0,
                        next_buy_threshold: 0,
                        next_sell_threshold: 0
                    };
                    
                    // Calculate profit/loss percentage
                    let profitLossPercent = 0;
                    if (holdings.quantity > 0 && parseFloat(holdings.avg_price) > 0) {
                        profitLossPercent = ((price - parseFloat(holdings.avg_price)) / parseFloat(holdings.avg_price)) * 100;
                    }
                    
                    // Send extra data with the price update to avoid separate DB calls
                    io.emit('holdings-update', {
                        symbol: symbol.replace('USDT', ''),
                        amount: parseFloat(holdings.quantity),
                        avgPrice: parseFloat(holdings.avg_price),
                        initialPrice: parseFloat(refPrices.initial_purchase_price),
                        lastBuyPrice: parseFloat(refPrices.last_purchase_price),
                        nextBuyThreshold: parseFloat(refPrices.next_buy_threshold),
                        nextSellThreshold: parseFloat(refPrices.next_sell_threshold),
                        profitLossPercent: profitLossPercent,
                        currentPrice: price
                    });
                } catch (error) {
                    console.error('Error getting data for price update:', error);
                } finally {
                    if (conn) {
                        try {
                            await conn.release();
                        } catch (releaseError) {
                            console.error('Error releasing connection:', releaseError);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error in price-update handler:', error);
        }
    });





// Connection pool monitoring function
function monitorConnectionPool() {
    setInterval(async () => {
        try {
            // First check if pool exists and has the necessary methods
            if (!pool) {
                console.log('Database pool status: Pool not initialized');
                return;
            }
            
            // Safely access active connections
            let activeConnections = 0;
            let totalConnections = 0;
            
            try {
                // Use optional chaining to safely call methods
                activeConnections = typeof pool.activeConnections === 'function' ? pool.activeConnections() : 0;
                totalConnections = typeof pool.totalConnections === 'function' ? pool.totalConnections() : 0;
            } catch (methodError) {
                console.error('Error getting connection counts:', methodError.message);
            }
            
            console.log(`Database pool status: Active=${activeConnections}, Total=${totalConnections}`);
            
            // Safely access connection limit
            const connectionLimit = pool.config?.connectionLimit || 20; // Default to 20 if not defined
            
            // If we're running at >80% of capacity, take action
            if (activeConnections > (connectionLimit * 0.8)) {
                console.warn(`High database connection usage: ${activeConnections}/${connectionLimit}`);
                
                // Try to recycle idle connections with a ping
                try {
                    await pool.query('SELECT 1 AS ping');
                } catch (pingError) {
                    console.error('Error pinging database:', pingError.message);
                }
                
                // If we're at or near the limit, take more drastic action
                if (activeConnections >= connectionLimit) {
                    console.error('DATABASE CONNECTION POOL EXHAUSTED - EMERGENCY MEASURES');
                    
                    // Try to force close any idle connections
                    try {
                        if (typeof pool._removeIdleConnections === 'function') {
                            pool._removeIdleConnections();
                            console.log('Removed idle connections');
                        }
                    } catch (idleError) {
                        console.error('Error removing idle connections:', idleError.message);
                    }
                    
                    // Force a garbage collection if possible
                    if (global.gc) {
                        console.log('Forcing garbage collection');
                        global.gc();
                    }
                }
            }
        } catch (error) {
            console.error('Error monitoring connection pool:', error.message);
        }
    }, 15000); // Check every 15 seconds
}

// Start connection pool monitoring
monitorConnectionPool();


// Handle graceful shutdown
process.on('SIGINT', async () => {
    console.log('Shutting down server...');
    
    // Disconnect all WebSockets
    try {
        await binanceAPI.closeAllConnections();
        console.log('All WebSocket connections closed');
    } catch (error) {
        console.error('Error closing WebSocket connections:', error);
    }
    
    // Close database pool
    try {
        await pool.end();
        console.log('Database pool closed');
    } catch (error) {
        console.error('Error closing database pool:', error);
    }
    
    // Close server
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
    
    // Force exit after 5 seconds if server doesn't close properly
    setTimeout(() => {
        console.error('Forcing server shutdown after timeout');
        process.exit(1);
    }, 5000);
});
})