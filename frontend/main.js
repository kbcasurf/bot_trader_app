// Import socket.io client
import { io } from 'socket.io-client';

// Debug mode toggle
const DEBUG_MODE = true;

// Create and configure socket connection
const socket = io({
    // Remove explicit path setting to use default
    transports: ['websocket', 'polling'],  // Try WebSocket first, then polling
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    timeout: 20000,
    autoConnect: true
});

// Add enhanced debugging for socket connection
if (DEBUG_MODE) {
    // Track original socket methods to enhance with logging
    const originalOn = socket.on;
    const originalEmit = socket.emit;
    
    // Add debug logging to socket.on
    socket.on = function(event, callback) {
        // Wrap the callback with logging
        const wrappedCallback = function(...args) {
            console.log(`[Socket Debug] Received event: ${event}`, args.length > 0 ? args[0] : null);
            return callback.apply(this, args);
        };
        
        // Use the original socket.on with the wrapped callback
        return originalOn.call(this, event, wrappedCallback);
    };
    
    // Add debug logging to socket.emit
    socket.emit = function(event, ...args) {
        console.log(`[Socket Debug] Emitting event: ${event}`, args.length > 0 ? args[0] : null);
        return originalEmit.apply(this, [event, ...args]);
    };
    
    // Add transport debugging
    socket.on('connect', () => {
        console.log('Socket connected successfully with ID:', socket.id);
        console.log('Transport used:', socket.io.engine.transport.name);
    });
    
    socket.io.engine.on('upgrade', (transport) => {
        console.log('Socket transport upgraded to:', transport.name);
    });
}

// Export the socket for other modules to use
export { socket };

// Connection status variables
let tradingActive = false;
let lastBackendResponseTime = Date.now();

// Connection and trading status elements
let backendStatusDot;
let backendStatusText;
let dbStatusDot;
let dbStatusText;
let binanceStatusDot;
let binanceStatusText;
let telegramStatusDot;
let telegramStatusText;
let tradingStatusDot;
let tradingStatusText;
let testTelegramBtn;
let testBinanceStreamBtn;

// Dom Ready Utilities
function whenDomReady(callback) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', callback);
    } else {
        callback();
    }
}

// Initialize all components
function initializeApp() {
    console.log('Initializing application...');
    
    // Get all status elements
    backendStatusDot = document.getElementById('backend-status-dot');
    backendStatusText = document.getElementById('backend-status-text');
    dbStatusDot = document.getElementById('db-status-dot');
    dbStatusText = document.getElementById('db-status-text');
    binanceStatusDot = document.getElementById('binance-status-dot');
    binanceStatusText = document.getElementById('binance-status-text');
    telegramStatusDot = document.getElementById('telegram-status-dot');
    telegramStatusText = document.getElementById('telegram-status-text');
    tradingStatusDot = document.getElementById('trading-status-dot');
    tradingStatusText = document.getElementById('trading-status-text');
    
    // Get test buttons
    testTelegramBtn = document.getElementById('test-telegram');
    testBinanceStreamBtn = document.getElementById('test-binance-stream');
    
    // Initialize crypto cards
    createCryptoCards();
    
    // Attach event listeners
    attachEventListeners();
    
    // Wait a bit for components, then validate DOM
    setTimeout(validateDomElements, 300);
    
    // Set up price polling fallback
    setupPeriodicPriceUpdates();
    
    // Start connection monitoring
    implementConnectionMonitoring();
}

