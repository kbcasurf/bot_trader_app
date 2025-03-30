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

// WebSocket connections
const socketConnections = {};

// Connection lifecycle and status tracking
const connectionStatus = {
    reconnectAttempt: 0,
    maxReconnectAttempts: 5,
    reconnectDelay: 5000,
    maxReconnectDelay: 30000,
    lastSuccessfulConnection: 0,
    connectionLifetime: 23 * 60 * 60 * 1000, // 23 hours (1 hour less than Binance's 24h limit)
    pollingActive: false,
    pollingIntervalId: null,
    connectionRenewalTimeout: null
};

// Test Binance API connection
async function testConnection() {
    try {
        const response = await axios.get(`${BASE_URL}/api/v3/ping`);
        return response.status === 200;
    } catch (error) {
        console.error('Binance API connection test failed:', error.message);
        throw error;
    }
}

// Generate signature for signed endpoints
function generateSignature(queryString) {
    return crypto
        .createHmac('sha256', API_SECRET)
        .update(queryString)
        .digest('hex');
}

// Get account information
async function getAccountInfo() {
    try {
        const timestamp = Date.now();
        const queryString = `timestamp=${timestamp}`;
        const signature = generateSignature(queryString);
        
        const response = await axios.get(
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

// Get current ticker price for a symbol
async function getTickerPrice(symbol) {
    try {
        const response = await axios.get(`${BASE_URL}/api/v3/ticker/price`, {
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
        const response = await axios.get(`${BASE_URL}/api/v3/ticker/price`);
        
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
        const response = await axios.get(`${BASE_URL}/api/v3/exchangeInfo`, {
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

// Start fallback polling mechanism for price updates
function startPolling(symbols, io) {
    // Don't start if already polling
    if (connectionStatus.pollingActive) {
        return;
    }
    
    console.log('Starting price polling as WebSocket fallback');
    connectionStatus.pollingActive = true;
    
    // Clear any existing polling interval
    if (connectionStatus.pollingIntervalId) {
        clearInterval(connectionStatus.pollingIntervalId);
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
    
    // Set up interval for regular polling (every 10 seconds)
    connectionStatus.pollingIntervalId = setInterval(fetchAndEmitPrices, 10000);
    
    // Notify clients that we're in polling mode
    io.emit('websocket-status', { 
        connected: false, 
        pollingActive: true,
        message: 'Using REST API polling due to WebSocket disconnection'
    });
}

// Stop polling mechanism
function stopPolling() {
    if (!connectionStatus.pollingActive) {
        return;
    }
    
    console.log('Stopping price polling');
    
    // Clear polling interval
    if (connectionStatus.pollingIntervalId) {
        clearInterval(connectionStatus.pollingIntervalId);
        connectionStatus.pollingIntervalId = null;
    }
    
    connectionStatus.pollingActive = false;
}

// Subscribe to ticker stream using WebSocket
function subscribeToTickerStream(symbols, io) {
    const symbolsKey = symbols.join('-');
    
    // Check if we already have an active connection for these symbols
    if (socketConnections[symbolsKey]) {
        console.log(`Already have an active connection for ${symbols.join(', ')}`);
        return socketConnections[symbolsKey];
    }
    
    // For testnet, use the correct subscription method
    const socketUrl = WS_BASE_URL;
    
    console.log(`Connecting to Binance WebSocket: ${socketUrl}`);
    
    // Create WebSocket connection
    const ws = new WebSocket(socketUrl);
    
    // Initialize connection properties
    ws.symbolsKey = symbolsKey;
    ws.symbols = symbols;
    ws.isAlive = true;
    ws.reconnectAttempt = connectionStatus.reconnectAttempt;
    ws.connectionStartTime = Date.now();
    
    // Connection opened handler
    ws.on('open', () => {
        console.log(`WebSocket connection opened for ${symbols.join(', ')}`);
        ws.isAlive = true;
        connectionStatus.reconnectAttempt = 0;
        connectionStatus.lastSuccessfulConnection = Date.now();
        
        // Subscribe to all symbols
        const subscribeMsg = {
            method: "SUBSCRIBE",
            params: symbols.map(symbol => `${symbol.toLowerCase()}@ticker`),
            id: Date.now()
        };
        
        ws.send(JSON.stringify(subscribeMsg));
        console.log("Sent subscription request:", subscribeMsg);
        
        // Emit connection status
        io.emit('websocket-status', { 
            connected: true, 
            symbols,
            pollingActive: connectionStatus.pollingActive
        });
        
        // Update trading status
        io.emit('trading-status', { active: true });
        
        // Stop polling if active as we now have WebSocket
        stopPolling();
        
        // Set up connection renewal timeout (23 hours)
        setupConnectionRenewal(symbols, io);
    });
    
    // Message handler
    ws.on('message', (data) => {
        try {
            // Parse the data
            const parsedData = JSON.parse(data.toString());
            
            // Check if this is a pong response
            if (parsedData.result === null && parsedData.id !== undefined) {
                console.log("Received pong response from Binance");
                ws.isAlive = true;
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
                    console.log(`Ticker update for ${symbol}: ${price}`);
                }
            } else {
                // Log other message types (truncated to avoid huge logs)
                console.log(`Received WebSocket message: ${JSON.stringify(parsedData).substring(0, 100)}...`);
            }
        } catch (error) {
            console.error('Error handling WebSocket message:', error.message);
        }
    });
    
    // Error handler
    ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
        io.emit('websocket-status', { 
            connected: false, 
            error: error.message, 
            symbols 
        });
        
        // Try to recover the connection
        setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
                handleReconnect(ws, symbols, io);
            }
        }, 2000);
    });
    
    // Close handler
    ws.on('close', (code, reason) => {
        console.log(`WebSocket closed for ${symbols.join(', ')}. Code: ${code}, Reason: ${reason}`);
        
        // Update WebSocket status
        io.emit('websocket-status', { 
            connected: false, 
            symbols 
        });
        
        // Start polling as fallback
        startPolling(symbols, io);
        
        // Clear connection renewal timeout if it exists
        if (connectionStatus.connectionRenewalTimeout) {
            clearTimeout(connectionStatus.connectionRenewalTimeout);
            connectionStatus.connectionRenewalTimeout = null;
        }
        
        // Attempt to reconnect
        handleReconnect(ws, symbols, io);
    });
    
    // Start health check for connection
    startHealthCheck(ws, symbols, io);
    
    // Store connection reference
    socketConnections[symbolsKey] = ws;
    
    return ws;
}

// Setup connection renewal timer
function setupConnectionRenewal(symbols, io) {
    // Clear any existing timeout
    if (connectionStatus.connectionRenewalTimeout) {
        clearTimeout(connectionStatus.connectionRenewalTimeout);
    }
    
    // Set timeout to renew connection after 23 hours
    connectionStatus.connectionRenewalTimeout = setTimeout(() => {
        console.log(`Connection lifetime (23 hours) reached, performing planned renewal`);
        
        // Get the connection
        const symbolsKey = symbols.join('-');
        const connection = socketConnections[symbolsKey];
        
        if (connection) {
            // Notify clients
            io.emit('websocket-status', { 
                connected: true, 
                renewing: true,
                message: 'Performing scheduled 24h connection renewal',
                symbols 
            });
            
            // Start polling before closing connection
            startPolling(symbols, io);
            
            // Reset reconnect attempt counter for clean reconnection
            connectionStatus.reconnectAttempt = 0;
            
            // Close connection (will trigger reconnect)
            connection.close(1000, "Planned connection renewal");
        } else {
            console.warn(`Cannot find connection for renewal: ${symbolsKey}`);
        }
    }, connectionStatus.connectionLifetime);
    
    console.log(`Scheduled connection renewal in ${connectionStatus.connectionLifetime / 1000 / 60 / 60} hours`);
}

// Start health check for WebSocket connection
function startHealthCheck(ws, symbols, io) {
    // Clear any existing interval
    if (ws.healthCheckIntervalId) {
        clearInterval(ws.healthCheckIntervalId);
    }
    
    // Set up health check interval (every 30 seconds)
    ws.healthCheckIntervalId = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            console.log('Health check: WebSocket not open, clearing interval');
            clearInterval(ws.healthCheckIntervalId);
            return;
        }
        
        // Mark as not alive until we get a response
        ws.isAlive = false;
        
        try {
            // Send a proper Binance request that will get a response
            ws.send(JSON.stringify({
                method: "LIST_SUBSCRIPTIONS",
                id: Date.now()
            }));
            
            // Also use standard WebSocket ping
            ws.ping();
            
            // Schedule check for response
            setTimeout(() => {
                if (!ws.isAlive) {
                    console.warn('No response received to health check, connection may be dead');
                    ws.terminate();
                }
            }, 5000);
        } catch (error) {
            console.error('Error sending health check:', error.message);
            ws.terminate();
        }
    }, 30000);
}

// Handle reconnection with exponential backoff
function handleReconnect(ws, symbols, io) {
    const symbolsKey = symbols.join('-');
    
    // Increment reconnect attempt counter
    connectionStatus.reconnectAttempt++;
    
    // Don't reconnect if we've exceeded max attempts
    if (connectionStatus.reconnectAttempt > connectionStatus.maxReconnectAttempts) {
        console.error(`Max reconnect attempts (${connectionStatus.maxReconnectAttempts}) reached`);
        
        // Ensure polling is active as a fallback
        startPolling(symbols, io);
        
        // After a longer delay, reset reconnect counter and try again
        setTimeout(() => {
            console.log('Resetting reconnect attempt counter after cooldown period');
            connectionStatus.reconnectAttempt = 0;
            
            // Clean up old connection reference
            delete socketConnections[symbolsKey];
            
            // Try to reconnect
            subscribeToTickerStream(symbols, io);
        }, 5 * 60 * 1000); // 5 minutes
        
        return;
    }
    
    // Calculate exponential backoff delay
    const delay = Math.min(
        connectionStatus.reconnectDelay * Math.pow(1.5, connectionStatus.reconnectAttempt - 1),
        connectionStatus.maxReconnectDelay
    );
    
    console.log(`Will attempt to reconnect in ${delay}ms (attempt ${connectionStatus.reconnectAttempt}/${connectionStatus.maxReconnectAttempts})`);
    
    // Notify clients about reconnection attempt
    io.emit('websocket-status', {
        connected: false,
        reconnecting: true,
        attempt: connectionStatus.reconnectAttempt,
        maxAttempts: connectionStatus.maxReconnectAttempts,
        symbols
    });
    
    // Schedule reconnection
    setTimeout(() => {
        console.log(`Attempting to reconnect WebSocket for ${symbols.join(', ')}`);
        
        // Remove the old connection before attempting to reconnect
        delete socketConnections[symbolsKey];
        
        // Create a new connection
        subscribeToTickerStream(symbols, io);
    }, delay);
}

// Unsubscribe from ticker stream
function unsubscribeFromTickerStream(symbols, io) {
    const key = symbols.join('-');
    const connection = socketConnections[key];
    
    if (connection) {
        // Clear health check interval if it exists
        if (connection.healthCheckIntervalId) {
            clearInterval(connection.healthCheckIntervalId);
        }
        
        // Close the WebSocket connection
        connection.close(1000, "Unsubscribed");
        delete socketConnections[key];
        console.log(`Unsubscribed from ticker stream for ${symbols.join(', ')}`);
        
        // Emit status update
        if (io) {
            io.emit('websocket-status', { connected: false, symbols });
        }
        return true;
    } else {
        console.log(`No active connection found for ${symbols.join(', ')}`);
        return false;
    }
}

// Manually connect and get prices
async function manualConnectAndGetPrices(symbols) {
    try {
        console.log(`Manually connecting to Binance for symbols: ${symbols.join(', ')}`);
        
        // First test connectivity
        const connected = await testConnection();
        if (!connected) {
            console.error('Could not connect to Binance API.');
            return { success: false, error: 'API connection failed' };
        }
        
        // Get current prices from REST API
        const prices = {};
        for (const symbol of symbols) {
            try {
                const data = await getTickerPrice(symbol);
                prices[symbol] = data.price;
                console.log(`Got price for ${symbol}: ${data.price}`);
            } catch (err) {
                console.error(`Error getting price for ${symbol}:`, err.message);
            }
        }
        
        return { 
            success: true, 
            prices,
            message: 'Manual connection established successfully'
        };
    } catch (err) {
        console.error('Manual connection error:', err);
        return { success: false, error: err.message };
    }
}

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

// Initialize WebSocket connections for the configured symbols
function initializeWebSockets(io) {
    // List of symbols to track
    const symbols = ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'NEARUSDT', 'PENDLEUSDT'];
    
    console.log(`Initializing WebSocket connections for ${symbols.join(', ')}`);
    
    // Reset reconnect attempt counter
    connectionStatus.reconnectAttempt = 0;
    
    // Subscribe to ticker streams
    return subscribeToTickerStream(symbols, io);
}

