import { io } from 'socket.io-client';

// Enhanced Socket.IO debugging
const DEBUG_MODE = true;

// Wrap socket.io with debugging capabilities
function createDebugSocket() {
    // Create socket with proper backend URL
    const socket = io({
        // Note: No need to specify the URL as Vite will proxy the requests
        // The proxy is set up in vite.config.js
        transports: ['polling', 'websocket'],
        reconnectionAttempts: 5,
        timeout: 20000,
        forceNew: true
    });
    
    // Add debug event listeners
    if (DEBUG_MODE) {
        // Track original listeners to prevent duplicates
        const originalOn = socket.on;
        const registeredEvents = new Set();
        
        socket.on = function(event, callback) {
            if (!registeredEvents.has(event)) {
                console.log(`[Socket Debug] Registering listener for event: ${event}`);
                registeredEvents.add(event);
                
                // Wrap the callback with logging
                const wrappedCallback = function(...args) {
                    console.log(`[Socket Debug] Received event: ${event}`, args.length > 0 ? args[0] : null);
                    return callback.apply(this, args);
                };
                
                return originalOn.call(this, event, wrappedCallback);
            } else {
                return originalOn.call(this, event, callback);
            }
        };
        
        // Also wrap socket.emit for debugging
        const originalEmit = socket.emit;
        socket.emit = function(event, ...args) {
            console.log(`[Socket Debug] Emitting event: ${event}`, args.length > 0 ? args[0] : null);
            return originalEmit.apply(this, [event, ...args]);
        };
    }
    
    return socket;
}

// Export the socket for other modules to use
export const socket = createDebugSocket();

document.addEventListener('DOMContentLoaded', () => {
    // Log all available price elements as a sanity check
    console.log('Available price elements on DOM load:', 
        Array.from(document.querySelectorAll('[id$="-price"]')).map(el => el.id));
    
    // Initialize your components after DOM is ready
    initializeComponents();
    
    // Run DOM validation after a short delay to ensure all elements are loaded
    setTimeout(() => {
        validateDomElements();
    }, 1000);
    
    // Fetch prices automatically after a short delay
    setTimeout(() => {
        if (socket && socket.connected) {
            console.log('Automatically fetching initial prices...');
            socket.emit('manual-binance-test', {
                symbols: ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'NEARUSDT', 'PENDLEUSDT']
            });
        } else {
            console.log('Socket not connected yet, will try to fetch prices on connect');
        }
    }, 1500);
    
    // Set up periodic price updates
    setupPeriodicPriceUpdates();
});

// Setup periodic price updates every 30 seconds
function setupPeriodicPriceUpdates() {
    // Fetch prices every 30 seconds as a fallback mechanism
    const priceUpdateInterval = setInterval(() => {
        if (socket && socket.connected) {
            console.log('Performing periodic price update...');
            socket.emit('manual-binance-test', {
                symbols: ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'NEARUSDT', 'PENDLEUSDT']
            });
        } else {
            console.log('Socket disconnected, cannot update prices');
        }
    }, 30000);
    
    // Store the interval ID so we can clear it if needed
    window.priceUpdateInterval = priceUpdateInterval;
}

