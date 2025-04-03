// trading-engine.js - Trading Engine Module for Backend
// Responsible for backend trading operations, WebSocket connections, and data management

// Use CommonJS imports for Node.js environment
const { Server } = require('socket.io');
const socketClient = require('socket.io-client');

// Configuration for request throttling
const THROTTLE_CONFIG = {
    // Minimum time between repeated requests (milliseconds)
    MIN_INTERVAL: {
        transactions: 5000,   // 5 seconds between requests for the same symbol
        status: 15000,        // 15 seconds between system status checks
        account: 30000        // 30 seconds between account info requests
    },
    // Track when requests were last made for each type/symbol
    lastRequests: {
        transactions: {},     // Key: symbol, Value: timestamp
        status: 0,            // Timestamp of last status request
        account: 0            // Timestamp of last account info request
    },
    // Set this to control max requests per minute
    MAX_REQUESTS_PER_MINUTE: 20,
    // Track requests made in current minute window
    requestsInLastMinute: 0,
    // Start time of current minute window
    currentMinuteStart: Date.now()
};

// Reset request counter every minute
setInterval(() => {
    THROTTLE_CONFIG.requestsInLastMinute = 0;
    THROTTLE_CONFIG.currentMinuteStart = Date.now();
}, 60000);

// State tracking
let io;
let socket;
let initialized = false;

// Event callbacks registry - this allows dashboard.js to register callbacks
const eventCallbacks = {
    // Connection events
    'connect': [],
    'disconnect': [],
    'connect_error': [],
    
    // Status events
    'database-status': [],
    'binance-status': [],
    'telegram-status': [],
    'trading-status': [],
    'websocket-status': [],
    
    // Data events
    'price-update': [],
    'transaction-update': [],
    'holdings-update': [],
    'account-info': [],
    'batch-data-update': [],
    
    // Order result events
    'buy-result': [],
    'sell-result': [],
    'first-purchase-result': [],
    'sell-all-result': []
};

// System status tracking
const systemStatus = {
    backend: false,
    database: false,
    binance: false,
    telegram: false,
    websocket: false,
    lastBackendResponse: Date.now(),
    reconnectAttempts: 0,
    lastPriceUpdates: {
        btc: 0,
        sol: 0,
        xrp: 0,
        doge: 0,
        near: 0,
        pendle: 0
    }
};

// Interval references for monitoring
let connectionMonitorInterval = null;
let priceMonitorInterval = null;
let reconnectTimeout = null;

/**
 * Initialize the trading engine with dependencies
 * @param {Object} dbPool - Database connection pool
 * @param {Object} binanceAPI - Binance API module
 * @param {Object} telegramBot - Telegram bot module
 * @param {Object} socketIo - Socket.io instance
 */
function initialize(dbPool, binanceAPI, telegramBot, socketIo) {
    if (initialized) {
        console.log('Trading engine already initialized');
        return;
    }
    
    io = socketIo;
    console.log('Trading engine initialized');
    initialized = true;
    
    // Initialize monitoring
    initializeMonitoring();
    
    // Set up socket.io event listeners if available
    if (io) {
        console.log('Setting up socket.io event listeners in trading engine');
        setupSocketListeners(dbPool, binanceAPI, telegramBot);
    } else {
        console.warn('Socket.io not provided, trading engine will run without real-time updates');
    }
}

// Initialize monitoring of connections and price updates
function initializeMonitoring() {
    // Clear any existing intervals first
    if (connectionMonitorInterval) clearInterval(connectionMonitorInterval);
    if (priceMonitorInterval) clearInterval(priceMonitorInterval);
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    
    // Monitor backend connection health every 10 seconds
    connectionMonitorInterval = setInterval(() => {
        // Check for system health
        // This is just a stub - implement actual health checks as needed
        console.log('Trading engine health check: OK');
    }, 15000);
    
    // Monitor price updates every 10 seconds
    priceMonitorInterval = setInterval(() => {
        const now = Date.now();
        let anyRecentPriceUpdates = false;
        
        // Check if any cryptocurrency has received a price update in the last 20 seconds
        Object.values(systemStatus.lastPriceUpdates).forEach(timestamp => {
            if (timestamp > 0 && now - timestamp < 20000) {
                anyRecentPriceUpdates = true;
            }
        });
        
        // Update the websocket status based on recent price updates
        if (systemStatus.websocket !== anyRecentPriceUpdates) {
            systemStatus.websocket = anyRecentPriceUpdates;
            
            // Log the status change
            console.log(`WebSocket price flow status changed: ${anyRecentPriceUpdates ? 'ACTIVE' : 'INACTIVE'}`);
            
            // Notify clients if io is available
            if (io) {
                io.emit('websocket-status', { connected: anyRecentPriceUpdates });
            }
        }
    }, 10000);
}

