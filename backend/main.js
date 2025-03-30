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

// Detailed logging mode - turn on for debugging
const DETAILED_LOGGING = true;

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

// Add a health check endpoint that returns 200
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Add a simple endpoint
app.get('/', (req, res) => {
    res.send('Crypto Trading Bot Backend is running!');
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
    transports: ['polling', 'websocket'],
    pingTimeout: 60000,
    pingInterval: 25000
});

// Debug middleware for Socket.IO connections
io.use((socket, next) => {
    console.log('New Socket.IO connection attempt:', socket.id);
    next();
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

// Helper function for detailed logging
function detailedLog(...args) {
    if (DETAILED_LOGGING) {
        console.log('[DETAILED]', ...args);
    }
}

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

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log('Client connected with ID:', socket.id);
    
    // Send current system status to newly connected client
    socket.emit('database-status', systemStatus.database);
    socket.emit('binance-status', systemStatus.binance);
    socket.emit('telegram-status', systemStatus.telegram);
    socket.emit('trading-status', { 
        active: websocketConnected && !CIRCUIT_BREAKER.tripped,
        circuitBreaker: CIRCUIT_BREAKER.tripped
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
    
    // Handle manual price updates
    socket.on('manual-price-update', (data) => {
        console.log('Manual price update received:', data);
        
        if (!data || !data.symbol || !data.price) {
            console.error('Invalid manual price update data:', data);
            return;
        }
        
        // Broadcast the manual price update to all clients
        io.emit('price-update', {
            symbol: data.symbol,
            price: data.price,
            source: 'manual'
        });
        
        console.log(`Manual price update for ${data.symbol} to ${data.price} broadcast to all clients`);
    });
    
    // Handle Telegram test
    socket.on('test-telegram', async () => {
        try {
            await telegramBot.sendMessage('Test message from Crypto Trading Bot');
            socket.emit('telegram-test-result', { success: true });
        } catch (err) {
            console.error('Telegram test error:', err);
            socket.emit('telegram-test-result', { 
                success: false, 
                error: err.message 
            });
        }
    });
    
    // Handle manual Binance API test
    socket.on('manual-binance-test', async (data) => {
        try {
            console.log('Received manual-binance-test request with data:', data);
            
            if (!data || !data.symbols || !Array.isArray(data.symbols)) {
                socket.emit('manual-test-result', {
                    success: false,
                    error: 'Invalid request: missing symbols array'
                });
                return;
            }
            
            // Use the manual connect function
            const result = await binanceAPI.manualConnectAndGetPrices(data.symbols);
            
            // Send back the result
            socket.emit('binance-test-result', result);
            
            // If successful, also broadcast the prices as price updates
            if (result.success && result.prices) {
                Object.entries(result.prices).forEach(([symbol, price]) => {
                    io.emit('price-update', {
                        symbol: symbol,
                        price: price,
                        source: 'manual-test'
                    });
                });
            }
        } catch (err) {
            console.error('Error in manual Binance test:', err);
            socket.emit('binance-test-result', {
                success: false,
                error: err.message
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
                        await conn.query(
                            'INSERT INTO holdings (symbol, quantity, avg_price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?, avg_price = ((avg_price * quantity) + (? * ?)) / (quantity + ?)',
                            [data.symbol, result.amount, result.price, result.amount, result.price, result.amount, result.amount]
                        );
                        
                        conn.release();
                        
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
                        await conn.query(
                            'UPDATE holdings SET quantity = GREATEST(0, quantity - ?), avg_price = CASE WHEN quantity <= ? THEN 0 ELSE avg_price END WHERE symbol = ?',
                            [result.amount, result.amount, data.symbol]
                        );
                        
                        conn.release();
                        
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
            
            // First, test connection to Binance API
            const apiConnected = await binanceAPI.testConnection();
            if (!apiConnected) {
                socket.emit('binance-test-result', { 
                    success: false, 
                    error: 'Cannot connect to Binance API' 
                });
                return;
            }
            
            // Get current prices to verify API is working
            try {
                const symbols = ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'NEARUSDT', 'PENDLEUSDT'];
                
                // Get prices for all symbols
                const prices = {};
                for (const symbol of symbols) {
                    const tickerData = await binanceAPI.getTickerPrice(symbol);
                    prices[symbol] = tickerData.price;
                    
                    // Emit price updates immediately
                    io.emit('price-update', {
                        symbol: symbol,
                        price: tickerData.price,
                        source: 'api'
                    });
                }
                
                // Initialize or restart WebSocket connections
                const wsConnection = binanceAPI.subscribeToTickerStream(symbols, io);
                
                socket.emit('binance-test-result', { 
                    success: true,
                    prices,
                    message: 'WebSocket connection initiated. You should see price updates soon.'
                });
                
                // Update WebSocket connected status
                websocketConnected = true;
                io.emit('trading-status', { 
                    active: websocketConnected && !CIRCUIT_BREAKER.tripped,
                    circuitBreaker: CIRCUIT_BREAKER.tripped
                });
                console.log('Trading status updated:', { 
                    active: websocketConnected && !CIRCUIT_BREAKER.tripped,
                    circuitBreaker: CIRCUIT_BREAKER.tripped
                });
                
            } catch (err) {
                console.error('Error in test-binance-stream:', err);
                socket.emit('binance-test-result', { 
                    success: false, 
                    error: err.message 
                });
            }
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
            
            // Calculate quantity based on investment amount
            const quantity = investment / currentPrice;
            
            // Execute buy order
            console.log(`Executing buy order: ${quantity} ${data.symbol} at $${currentPrice}`);
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
                        [data.symbol, 'BUY', currentPrice, quantity, investment]
                    );
                    
                    // Update holdings
                    await conn.query(
                        'INSERT INTO holdings (symbol, quantity, avg_price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = quantity + ?, avg_price = ((avg_price * quantity) + (? * ?)) / (quantity + ?)',
                        [data.symbol, quantity, currentPrice, quantity, currentPrice, quantity, quantity]
                    );
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
                        quantity: quantity,
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
                transactions: transactions
            });
            
            // Send holdings update to clients
            const holdings = await getHoldings(data.symbol);
            io.emit('holdings-update', {
                symbol: data.symbol.replace('USDT', ''),
                amount: holdings.quantity,
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

            // Get current holdings
            const holdings = await getHoldings(data.symbol);
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

            // Execute sell order
            console.log(`Executing sell order: ${holdings.quantity} ${data.symbol} at $${currentPrice}`);
            const result = await binanceAPI.createMarketSellOrder(data.symbol, holdings.quantity);

            if (!result) {
                socket.emit('sell-all-result', {
                    success: false,
                    error: 'Failed to execute sell order'
                });
                return;
            }

            // Update circuit breaker status
            checkCircuitBreaker(result !== null);

            // Store transaction in database if connected
            if (systemStatus.database) {
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

            // Update circuit breaker
            checkCircuitBreaker(false);
        }
    })
});

// Start the server
const PORT = process.env.PORT;
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
    })();
});

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