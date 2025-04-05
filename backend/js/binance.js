const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');
const WebSocket = require('ws');

// Load environment variables
dotenv.config({ path: '/app/.env' });

// Binance API credentials
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

// Binance API base URLs
const BASE_URL = process.env.BINANCE_API_URL;
const WS_BASE_URL = process.env.BINANCE_WEBSOCKET_URL;

// Constants
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_RECONNECT_DELAY = 5000;
const MAX_RECONNECT_DELAY = 60000;
const WS_CONNECTION_LIFETIME = 23 * 60 * 60 * 1000; // 23 hours (1 hour less than Binance's 24h limit)
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
const HEALTH_CHECK_TIMEOUT = 5000; // 5 seconds
const POLLING_INTERVAL = 10000; // 10 seconds


// WebSocket state
let wsInstance = null;
let wsState = {
    isConnected: false,
    activeSymbols: [],
    connectionStartTime: 0,
    reconnectAttempt: 0,
    reconnectTimeout: null,
    renewalTimeout: null,
    healthCheckInterval: null,
    isReconnecting: false
};

// Polling state
let pollingState = {
    isActive: false,
    intervalId: null
};


// Initialize WebSocket connections for the configured symbols
function initializeWebSockets(io) {
    // List of symbols to track
    const symbols = ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'NEARUSDT', 'PENDLEUSDT'];
    
    console.log(`Initializing WebSocket connections for ${symbols.join(', ')}`);
    
    // Reset reconnect attempt counter
    wsState.reconnectAttempt = 0;
    wsState.isReconnecting = false;
    
    // Connect to WebSocket
    return connectToWebSocket(symbols, io);
}

// Close all active WebSocket connections
async function closeAllConnections() {
    console.log('Closing all WebSocket connections');
    
    // Stop polling if active
    stopPolling();
    
    // Clean up WebSocket
    if (wsInstance) {
        cleanupWebSocket(wsInstance);
        wsInstance = null;
    }
    
    // Reset connection state
    wsState.isConnected = false;
    
    return true;
}



// Get WebSocket connection status
function getWebSocketStatus() {
    // Create a status report
    const status = {
        connections: {},
        totalConnections: wsInstance ? 1 : 0,
        reconnectAttempt: wsState.reconnectAttempt,
        pollingActive: pollingState.isActive,
        connectionAge: wsState.connectionStartTime ? 
            Math.round((Date.now() - wsState.connectionStartTime) / 1000 / 60 / 60) : 0
    };
    
    // Add details for the connection
    if (wsInstance) {
        const key = wsState.activeSymbols.join('-');
        status.connections[key] = {
            isOpen: wsInstance.readyState === OPEN,
            connectionAge: status.connectionAge,
            symbols: wsState.activeSymbols || [],
            readyState: wsInstance.readyState
        };
    }
    
    return status;
}



