// backend/js/tradings.js
// Trading Logic Module
// Handles trading decisions, execution and bridges between Binance API and database

// Import required modules (CommonJS syntax)
const binanceAPI = require('./binance.js');
const dbconns = require('./dbconns.js');
const telegramAPI = require('./telegram.js');

// Configuration for trading rules
const TRADING_CONFIG = {
    // Default thresholds
    DEFAULT_BUY_THRESHOLD_PERCENT: 5,
    DEFAULT_SELL_THRESHOLD_PERCENT: 5,
    ADDITIONAL_PURCHASE_AMOUNT: 50,
    
    // Price monitoring settings
    PRICE_CHECK_INTERVAL_MS: 10000, // 10 seconds
    
    // Circuit breaker settings
    CIRCUIT_BREAKER: {
        MAX_ERROR_COUNT: 3,           // Max errors before breaking circuit
        RESET_TIMEOUT_MS: 60000,      // Reset after 1 minute
        ERROR_COUNT: 0,               // Current error count
        TRIPPED: false,               // Whether circuit is tripped
        LAST_ERROR_TIME: 0            // Last error timestamp
    }
};

// Trading state tracking
const tradingState = {
    isActive: false,                 // Whether trading is active globally
    symbolsEnabled: {},              // Trading status per symbol
    lastPriceCheck: {},              // Last time price was checked for each symbol
    lastTradeAttempt: {},            // Last trade attempt timestamps
    priceHistory: {},                // Recent price history for each symbol
    pendingOrders: new Set(),        // Set of pending orders to prevent duplicates
    currentPrices: {}                // Current price for each symbol
};

// Cache of trading thresholds to reduce DB access
const thresholdCache = {};

// Socket.io instance (will be set during initialization)
let io = null;

/**
 * Initialize the trading module
 * @param {Object} socketIo - Socket.io instance for emitting updates
 * @returns {boolean} Initialization success
 */
async function initialize(socketIo) {
    console.log('Initializing trading module...');
    
    try {
        // Store Socket.io instance for emitting updates
        io = socketIo;
        
        // Get global configuration
        await loadConfiguration();
        
        // Start price monitoring
        startPriceMonitoring();
        
        console.log('Trading module initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing trading module:', error);
        return false;
    }
}

/**
 * Load configuration from database for all supported symbols
 */
async function loadConfiguration() {
    try {
        const config = await dbconns.getConfiguration();
        
        // Initialize trading state for each symbol
        config.forEach(symbolConfig => {
            const symbol = symbolConfig.symbol;
            tradingState.symbolsEnabled[symbol] = symbolConfig.active;
            
            // Cache thresholds
            thresholdCache[symbol] = {
                buyThresholdPercent: symbolConfig.buy_threshold_percent,
                sellThresholdPercent: symbolConfig.sell_threshold_percent,
                additionalPurchaseAmount: symbolConfig.additional_purchase_amount,
                lastUpdated: Date.now()
            };
        });
        
        console.log('Trading configuration loaded:', 
            Object.keys(tradingState.symbolsEnabled).length, 'symbols configured');
        
        return true;
    } catch (error) {
        console.error('Error loading trading configuration:', error);
        return false;
    }
}

/**
 * Start monitoring prices for trading opportunities
 */
function startPriceMonitoring() {
    // Setup interval for checking prices against thresholds
    setInterval(async () => {
        // Skip if trading is not active globally
        if (!tradingState.isActive) return;
        
        // Iterate through all enabled symbols
        for (const [symbol, isEnabled] of Object.entries(tradingState.symbolsEnabled)) {
            // Skip if trading is disabled for this symbol
            if (!isEnabled) continue;
            
            try {
                // Check if we already checked price recently
                const now = Date.now();
                const lastCheck = tradingState.lastPriceCheck[symbol] || 0;
                
                // Only check every PRICE_CHECK_INTERVAL_MS milliseconds
                if (now - lastCheck < TRADING_CONFIG.PRICE_CHECK_INTERVAL_MS) continue;
                
                // Mark that we checked price
                tradingState.lastPriceCheck[symbol] = now;
                
                // Get current price and check if it meets trading conditions
                await evaluateTradingStrategy(symbol);
            } catch (error) {
                console.error(`Error monitoring price for ${symbol}:`, error);
            }
        }
    }, TRADING_CONFIG.PRICE_CHECK_INTERVAL_MS);
    
    console.log('Price monitoring started with interval:', 
        TRADING_CONFIG.PRICE_CHECK_INTERVAL_MS, 'ms');
}

