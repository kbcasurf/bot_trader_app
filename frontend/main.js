// Import socket.io client
import { io } from 'socket.io-client';

// Flag to track if prices are flowing
let pricesAreFlowing = false;

// Create and configure socket connection
const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 30000,
    autoConnect: true,
    forceNew: true
});

// Export the socket for other modules to use
export { socket };

// Centralized system status tracking
const systemStatus = {
    backend: false,
    database: false,
    binance: false,
    telegram: false,
    websocket: false,
    lastBackendResponse: Date.now(),
    lastPriceUpdates: {
        btc: 0,
        sol: 0,
        xrp: 0,
        doge: 0,
        near: 0,
        pendle: 0
    }
};

// Trading status flag - initialized to false for safety
let tradingActive = false;

// UI status elements
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

// Timers and intervals
let priceCheckInterval;
let connectionCheckInterval;

// Dom Ready Utilities
whenDomReady(() => {
    // Wait a short time for everything to render completely
    setTimeout(() => {
        initializeApp();
        
        // Request initial system status
        socket.emit('get-system-status');
        
        console.log('Application initialized and ready');
        
        // Request initial data for crypto cards after a delay
        setTimeout(requestInitialData, 2000);
    }, 500);
});


// Request initial data for all crypto cards
function requestInitialData() {
    console.log('Requesting initial data for all crypto cards...');
    
    // Define the supported crypto symbols
    const cryptoSymbols = ['BTC', 'SOL', 'XRP', 'PENDLE', 'DOGE', 'NEAR'];
    
    // Request data for each symbol
    cryptoSymbols.forEach(symbol => {
        // Request transaction history
        socket.emit('get-transactions', { symbol: `${symbol}USDT` });
        console.log(`Requested transaction history for ${symbol}`);
    });
    
    // Also request account information
    socket.emit('get-account-info');
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
    
    // Initialize crypto cards
    createCryptoCards();
    
    // Attach event listeners
    attachEventListeners();
    
    // Wait a bit for components, then validate DOM
    setTimeout(validateDomElements, 300);
    
    // Initialize trading status as disabled
    updateTradingStatus(false, "Initializing system...");
    
    // Set up monitoring
    setupSystemMonitoring();
    
    // Request initial system status
    socket.emit('get-system-status');
}