// Function to create crypto cards dynamically
function createCryptoCards() {
    console.log('Creating crypto cards...');
    
    const supportedCryptos = [
        { symbol: 'BTC', fullName: 'Bitcoin' },
        { symbol: 'SOL', fullName: 'Solana' },
        { symbol: 'XRP', fullName: 'Ripple' },
        { symbol: 'PENDLE', fullName: 'Pendle' },
        { symbol: 'DOGE', fullName: 'Dogecoin' },
        { symbol: 'NEAR', fullName: 'NEAR Protocol' }
    ];
    
    const gridElement = document.querySelector('.crypto-grid');
    if (!gridElement) {
        console.error('Crypto grid element not found!');
        return;
    }
    
    // Find the BTC card to use as a template
    const btcCard = document.getElementById('btc-card');
    if (!btcCard) {
        console.error('BTC card template not found!');
        return;
    }
    
    // Keep BTC card and remove any other existing cards
    const existingCards = gridElement.querySelectorAll('.crypto-card:not(#btc-card)');
    existingCards.forEach(card => card.remove());
    
    // Create cards for each supported crypto except BTC (already in HTML)
    supportedCryptos.slice(1).forEach(crypto => {
        const symbol = crypto.symbol.toLowerCase();
        
        // Clone the BTC card
        const newCard = btcCard.cloneNode(true);
        newCard.id = `${symbol}-card`;
        
        // Update card header
        const header = newCard.querySelector('.crypto-header h3');
        if (header) {
            header.textContent = `${crypto.symbol}/USDT`;
        }
        
        // Find and update all elements with IDs
        const elementsWithIds = newCard.querySelectorAll('[id]');
        elementsWithIds.forEach(element => {
            // Replace 'btc' with the new symbol in all IDs
            const newId = element.id.replace('btc', symbol);
            element.id = newId;
        });
        
        // Make sure price element has correct ID and content
        const price = newCard.querySelector('.current-price');
        if (price) {
            price.id = `${symbol}-price`;
            price.textContent = 'Price: $0.00';
        }
        
        // Update holdings display
        const holdings = newCard.querySelector('.holdings span');
        if (holdings) {
            holdings.id = `${symbol}-holdings`;
            holdings.textContent = `0.00 ${crypto.symbol}`;
        }
        
        // Update profit bar and text IDs
        const profitBar = newCard.querySelector('.bar-fill');
        if (profitBar) {
            profitBar.id = `${symbol}-profit-bar`;
        }
        
        const profitText = newCard.querySelector('.profit-loss-text span');
        if (profitText) {
            profitText.id = `${symbol}-profit-text`;
        }
        
        // Update transaction history ID
        const history = newCard.querySelector('.transaction-history ul');
        if (history) {
            history.id = `${symbol}-history`;
        }
        
        // Update button IDs
        const firstPurchaseBtn = newCard.querySelector('.first-purchase');
        if (firstPurchaseBtn) {
            firstPurchaseBtn.id = `${symbol}-first-purchase`;
        }
        
        const sellAllBtn = newCard.querySelector('.sell-all');
        if (sellAllBtn) {
            sellAllBtn.id = `${symbol}-sell-all`;
        }
        
        // Set the investment value
        const investmentInput = newCard.querySelector('input[type="hidden"]');
        if (investmentInput) {
            investmentInput.id = `${symbol}-investment`;
        }
        
        // Add the new card to the grid
        gridElement.appendChild(newCard);
    });
    
    console.log('Crypto cards created successfully');
}

// Attach all event listeners
function attachEventListeners() {
    console.log('Attaching event listeners...');
    
    // Investment preset buttons
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
            if (!tradingActive) {
                alert('Trading is currently paused due to WebSocket connection issues. Please try again when connection is restored.');
                return;
            }
            
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
            if (!tradingActive) {
                alert('Trading is currently paused due to WebSocket connection issues. Please try again when connection is restored.');
                return;
            }
            
            const card = this.closest('.crypto-card');
            const symbol = card.id.replace('-card', '').toUpperCase() + 'USDT';
            const holdingsElement = card.querySelector('.holdings span');
            
            // Check if there are any holdings to sell
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
    
    // Test buttons
    if (testTelegramBtn) {
        testTelegramBtn.addEventListener('click', () => {
            socket.emit('test-telegram');
        });
    }
    
    if (testBinanceStreamBtn) {
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
    }
}