/**
 * Check and update circuit breaker state
 * @param {boolean} success - Whether the operation was successful
 * @returns {boolean} - Whether the circuit is tripped
 */
function checkCircuitBreaker(success) {
    const now = Date.now();
    const cb = TRADING_CONFIG.CIRCUIT_BREAKER;
    
    // Reset circuit breaker after timeout
    if (cb.TRIPPED && (now - cb.LAST_ERROR_TIME > cb.RESET_TIMEOUT_MS)) {
        console.log('Circuit breaker timeout elapsed, resetting');
        cb.TRIPPED = false;
        cb.ERROR_COUNT = 0;
    }
    
    if (success) {
        // Reset error count on success
        cb.ERROR_COUNT = 0;
    } else {
        // Increment error count and check if circuit should trip
        cb.ERROR_COUNT++;
        cb.LAST_ERROR_TIME = now;
        
        if (cb.ERROR_COUNT >= cb.MAX_ERROR_COUNT) {
            cb.TRIPPED = true;
            console.error(`Circuit breaker tripped after ${cb.ERROR_COUNT} consecutive errors.`);
            
            // Notify via Telegram
            telegramAPI.sendSystemAlert({
                type: 'error',
                message: 'Trading circuit breaker has been tripped due to multiple consecutive errors.',
                details: 'Trading operations have been suspended temporarily.'
            });
            
            // Emit trading status if io available
            if (io) {
                io.emit('trading-status', { 
                    active: false, 
                    circuitBreaker: true, 
                    message: 'Trading suspended due to multiple consecutive errors'
                });
            }
        }
    }
    
    return cb.TRIPPED;
}

/**
 * Get a formatted version of the symbol (enforce USDT suffix)
 * @param {string} symbol - Symbol to format
 * @returns {string} Formatted symbol
 */
function formatSymbol(symbol) {
    if (!symbol) return '';
    
    // Convert to uppercase
    const upperSymbol = symbol.toUpperCase();
    
    // Add USDT suffix if not present
    if (!upperSymbol.endsWith('USDT')) {
        return upperSymbol + 'USDT';
    }
    
    return upperSymbol;
}

/**
 * Evaluate trading strategy for a symbol based on current price
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {boolean} Whether any action was taken
 */