// Log connection events for debugging
socket.on('connect', () => {
    console.log('Socket connected successfully');
    
    // Request system status first
    socket.emit('get-system-status');
    
    // Wait a bit longer for the backend services to initialize
    setTimeout(() => {
        console.log('Fetching initial prices after connection...');
        socket.emit('test-binance-stream');
    }, 2000);
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

socket.on('telegram-test-result', (result) => {
    if (result.success) {
        alert('Telegram notification test successful!');
    } else {
        alert(`Telegram notification test failed: ${result.error || 'Unknown error'}`);
    }
    
    console.log('Telegram test result:', result);
});

// Socket connection events
socket.on('connect', () => {
    console.log('Socket connected successfully');
    
    // Request system status first
    socket.emit('get-system-status');
    
    // Add this to fetch account holdings after connection
    setTimeout(() => {
        console.log('Fetching account holdings...');
        socket.emit('get-account-info');
    }, 1500);
    
    // Wait a bit longer for the backend services to initialize and fetch prices
    setTimeout(() => {
        console.log('Fetching initial prices after connection...');
        socket.emit('test-binance-stream');
    }, 2500);
});

socket.on('account-info', (accountInfo) => {
    console.log('Account info received:', accountInfo);
    
    if (accountInfo && accountInfo.balances) {
        // Process each supported cryptocurrency
        const supportedSymbols = ['BTC', 'SOL', 'XRP', 'DOGE', 'NEAR', 'PENDLE'];
        
        supportedSymbols.forEach(symbol => {
            // Find the balance for this cryptocurrency
            const balance = accountInfo.balances.find(b => b.asset === symbol);
            
            if (balance) {
                // Get the holdings element
                const holdingsElement = document.getElementById(`${symbol.toLowerCase()}-holdings`);
                if (holdingsElement) {
                    holdingsElement.textContent = `${parseFloat(balance.free).toFixed(8)} ${symbol}`;
                    console.log(`Updated ${symbol} holdings: ${balance.free}`);
                }
            }
        });
    }
});


    socket.on('buy-result', (result) => {
        if (result.success) {
            console.log('Buy order successful:', result);
            
            // Request updated account info to refresh all holdings
            socket.emit('get-account-info');
        } else {
            console.error('Buy order failed:', result.error);
            alert(`Purchase failed: ${result.error}`);
        }
    });
    
    // Similarly for sell-result handler
    socket.on('sell-result', (result) => {
        if (result.success) {
            console.log('Sell order successful:', result);
            
            // Request updated account info to refresh all holdings
            socket.emit('get-account-info');
        } else {
            console.error('Sell order failed:', result.error);
            alert(`Sell failed: ${result.error}`);
        }
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

// IMPROVED: Enhanced price update handler for frontend
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

// Enhanced transaction result handlers
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

// Enhanced transaction update handler
socket.on('transaction-update', (data) => {
    if (!data || !data.symbol || !data.transactions) {
        console.error('Invalid transaction update data', data);
        return;
    }
    
    console.log(`Received transaction update for ${data.symbol}:`, data.transactions);
    
    const symbol = data.symbol.toLowerCase();
    const historyElement = document.getElementById(`${symbol}-history`);
    
    if (!historyElement) {
        console.error(`Transaction history element not found for ${symbol}`);
        return;
    }

     // Clear existing entries
     historyElement.innerHTML = '';
    
     if (data.transactions.length === 0) {
         const noTransactionsItem = document.createElement('li');
         noTransactionsItem.classList.add('no-transactions');
         noTransactionsItem.textContent = 'No transactions yet';
         historyElement.appendChild(noTransactionsItem);
         return;
     }
     
    // Add transactions to the history list
    data.transactions.forEach(transaction => {
        if (!transaction) {
            console.error('Invalid transaction in array');
            return;
        }

        const listItem = document.createElement('li');

        // Apply appropriate styling based on transaction type
        if (transaction.type) {
            listItem.classList.add(transaction.type.toLowerCase());
        }

        // Format the transaction information
        let dateStr = 'Unknown date';
        if (transaction.timestamp) {
            const date = new Date(transaction.timestamp);
            dateStr = date.toLocaleString();
        }

        // Make sure all values are properly formatted to avoid "undefined"
        const type = transaction.type || 'UNKNOWN';
        const quantity = transaction.quantity ? parseFloat(transaction.quantity).toFixed(6) : '0.00';
        const price = transaction.price ? parseFloat(transaction.price).toFixed(2) : '0.00';

        listItem.textContent = `${type}: ${quantity} ${data.symbol} at $${price} (${dateStr})`;
        historyElement.appendChild(listItem);
    });
});

// Test button event listeners
testTelegramBtn.addEventListener('click', () => {
    socket.emit('test-telegram');
});

testBinanceStreamBtn.addEventListener('click', () => {
    socket.emit('test-binance-stream');
    
    // Fetch prices via API rather than manual override
    setTimeout(() => {
        console.log('Fetching fresh prices via API...');
        socket.emit('manual-binance-test', {
            symbols: ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'NEARUSDT', 'PENDLEUSDT']
        });
    }, 2000);
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
window.updatePrice = function(symbol, price) {
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
};

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
        
        // Check if there are holdings to sell - get value from holdings element
        const holdingsElement = card.querySelector('.holdings span');
        const holdingsText = holdingsElement.textContent;
        const quantity = parseFloat(holdingsText.split(' ')[0]);
        
        if (isNaN(quantity) || quantity <= 0) {
            alert('No holdings to sell.');
            return;
        }
        
        console.log(`Initiating sell all for ${symbol} with quantity ${quantity}`);
        
        // Emit sell all event to backend
        socket.emit('sell-all', {
            symbol: symbol
        });
    });
});

// Function to validate that all required price elements exist
function validateDomElements() {
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
}

// Manual price update function for debugging
window.manualPriceUpdate = function(symbol, price) {
    // Create a mock price update event
    const data = {
        symbol: symbol,
        price: price
    };
    
    console.log(`Manually triggering price update for ${symbol}: $${price}`);
    
    // Manually trigger the price-update event
    if (socket) {
        socket.emit('manual-price-update', data);
        
        // Also process it locally to ensure UI updates
        const baseSymbol = symbol.replace('USDT', '').toLowerCase();
        const priceElement = document.getElementById(`${baseSymbol}-price`);
        
        if (priceElement) {
            priceElement.textContent = `Price: $${parseFloat(price).toFixed(2)}`;
            console.log(`Updated ${baseSymbol}-price element manually`);
            return true;
        } else {
            console.error(`Could not find price element with ID: ${baseSymbol}-price`);
            return false;
        }
    } else {
        console.error('Socket not initialized');
        return false;
    }
};

// Initialization function (you can add more components here)
function initializeComponents() {
    // Any additional initialization code can go here
    console.log('Initializing components...');
}