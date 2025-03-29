import { io } from 'socket.io-client';

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




// Price update from Binance
socket.on('price-update', (data) => {
    console.log('Price update received:', data);
    
    if (!data || !data.symbol) {
        console.warn('Invalid price update data:', data);
        return;
    }
    
    // Try different approaches to find the price element
    
    // 1. Try by ID (btc-price)
    const baseSymbol = data.symbol.replace('USDT', '').toLowerCase();
    let priceElement = document.getElementById(`${baseSymbol}-price`);
    
    // 2. If not found, try by class and card ID
    if (!priceElement) {
        console.log(`Price element with ID ${baseSymbol}-price not found, trying alternative selectors...`);
        const card = document.getElementById(`${baseSymbol}-card`);
        if (card) {
            priceElement = card.querySelector('.current-price');
            console.log(`Found price element in card: ${priceElement ? 'Yes' : 'No'}`);
        }
    }
    
    // 3. If still not found, try by class and content filtering
    if (!priceElement) {
        console.log('Trying to find price element by class...');
        const allPriceElements = document.querySelectorAll('.current-price');
        console.log(`Found ${allPriceElements.length} price elements by class`);
        
        // Look for price elements inside cards with matching symbol
        const matchingElement = Array.from(allPriceElements).find(el => {
            // Check if we're in a card with a matching heading
            const parentCard = el.closest('.crypto-card');
            if (parentCard) {
                const heading = parentCard.querySelector('h3');
                if (heading && heading.textContent.includes(baseSymbol.toUpperCase())) {
                    return true;
                }
            }
            return false;
        });
        
        if (matchingElement) {
            console.log('Found matching price element by card heading');
            priceElement = matchingElement;
        }
    }
    
    // Update the price if we found an element
    if (priceElement) {
        const formattedPrice = parseFloat(data.price).toFixed(2);
        console.log(`Updating price for ${data.symbol} to $${formattedPrice}`);
        priceElement.textContent = `Price: $${formattedPrice}`;
    } else {
        console.error(`Could not find any price element for ${data.symbol}`);
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
    
    if (!priceElement) {
        const card = document.getElementById(`${baseSymbol}-card`);
        if (card) {
            priceElement = card.querySelector('.current-price');
        }
    }
    
    if (priceElement) {
        priceElement.textContent = `Price: $${price}`;
        console.log(`Manually updated price for ${symbol} to $${price}`);
        return true;
    } else {
        console.error(`Could not find price element for ${symbol}`);
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

// Debug HTML structure
window.addEventListener('load', () => {
    console.log('Debugging HTML structure...');
    
    // Find all crypto cards
    const cryptoCards = document.querySelectorAll('.crypto-card');
    console.log('Found crypto cards:', cryptoCards.length);
    
    // Print the HTML structure of each card
    cryptoCards.forEach(card => {
        console.log('Card ID:', card.id);
        console.log('Card HTML:', card.innerHTML.substring(0, 500)); // First 500 chars
        
        // Check for price elements
        const priceElements = card.querySelectorAll('.current-price');
        console.log('Price elements in this card:', priceElements.length);
        priceElements.forEach(el => {
            console.log('Price element ID:', el.id);
            console.log('Price element content:', el.textContent);
        });
    });
    
    // List all elements with class 'current-price'
    const allPriceElements = document.querySelectorAll('.current-price');
    console.log('All price elements:', allPriceElements.length);
    Array.from(allPriceElements).forEach(el => {
        console.log('Price element ID:', el.id, 'Content:', el.textContent);
    });
});