// Close all active WebSocket connections
async function closeAllConnections() {
    console.log(`Closing all WebSocket connections: ${Object.keys(socketConnections).length} active connections`);
    
    // Stop polling if active
    stopPolling();
    
    // Clear connection renewal timeout if active
    if (connectionStatus.connectionRenewalTimeout) {
        clearTimeout(connectionStatus.connectionRenewalTimeout);
        connectionStatus.connectionRenewalTimeout = null;
    }
    
    // Make a copy of the keys to avoid modification during iteration
    const connectionKeys = Object.keys(socketConnections);
    
    for (const key of connectionKeys) {
        try {
            console.log(`Closing WebSocket connection for ${key}`);
            const connection = socketConnections[key];
            
            // Clear any intervals
            if (connection.healthCheckIntervalId) {
                clearInterval(connection.healthCheckIntervalId);
            }
            
            // Close the connection
            if (connection && connection.readyState === WebSocket.OPEN) {
                connection.close(1000, "Server shutting down");
            } else if (connection && connection.terminate) {
                connection.terminate();
            }
            
            // Delete the connection reference
            delete socketConnections[key];
        } catch (error) {
            console.error(`Error closing WebSocket for ${key}:`, error);
        }
    }
    
    return true;
}

// Get WebSocket connection status
function getWebSocketStatus() {
    // Create a status report for all connections
    const status = {
        connections: {},
        totalConnections: Object.keys(socketConnections).length,
        reconnectAttempt: connectionStatus.reconnectAttempt,
        pollingActive: connectionStatus.pollingActive,
        connectionAge: 0
    };
    
    // Add details for each connection
    for (const [key, connection] of Object.entries(socketConnections)) {
        const connectionAge = connection.connectionStartTime ? 
            Math.round((Date.now() - connection.connectionStartTime) / 1000 / 60 / 60) : 0;
            
        status.connections[key] = {
            isOpen: connection.readyState === WebSocket.OPEN,
            connectionAge: connectionAge,
            symbols: connection.symbols || []
        };
        
        // Track the oldest connection for renewal decisions
        if (connectionAge > status.connectionAge) {
            status.connectionAge = connectionAge;
        }
    }
    
    return status;
}

// Renew a specific WebSocket connection manually
function renewWebSocketConnection(symbols, io) {
    const symbolsKey = Array.isArray(symbols) ? symbols.join('-') : symbols;
    const connection = socketConnections[symbolsKey];
    
    if (!connection) {
        console.log(`No connection found for ${symbolsKey}`);
        return false;
    }
    
    console.log(`Manually renewing WebSocket connection for ${symbolsKey}`);
    
    // Start polling as fallback during renewal
    startPolling(connection.symbols || symbols, io);
    
    // Reset reconnect attempt counter
    connectionStatus.reconnectAttempt = 0;
    
    // Close the connection (will trigger reconnect)
    connection.close(1000, "Manual renewal requested");
    
    return true;
}

module.exports = {
    testConnection,
    getAccountInfo,
    getTickerPrice,
    getMultipleTickers,
    calculateQuantityFromUsdt,
    createMarketBuyOrder,
    createMarketSellOrder,
    subscribeToTickerStream,
    unsubscribeFromTickerStream,
    manualConnectAndGetPrices,
    executeBuyOrder,
    executeSellOrder,
    initializeWebSockets,
    closeAllConnections,
    getWebSocketStatus,
    renewWebSocketConnection
};