// Set up Socket.io event listeners
function setupSocketListeners(dbPool, binanceAPI, telegramBot) {
    io.on('connection', (socket) => {
        console.log('New client connected to trading engine:', socket.id);
        
        // Handle ping request for connection testing
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
            console.log(`Client ${socket.id} disconnected from trading engine. Reason: ${reason}`);
        });
        
        // Price update handling
        socket.on('price-update', async (data) => {
            try {
                await processPriceUpdate(io, data.symbol, parseFloat(data.price));
            } catch (error) {
                console.error('Error processing price update:', error);
            }
        });
        
        // First purchase handler
        socket.on('first-purchase', async (data) => {
            try {
                const result = await executeFirstPurchase(data, binanceAPI, dbPool, telegramBot);
                socket.emit('first-purchase-result', result);
            } catch (error) {
                console.error('Error executing first purchase:', error);
                socket.emit('first-purchase-result', { 
                    success: false, 
                    error: error.message
                });
            }
        });
        
        // Sell all handler
        socket.on('sell-all', async (data) => {
            try {
                const result = await executeSellAll(data, binanceAPI, dbPool, telegramBot);
                socket.emit('sell-all-result', result);
            } catch (error) {
                console.error('Error executing sell all:', error);
                socket.emit('sell-all-result', { 
                    success: false, 
                    error: error.message
                });
            }
        });
        
        // Get transactions handler
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
                
                // Get transactions for the symbol from database
                const transactions = await getTransactions(data.symbol, dbPool);
                
                // Get reference prices
                const refPrices = await getReferencePrices(data.symbol, dbPool);
                
                // Send transaction history to client
                socket.emit('transaction-update', {
                    symbol: data.symbol.replace('USDT', ''),
                    transactions: transactions,
                    success: true,
                    refPrices: refPrices
                });
                
                // Also send holdings
                const holdings = await getHoldings(data.symbol, dbPool);
                
                // Get current price to calculate profit/loss
                const priceData = await binanceAPI.getTickerPrice(data.symbol);
                const currentPrice = parseFloat(priceData.price);
                
                // Calculate profit/loss percentage if we have holdings and price
                let profitLossPercent = 0;
                if (holdings.quantity > 0 && holdings.avg_price > 0 && currentPrice > 0) {
                    profitLossPercent = calculateProfitLoss(holdings.avg_price, currentPrice);
                }
                
                socket.emit('holdings-update', {
                    symbol: data.symbol.replace('USDT', ''),
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
        
        // Add other event handlers as needed
        // ...
    });
}

// Process price update and execute trades if thresholds are met
async function processPriceUpdate(io, symbol, price) {
    console.log(`Processing price update for ${symbol}: $${price}`);
    
    // Here you would implement logic to:
    // 1. Check if price meets buy/sell thresholds
    // 2. Execute automated trades if configured
    // 3. Update clients with new price and threshold info
    
    if (io) {
        io.emit('price-update', {
            symbol,
            price,
            source: 'engine'
        });
    }
    
    // Track the price update time
    const baseSymbol = symbol.replace('USDT', '').toLowerCase();
    if (systemStatus.lastPriceUpdates.hasOwnProperty(baseSymbol)) {
        systemStatus.lastPriceUpdates[baseSymbol] = Date.now();
    }
    
    return true;
}

