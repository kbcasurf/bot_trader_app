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
            `${BASE_URL}/v3/account?${queryString}&signature=${signature}`,
            {
                headers: {
                    'X-MBX-APIKEY': API_KEY
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error('Failed to get account info:', error.message);
        throw error;
    }
}

// Get current ticker price for a symbol
async function getTickerPrice(symbol) {
    try {
        const response = await axios.get(`${BASE_URL}/v3/ticker/price`, {
            params: { symbol }
        });
        
        return response.data;
    } catch (error) {
        console.error(`Failed to get ticker price for ${symbol}:`, error.message);
        throw error;
    }
}

// Create a market buy order
async function createMarketBuyOrder(symbol, quantity) {
    try {
        const timestamp = Date.now();
        const queryString = `symbol=${symbol}&side=BUY&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
        const signature = generateSignature(queryString);
        
        const response = await axios.post(
            `${BASE_URL}/v3/order?${queryString}&signature=${signature}`,
            null, // No request body for GET-like POST
            {
                headers: {
                    'X-MBX-APIKEY': API_KEY
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error(`Failed to create market buy order for ${symbol}:`, error.message);
        throw error;
    }
}

// Create a market sell order
async function createMarketSellOrder(symbol, quantity) {
    try {
        const timestamp = Date.now();
        const queryString = `symbol=${symbol}&side=SELL&type=MARKET&quantity=${quantity}&timestamp=${timestamp}`;
        const signature = generateSignature(queryString);
        
        const response = await axios.post(
            `${BASE_URL}/v3/order?${queryString}&signature=${signature}`,
            null, // No request body for GET-like POST
            {
                headers: {
                    'X-MBX-APIKEY': API_KEY
                }
            }
        );
        
        return response.data;
    } catch (error) {
        console.error(`Failed to create market sell order for ${symbol}:`, error.message);
        throw error;
    }
}

// Handle setting up a connection to Binance WebSocket using Socket.io server
function setupBinanceSocketServer(server) {
    // Create a Socket.io namespace for Binance streams
    const binanceNsp = server.of('/binance');

    binanceNsp.on('connection', (socket) => {
        console.log('Client connected to Binance namespace');

        // Handle subscription requests
        socket.on('subscribe', (data) => {
            const { symbols } = data;
            if (symbols && symbols.length > 0) {
                subscribeToTickerStream(symbols, socket);
            }
        });

        // Handle unsubscribe requests
        socket.on('unsubscribe', (data) => {
            const { symbols } = data;
            if (symbols && symbols.length > 0) {
                unsubscribeFromTickerStream(symbols, socket);
            }
        });

        // Clean up on disconnect
        socket.on('disconnect', () => {
            console.log('Client disconnected from Binance namespace');
            // Clean up any socket-specific resources
        });
    });

    return binanceNsp;
}

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
        
        // Now try to set up WebSocket for real-time updates
        const handleUpdate = (data) => {
            console.log('WebSocket update received:', data);
        };
        
        subscribeToTickerStream(symbols, handleUpdate);
        
        return { 
            success: true, 
            prices,
            message: 'Manual connection established and WebSocket initiated'
        };
    } catch (err) {
        console.error('Manual connection error:', err);
        return { success: false, error: err.message };
    }
}

// Subscribe to ticker stream using native WebSocket
function subscribeToTickerStream(symbols, callback) {
    const symbolsKey = symbols.join('-');
    
    // Check if we already have an active connection for these symbols
    if (!socketConnections[symbolsKey]) {
        // Format symbols for stream - use ticker instead of bookTicker for more reliable price updates
        const streams = symbols.map(symbol => `${symbol.toLowerCase()}@ticker`).join('/');
        const socketUrl = `${WS_BASE_URL}/stream?streams=${streams}`;
        
        console.log(`Connecting to Binance WebSocket: ${socketUrl}`);
        
        // Create native WebSocket connection
        const ws = new WebSocket(socketUrl);

        // Initialize status properties
        ws.isAlive = true;
        ws.symbolsKey = symbolsKey;
        ws.reconnectAttempts = 0;
        ws.maxReconnectAttempts = 10;
        ws.reconnectDelay = 5000; // Start with 5 seconds
        ws.maxReconnectDelay = 60000; // Max delay of 1 minute
        
        ws.on('open', () => {
            console.log(`WebSocket connection opened for ${symbols.join(', ')}`);
            ws.isAlive = true;
            ws.reconnectAttempts = 0;
            
            // Emit connection status if callback is a Socket.io socket
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { 
                    connected: true, 
                    symbols 
                });
            }
            
            // Start ping-pong for connection health check
            startPingPong(ws);
        });
        
        ws.on('message', (data) => {
            try {
                // Log the raw message for debugging
                if (data) {
                    console.log('Raw WebSocket message received:', 
                        data.toString().substring(0, 100) + '...');
                }
                
                // Parse data
                const parsedData = JSON.parse(data.toString());
                
                // Simple logging of the structure
                console.log('Message structure:', Object.keys(parsedData));
                
                // Extract price data
                let symbol, price;
                
                // Handle different Binance WebSocket data formats
                if (parsedData.data) {
                    // Format: { data: { s: "BTCUSDT", ... } }
                    if (parsedData.data.s) {
                        symbol = parsedData.data.s;
                        // For ticker format
                        price = parsedData.data.c || parsedData.data.a || parsedData.data.b;
                    } else if (parsedData.data.symbol) {
                        symbol = parsedData.data.symbol;
                        price = parsedData.data.price || parsedData.data.close || parsedData.data.lastPrice;
                    }
                } else if (parsedData.s) {
                    // Format: { s: "BTCUSDT", ... }
                    symbol = parsedData.s;
                    // For ticker format
                    price = parsedData.a || parsedData.b || parsedData.c || parsedData.p;
                } else if (parsedData.stream && parsedData.data) {
                    // Format: { stream: "...", data: { ... } }
                    if (parsedData.data.s) {
                        symbol = parsedData.data.s;
                        // For ticker format
                        price = parsedData.data.c || parsedData.data.a || parsedData.data.b;
                    } else if (parsedData.data.symbol) {
                        symbol = parsedData.data.symbol;
                        price = parsedData.data.price || parsedData.data.close || parsedData.data.lastPrice;
                    }
                }
                
                // If we couldn't extract the necessary data, log and return
                if (!symbol || !price) {
                    console.warn('Could not extract symbol or price from message:', parsedData);
                    return;
                }
                
                console.log(`Successfully extracted data - Symbol: ${symbol}, Price: ${price}`);
                
                // Create a simplified data object for our app
                const simplifiedData = {
                    symbol: symbol,
                    price: price
                };
                
                // Forward the data to the callback
                if (typeof callback === 'object' && callback.emit) {
                    callback.emit('price-update', simplifiedData);
                } else if (typeof callback === 'function') {
                    callback(simplifiedData);
                }
            } catch (error) {
                console.error('Error handling WebSocket message:', error.message);
                if (typeof data === 'string') {
                    console.error('Raw data (first 200 chars):', data.substring(0, 200));
                } else if (data) {
                    console.error('Raw data (Buffer):', data.toString().substring(0, 200));
                }
            }
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error.message);
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { 
                    connected: false, 
                    error: error.message, 
                    symbols 
                });
            }
        });
        
        ws.on('close', (code, reason) => {
            console.log(`WebSocket closed for ${symbols.join(', ')}. Code: ${code}, Reason: ${reason}`);
            ws.isAlive = false;
            
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: false, symbols });
            }
            
            // Attempt to reconnect with exponential backoff
            handleReconnect(ws, symbols, callback);
        });
        
        // Initialize ping timer ID
        ws.pingTimerId = null;
        
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
        if (ws.isAlive === false) {
            clearInterval(ws.pingTimerId);
            ws.terminate();
            return;
        }
        
        ws.isAlive = false;
        // For Binance WebSocket, we can't send actual ping frames
        // Instead we send a simple message that should get a response
        // but since Binance doesn't support pings directly, we check for timeouts
        setTimeout(() => {
            if (ws.isAlive === false && ws.readyState === WebSocket.OPEN) {
                console.log('WebSocket connection timed out. Reconnecting...');
                ws.terminate();
            }
        }, 15000); // Wait 15s for activity before assuming connection is dead
    }, 30000); // Check every 30s
}

// Handle reconnection with exponential backoff
function handleReconnect(ws, symbols, callback) {
    const symbolsKey = ws.symbolsKey;
    
    // Don't reconnect if we've exceeded max attempts or connection is open
    if (ws.reconnectAttempts >= ws.maxReconnectAttempts || ws.readyState === WebSocket.OPEN) {
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
        
        // Create a new connection
        subscribeToTickerStream(symbols, callback);
    }, delay);
}

// Unsubscribe from ticker stream
function unsubscribeFromTickerStream(symbols, socket) {
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
        
        // Emit status update if socket is provided
        if (socket && typeof socket.emit === 'function') {
            socket.emit('websocket-status', { connected: false, symbols });
        }
    }
}

module.exports = {
    testConnection,
    getAccountInfo,
    getTickerPrice,
    createMarketBuyOrder,
    createMarketSellOrder,
    setupBinanceSocketServer,
    subscribeToTickerStream,
    unsubscribeFromTickerStream,
    manualConnectAndGetPrices
};