// Setup price update fallback
function setupPeriodicPriceUpdates() {
    // Track last price update time
    let lastPriceUpdateTime = Date.now();
    let wsActive = false;
    
    // Clear any existing interval
    if (window.priceUpdateInterval) {
        clearInterval(window.priceUpdateInterval);
    }
    
    // Listen for price updates from WebSocket
    socket.on('price-update', (data) => {
        // Mark the WebSocket as active when we receive updates
        wsActive = true;
        lastPriceUpdateTime = Date.now();
    });
    
    // Fetch prices every 30 seconds ONLY if WebSocket is inactive
    const priceUpdateInterval = setInterval(() => {
        const now = Date.now();
        const secondsSinceLastUpdate = (now - lastPriceUpdateTime) / 1000;
        
        // If no updates for more than 15 seconds, consider WebSocket inactive
        if (secondsSinceLastUpdate > 15) {
            console.log('WebSocket price updates may be inactive, using fallback polling...');
            wsActive = false;
            
            if (socket && socket.connected) {
                socket.emit('manual-binance-test', {
                    symbols: ['BTCUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'NEARUSDT', 'PENDLEUSDT']
                });
            } else {
                console.log('Socket disconnected, cannot update prices');
            }
        } else if (wsActive) {
            console.log('WebSocket price updates active, skipping polling');
        }
    }, 30000);
    
    // Store the interval ID so we can clear it if needed
    window.priceUpdateInterval = priceUpdateInterval;
}

// Connection monitoring mechanism
function implementConnectionMonitoring() {
    // Create a function to mark backend responses
    function markBackendResponse() {
        lastBackendResponseTime = Date.now();
        updateConnectionStatus(true);
    }
    
    // Periodically check backend connection health
    setInterval(() => {
        const now = Date.now();
        const secondsSinceLastResponse = (now - lastBackendResponseTime) / 1000;
        
        // If no responses for more than 10 seconds, check connection status
        if (secondsSinceLastResponse > 10) {
            // Connection might be unhealthy, check if socket reports as connected
            if (socket.connected) {
                // Socket says it's connected but we haven't received events
                // Send a ping to see if connection is really alive
                console.log('Testing backend connection health...');
                socket.emit('get-system-status');
                
                // Give it 2 seconds to respond
                setTimeout(() => {
                    const newSecondsSinceLastResponse = (Date.now() - lastBackendResponseTime) / 1000;
                    if (newSecondsSinceLastResponse > 12) {
                        // Still no response, connection might be dead
                        console.warn('Backend connection appears unresponsive despite socket reporting as connected');
                        updateConnectionStatus(false);
                        
                        // Try to reconnect
                        socket.disconnect().connect();
                    }
                }, 2000);
            } else {
                // Socket knows it's disconnected
                updateConnectionStatus(false);
            }
        }
    }, 10000);
}

// Update connection status indicators
function updateConnectionStatus(isConnected) {
    if (!backendStatusDot || !backendStatusText) return;
    
    if (isConnected) {
        backendStatusDot.classList.add('connected');
        backendStatusDot.classList.remove('disconnected');
        backendStatusText.textContent = 'Backend: Connected';
    } else {
        backendStatusDot.classList.remove('connected');
        backendStatusDot.classList.add('disconnected');
        backendStatusText.textContent = 'Backend: Disconnected';
    }
}

// Update service status indicators
function updateStatusIndicator(dotElement, textElement, serviceName, isConnected) {
    if (!dotElement || !textElement) return;
    
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

// Update trading status and button state
function updateTradingStatus(isActive) {
    tradingActive = isActive;
    
    if (!tradingStatusDot || !tradingStatusText) return;
    
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

// Update transaction history
function updateTransactionHistory(symbol, transactions) {
    const historyElement = document.getElementById(`${symbol.toLowerCase()}-history`);
    
    if (!historyElement) {
        console.error(`Could not find history element for ${symbol}`);
        return;
    }
    
    // Clear existing entries
    historyElement.innerHTML = '';
    
    if (!transactions || transactions.length === 0) {
        const noTransactionsItem = document.createElement('li');
        noTransactionsItem.classList.add('no-transactions');
        noTransactionsItem.textContent = 'No transactions yet';
        historyElement.appendChild(noTransactionsItem);
        return;
    }
    
    console.log(`Updating transaction history for ${symbol} with ${transactions.length} transactions`);
    
    // Add transactions to the history list
    transactions.forEach(transaction => {
        const listItem = document.createElement('li');
        listItem.classList.add(transaction.type.toLowerCase());
        
        // Format the transaction information
        const date = new Date(transaction.timestamp);
        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        
        // Make sure to format price and quantity with proper precision
        const price = parseFloat(transaction.price).toFixed(2);
        const quantity = parseFloat(transaction.quantity).toFixed(6);
        
        listItem.textContent = `${transaction.type}: ${quantity} ${symbol} at $${price} (${formattedDate})`;
        
        historyElement.appendChild(listItem);
    });
}

// Function to validate that all required price elements exist
function validateDomElements() {
    console.log('Validating DOM elements...');
    
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
        console.warn('Will attempt to fix missing elements by recreating crypto cards...');
        
        // Try to fix by recreating crypto cards
        createCryptoCards();
        attachEventListeners();
        
        // Check again
        setTimeout(() => {
            const stillMissing = [];
            requiredSymbols.forEach(symbol => {
                const element = document.getElementById(`${symbol}-price`);
                if (!element) {
                    stillMissing.push(`${symbol}-price`);
                }
            });
            
            if (stillMissing.length > 0) {
                console.error('Still missing elements after fix attempt:', stillMissing);
                alert(`Warning: Some price elements are missing: ${stillMissing.join(', ')}. Please refresh the page.`);
            } else {
                console.log('All missing elements have been fixed!');
            }
        }, 500);
    } else {
        console.log('All required DOM elements found.');
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

// ======== Socket.IO Event Handlers ========

// Connection events
socket.on('connect', () => {
    console.log('Socket connected successfully with ID:', socket.id);
    
    // Update the backend connection status
    updateConnectionStatus(true);
    
    // Mark response received
    lastBackendResponseTime = Date.now();
    
    // Request system status
    socket.emit('get-system-status');
    
    // Fetch account holdings after connection
    setTimeout(() => {
        console.log('Fetching account holdings...');
        socket.emit('get-account-info');
    }, 1500);
    
    // Wait for backend services to initialize and fetch prices
    setTimeout(() => {
        console.log('Fetching initial prices after connection...');
        socket.emit('test-binance-stream');
    }, 2500);
});

socket.on('connect_error', (error) => {
    console.error('Socket.IO connection error:', error.message);
    
    // Update UI
    updateConnectionStatus(false);
    
    // Try to reconnect with polling if WebSocket fails
    if (socket.io.opts.transports[0] === 'websocket') {
        console.log('WebSocket connection failed, falling back to polling');
        socket.io.opts.transports = ['polling', 'websocket'];
        socket.connect();
    }
});

socket.on('disconnect', (reason) => {
    console.log('Socket disconnected. Reason:', reason);
    
    // Update UI
    updateConnectionStatus(false);
    
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

// Price updates
socket.on('price-update', (data) => {
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
    
    // Try to find the price element
    const priceElement = document.getElementById(`${baseSymbol}-price`);
    
    if (priceElement) {
        // Format the price with 2 decimal places
        const formattedPrice = parseFloat(price).toFixed(2);
        priceElement.textContent = `Price: $${formattedPrice}`;
        console.log(`Updated price for ${baseSymbol} to $${formattedPrice}`);
        
        // Mark response received
        lastBackendResponseTime = Date.now();
    } else {
        console.warn(`Could not find price element for symbol ${baseSymbol}`);
    }
});

// Account info
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
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

// Transaction updates
socket.on('transaction-update', (data) => {
    const { symbol, transactions } = data;
    console.log(`Received transaction update for ${symbol}:`, transactions);
    updateTransactionHistory(symbol, transactions);
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

// Holdings updates
socket.on('holdings-update', (data) => {
    const { symbol, amount, profitLossPercent } = data;
    console.log(`Received holdings update for ${symbol}: ${amount} (${profitLossPercent}%)`);
    
    // Update holdings display
    const holdingsElement = document.getElementById(`${symbol.toLowerCase()}-holdings`);
    if (holdingsElement) {
        // Format the holdings amount with 6 decimal places for cryptocurrencies
        holdingsElement.textContent = `${parseFloat(amount).toFixed(6)} ${symbol}`;
    }
    
    // Update profit/loss bar and text
    const barElement = document.getElementById(`${symbol.toLowerCase()}-profit-bar`);
    const textElement = document.getElementById(`${symbol.toLowerCase()}-profit-text`);
    
    if (barElement && textElement) {
        // Calculate bar width (50% is neutral, 0% is -10% or worse, 100% is +10% or better)
        const barWidth = Math.min(Math.max((profitLossPercent + 10) * 5, 0), 100);
        barElement.style.width = `${barWidth}%`;
        
        // Update text with profit/loss percentage
        textElement.textContent = `${profitLossPercent.toFixed(2)}%`;
        
        // Add color classes based on profit/loss
        if (profitLossPercent > 0) {
            textElement.classList.add('profit');
            textElement.classList.remove('loss');
        } else if (profitLossPercent < 0) {
            textElement.classList.add('loss');
            textElement.classList.remove('profit');
        } else {
            textElement.classList.remove('profit', 'loss');
        }
    }
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

// Order results
socket.on('buy-result', (result) => {
    if (result.success) {
        console.log('Buy order successful:', result);
        
        // Request updated account info to refresh all holdings
        socket.emit('get-account-info');
    } else {
        console.error('Buy order failed:', result.error);
        alert(`Purchase failed: ${result.error}`);
    }
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

socket.on('sell-result', (result) => {
    if (result.success) {
        console.log('Sell order successful:', result);
        
        // Request updated account info to refresh all holdings
        socket.emit('get-account-info');
    } else {
        console.error('Sell order failed:', result.error);
        alert(`Sell failed: ${result.error}`);
    }
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

socket.on('first-purchase-result', (result) => {
    if (!result.success) {
        alert(`First purchase failed: ${result.error}`);
    } else {
        console.log('First purchase successful');
    }
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

socket.on('sell-all-result', (result) => {
    if (!result.success) {
        alert(`Sell all failed: ${result.error}`);
    } else {
        console.log('Sell all successful');
    }
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

socket.on('telegram-test-result', (result) => {
    if (result.success) {
        alert('Telegram notification test successful!');
    } else {
        alert(`Telegram notification test failed: ${result.error || 'Unknown error'}`);
    }
    
    // Mark response received
    lastBackendResponseTime = Date.now();
});

// Initialize everything when DOM is ready
whenDomReady(() => {
    // Wait a short time for everything to render completely
    setTimeout(() => {
        initializeApp();
        
        // Request initial system status
        socket.emit('get-system-status');
        
        console.log('Application initialized and ready');
    }, 500);
});