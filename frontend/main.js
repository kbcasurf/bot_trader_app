import { io } from 'socket.io-client';

document.addEventListener('DOMContentLoaded', () => {
    // Log all available price elements as a sanity check
    console.log('Available price elements on DOM load:', 
        Array.from(document.querySelectorAll('[id$="-price"]')).map(el => el.id));
    
    // Initialize your components after DOM is ready
    initializeComponents();
});

// Create socket with proper backend URL
export const socket = io({
    // Note: No need to specify the URL as Vite will proxy the requests
    // The proxy is set up in vite.config.js
    transports: ['polling', 'websocket'],
    reconnectionAttempts: 5,
    timeout: 20000,
    forceNew: true
});

// Log connection events for debugging
socket.on('connect', () => {
    console.log('Socket connected successfully');
});

socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error.message);
});

socket.on('disconnect', (reason) => {
    console.log('Socket disconnected. Reason:', reason);
});

// Connection status elements
const backendStatusDot = document.getElementById('backend-status-dot');
const backendStatusText = document.getElementById('backend-status-text');
const dbStatusDot = document.getElementById('db-status-dot');
const dbStatusText = document.getElementById('db-status-text');
const binanceStatusDot = document.getElementById('binance-status-dot');
const binanceStatusText = document.getElementById('binance-status-text');
const telegramStatusDot = document.getElementById('telegram-status-dot');
const telegramStatusText = document.getElementById('telegram-status-text');

// Trading status elements
const tradingStatusDot = document.getElementById('trading-status-dot');
const tradingStatusText = document.getElementById('trading-status-text');

// Test buttons
const testTelegramBtn = document.getElementById('test-telegram');
const testBinanceStreamBtn = document.getElementById('test-binance-stream');

// Socket connection events
socket.on('connect', () => {
    console.log('Connected to backend');
    backendStatusDot.classList.add('connected');
    backendStatusDot.classList.remove('disconnected');
    backendStatusText.textContent = 'Backend: Connected';
    
    // Request system status after connection
    socket.emit('get-system-status');
});

socket.on('connect_error', (error) => {
    console.error('Connection error:', error);
    backendStatusDot.classList.remove('connected');
    backendStatusDot.classList.add('disconnected');
    backendStatusText.textContent = 'Backend: Connection Error';
});

socket.on('disconnect', () => {
    console.log('Disconnected from backend');
    backendStatusDot.classList.remove('connected');
    backendStatusDot.classList.add('disconnected');
    backendStatusText.textContent = 'Backend: Disconnected';
    
    // Also update other status indicators as disconnected
    updateStatusIndicator(dbStatusDot, dbStatusText, 'Database', false);
    updateStatusIndicator(binanceStatusDot, binanceStatusText, 'Binance', false);
    updateStatusIndicator(telegramStatusDot, telegramStatusText, 'Telegram', false);
    
    // Update trading status
    updateTradingStatus(false);
});

// Backend service status events
socket.on('database-status', (isConnected) => {
    updateStatusIndicator(dbStatusDot, dbStatusText, 'Database', isConnected);
});

socket.on('binance-status', (isConnected) => {
    updateStatusIndicator(binanceStatusDot, binanceStatusText, 'Binance', isConnected);
});

socket.on('telegram-status', (isConnected) => {
    updateStatusIndicator(telegramStatusDot, telegramStatusText, 'Telegram', isConnected);
});

// Trading status update
socket.on('trading-status', (status) => {
    console.log('Trading status update received:', status);
    updateTradingStatus(status.active);
});




// Enhanced price update handler for frontend
socket.on('price-update', (data) => {
    console.log('Price update received:', data);
    
    if (!data) {
        console.warn('Received empty price update data');
        return;
    }
    
    // Handle different possible symbol formats
    let symbol = '';
    let price = 0;
    
    if (data.symbol) {
        symbol = data.symbol;
    } else if (data.s) {
        symbol = data.s;
    } else {
        console.warn('Price update missing symbol:', data);
        return;
    }
    
    if (data.price) {
        price = data.price;
    } else if (data.p) {
        price = data.p;
    } else if (data.a) {
        price = data.a; // Use ask price from bookTicker
    } else if (data.b) {
        price = data.b; // Use bid price from bookTicker
    } else if (data.c) {
        price = data.c; // Use close price from ticker
    } else {
        console.warn('Price update missing price value:', data);
        return;
    }
    
    // Normalize symbol format (remove USDT if it exists)
    const baseSymbol = symbol.replace('USDT', '').toLowerCase();
    
    // Try multiple selectors to find the price element
    let priceElement = document.getElementById(`${baseSymbol}-price`);
    
    if (!priceElement) {
        // Try alternative selector
        const cryptoCard = document.getElementById(`${baseSymbol}-card`);
        if (cryptoCard) {
            priceElement = cryptoCard.querySelector('.current-price');
        }
    }
    
    if (priceElement) {
        // Format the price with 2 decimal places
        const formattedPrice = parseFloat(price).toFixed(2);
        priceElement.textContent = `Price: $${formattedPrice}`;
        console.log(`Updated price for ${baseSymbol} to $${formattedPrice}`);
        
        // Also update the 'last update' text if it exists
        const updatedElement = document.getElementById(`${baseSymbol}-updated`);
        if (updatedElement) {
            const now = new Date().toLocaleTimeString();
            updatedElement.textContent = `Last update: ${now}`;
        }
    } else {
        console.warn(`Could not find price element for symbol ${baseSymbol}`);
        
        // Log all available price elements for debugging
        console.log('Available price elements:', 
            Array.from(document.querySelectorAll('[id$="-price"]')).map(el => el.id));
    }
});




