import { io } from 'socket.io-client';

// Initialize socket connection to backend
const socket = io('http://backend:3000');

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
    updateTradingStatus(status.active);
});

// Price update from Binance
socket.on('price-update', (data) => {
    console.log('Price update:', data);
    
    // Update price display for the specific cryptocurrency
    const priceElement = document.getElementById(`${data.symbol.toLowerCase()}-price`);
    if (priceElement) {
        priceElement.textContent = `Price: $${parseFloat(data.price).toFixed(2)}`;
    }
});

// Transaction and operation results
socket.on('first-purchase-result', (result) => {
    if (!result.success) {
        alert(`Purchase failed: ${result.error}`);
    }
});

socket.on('sell-all-result', (result) => {
    if (!result.success) {
        alert(`Sell failed: ${result.error}`);
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

// First Purchase button functionality
const firstPurchaseButtons = document.querySelectorAll('.first-purchase');
firstPurchaseButtons.forEach(button => {
    button.addEventListener('click', function() {
        const card = this.closest('.crypto-card');
        const symbol = card.id.replace('-card', '').toUpperCase() + 'USDT';
        const investment = card.querySelector('input[type="hidden"]').value;
        
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
        
        // Emit sell all event to backend
        socket.emit('sell-all', {
            symbol: symbol
        });
    });
});

// Request initial system status when page loads
window.addEventListener('load', () => {
    socket.emit('get-system-status');
});