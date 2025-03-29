const axios = require('axios');
const crypto = require('crypto');
const dotenv = require('dotenv');
const { io } = require('socket.io-client');

// Load environment variables
dotenv.config({ path: '/app/.env' });

// Binance API credentials
const API_KEY = process.env.BINANCE_API_KEY;
const API_SECRET = process.env.BINANCE_API_SECRET;

// Binance API base URLs
const BASE_URL = process.env.BINANCE_API_URL;
const WS_BASE_URL = process.env.BINANCE_WEBSOCKET_URL;

// Socket.io connections
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




// Subscribe to ticker stream for multiple symbols using Socket.io to forward data
function subscribeToTickerStream(symbols, callback) {
    const symbolsKey = symbols.join('-');
    
    // Use Socket.io client to connect to Binance WebSocket
    if (!socketConnections[symbolsKey]) {
        // Format symbols for stream
        const streams = symbols.map(symbol => `${symbol.toLowerCase()}@bookTicker`).join('/');
        const socketUrl = `${WS_BASE_URL}/stream?streams=${streams}`;
        
        console.log(`Connecting to Binance WebSocket: ${socketUrl}`);
        
        // We'll use a custom implementation with Socket.io client to connect to Binance WebSocket
        // and then forward the data to our Socket.io server
        const socket = io.connect(socketUrl, {
            transports: ['websocket'],
            forceNew: true
        });
        
        socket.on('connect', () => {
            console.log(`Socket.io client connected to Binance WebSocket for ${symbols.join(', ')}`);
            // Emit a 'websocket-status' event when connected
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: true, symbols });
            }
        });
        



        socket.on('message', (data) => {
            try {
                // Log the raw message for debugging
                console.log('Raw WebSocket message received:', 
                    typeof data === 'string' ? data.substring(0, 100) + '...' : 'non-string data');
                
                // Parse data if it's a string
                let parsedData = data;
                if (typeof data === 'string') {
                    parsedData = JSON.parse(data);
                }
                
                // Simple logging of the structure
                console.log('Message structure:', Object.keys(parsedData));
                
                // Extract price data - Binance typically uses one of these structures
                let symbol, price;
                
                // Handle different Binance WebSocket data formats
                if (parsedData.data) {
                    // Format: { data: { s: "BTCUSDT", ... } }
                    symbol = parsedData.data.s || parsedData.data.symbol;
                    price = parsedData.data.c || parsedData.data.p || parsedData.data.price || parsedData.data.lastPrice;
                } else if (parsedData.s) {
                    // Format: { s: "BTCUSDT", ... }
                    symbol = parsedData.s;
                    price = parsedData.c || parsedData.p || parsedData.lastPrice;
                } else if (parsedData.stream && parsedData.data) {
                    // Format: { stream: "...", data: { ... } }
                    symbol = parsedData.data.s || parsedData.data.symbol;
                    price = parsedData.data.c || parsedData.data.p || parsedData.data.price;
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
                }
            }
        });
    }   
}




        socket.on('error', (error) => {
            console.error('Binance WebSocket error:', error.message);
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { 
                    connected: false, 
                    error: error.message, 
                    symbols 
                });
            }
        });

        
        socket.on('disconnect', (reason) => {
            console.log(`Binance WebSocket disconnected for ${symbols.join(', ')}. Reason: ${reason}`);
            
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: false, symbols });
            }
            
            // Set a reconnection timeout that increases with each attempt
            let reconnectDelay = 5000; // Start with 5 seconds
            const maxReconnectDelay = 60000; // Max delay of 1 minute
            
            const attemptReconnect = () => {
                console.log(`Attempting to reconnect to Binance WebSocket for ${symbols.join(', ')}`);
                
                // Remove the old connection before attempting to reconnect
                if (socketConnections[symbolsKey]) {
                    delete socketConnections[symbolsKey];
                }
                
                // Create a new connection
                subscribeToTickerStream(symbols, callback);
                
                // Increase the delay for next attempt (with a maximum)
                reconnectDelay = Math.min(reconnectDelay * 1.5, maxReconnectDelay);
            };
            
            setTimeout(attemptReconnect, reconnectDelay);
        });




// Unsubscribe from ticker stream
function unsubscribeFromTickerStream(symbols, socket) {
    const key = symbols.join('-');
    const connection = socketConnections[key];
    
    if (connection) {
        connection.disconnect();
        delete socketConnections[key];
        console.log(`Unsubscribed from ticker stream for ${symbols.join(', ')}`);
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
    unsubscribeFromTickerStream
};