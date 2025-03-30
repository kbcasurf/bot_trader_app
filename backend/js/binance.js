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




// and ensure it always rounds DOWN to the nearest step size
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




// it properly formats the quantity before sending to Binance
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


// Subscribe to ticker stream using native WebSocket
function subscribeToTickerStream(symbols, io) {
    const symbolsKey = symbols.join('-');
    
    // Check if we already have an active connection for these symbols
    if (!socketConnections[symbolsKey]) {
        // For testnet, use the correct subscription method
        const socketUrl = WS_BASE_URL;
        
        console.log(`Connecting to Binance WebSocket: ${socketUrl}`);
        
        // Create WebSocket connection
        const ws = new WebSocket(socketUrl);
        
        // Initialize status properties
        ws.isAlive = true;
        ws.symbolsKey = symbolsKey;
        
        ws.on('open', () => {
            console.log(`WebSocket connection opened for ${symbols.join(', ')}`);
            ws.isAlive = true;
            
            // Important: Send a subscribe message for all symbols
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
                symbols 
            });
        });
        


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
                
                // Handle the various Binance message formats
                // Rest of your message handling code...
            } catch (error) {
                console.error('Error handling WebSocket message:', error.message);
            }
        });
        


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

        
        
        ws.on('close', (code, reason) => {
            console.log(`WebSocket closed for ${symbols.join(', ')}. Code: ${code}, Reason: ${reason}`);
            ws.isAlive = false;
            
            io.emit('websocket-status', { connected: false, symbols });
            
            // Attempt to reconnect with exponential backoff
            handleReconnect(ws, symbols, io);
        });
        
        // Initialize ping timer ID
        ws.pingTimerId = null;
        
        // Start ping-pong for connection health check
        startPingPong(ws);
        
        // Store connection reference
        socketConnections[symbolsKey] = ws;
    }
    
    return socketConnections[symbolsKey];
}

// Start ping-pong mechanism to keep connection alive
function startPingPong(ws) {
    // Clear any existing timer
    if (ws.pingTimerId) {
        clearInterval(ws.pingTimerId);
    }
    
    // Set up ping interval
    ws.pingTimerId = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) {
            clearInterval(ws.pingTimerId);
            return;
        }
        
        // Binance testnet requires a ping message to keep the connection alive
        // Send a ping message as a proper JSON payload
        try {
            ws.send(JSON.stringify({ method: "ping" }));
            console.log("Sent ping to Binance WebSocket");
            
            // Set a timeout to check for pong response
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    // If still connected, connection is healthy
                    console.log("WebSocket connection is healthy");
                }
            }, 5000);
        } catch (error) {
            console.error("Error sending ping:", error);
            ws.terminate();
        }
    }, 20000); // Send a ping every 20 seconds
}

// Handle reconnection with exponential backoff
function handleReconnect(ws, symbols, io) {
    const symbolsKey = ws.symbolsKey;
    
    // Don't reconnect if we've exceeded max attempts or connection is open
    if (ws.reconnectAttempts >= ws.maxReconnectAttempts || 
        (ws.readyState !== undefined && ws.readyState === WebSocket.OPEN)) {
        return;
    }
    
    // Calculate delay with exponential backoff
    const delay = Math.min(
        ws.reconnectDelay * Math.pow(1.5, ws.reconnectAttempts),
        ws.maxReconnectDelay
    );
    
    console.log(`Will attempt to reconnect in ${delay}ms (attempt ${ws.reconnectAttempts + 1}/${ws.maxReconnectAttempts})`);
    
    // Schedule reconnection
    setTimeout(() => {
        console.log(`Attempting to reconnect WebSocket for ${symbols.join(', ')}`);
        
        // Remove the old connection before attempting to reconnect
        if (socketConnections[symbolsKey]) {
            delete socketConnections[symbolsKey];
        }
        
        // Increment reconnect attempts counter
        ws.reconnectAttempts++;
        
        // Verify API connectivity before reconnecting WebSocket
        testConnection().then(connected => {
            if (connected) {
                // Create a new connection
                subscribeToTickerStream(symbols, io);
            } else {
                console.log('Binance API not available, delaying WebSocket reconnection');
                // Try again later with a longer delay
                setTimeout(() => {
                    handleReconnect(ws, symbols, io);
                }, ws.reconnectDelay * 2);
            }
        }).catch(err => {
            console.error('Error testing connection:', err);
            // Try again later with a longer delay
            setTimeout(() => {
                handleReconnect(ws, symbols, io);
            }, ws.reconnectDelay * 2);
        });
    }, delay);
}

// Unsubscribe from ticker stream
function unsubscribeFromTickerStream(symbols, io) {
    const key = symbols.join('-');
    const connection = socketConnections[key];
    
    if (connection) {
        // Clear ping timer if it exists
        if (connection.pingTimerId) {
            clearInterval(connection.pingTimerId);
        }
        
        // Close the WebSocket connection
        connection.close();
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

/**
 * Close all active WebSocket connections
 * @returns {Promise<boolean>} True if all connections were closed successfully
 */
async function closeAllConnections() {
    console.log(`Closing all WebSocket connections: ${Object.keys(socketConnections).length} active connections`);
    
    // Make a copy of the keys to avoid modification during iteration
    const connectionKeys = Object.keys(socketConnections);
    
    for (const key of connectionKeys) {
        try {
            console.log(`Closing WebSocket connection for ${key}`);
            const connection = socketConnections[key];
            
            if (connection && connection.readyState !== undefined) {
                // If it's a standard WebSocket
                if (connection.readyState === WebSocket.OPEN) {
                    connection.close(1000, "Server shutting down");
                }
            } else if (connection && connection.terminate) {
                // If it's a ws library WebSocket
                connection.terminate();
            } else if (connection && connection.close) {
                // Generic close method
                connection.close();
            }
            
            // Delete the connection reference
            delete socketConnections[key];
        } catch (error) {
            console.error(`Error closing WebSocket for ${key}:`, error);
        }
    }
    
    // Clear any ping intervals that might be running
    Object.values(socketConnections).forEach(conn => {
        if (conn && conn.pingTimerId) {
            clearInterval(conn.pingTimerId);
        }
    });
    
    return true;
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

// Execute a sell order based on USDT value
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
    
    // Subscribe to ticker streams
    return subscribeToTickerStream(symbols, io);
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
    closeAllConnections
};