// Test Binance API connection
async function testConnection() {
    try {
        const response = await get(`${BASE_URL}/api/v3/ping`);
        return response.status === 200;
    } catch (error) {
        console.error('Binance API connection test failed:', error.message);
        throw error;
    }
}

 
// Get current ticker price for a symbol
async function getTickerPrice(symbol) {
    try {
        const response = await get(`${BASE_URL}/api/v3/ticker/price`, {
            params: { symbol }
        });
        
        return response.data;
    } catch (error) {
        console.error(`Failed to get ticker price for ${symbol}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}



// Get ticker price for multiple symbols
async function getMultipleTickers(symbols = []) {
    try {
        // If no symbols provided, get all tickers
        const response = await get(`${BASE_URL}/api/v3/ticker/price`);
        
        if (symbols.length === 0) {
            return response.data;
        }
        
        // Filter the results if symbols were provided
        return response.data.filter(ticker => 
            symbols.includes(ticker.symbol)
        );
    } catch (error) {
        console.error('Failed to get multiple tickers:', error.response ? error.response.data : error.message);
        throw error;
    }
}

// Calculate order quantity based on USDT amount
async function calculateQuantityFromUsdt(symbol, usdtAmount) {
    try {
        // Get current price
        const tickerData = await getTickerPrice(symbol);
        const price = parseFloat(tickerData.price);
        
        if (isNaN(price) || price <= 0) {
            throw new Error(`Invalid price for ${symbol}: ${price}`);
        }
        
        // Calculate quantity
        const quantity = usdtAmount / price;
        
        // Get symbol info to properly format quantity according to Binance's rules
        const exchangeInfo = await getExchangeInfo(symbol);
        
        // Apply correct precision
        const formattedQuantity = formatQuantity(quantity, exchangeInfo);
        
        return {
            quantity: formattedQuantity, 
            price: price,
            rawQuantity: quantity
        };
    } catch (error) {
        console.error(`Error calculating quantity for ${usdtAmount} USDT of ${symbol}:`, error);
        throw error;
    }
}

// Get exchange info for a symbol
async function getExchangeInfo(symbol) {
    try {
        const response = await get(`${BASE_URL}/api/v3/exchangeInfo`, {
            params: { symbol }
        });
        
        // Find the symbol info
        const symbolInfo = response.data.symbols.find(s => s.symbol === symbol);
        if (!symbolInfo) {
            throw new Error(`Symbol ${symbol} not found in exchange info`);
        }
        
        return symbolInfo;
    } catch (error) {
        console.error(`Failed to get exchange info for ${symbol}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}

// Format quantity using LOT_SIZE filter
function formatQuantity(quantity, symbolInfo) {
    try {
        // Find the LOT_SIZE filter
        const lotSizeFilter = symbolInfo.filters.find(f => f.filterType === 'LOT_SIZE');
        
        if (!lotSizeFilter) {
            console.warn(`No LOT_SIZE filter found for ${symbolInfo.symbol}, using raw quantity`);
            return quantity.toString();
        }
        
        // Ensure quantity is a number before using toFixed
        if (typeof quantity !== 'number') {
            quantity = parseFloat(quantity);
            if (isNaN(quantity)) {
                throw new Error("Invalid quantity value");
            }
        }
        
        // Get the step size
        const stepSize = parseFloat(lotSizeFilter.stepSize);
        const minQty = parseFloat(lotSizeFilter.minQty);
        const maxQty = parseFloat(lotSizeFilter.maxQty);
        
        // Calculate precision from step size
        let precision = 0;
        if (stepSize.toString().includes('.')) {
            precision = stepSize.toString().split('.')[1].length;
        }
        
        // Ensure quantity is within min/max bounds
        quantity = Math.max(minQty, Math.min(maxQty, quantity));
        
        // Round down to the nearest step
        const remainder = quantity % stepSize;
        if (remainder !== 0) {
            quantity = quantity - remainder;
        }
        
        // Format to correct precision
        return quantity.toFixed(precision);
    } catch (error) {
        console.error('Error formatting quantity:', error);
        return quantity.toString();
    }
}


/* 
// Create a market buy order
async function createMarketBuyOrder(symbol, quantity, isUsdtAmount = false) {
    try {
        let orderQuantity = quantity;
        let price = null;
        
        // If isUsdtAmount is true, convert USDT amount to asset quantity
        if (isUsdtAmount) {
            const quantityData = await calculateQuantityFromUsdt(symbol, quantity);
            orderQuantity = quantityData.quantity;
            price = quantityData.price;
        }
        
        const timestamp = Date.now();
        const queryString = `symbol=${symbol}&side=BUY&type=MARKET&quantity=${orderQuantity}&timestamp=${timestamp}`;
        const signature = generateSignature(queryString);
        
        console.log(`Creating market buy order: ${queryString}`);
        
        const response = await axios({
            method: 'POST',
            url: `${BASE_URL}/api/v3/order`,
            headers: {
                'X-MBX-APIKEY': API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            params: {
                symbol: symbol,
                side: 'BUY',
                type: 'MARKET',
                quantity: orderQuantity,
                timestamp: timestamp,
                signature: signature
            }
        });
        
        // Add price to response if we calculated it
        if (price) {
            response.data.calculatedPrice = price;
        }
        
        return response.data;
    } catch (error) {
        console.error(`Failed to create market buy order for ${symbol}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}

// Create a market sell order
async function createMarketSellOrder(symbol, quantity, isUsdtAmount = false) {
    try {
        let orderQuantity = quantity;
        let price = null;
        
        // If isUsdtAmount is true, convert USDT amount to asset quantity
        if (isUsdtAmount) {
            const quantityData = await calculateQuantityFromUsdt(symbol, quantity);
            orderQuantity = quantityData.quantity;
            price = quantityData.price;
            
            // For sell orders, also check if we have enough balance
            const accountInfo = await getAccountInfo();
            const asset = symbol.replace('USDT', '');
            const assetBalance = accountInfo.balances.find(b => b.asset === asset);
            
            if (!assetBalance || parseFloat(assetBalance.free) < parseFloat(orderQuantity)) {
                throw new Error(`Insufficient ${asset} balance. Required: ${orderQuantity}, Available: ${assetBalance ? assetBalance.free : 0}`);
            }
        } else {
            // For sell-all scenarios, need to get exchange info for LOT_SIZE rule
            const exchangeInfo = await getExchangeInfo(symbol);
            orderQuantity = formatQuantity(quantity, exchangeInfo);
            console.log(`Formatted ${symbol} quantity from ${quantity} to ${orderQuantity} based on LOT_SIZE rule`);
        }
        
        const timestamp = Date.now();
        const queryString = `symbol=${symbol}&side=SELL&type=MARKET&quantity=${orderQuantity}&timestamp=${timestamp}`;
        const signature = generateSignature(queryString);
        
        console.log(`Creating market sell order: ${queryString}`);
        
        const response = await axios({
            method: 'POST',
            url: `${BASE_URL}/api/v3/order`,
            headers: {
                'X-MBX-APIKEY': API_KEY,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            params: {
                symbol: symbol,
                side: 'SELL',
                type: 'MARKET',
                quantity: orderQuantity,
                timestamp: timestamp,
                signature: signature
            }
        });
        
        // Add price to response if we calculated it
        if (price) {
            response.data.calculatedPrice = price;
        }
        
        return response.data;
    } catch (error) {
        console.error(`Failed to create market sell order for ${symbol}:`, error.response ? error.response.data : error.message);
        throw error;
    }
}
 */

// Start price polling
function startPolling(symbols, io) {
    // Don't start if already polling
    if (pollingState.isActive) {
        return;
    }
    
    console.log('Starting price polling as WebSocket fallback');
    pollingState.isActive = true;
    
    // Clear any existing polling interval
    if (pollingState.intervalId) {
        clearInterval(pollingState.intervalId);
    }
    
    // Function to fetch prices and emit updates
    const fetchAndEmitPrices = async () => {
        try {
            // Fetch prices for all symbols
            const prices = await getMultipleTickers(symbols);
            
            // Emit price updates to clients
            prices.forEach(price => {
                io.emit('price-update', {
                    symbol: price.symbol,
                    price: price.price,
                    source: 'polling'
                });
            });
            
            console.log(`Polled prices for ${prices.length} symbols`);
        } catch (error) {
            console.error('Error polling prices:', error.message);
        }
    };
    
    // Fetch prices immediately
    fetchAndEmitPrices();
    
    // Set up interval for regular polling
    pollingState.intervalId = setInterval(fetchAndEmitPrices, POLLING_INTERVAL);
    
    // Notify clients that we're in polling mode
    io.emit('websocket-status', { 
        connected: false, 
        pollingActive: true,
        message: 'Using REST API polling due to WebSocket disconnection'
    });
}

// Stop polling
function stopPolling() {
    if (!pollingState.isActive) {
        return;
    }
    
    console.log('Stopping price polling');
    
    // Clear polling interval
    if (pollingState.intervalId) {
        clearInterval(pollingState.intervalId);
        pollingState.intervalId = null;
    }
    
    pollingState.isActive = false;
}

// Clean up a WebSocket instance
function cleanupWebSocket(ws) {
    if (!ws) return;
    
    // Clear associated intervals
    if (wsState.healthCheckInterval) {
        clearInterval(wsState.healthCheckInterval);
        wsState.healthCheckInterval = null;
    }
    
    // Clear renewal timeout
    if (wsState.renewalTimeout) {
        clearTimeout(wsState.renewalTimeout);
        wsState.renewalTimeout = null;
    }
    
    // Clear reconnect timeout
    if (wsState.reconnectTimeout) {
        clearTimeout(wsState.reconnectTimeout);
        wsState.reconnectTimeout = null;
    }
    
    // Close WebSocket if it's still open
    if (ws.readyState === OPEN || ws.readyState === CONNECTING) {
        try {
            ws.terminate();
        } catch (err) {
            console.error('Error terminating WebSocket:', err.message);
        }
    }
}




// Schedule connection renewal
function scheduleConnectionRenewal(symbols, io) {
    // Clear any existing renewal timeout
    if (wsState.renewalTimeout) {
        clearTimeout(wsState.renewalTimeout);
    }
    
    // Set timeout for renewal after connection lifetime
    wsState.renewalTimeout = setTimeout(() => {
        console.log('Connection lifetime (23 hours) reached, performing planned renewal');
        
        // Start polling before closing connection
        startPolling(symbols, io);
        
        // Reset reconnect attempt counter for clean reconnection
        wsState.reconnectAttempt = 0;
        wsState.isReconnecting = false;
        
        // Notify clients
        io.emit('websocket-status', { 
            connected: true, 
            renewing: true,
            message: 'Performing scheduled 24h connection renewal',
            symbols 
        });
        
        // Close the connection (will trigger reconnect)
        if (wsInstance) {
            wsInstance.close(1000, "Planned connection renewal");
        }
    }, WS_CONNECTION_LIFETIME);
    
    console.log(`Scheduled connection renewal in ${WS_CONNECTION_LIFETIME / 1000 / 60 / 60} hours`);
}




// Set up health check for WebSocket connection
function setupHealthCheck(ws, symbols, io) {
    // Clear any existing interval
    if (wsState.healthCheckInterval) {
        clearInterval(wsState.healthCheckInterval);
    }
    
    // Setup health check interval
    wsState.healthCheckInterval = setInterval(() => {
        if (!ws || ws.readyState !== OPEN) {
            console.log('Health check: WebSocket not open, clearing interval');
            clearInterval(wsState.healthCheckInterval);
            wsState.healthCheckInterval = null;
            return;
        }
        
        // Ping server and mark as not alive until response
        ws.isAlive = false;
        
        try {
            // Send a Binance-specific ping (subscription list request)
            ws.send(JSON.stringify({
                method: "LIST_SUBSCRIPTIONS",
                id: Date.now()
            }));
            
            // Also use standard WebSocket ping
            ws.ping();
            
            // Check for response after timeout
            setTimeout(() => {
                if (ws && !ws.isAlive) {
                    console.warn('No response received to health check, connection may be dead');
                    
                    // Connection appears to be dead, terminate and trigger reconnect
                    if (ws.readyState === OPEN) {
                        ws.terminate();
                    }
                }
            }, HEALTH_CHECK_TIMEOUT);
        } catch (error) {
            console.error('Error sending health check:', error.message);
            
            // Error sending health check, terminate connection
            if (ws.readyState === OPEN) {
                ws.terminate();
            }
        }
    }, HEALTH_CHECK_INTERVAL);
}





// Implement exponential backoff for reconnection
function getReconnectDelay() {
    return Math.min(
        INITIAL_RECONNECT_DELAY * Math.pow(1.5, wsState.reconnectAttempt),
        MAX_RECONNECT_DELAY
    );
}

// Handle WebSocket reconnection
function handleReconnect(symbols, io) {
    // Don't attempt to reconnect if already in process
    if (wsState.isReconnecting) {
        return;
    }
    
    wsState.isReconnecting = true;
    wsState.reconnectAttempt++;
    
    if (wsState.reconnectAttempt > MAX_RECONNECT_ATTEMPTS) {
        console.error(`Max reconnect attempts (${MAX_RECONNECT_ATTEMPTS}) reached`);
        
        // Ensure polling is active as fallback
        startPolling(symbols, io);
        
        // After a cooldown period, reset reconnect counter and try again
        setTimeout(() => {
            console.log('Resetting reconnect attempt counter after cooldown period');
            wsState.reconnectAttempt = 0;
            wsState.isReconnecting = false;
            
            // Try to reconnect
            connectToWebSocket(symbols, io);
        }, 5 * 60 * 1000); // 5 minutes
        
        return;
    }
    
    // Calculate delay with exponential backoff
    const delay = getReconnectDelay();
    
    console.log(`Will attempt to reconnect in ${delay}ms (attempt ${wsState.reconnectAttempt}/${MAX_RECONNECT_ATTEMPTS})`);
    
    // Notify clients about reconnection attempt
    io.emit('websocket-status', {
        connected: false,
        reconnecting: true,
        attempt: wsState.reconnectAttempt,
        maxAttempts: MAX_RECONNECT_ATTEMPTS,
        symbols
    });
    
    // Schedule reconnection
    wsState.reconnectTimeout = setTimeout(() => {
        console.log(`Attempting to reconnect WebSocket for ${symbols.join(', ')}`);
        wsState.isReconnecting = false;
        connectToWebSocket(symbols, io);
    }, delay);
}



 // Main function to connect to Binance WebSocket
function connectToWebSocket(symbols, io) {
    // Clean up existing connection if present
    if (wsInstance) {
        cleanupWebSocket(wsInstance);
    }
    
    // Update active symbols
    wsState.activeSymbols = symbols;
    
    console.log(`Connecting to Binance WebSocket: ${WS_BASE_URL}`);
    
    // Create new WebSocket connection
    const ws = new WebSocket(WS_BASE_URL);
    wsInstance = ws;
    
    // Connection opened handler
    ws.on('open', () => {
        console.log(`WebSocket connection opened for ${symbols.join(', ')}`);
        ws.isAlive = true;
        wsState.isConnected = true;
        wsState.reconnectAttempt = 0;
        wsState.connectionStartTime = Date.now();
        
        // Subscribe to all symbols
        const subscribeMsg = {
            method: "SUBSCRIBE",
            params: symbols.map(symbol => `${symbol.toLowerCase()}@bookTicker`),
            id: Date.now()
        };
        
        ws.send(JSON.stringify(subscribeMsg));
        console.log("Sent subscription request:", subscribeMsg);
        
        // Set up health check
        setupHealthCheck(ws, symbols, io);
        
        // Schedule connection renewal
        scheduleConnectionRenewal(symbols, io);
        
        // Emit connection status
        io.emit('websocket-status', { 
            connected: true, 
            symbols,
            pollingActive: pollingState.isActive
        });
        
        // Update trading status
        io.emit('trading-status', { active: true });
        
        // Stop polling if active as we now have WebSocket
        stopPolling();
    });
    


    // Message handler
    ws.on('message', (data) => {
        try {
            // Mark connection as alive when receiving any message
            ws.isAlive = true;
            
            // Parse the data
            const parsedData = JSON.parse(data.toString());
            
            // Check if this is a pong response
            if (parsedData.result === null && parsedData.id !== undefined) {
                console.log("Received pong response from Binance");
                return;
            }
            
            // Check if this is an error message
            if (parsedData.error) {
                console.error('Error from Binance WebSocket:', parsedData.error);
                return;
            }
            
            // For ticker data (@ticker stream)
            if (parsedData.e === '24hrTicker') {
                // Extract symbol and price
                const symbol = parsedData.s;
                const price = parsedData.c;
                
                // Emit price update to clients
                io.emit('price-update', {
                    symbol,
                    price,
                    data: parsedData,
                    source: 'websocket'
                });
                
                // Log only occasionally to avoid flooding
                if (Math.random() < 0.1) {
                    // console.log(`Ticker update for ${symbol}: ${price}`);
                }
            }
            // For bookTicker data
            else if (parsedData.s && (parsedData.b || parsedData.a)) {
                // Extract symbol and price (using best ask price)
                const symbol = parsedData.s;
                const price = parsedData.a || parsedData.b; // Prefer ask price, fall back to bid
                
                // Emit price update to clients
                io.emit('price-update', {
                    symbol,
                    price,
                    data: parsedData,
                    source: 'websocket'
                });
            }
            else {
                // Log other message types (truncated to avoid huge logs)
                const msgStr = JSON.stringify(parsedData);
                console.log(`Received WebSocket message: ${msgStr.length > 100 ? msgStr.substring(0, 100) + '...' : msgStr}`);
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error.message);
        }
    });




    // Pong handler to mark connection as alive
    ws.on('pong', () => {
        ws.isAlive = true;
    });
    
    // Error handler
    ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        io.emit('websocket-status', { 
            connected: false, 
            error: error.message, 
            symbols 
        });
    });
    
    // Close handler
    ws.on('close', (code, reason) => {
        console.log(`WebSocket closed. Code: ${code}, Reason: ${reason || 'No reason provided'}`);
        
        // Update connection state
        wsState.isConnected = false;
        
        // Update WebSocket status for clients
        io.emit('websocket-status', { 
            connected: false, 
            symbols 
        });
        
        // Start polling as fallback
        startPolling(symbols, io);
        
        // Attempt to reconnect
        handleReconnect(symbols, io);
    });
    
    return ws;
}