// Transaction and operation results
socket.on('first-purchase-result', (result) => {
    if (!result.success) {
        alert(`Purchase failed: ${result.error}`);
    } else {
        console.log('Purchase successful');
    }
});

socket.on('sell-all-result', (result) => {
    if (!result.success) {
        alert(`Sell failed: ${result.error}`);
    } else {
        console.log('Sell successful');
    }
});

// Test button event listeners
testTelegramBtn.addEventListener('click', () => {
    socket.emit('test-telegram');
});

testBinanceStreamBtn.addEventListener('click', () => {
    socket.emit('test-binance-stream');
});

// Helper function to update status indicators
function updateStatusIndicator(dotElement, textElement, serviceName, isConnected) {
    if (isConnected) {
        dotElement.classList.add('connected');
        dotElement.classList.remove('disconnected');
        textElement.textContent = `${serviceName}: Connected`;
    } else {
        dotElement.classList.remove('connected');
        dotElement.classList.add('disconnected');
        textElement.textContent = `${serviceName}: Disconnected`;
    }
}

// Helper function to update trading status and enable/disable buttons
function updateTradingStatus(isActive) {
    if (isActive) {
        tradingStatusDot.classList.add('connected');
        tradingStatusDot.classList.remove('disconnected');
        tradingStatusText.textContent = 'Trading: Active';
        
        // Enable trading buttons
        enableTradingButtons();
    } else {
        tradingStatusDot.classList.remove('connected');
        tradingStatusDot.classList.add('disconnected');
        tradingStatusText.textContent = 'Trading: Paused (WebSocket disconnected)';
        
        // Disable trading buttons
        disableTradingButtons();
    }
}

// Helper function to disable trading buttons
function disableTradingButtons() {
    const tradingButtons = document.querySelectorAll('.first-purchase, .sell-all');
    tradingButtons.forEach(button => {
        button.disabled = true;
        button.classList.add('disabled');
    });
}

// Helper function to enable trading buttons
function enableTradingButtons() {
    const tradingButtons = document.querySelectorAll('.first-purchase, .sell-all');
    tradingButtons.forEach(button => {
        button.disabled = false;
        button.classList.remove('disabled');
    });
}

// Investment preset buttons functionality
const presetButtons = document.querySelectorAll('.preset-btn');
presetButtons.forEach(button => {
    button.addEventListener('click', function() {
        // Get parent card
        const card = this.closest('.crypto-card');
        const investmentInput = card.querySelector('input[type="hidden"]');
        
        // Update active button
        card.querySelectorAll('.preset-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        this.classList.add('active');
        
        // Update hidden input value
        investmentInput.value = this.dataset.value;
    });
});

// Helper function to manually update a price (for testing)
function updatePrice(symbol, price) {
    const baseSymbol = symbol.replace('USDT', '').toLowerCase();
    
    // Try different methods to find the element
    let priceElement = document.getElementById(`${baseSymbol}-price`);
    console.log(`Looking for price element with ID: ${baseSymbol}-price, found: ${priceElement ? 'yes' : 'no'}`);
    
    if (!priceElement) {
        const card = document.getElementById(`${baseSymbol}-card`);
        if (card) {
            priceElement = card.querySelector('.current-price');
            console.log(`Found card element, querySelector for .current-price returned: ${priceElement ? 'element' : 'null'}`);
        }
    }
    
    if (priceElement) {
        priceElement.textContent = `Price: $${price}`;
        return true;
    } else {
        console.error(`Could not find price element for ${symbol}. Available price elements:`, 
            Array.from(document.querySelectorAll('[id$="-price"]')).map(el => el.id));
        return false;
    }
}

// Add a test button click handler
document.getElementById('test-binance-stream').addEventListener('click', function() {
    // After sending the test request, try a manual update
    setTimeout(() => {
        console.log('Testing manual price update...');
        updatePrice('BTCUSDT', '99999.99');
    }, 2000);
});


// First Purchase button functionality
const firstPurchaseButtons = document.querySelectorAll('.first-purchase');
firstPurchaseButtons.forEach(button => {
    button.addEventListener('click', function() {
        const card = this.closest('.crypto-card');
        const symbol = card.id.replace('-card', '').toUpperCase() + 'USDT';
        const investment = card.querySelector('input[type="hidden"]').value;
        
        console.log(`Initiating first purchase for ${symbol} with investment ${investment}`);
        
        // Emit first purchase event to backend
        socket.emit('first-purchase', {
            symbol: symbol,
            investment: investment
        });
    });
});

// Sell All button functionality
const sellAllButtons = document.querySelectorAll('.sell-all');
sellAllButtons.forEach(button => {
    button.addEventListener('click', function() {
        const card = this.closest('.crypto-card');
        const symbol = card.id.replace('-card', '').toUpperCase() + 'USDT';
        
        console.log(`Initiating sell all for ${symbol}`);
        
        // Emit sell all event to backend
        socket.emit('sell-all', {
            symbol: symbol
        });
    });
});

// Validate that all required price elements exist
window.addEventListener('load', () => {
    console.log('Validating price elements...');
    
    const requiredSymbols = ['btc', 'sol', 'xrp', 'doge', 'near', 'pendle'];
    const missingElements = [];
    
    requiredSymbols.forEach(symbol => {
        const element = document.getElementById(`${symbol}-price`);
        if (!element) {
            console.error(`Missing required price element: ${symbol}-price`);
            missingElements.push(`${symbol}-price`);
        } else {
            console.log(`Found price element: ${symbol}-price`);
        }
    });
    
    if (missingElements.length > 0) {
        console.error('Some price elements are missing!', missingElements);
        alert(`Warning: Some price elements are missing: ${missingElements.join(', ')}. Prices may not display correctly.`);
    } else {
        console.log('All required price elements found.');
    }
});