async function evaluateTradingStrategy(symbol) {
    // Skip if circuit breaker is tripped
    if (TRADING_CONFIG.CIRCUIT_BREAKER.TRIPPED) {
        return false;
    }
    
    try {
        // Ensure symbol is properly formatted
        const formattedSymbol = formatSymbol(symbol);
        
        // Get current price from Binance
        const priceData = await binanceAPI.getTickerPrice(formattedSymbol);
        if (!priceData || !priceData.price) {
            console.warn(`Could not get current price for ${formattedSymbol}`);
            return false;
        }
        
        const currentPrice = parseFloat(priceData.price);
        
        // Store current price
        tradingState.currentPrices[formattedSymbol] = currentPrice;
        
        // Get thresholds from database
        const refPrices = await dbconns.getReferencePrice(formattedSymbol);
        
        // Skip if no initial purchase price (meaning no first purchase yet)
        if (!refPrices.initial_purchase_price || refPrices.initial_purchase_price <= 0) {
            return false;
        }
        
        // Get holdings for this symbol
        const holdings = await dbconns.getHoldings(formattedSymbol);
        
        // Get thresholds from cache or config
        const thresholds = thresholdCache[formattedSymbol] || {
            buyThresholdPercent: TRADING_CONFIG.DEFAULT_BUY_THRESHOLD_PERCENT,
            sellThresholdPercent: TRADING_CONFIG.DEFAULT_SELL_THRESHOLD_PERCENT,
            additionalPurchaseAmount: TRADING_CONFIG.ADDITIONAL_PURCHASE_AMOUNT
        };
        
        // Check buy condition: price dropped by threshold % from last purchase
        if (refPrices.last_purchase_price > 0 && 
            currentPrice <= refPrices.next_buy_threshold) {
            
            console.log(`${formattedSymbol} price ${currentPrice} is below buy threshold ${refPrices.next_buy_threshold}`);
            
            // Execute buy with additional purchase amount
            return await executeBuy(
                formattedSymbol, 
                thresholds.additionalPurchaseAmount,
                true, // Automated
                currentPrice
            );
        }
        
        // Check sell condition: price rose by threshold % above initial purchase
        else if (holdings.quantity > 0 && 
                 currentPrice >= refPrices.next_sell_threshold) {
            
            console.log(`${formattedSymbol} price ${currentPrice} is above sell threshold ${refPrices.next_sell_threshold}`);
            
            // Execute sell all
            return await executeSellAll(formattedSymbol, true, currentPrice);
        }
        
        // No action needed
        return false;
        
    } catch (error) {
        console.error(`Error evaluating trading strategy for ${symbol}:`, error);
        
        // Update circuit breaker
        checkCircuitBreaker(false);
        
        return false;
    }
}

/**
 * Process a first purchase request initiated by user
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} investment - Investment amount in USDT
 * @returns {Object} Result object
 */