// Setup all system monitoring timers
function setupSystemMonitoring() {
    // Clear any existing intervals
    if (priceCheckInterval) clearInterval(priceCheckInterval);
    if (connectionCheckInterval) clearInterval(connectionCheckInterval);
    
    // Check for price updates every 5 seconds
    priceCheckInterval = setInterval(() => {
        const now = Date.now();
        let anyRecentPriceUpdates = false;
        
        // Check if any cryptocurrency has received a price update in the last 20 seconds
        Object.values(systemStatus.lastPriceUpdates).forEach(timestamp => {
            if (timestamp > 0 && now - timestamp < 20000) {
                anyRecentPriceUpdates = true;
            }
        });
        
        // Update the websocket status based on recent price updates
        if (systemStatus.websocket !== anyRecentPriceUpdates) {
            systemStatus.websocket = anyRecentPriceUpdates;
            
            // Log the status change
            console.log(`WebSocket price flow status changed: ${anyRecentPriceUpdates ? 'ACTIVE' : 'INACTIVE'}`);
            
            // Update UI to reflect status
            updateWebSocketStatus(anyRecentPriceUpdates);
            
            // Re-evaluate if trading should be enabled/disabled
            reevaluateTradingStatus();
        }
        
        // Periodically log detailed price update status (every ~30 seconds)
        if (now % 30000 < 5000) {
            const priceStatus = Object.entries(systemStatus.lastPriceUpdates).map(([symbol, timestamp]) => {
                const secondsAgo = timestamp > 0 ? Math.round((now - timestamp) / 1000) : 'never';
                return `${symbol.toUpperCase()}: ${secondsAgo === 'never' ? 'No updates' : `${secondsAgo}s ago`}`;
            }).join(', ');
            
            console.log(`Price update status: ${priceStatus}`);
        }
    }, 5000);
    
    // Check overall connection health every 10 seconds
    connectionCheckInterval = setInterval(() => {
        const now = Date.now();
        const timeSinceLastResponse = now - systemStatus.lastBackendResponse;
        
        // If no response for 10 seconds, backend might be disconnected
        if (timeSinceLastResponse > 10000) {
            console.warn('No backend response for 10 seconds');
            
            // If socket claims to be connected, test with a ping
            if (socket.connected) {
                console.log('Testing connection with ping...');
                socket.emit('get-system-status');
                
                // Give it 2 seconds to respond
                setTimeout(() => {
                    const newTimeSinceResponse = Date.now() - systemStatus.lastBackendResponse;
                    if (newTimeSinceResponse > 12000) {
                        console.error('Connection test failed - marking backend as disconnected');
                        updateConnectionStatus(false);
                    }
                }, 2000);
            } else {
                // Socket knows it's disconnected
                updateConnectionStatus(false);
            }
        }
    }, 10000);
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
            // CRITICAL: Check trading status before proceeding
            if (!isTradingEnabled()) {
                showTradingDisabledAlert();
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
            // CRITICAL: Check trading status before proceeding
            if (!isTradingEnabled()) {
                showTradingDisabledAlert();
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
}

// Show trading disabled alert with detailed status
function showTradingDisabledAlert() {
    // Create detailed message about which systems are not ready
    let errorMessage = 'Trading is currently disabled:\n\n';
    const disconnectedSystems = [];
    
    if (!systemStatus.backend) disconnectedSystems.push('Backend Connection');
    if (!systemStatus.database) disconnectedSystems.push('Database');
    if (!systemStatus.binance) disconnectedSystems.push('Binance API');
    if (!systemStatus.telegram) disconnectedSystems.push('Telegram API');
    if (!systemStatus.websocket) disconnectedSystems.push('WebSocket Price Feed');
    
    if (disconnectedSystems.length > 0) {
        errorMessage += 'The following systems are not connected:\n- ' + 
                       disconnectedSystems.join('\n- ') + 
                       '\n\nPlease wait until all systems are ready.';
    } else {
        errorMessage += 'System is still initializing. Please wait a moment.';
    }
    
    alert(errorMessage);
}

// Check if trading is enabled based on system status
function isTradingEnabled() {
    // First check the global flag
    if (!tradingActive) {
        return false;
    }
    
    // Double-check all system components
    return (
        systemStatus.backend &&
        systemStatus.database &&
        systemStatus.binance &&
        systemStatus.telegram &&
        systemStatus.websocket
    );
}




/* 
// Re-evaluate trading status based on all system statuses
function reevaluateTradingStatus() {
    const allServicesConnected = (
        systemStatus.backend &&
        systemStatus.database &&
        systemStatus.binance &&
        systemStatus.telegram &&
        systemStatus.websocket
    );
    
    // Create detailed status message
    let statusMessage = "Trading: ";
    
    if (!allServicesConnected) {
        // Determine which services are disconnected
        const disconnectedServices = [];
        
        if (!systemStatus.backend) disconnectedServices.push("Backend");
        if (!systemStatus.database) disconnectedServices.push("Database");
        if (!systemStatus.binance) disconnectedServices.push("Binance API");
        if (!systemStatus.telegram) disconnectedServices.push("Telegram API");
        if (!systemStatus.websocket) disconnectedServices.push("WebSocket");
        
        // Create message based on disconnected services
        statusMessage += `Paused (Waiting for ${disconnectedServices.join(", ")})`;
        
        // Ensure trading is disabled
        updateTradingStatus(false, statusMessage);
    } else {
        // All services are connected, enable trading
        statusMessage += "Active";
        updateTradingStatus(true, statusMessage);
    }
}
 */




// Update connection status indicators
function updateConnectionStatus(isConnected) {
    if (!backendStatusDot || !backendStatusText) return;
    
    // Update system status
    systemStatus.backend = isConnected;
    systemStatus.lastBackendResponse = Date.now();
    
    // Update UI
    if (isConnected) {
        backendStatusDot.classList.add('connected');
        backendStatusDot.classList.remove('disconnected');
        backendStatusText.textContent = 'Backend: Connected';
    } else {
        backendStatusDot.classList.remove('connected');
        backendStatusDot.classList.add('disconnected');
        backendStatusText.textContent = 'Backend: Disconnected';
        
        // If backend disconnects, all other services should be marked as disconnected
        systemStatus.database = false;
        systemStatus.binance = false;
        systemStatus.telegram = false;
        systemStatus.websocket = false;
        
        // Update other status indicators
        updateStatusIndicator(dbStatusDot, dbStatusText, 'Database', false);
        updateStatusIndicator(binanceStatusDot, binanceStatusText, 'Binance', false);
        updateStatusIndicator(telegramStatusDot, telegramStatusText, 'Telegram', false);
    }
    
    // Re-evaluate trading status
    reevaluateTradingStatus();
}

// Update service status indicators
function updateStatusIndicator(dotElement, textElement, serviceName, isConnected) {
    if (!dotElement || !textElement) return;
    
    // Update system status based on service name
    if (serviceName.toLowerCase().includes('database')) {
        systemStatus.database = isConnected;
    } else if (serviceName.toLowerCase().includes('binance')) {
        systemStatus.binance = isConnected;
    } else if (serviceName.toLowerCase().includes('telegram')) {
        systemStatus.telegram = isConnected;
    }
    
    // Update the last response time
    systemStatus.lastBackendResponse = Date.now();
    
    // Update UI
    if (isConnected) {
        dotElement.classList.add('connected');
        dotElement.classList.remove('disconnected');
        textElement.textContent = `${serviceName}: Connected`;
    } else {
        dotElement.classList.remove('connected');
        dotElement.classList.add('disconnected');
        textElement.textContent = `${serviceName}: Disconnected`;
    }
    
    // Re-evaluate trading status
    reevaluateTradingStatus();
}

// Update trading status and button state
function updateTradingStatus(isActive, statusText) {
    // Update the global flag
    tradingActive = isActive;
    
    if (!tradingStatusDot || !tradingStatusText) return;
    
    if (isActive) {
        tradingStatusDot.classList.add('connected');
        tradingStatusDot.classList.remove('disconnected');
        tradingStatusText.textContent = statusText || 'Trading: Active';
        
        // Enable trading buttons
        enableTradingButtons();
    } else {
        tradingStatusDot.classList.remove('connected');
        tradingStatusDot.classList.add('disconnected');
        tradingStatusText.textContent = statusText || 'Trading: Paused';
        
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


// Make socket.on('connect') focus on re-requesting status
socket.on('connect', () => {
    console.log('Socket connected successfully with ID:', socket.id);
    
    // Mark response received
    systemStatus.lastBackendResponse = Date.now();
    
    // Request system status
    socket.emit('get-system-status');
    
    // Request initial data for all crypto cards with a delay
    // to ensure system is ready
    setTimeout(requestInitialData, 1500);
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

socket.on('trading-status', (status) => {
    console.log('Received trading status update from server:', status);
    
    // Note: We still use our local status mechanism rather than the server's
    // simply mark it as a backend response
    systemStatus.lastBackendResponse = Date.now();
});

socket.on('websocket-status', (status) => {
    console.log('Received WebSocket status update:', status);
    
    // Update websocket status in our system status
    systemStatus.websocket = status.connected || false;
    
    // Re-evaluate trading status
    reevaluateTradingStatus();
    
    // Mark as backend response
    systemStatus.lastBackendResponse = Date.now();
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
    
    // IMPORTANT: Track this price update time
    if (systemStatus.lastPriceUpdates.hasOwnProperty(baseSymbol)) {
        systemStatus.lastPriceUpdates[baseSymbol] = Date.now();
        
        // Make sure websocket status is true when receiving price updates
        if (!systemStatus.websocket) {
            systemStatus.websocket = true;
            updateWebSocketStatus(true);
            reevaluateTradingStatus();
        }
    }
    
    // Try to find the price element
    const priceElement = document.getElementById(`${baseSymbol}-price`);
    
    if (priceElement) {
        // Format the price with 2 decimal places
        const formattedPrice = parseFloat(price).toFixed(2);
        priceElement.textContent = `Price: $${formattedPrice}`;
    } else {
        console.warn(`Could not find price element for symbol ${baseSymbol}`);
    }
    
        // CRITICAL: If we're receiving price updates, the backend must be connected
    // Use the existing updateConnectionStatus function to update backend status
    updateConnectionStatus(true);
    
    // Mark response received and WebSocket as active
    systemStatus.lastBackendResponse = Date.now();
    systemStatus.websocket = true;
    
    // Re-evaluate trading status
    reevaluateTradingStatus();
});


// Function to update WebSocket status indicator
function updateWebSocketStatus(isConnected) {
    // Find WebSocket status elements in your UI
    const wsStatusElement = document.querySelector('#websocket-monitor .status-value#ws-connection-status');
    
    if (wsStatusElement) {
        wsStatusElement.textContent = isConnected ? 'Connected' : 'Disconnected (No price updates)';
        wsStatusElement.style.color = isConnected ? '#28a745' : '#dc3545';
    }
}

// Update reevaluateTradingStatus to prioritize WebSocket/price status
function reevaluateTradingStatus() {
    // Always check WebSocket/price updates first
    if (!systemStatus.websocket) {
        updateTradingStatus(false, "Trading: Paused (Waiting for price updates)");
        return;
    }
    
    // If prices are flowing, check other service statuses
    const allServicesConnected = (
        systemStatus.database &&
        systemStatus.binance &&
        systemStatus.telegram
    );
    
    // Create detailed status message
    let statusMessage = "Trading: ";
    
    if (!allServicesConnected) {
        // Determine which services are disconnected
        const disconnectedServices = [];
        
        if (!systemStatus.database) disconnectedServices.push("Database");
        if (!systemStatus.binance) disconnectedServices.push("Binance API");
        if (!systemStatus.telegram) disconnectedServices.push("Telegram API");
        
        // Create message based on disconnected services
        statusMessage += `Paused (Waiting for ${disconnectedServices.join(", ")})`;
        
        // Ensure trading is disabled
        updateTradingStatus(false, statusMessage);
    } else {
        // All services are connected, enable trading
        statusMessage += "Active";
        updateTradingStatus(true, statusMessage);
    }
}


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
    systemStatus.lastBackendResponse = Date.now();
});

// Transaction updates
socket.on('transaction-update', (data) => {
    const { symbol, transactions } = data;
    console.log(`Received transaction update for ${symbol}:`, transactions);
    updateTransactionHistory(symbol, transactions);
    
    // Mark response received
    systemStatus.lastBackendResponse = Date.now();
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
    systemStatus.lastBackendResponse = Date.now();
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
    systemStatus.lastBackendResponse = Date.now();
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
    systemStatus.lastBackendResponse = Date.now();
});

socket.on('first-purchase-result', (result) => {
    if (!result.success) {
        alert(`First purchase failed: ${result.error}`);
    } else {
        console.log('First purchase successful');
    }
    
    // Mark response received
    systemStatus.lastBackendResponse = Date.now();
});

socket.on('sell-all-result', (result) => {
    if (!result.success) {
        alert(`Sell all failed: ${result.error}`);
    } else {
        console.log('Sell all successful');
    }
    
    // Mark response received
    systemStatus.lastBackendResponse = Date.now();
});

// Heartbeat events to keep connection alive
socket.on('heartbeat', () => {
    // Update last response time
    systemStatus.lastBackendResponse = Date.now();
});

// Any other events from server
socket.onAny((eventName) => {
    // Update last response time for any event
    systemStatus.lastBackendResponse = Date.now();
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