// Generate signature for signed endpoints
function generateSignature(queryString) {
    return createHmac('sha256', API_SECRET)
        .update(queryString)
        .digest('hex');
}

// Get account information
async function getAccountInfo() {
    try {
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = generateSignature(queryString);
        
        const response = await get(
            `${BASE_URL}/api/v3/account?${queryString}&signature=${signature}`,
            {
                headers: {
                    'X-MBX-APIKEY': API_KEY
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error('Failed to get account info:', error.response ? error.response.data : error.message);
        throw error;
    }
}


/* 
// Execute a buy order based on USDT value
async function executeBuyOrder(symbol, amount, amountType = 'amount') {
    try {
        let quantity = amount;
        let price;
        
        // Validate inputs
        if (!symbol) {
            throw new Error('Symbol is required');
        }
        
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            throw new Error('Invalid amount: must be a positive number');
        }
        
        // If the amount is specified in USDT, calculate the quantity
        if (amountType === 'usdt') {
            const quantityData = await calculateQuantityFromUsdt(symbol, amount);
            quantity = quantityData.quantity;
            price = quantityData.price;
        } else {
            // Get current price for reference
            const tickerData = await getTickerPrice(symbol);
            price = parseFloat(tickerData.price);
        }
        
        // Execute the buy order
        const result = await createMarketBuyOrder(symbol, quantity);
        
        // Get updated balance
        const accountInfo = await getAccountInfo();
        const baseAsset = symbol.replace('USDT', '');
        const assetBalance = accountInfo.balances.find(b => b.asset === baseAsset);
        const newBalance = assetBalance ? parseFloat(assetBalance.free) : 0;
        
        return {
            success: true,
            symbol,
            amount: quantity,
            price,
            newBalance,
            orderResult: result
        };
    } catch (error) {
        console.error(`Error executing buy order for ${symbol}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Execute a sell order
async function executeSellOrder(symbol, amount, amountType = 'amount') {
    try {
        let quantity = amount;
        let price;
        
        // Validate inputs
        if (!symbol) {
            throw new Error('Symbol is required');
        }
        
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            throw new Error('Invalid amount: must be a positive number');
        }
        
        // If the amount is specified in USDT, calculate the quantity
        if (amountType === 'usdt') {
            const quantityData = await calculateQuantityFromUsdt(symbol, amount);
            quantity = quantityData.quantity;
            price = quantityData.price;
        } else {
            // Get current price for reference
            const tickerData = await getTickerPrice(symbol);
            price = parseFloat(tickerData.price);
            
            // Get exchange info for precise quantity formatting
            const exchangeInfo = await getExchangeInfo(symbol);
            quantity = formatQuantity(quantity, exchangeInfo);
        }
        
        // Get current balance to check if sufficient
        const accountInfo = await getAccountInfo();
        const baseAsset = symbol.replace('USDT', '');
        const assetBalance = accountInfo.balances.find(b => b.asset === baseAsset);
        const currentBalance = assetBalance ? parseFloat(assetBalance.free) : 0;
        
        if (currentBalance < parseFloat(quantity)) {
            return {
                success: false,
                error: `Insufficient ${baseAsset} balance. Required: ${quantity}, Available: ${currentBalance}`
            };
        }
        
        // Execute the sell order
        const result = await createMarketSellOrder(symbol, quantity);
        
        // Get updated balance
        const updatedAccountInfo = await getAccountInfo();
        const updatedAssetBalance = updatedAccountInfo.balances.find(b => b.asset === baseAsset);
        const newBalance = updatedAssetBalance ? parseFloat(updatedAssetBalance.free) : 0;
        
        return {
            success: true,
            symbol,
            amount: quantity,
            price,
            newBalance,
            orderResult: result
        };
    } catch (error) {
        console.error(`Error executing sell order for ${symbol}:`, error);
        return {
            success: false,
            error: error.message
        };
    }
}
 */

/* // Legacy function for backward compatibility
function subscribeToTickerStream(symbols, io) {
    console.log(`Legacy subscribeToTickerStream called for symbols: ${symbols.join(', ')}`);
    
    // If we have an active connection, close it first
    if (wsInstance) {
        cleanupWebSocket(wsInstance);
        wsInstance = null;
    }
    
    // Create a new connection with the provided symbols
    return connectToWebSocket(symbols, io);
}

// Legacy function for backward compatibility
function unsubscribeFromTickerStream(symbols, io) {
    console.log(`Legacy unsubscribeFromTickerStream called for symbols: ${symbols ? symbols.join(', ') : 'all'}`);
    
    // Just close the current WebSocket connection
    if (wsInstance) {
        cleanupWebSocket(wsInstance);
        wsInstance = null;
        
        // Notify clients
        if (io) {
            io.emit('websocket-status', { connected: false, symbols: wsState.activeSymbols });
        }
        
        // Reset state
        wsState.isConnected = false;
        wsState.activeSymbols = [];
        
        return true;
    }
    
    return false;
}
 */



export default {
    initializeWebSockets,
    closeAllConnections,
    getWebSocketStatus,
    testConnection,
    getAccountInfo,
    getTickerPrice,
    getMultipleTickers,
    calculateQuantityFromUsdt,
    createMarketBuyOrder,
    createMarketSellOrder,
//    subscribeToTickerStream,
//    unsubscribeFromTickerStream,
//    executeBuyOrder,
//    executeSellOrder,

//    renewWebSocketConnection
};