async function processFirstPurchase(symbol, investment) {
    try {
        // Ensure symbol is properly formatted
        const formattedSymbol = formatSymbol(symbol);
        
        // Check if amount is valid
        const investmentAmount = parseFloat(investment);
        if (isNaN(investmentAmount) || investmentAmount <= 0) {
            return {
                success: false,
                error: 'Invalid investment amount'
            };
        }
        
        // Get current price
        const priceData = await binanceAPI.getTickerPrice(formattedSymbol);
        const currentPrice = parseFloat(priceData.price);
        
        if (!currentPrice || currentPrice <= 0) {
            return {
                success: false,
                error: 'Could not get current price'
            };
        }
        
        // Execute the buy operation
        const result = await executeBuy(formattedSymbol, investmentAmount, false, currentPrice);
        
        // Return appropriate result
        if (result) {
            return { success: true };
        } else {
            return {
                success: false,
                error: 'Failed to execute buy order'
            };
        }
    } catch (error) {
        console.error(`Error processing first purchase for ${symbol}:`, error);
        
        // Update circuit breaker
        checkCircuitBreaker(false);
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Process a sell all request initiated by user
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {Object} Result object
 */
async function processSellAll(symbol) {
    try {
        // Ensure symbol is properly formatted
        const formattedSymbol = formatSymbol(symbol);
        
        // Get current holdings
        const holdings = await dbconns.getHoldings(formattedSymbol);
        
        // Check if there are any holdings to sell
        if (!holdings || parseFloat(holdings.quantity) <= 0) {
            return {
                success: false,
                error: 'No holdings to sell'
            };
        }
        
        // Execute the sell operation
        const result = await executeSellAll(formattedSymbol, false);
        
        // Return appropriate result
        if (result) {
            return { success: true };
        } else {
            return {
                success: false,
                error: 'Failed to execute sell order'
            };
        }
    } catch (error) {
        console.error(`Error processing sell all for ${symbol}:`, error);
        
        // Update circuit breaker
        checkCircuitBreaker(false);
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Execute a buy order for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} amount - Amount to buy in USDT
 * @param {boolean} automated - Whether this is an automated trade
 * @param {number} currentPrice - Current price (optional, will fetch if not provided)
 * @returns {boolean} Success status
 */
async function executeBuy(symbol, amount, automated = false, currentPrice = null) {
    // Skip if circuit breaker is tripped
    if (TRADING_CONFIG.CIRCUIT_BREAKER.TRIPPED) {
        console.warn(`Buy order for ${symbol} rejected: circuit breaker tripped`);
        return false;
    }
    
    // Check for duplicate or pending orders
    const orderKey = `buy-${symbol}-${Date.now()}`;
    if (tradingState.pendingOrders.has(orderKey)) {
        console.warn(`Duplicate buy order detected for ${symbol}, ignoring`);
        return false;
    }
    
    // Mark order as pending
    tradingState.pendingOrders.add(orderKey);
    
    try {
        // Get current price if not provided
        let price = currentPrice;
        if (!price) {
            const priceData = await binanceAPI.getTickerPrice(symbol);
            price = parseFloat(priceData.price);
        }
        
        // Calculate quantity based on USDT amount
        const quantityData = await binanceAPI.calculateQuantityFromUsdt(symbol, amount);
        const quantity = quantityData.quantity;
        
        console.log(`Executing buy order: ${amount} USDT worth of ${symbol} at $${price.toFixed(4)}`);
        
        // Execute the buy order through Binance API
        // This is commented out because we don't have the actual implementation in binance.js
        // In a real scenario, you would replace this with the actual Binance API call
        /*
        const orderResult = await binanceAPI.createMarketBuyOrder(symbol, quantity);
        if (!orderResult) {
            throw new Error(`Failed to create buy order for ${symbol}`);
        }
        */
        
        // For now, simulate a successful order for testing (remove in production)
        const orderResult = {
            symbol,
            orderId: Math.floor(Math.random() * 1000000),
            executedQty: quantity,
            cummulativeQuoteQty: amount,
            status: 'FILLED',
            price: price
        };
        
        // Store transaction in database
        const transactionData = {
            symbol,
            type: 'BUY',
            price,
            quantity,
            investment: amount,
            automated
        };
        
        await dbconns.storeTransaction(transactionData);
        
        // Update holdings
        await dbconns.updateHoldings(symbol);
        
        // Update reference prices
        await dbconns.updateReferencePrice(symbol, price);
        
        // Send notification via Telegram
        await telegramAPI.sendTradeNotification({
            symbol,
            type: 'BUY',
            price,
            quantity,
            investment: amount,
            timestamp: Date.now()
        });
        
        // Emit updates through Socket.IO if available
        if (io) {
            // Emit price update
            io.emit('price-update', {
                symbol,
                price,
                source: 'order'
            });
            
            // Get updated data
            const transactions = await dbconns.getTransactions(symbol);
            const updatedHoldings = await dbconns.getHoldings(symbol);
            const refPrices = await dbconns.getReferencePrice(symbol);
            
            // Emit transaction update
            io.emit('transaction-update', {
                symbol: symbol.replace('USDT', ''),
                transactions,
                refPrices
            });
            
            // Emit holdings update
            io.emit('holdings-update', {
                symbol: symbol.replace('USDT', ''),
                amount: updatedHoldings.quantity,
                avgPrice: updatedHoldings.avg_price,
                initialPrice: refPrices.initial_purchase_price,
                lastBuyPrice: refPrices.last_purchase_price,
                nextBuyThreshold: refPrices.next_buy_threshold,
                nextSellThreshold: refPrices.next_sell_threshold,
                profitLossPercent: ((price - updatedHoldings.avg_price) / updatedHoldings.avg_price) * 100
            });
        }
        
        // Update circuit breaker
        checkCircuitBreaker(true);
        
        console.log(`Buy order executed successfully for ${symbol}`);
        return true;
        
    } catch (error) {
        console.error(`Error executing buy order for ${symbol}:`, error);
        
        // Update circuit breaker
        checkCircuitBreaker(false);
        
        return false;
    } finally {
        // Remove from pending orders
        tradingState.pendingOrders.delete(orderKey);
    }
}

/**
 * Execute a sell all order for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {boolean} automated - Whether this is an automated trade
 * @param {number} currentPrice - Current price (optional, will fetch if not provided)
 * @returns {boolean} Success status
 */
async function executeSellAll(symbol, automated = false, currentPrice = null) {
    // Skip if circuit breaker is tripped
    if (TRADING_CONFIG.CIRCUIT_BREAKER.TRIPPED) {
        console.warn(`Sell order for ${symbol} rejected: circuit breaker tripped`);
        return false;
    }
    
    // Check for duplicate or pending orders
    const orderKey = `sell-${symbol}-${Date.now()}`;
    if (tradingState.pendingOrders.has(orderKey)) {
        console.warn(`Duplicate sell order detected for ${symbol}, ignoring`);
        return false;
    }
    
    // Mark order as pending
    tradingState.pendingOrders.add(orderKey);
    
    try {
        // Get current holdings
        const holdings = await dbconns.getHoldings(symbol);
        
        // Check if there are holdings to sell
        if (!holdings || parseFloat(holdings.quantity) <= 0) {
            console.warn(`No holdings to sell for ${symbol}`);
            return false;
        }
        
        // Get current price if not provided
        let price = currentPrice;
        if (!price) {
            const priceData = await binanceAPI.getTickerPrice(symbol);
            price = parseFloat(priceData.price);
        }
        
        // Calculate total value
        const totalValue = holdings.quantity * price;
        
        console.log(`Executing sell order: ${holdings.quantity} ${symbol} at $${price.toFixed(4)}`);
        
        // Execute the sell order through Binance API
        // This is commented out because we don't have the actual implementation in binance.js
        // In a real scenario, you would replace this with the actual Binance API call
        /*
        const orderResult = await binanceAPI.createMarketSellOrder(symbol, holdings.quantity);
        if (!orderResult) {
            throw new Error(`Failed to create sell order for ${symbol}`);
        }
        */
        
        // For now, simulate a successful order for testing (remove in production)
        const orderResult = {
            symbol,
            orderId: Math.floor(Math.random() * 1000000),
            executedQty: holdings.quantity,
            cummulativeQuoteQty: totalValue,
            status: 'FILLED',
            price: price
        };
        
        // Store transaction in database
        const transactionData = {
            symbol,
            type: 'SELL',
            price,
            quantity: holdings.quantity,
            investment: totalValue,
            automated
        };
        
        await dbconns.storeTransaction(transactionData);
        
        // Update holdings
        await dbconns.updateHoldings(symbol);
        
        // Update reference prices
        await dbconns.updateReferencePrice(symbol, price);
        
        // Send notification via Telegram
        await telegramAPI.sendTradeNotification({
            symbol,
            type: 'SELL',
            price,
            quantity: holdings.quantity,
            investment: totalValue,
            timestamp: Date.now()
        });
        
        // Emit updates through Socket.IO if available
        if (io) {
            // Emit price update
            io.emit('price-update', {
                symbol,
                price,
                source: 'order'
            });
            
            // Get updated data
            const transactions = await dbconns.getTransactions(symbol);
            const updatedHoldings = await dbconns.getHoldings(symbol);
            const refPrices = await dbconns.getReferencePrice(symbol);
            
            // Emit transaction update
            io.emit('transaction-update', {
                symbol: symbol.replace('USDT', ''),
                transactions,
                refPrices
            });
            
            // Emit holdings update
            io.emit('holdings-update', {
                symbol: symbol.replace('USDT', ''),
                amount: 0, // Since we sold everything
                avgPrice: 0,
                initialPrice: refPrices.initial_purchase_price,
                lastBuyPrice: refPrices.last_purchase_price,
                nextBuyThreshold: refPrices.next_buy_threshold,
                nextSellThreshold: refPrices.next_sell_threshold,
                profitLossPercent: 0
            });
        }
        
        // Update circuit breaker
        checkCircuitBreaker(true);
        
        console.log(`Sell order executed successfully for ${symbol}`);
        return true;
        
    } catch (error) {
        console.error(`Error executing sell order for ${symbol}:`, error);
        
        // Update circuit breaker
        checkCircuitBreaker(false);
        
        return false;
    } finally {
        // Remove from pending orders
        tradingState.pendingOrders.delete(orderKey);
    }
}

/**
 * Update trading state with new price data
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} price - Current price
 */
function processNewPrice(symbol, price) {
    // Store current price
    tradingState.currentPrices[symbol] = price;
    
    // Add to price history (maintain last 10 prices)
    if (!tradingState.priceHistory[symbol]) {
        tradingState.priceHistory[symbol] = [];
    }
    
    tradingState.priceHistory[symbol].push({
        price,
        timestamp: Date.now()
    });
    
    // Keep only last 10 prices
    if (tradingState.priceHistory[symbol].length > 10) {
        tradingState.priceHistory[symbol].shift();
    }
    
    // Evaluate trading strategy if trading is enabled for this symbol
    if (tradingState.isActive && tradingState.symbolsEnabled[symbol]) {
        evaluateTradingStrategy(symbol);
    }
}

/**
 * Set global trading activity state
 * @param {boolean} isActive - Whether trading should be active
 * @returns {boolean} Success status
 */
function setTradingActivity(isActive) {
    tradingState.isActive = !!isActive;
    
    // Log the change
    console.log(`Trading activity set to: ${tradingState.isActive ? 'ACTIVE' : 'INACTIVE'}`);
    
    // Emit trading status if io available
    if (io) {
        io.emit('trading-status', { 
            active: tradingState.isActive,
            circuitBreaker: TRADING_CONFIG.CIRCUIT_BREAKER.TRIPPED
        });
    }
    
    return true;
}

/**
 * Set trading activity for a specific symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {boolean} isEnabled - Whether trading should be enabled for this symbol
 * @returns {boolean} Success status
 */
async function setSymbolTradingActivity(symbol, isEnabled) {
    // Ensure symbol is properly formatted
    const formattedSymbol = formatSymbol(symbol);
    
    // Update trading state
    tradingState.symbolsEnabled[formattedSymbol] = !!isEnabled;
    
    // Update configuration in database
    try {
        await dbconns.updateConfiguration(formattedSymbol, {
            active: !!isEnabled
        });
        
        console.log(`Trading for ${formattedSymbol} set to: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
        return true;
    } catch (error) {
        console.error(`Error updating trading activity for ${formattedSymbol}:`, error);
        return false;
    }
}

/**
 * Get current trading status
 * @returns {Object} Trading status object
 */
function getTradingStatus() {
    return {
        isActive: tradingState.isActive,
        circuitBreaker: TRADING_CONFIG.CIRCUIT_BREAKER.TRIPPED,
        symbolsEnabled: { ...tradingState.symbolsEnabled },
        currentPrices: { ...tradingState.currentPrices }
    };
}

/**
 * Reset circuit breaker manually
 * @returns {boolean} Success status
 */
function resetCircuitBreaker() {
    TRADING_CONFIG.CIRCUIT_BREAKER.TRIPPED = false;
    TRADING_CONFIG.CIRCUIT_BREAKER.ERROR_COUNT = 0;
    TRADING_CONFIG.CIRCUIT_BREAKER.LAST_ERROR_TIME = 0;
    
    console.log('Circuit breaker manually reset');
    
    // Emit trading status if io available
    if (io) {
        io.emit('trading-status', { 
            active: tradingState.isActive,
            circuitBreaker: false
        });
    }
    
    return true;
}

// Export all functions (CommonJS syntax)
module.exports = {
    initialize,
    processFirstPurchase,
    processSellAll,
    evaluateTradingStrategy,
    executeBuy,
    executeSellAll,
    processNewPrice,
    setTradingActivity,
    setSymbolTradingActivity,
    getTradingStatus,
    resetCircuitBreaker
};