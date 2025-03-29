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

// Function to subscribe to ticker stream for multiple symbols using Socket.io to forward data
function subscribeToTickerStream(symbols, callback) {
    const symbolsKey = symbols.join('-');
    
    // Use Socket.io client to connect to Binance WebSocket
    if (!socketConnections[symbolsKey]) {
        // Format symbols for stream
        const streams = symbols.map(symbol => `${symbol.toLowerCase()}@bookTicker`).join('/');
        const socketUrl = `${WS_BASE_URL}/stream?streams=${streams}`;
        
        console.log(`Attempting to connect to Binance WebSocket for ${symbols.join(', ')}`);
        
        // We'll use a custom implementation with Socket.io client to connect to Binance WebSocket
        // and then forward the data to our Socket.io server
        const socket = io(socketUrl, {
            transports: ['websocket'],
            forceNew: true,
            reconnection: true,
            reconnectionDelay: 5000,
            reconnectionAttempts: 10
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
                const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                if (parsedData.data) {
                    // If callback is a Socket.io socket, emit the data
                    if (typeof callback === 'object' && callback.emit) {
                        callback.emit('price-update', parsedData.data);
                    } 
                    // If callback is a function, call it with the data
                    else if (typeof callback === 'function') {
                        callback(parsedData.data);
                    }
                }
            } catch (error) {
                console.error('Error handling WebSocket message:', error);
            }
        });
        
        socket.on('error', (error) => {
            console.error('Socket.io client error:', error);
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: false, error: error.message, symbols });
            }
        });
        
        socket.on('disconnect', (reason) => {
            console.log(`Socket.io client disconnected from Binance WebSocket for ${symbols.join(', ')}. Reason: ${reason}`);
            
            if (typeof callback === 'object' && callback.emit) {
                callback.emit('websocket-status', { connected: false, symbols });
            }
            
            // Attempt to reconnect immediately, then on increasing delay if it continues to fail
            const attemptReconnect = () => {
                console.log(`Attempting to reconnect to Binance WebSocket for ${symbols.join(', ')}`);
                
                // Remove the old connection before attempting to reconnect
                if (socketConnections[symbolsKey]) {
                    delete socketConnections[symbolsKey];
                }
                
                // Create a new connection
                const newSocket = subscribeToTickerStream(symbols, callback);
                socketConnections[symbolsKey] = newSocket;
            };
            
            // Attempt to reconnect after a delay
            setTimeout(attemptReconnect, 5000);
        });
        
        // Store connection reference
        socketConnections[symbolsKey] = socket;
    }
    
    return socketConnections[symbolsKey];
}

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