// Execute a first purchase
async function executeFirstPurchase(data, binanceAPI, dbPool, telegramBot) {
    if (!data.symbol || !data.investment) {
        return {
            success: false,
            error: 'Missing required parameters (symbol or investment)'
        };
    }
    
    // Validate investment amount
    const investment = parseFloat(data.investment);
    if (isNaN(investment) || investment <= 0) {
        return {
            success: false,
            error: 'Invalid investment amount'
        };
    }
    
    try {
        // Get current price
        const priceData = await binanceAPI.getTickerPrice(data.symbol);
        const currentPrice = parseFloat(priceData.price);
        
        // Execute buy order
        console.log(`Executing buy order for ${data.symbol} with investment $${investment}`);
        const result = await binanceAPI.executeBuyOrder(data.symbol, investment, 'usdt');
        
        if (!result.success) {
            return {
                success: false,
                error: result.error || 'Failed to execute buy order'
            };
        }
        
        // Store transaction in database
        await storeTransaction(dbPool, {
            symbol: data.symbol,
            type: 'BUY',
            price: currentPrice,
            quantity: result.amount,
            investment: investment,
            automated: false
        });
        
        // Update holdings
        await updateHoldings(data.symbol, dbPool);
        
        // Update reference prices
        await updateReferencePrices(data.symbol, currentPrice, dbPool);
        
        // Send Telegram notification if configured
        if (telegramBot) {
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
        
        return { success: true };
    } catch (err) {
        console.error('First purchase error:', err);
        return { success: false, error: err.message };
    }
}

// Execute sell all holdings
async function executeSellAll(data, binanceAPI, dbPool, telegramBot) {
    if (!data.symbol) {
        return {
            success: false,
            error: 'Missing required parameter (symbol)'
        };
    }
    
    try {
        // Get current holdings
        const holdings = await getHoldings(data.symbol, dbPool);
        console.log(`Current holdings for ${data.symbol}:`, holdings);
        
        if (!holdings || parseFloat(holdings.quantity) <= 0) {
            return {
                success: false,
                error: 'No holdings to sell'
            };
        }
        
        // Get current price
        const priceData = await binanceAPI.getTickerPrice(data.symbol);
        const currentPrice = parseFloat(priceData.price);
        
        // Calculate total value
        const totalValue = holdings.quantity * currentPrice;
        
        // Execute sell order
        console.log(`Executing sell order: ${holdings.quantity} ${data.symbol} at ${currentPrice.toFixed(4)}`);
        const result = await binanceAPI.executeSellOrder(data.symbol, holdings.quantity, 'amount');
        
        // Check if the sell operation was successful
        if (!result || !result.success) {
            return {
                success: false,
                error: result?.error || 'Failed to execute sell order'
            };
        }
        
        // Store transaction in database
        await storeTransaction(dbPool, {
            symbol: data.symbol,
            type: 'SELL',
            price: currentPrice,
            quantity: holdings.quantity,
            investment: totalValue,
            automated: false
        });
        
        // Update holdings
        await updateHoldings(data.symbol, dbPool);
        
        // Update reference prices
        await updateReferencePrices(data.symbol, currentPrice, dbPool);
        
        // Send Telegram notification
        if (telegramBot) {
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
        
        return { success: true };
    } catch (err) {
        console.error('Sell all error:', err);
        return { success: false, error: err.message };
    }
}

// Get transactions for a symbol
async function getTransactions(symbol, dbPool) {
    let conn;
    try {
        conn = await dbPool.getConnection();
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

// Get holdings for a symbol
async function getHoldings(symbol, dbPool) {
    let conn;
    try {
        conn = await dbPool.getConnection();
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
        if (conn && conn.isValid && typeof conn.isValid === 'function' && conn.isValid()) {
            try {
                await conn.release();
            } catch (releaseError) {
                // Already released, ignore
            }
        }
    }
}

// Get reference prices for a symbol
async function getReferencePrices(symbol, dbPool) {
    let conn;
    try {
        conn = await dbPool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM reference_prices WHERE symbol = ?',
            [symbol]
        );
        
        await conn.release();
        
        // Default values if no record exists
        return rows[0] || {
            symbol,
            initial_purchase_price: 0,
            last_purchase_price: 0,
            next_buy_threshold: 0,
            next_sell_threshold: 0
        };
    } catch (err) {
        console.error('Error getting reference prices:', err);
        return {
            symbol,
            initial_purchase_price: 0,
            last_purchase_price: 0,
            next_buy_threshold: 0,
            next_sell_threshold: 0
        };
    } finally {
        if (conn && conn.isValid && typeof conn.isValid === 'function' && conn.isValid()) {
            try {
                await conn.release();
            } catch (releaseError) {
                // Already released, ignore
            }
        }
    }
}

// Store a transaction in the database
async function storeTransaction(dbPool, transaction) {
    let conn;
    try {
        conn = await dbPool.getConnection();
        await conn.query(
            'INSERT INTO transactions (symbol, type, price, quantity, investment, automated) VALUES (?, ?, ?, ?, ?, ?)',
            [
                transaction.symbol,
                transaction.type,
                transaction.price,
                transaction.quantity,
                transaction.investment,
                transaction.automated || false
            ]
        );
        console.log(`Stored ${transaction.type} transaction for ${transaction.symbol}`);
        return true;
    } catch (err) {
        console.error('Error storing transaction:', err);
        throw err;
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

// Update holdings for a symbol based on all transactions
async function updateHoldings(symbol, dbPool) {
    let conn;
    try {
        conn = await dbPool.getConnection();
        
        // Get all transactions for the symbol
        const transactions = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp ASC',
            [symbol]
        );
        
        // Calculate holdings
        let quantity = 0;
        let totalInvestment = 0;
        let avgPrice = 0;
        
        for (const tx of transactions) {
            if (tx.type === 'BUY') {
                // For buys, update the average price
                const oldValue = quantity * avgPrice;
                const newValue = parseFloat(tx.quantity) * parseFloat(tx.price);
                quantity += parseFloat(tx.quantity);
                totalInvestment += parseFloat(tx.investment);
                
                if (quantity > 0) {
                    avgPrice = (oldValue + newValue) / quantity;
                }
            } else if (tx.type === 'SELL') {
                // For sells, reduce the quantity
                quantity -= parseFloat(tx.quantity);
                // If no holdings left, reset average price
                if (quantity <= 0) {
                    quantity = 0;
                    avgPrice = 0;
                    totalInvestment = 0;
                }
            }
        }
        
        // Update or insert holdings record
        await conn.query(
            `INSERT INTO holdings (symbol, quantity, avg_price) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             quantity = VALUES(quantity), 
             avg_price = VALUES(avg_price)`,
            [symbol, quantity, avgPrice]
        );
        
        console.log(`Updated holdings for ${symbol}: ${quantity} at avg price ${avgPrice}`);
        return { symbol, quantity, avg_price: avgPrice };
    } catch (err) {
        console.error('Error updating holdings:', err);
        throw err;
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

// Update reference prices for a symbol
async function updateReferencePrices(symbol, currentPrice, dbPool) {
    let conn;
    try {
        conn = await dbPool.getConnection();
        
        // Get existing reference prices
        const existingPrices = await getReferencePrices(symbol, dbPool);
        
        // Get configuration for this symbol
        const configRows = await conn.query(
            'SELECT * FROM configuration WHERE symbol = ?',
            [symbol]
        );
        
        // Default thresholds if no config exists
        const buyThresholdPercent = configRows[0]?.buy_threshold_percent || 5;
        const sellThresholdPercent = configRows[0]?.sell_threshold_percent || 5;
        
        // Calculate new reference prices
        const initialPrice = existingPrices.initial_purchase_price > 0 
            ? existingPrices.initial_purchase_price 
            : currentPrice;
        
        const nextBuyPrice = currentPrice * (1 - buyThresholdPercent / 100);
        const nextSellPrice = currentPrice * (1 + sellThresholdPercent / 100);
        
        // Update or insert reference prices
        await conn.query(
            `INSERT INTO reference_prices 
             (symbol, initial_purchase_price, last_purchase_price, next_buy_threshold, next_sell_threshold) 
             VALUES (?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE 
             initial_purchase_price = CASE WHEN initial_purchase_price = 0 THEN ? ELSE initial_purchase_price END,
             last_purchase_price = ?,
             next_buy_threshold = ?,
             next_sell_threshold = ?`,
            [
                symbol, initialPrice, currentPrice, nextBuyPrice, nextSellPrice,
                initialPrice, currentPrice, nextBuyPrice, nextSellPrice
            ]
        );
        
        console.log(`Updated reference prices for ${symbol}: Initial=${initialPrice}, Last=${currentPrice}, NextBuy=${nextBuyPrice}, NextSell=${nextSellPrice}`);
        
        return {
            symbol,
            initial_purchase_price: initialPrice,
            last_purchase_price: currentPrice,
            next_buy_threshold: nextBuyPrice,
            next_sell_threshold: nextSellPrice
        };
    } catch (err) {
        console.error('Error updating reference prices:', err);
        throw err;
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

// Calculate profit/loss percentage
function calculateProfitLoss(purchasePrice, currentPrice) {
    if (!purchasePrice || purchasePrice <= 0) {
        return 0;
    }
    
    return ((currentPrice - purchasePrice) / purchasePrice) * 100;
}

// Register event handler
function on(event, callback) {
    if (eventCallbacks[event]) {
        eventCallbacks[event].push(callback);
    } else {
        console.warn(`Unknown event: ${event}`);
    }
}

// Remove event handler
function off(event, callback) {
    if (eventCallbacks[event]) {
        const index = eventCallbacks[event].indexOf(callback);
        if (index !== -1) {
            eventCallbacks[event].splice(index, 1);
        }
    }
}

// Export using CommonJS module.exports
module.exports = {
    initialize,
    on,
    off,
    requestSystemStatus: function() {
        console.log('System status requested');
        return systemStatus;
    },
    requestTransactions: function(symbol) {
        console.log(`Transactions requested for ${symbol}`);
        // Implementation would depend on your database setup
    },
    requestAccountInfo: function() {
        console.log('Account info requested');
        // Implementation would depend on your Binance API integration
    },
    executeBuyOrder: function(symbol, amount) {
        console.log(`Buy order requested for ${symbol}: ${amount}`);
        // Implementation would depend on your Binance API integration
    },
    executeSellOrder: function(symbol) {
        console.log(`Sell order requested for ${symbol}`);
        // Implementation would depend on your Binance API integration
    },
    testBinanceStream: function() {
        console.log('Binance stream test requested');
        // Implementation would depend on your Binance API integration
    },
    getSystemStatus: function() {
        return { ...systemStatus };
    },
    processPriceUpdate,
    getReferencePrices,
    getHoldings,
    updateHoldings,
    updateReferencePrices,
    calculateProfitLoss
};