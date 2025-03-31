// Import socket.io client
import { io } from 'socket.io-client';

// Create and configure socket connection
const socket = io({
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 30000,
    autoConnect: true,
    forceNew: true
});

// Add missing whenDomReady function
function whenDomReady(callback) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', callback);
  } else {
    callback();
  }
}

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


// Define supported crypto configurations
const supportedCryptos = [
    { symbol: 'BTC', fullName: 'Bitcoin', icon: 'frontend/images/btc.svg' },
    { symbol: 'SOL', fullName: 'Solana', icon: 'frontend/images/sol.svg' },
    { symbol: 'XRP', fullName: 'Ripple', icon: 'frontend/images/xrp.svg' },
    { symbol: 'PENDLE', fullName: 'Pendle', icon: 'frontend/images/pendle.svg' },
    { symbol: 'DOGE', fullName: 'Dogecoin', icon: 'frontend/images/doge.svg' },
    { symbol: 'NEAR', fullName: 'NEAR Protocol', icon: 'frontend/images/near.svg' }
];


// Request initial data for all crypto cards
function requestInitialData() {
    console.log('Requesting initial data for all crypto cards...');
    
    // Request data for each symbol
    supportedCryptos.forEach(crypto => {
        // Request transaction history
        socket.emit('get-transactions', { symbol: `${crypto.symbol}USDT` });
        console.log(`Requested transaction history for ${crypto.symbol}`);
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
    
    const gridElement = document.querySelector('.crypto-grid');
    if (!gridElement) {
        console.error('Crypto grid element not found!');
        return;
    }
    
    // Clear existing cards except for the BTC one which is in the HTML
    const existingCards = gridElement.querySelectorAll('.crypto-card:not(#btc-card)');
    existingCards.forEach(card => card.remove());
    
    // Find the BTC card to use as a template
    const btcCard = document.getElementById('btc-card');
    if (!btcCard) {
        console.error('BTC card template not found in the DOM!');
        return;
    }
    
    // Create cards for each supported crypto except BTC (already in HTML)
    supportedCryptos.slice(1).forEach(crypto => {
        const symbol = crypto.symbol.toLowerCase();
        
        // Clone the BTC card
        const newCard = btcCard.cloneNode(true);
        newCard.id = `${symbol}-card`;
        
        // Update card header
        const headerContainer = newCard.querySelector('.crypto-header-left');
        if (headerContainer) {
            const headerText = headerContainer.querySelector('h3');
            if (headerText) {
                headerText.textContent = `${crypto.symbol}/USDT`;
            }
            
            // Update icon
            const iconImage = headerContainer.querySelector('.crypto-icon');
            if (iconImage) {
                iconImage.src = crypto.icon;
                iconImage.alt = crypto.fullName;
            }
        }
        
        // Find ALL elements with IDs and update them
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
            if (!card) return;
            
            const investmentInput = card.querySelector('input[type="hidden"]');
            if (!investmentInput) return;
            
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
            if (!card) return;
            
            const symbol = card.id.replace('-card', '').toUpperCase() + 'USDT';
            const investmentInput = card.querySelector('input[type="hidden"]');
            if (!investmentInput) return;
            
            const investment = investmentInput.value;
            
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
            if (!card) return;
            
            const symbol = card.id.replace('-card', '').toUpperCase() + 'USDT';
            const holdingsElement = card.querySelector('.holdings span');
            if (!holdingsElement) return;
            
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
    
    // Sort transactions by timestamp (newest first)
    const sortedTransactions = [...transactions].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );
    
    // Add transactions to the history list
    sortedTransactions.forEach(transaction => {
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
    
    // Calculate and update profit/loss
    calculateProfitLoss(symbol, transactions);
}

// Calculate profit and loss based on transaction history
function calculateProfitLoss(symbol, transactions) {
    if (!transactions || transactions.length === 0) return;
    
    // Clone the transactions array to avoid modifying the original
    const txs = [...transactions];
    
    // Sort transactions by timestamp (oldest first for calculation)
    txs.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    let totalBuyAmount = 0;      // Total USDT invested
    let totalBuyQuantity = 0;    // Total quantity purchased
    let totalSellAmount = 0;     // Total USDT received from sales
    let totalSellQuantity = 0;   // Total quantity sold
    let remainingQuantity = 0;   // Current holdings
    
    // Calculate weighted average purchase price
    txs.forEach(tx => {
        const quantity = parseFloat(tx.quantity);
        const price = parseFloat(tx.price);
        const amount = quantity * price;
        
        if (tx.type === 'BUY') {
            totalBuyAmount += amount;
            totalBuyQuantity += quantity;
            remainingQuantity += quantity;
        } else if (tx.type === 'SELL') {
            totalSellAmount += amount;
            totalSellQuantity += quantity;
            remainingQuantity -= quantity;
        }
    });
    
    // Get current price from UI
    const priceElement = document.getElementById(`${symbol.toLowerCase()}-price`);
    const currentPriceText = priceElement ? priceElement.textContent : 'Price: $0.00';
    const currentPrice = parseFloat(currentPriceText.replace('Price: $', '')) || 0;
    
    // Calculate average buy price (weighted average)
    const avgBuyPrice = totalBuyQuantity > 0 ? totalBuyAmount / totalBuyQuantity : 0;
    
    // Calculate current portfolio value
    const currentValue = remainingQuantity * currentPrice;
    
    // Calculate cost basis (adjusted for sells)
    const costBasis = (totalBuyQuantity > 0) 
        ? (totalBuyAmount * (remainingQuantity / totalBuyQuantity)) 
        : 0;
    
    // Calculate unrealized profit/loss
    const unrealizedPL = costBasis > 0 ? currentValue - costBasis : 0;
    
    // Calculate profit/loss percentage relative to total investment
    let plPercentage = 0;
    if (costBasis > 0) {
        plPercentage = (unrealizedPL / costBasis) * 100;
    }
    
    // Update UI with profit/loss information
    const textElement = document.getElementById(`${symbol.toLowerCase()}-profit-text`);
    if (textElement) {
        textElement.textContent = `${plPercentage.toFixed(2)}%`;
        
        // Add appropriate class based on profit/loss
        if (plPercentage > 0) {
            textElement.classList.add('profit');
            textElement.classList.remove('loss');
        } else if (plPercentage < 0) {
            textElement.classList.add('loss');
            textElement.classList.remove('profit');
        } else {
            textElement.classList.remove('profit', 'loss');
        }
    }
    
    // Update profit/loss indicator
    updateProfitLossIndicator(symbol.toLowerCase(), plPercentage);
}

// Function to update profit/loss indicator
function updateProfitLossIndicator(symbol, profitLossPercent) {
    const indicator = document.getElementById(`${symbol}-profit-indicator`);
    if (!indicator) return;
    
    // Calculate position (0% is center at 50%, range is -5% to +5%)
    // Convert from -5% to +5% to 0% to 100%
    const position = Math.min(Math.max((profitLossPercent + 5) / 1000 * 100, 0), 100);
    
    // Update indicator position
    indicator.style.left = `${position}%`;
    
    // Update color based on profit/loss
    if (profitLossPercent > 0) {
        indicator.style.borderBottomColor = '#2ecc71'; // Green for profit
    } else if (profitLossPercent < 0) {
        indicator.style.borderBottomColor = '#e74c3c'; // Red for loss
    } else {
        indicator.style.borderBottomColor = '#f1c40f'; // Yellow for neutral
    }
}

// SOCKET EVENT HANDLERS

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

// Account info
socket.on('account-info', (accountInfo) => {
    console.log('Account info received:', accountInfo);
    
    if (accountInfo && accountInfo.balances) {
        // Process each supported cryptocurrency
        supportedCryptos.forEach(crypto => {
            const symbol = crypto.symbol;
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
    
    // Update profit/loss text
    const textElement = document.getElementById(`${symbol.toLowerCase()}-profit-text`);
    
    if (textElement) {
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
    
    // Update profit/loss indicator
    updateProfitLossIndicator(symbol.toLowerCase(), profitLossPercent);
    
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

// Element verification function
function verifyElements() {
    console.log("Verifying DOM elements...");
    
    const cryptoSymbols = supportedCryptos.map(crypto => crypto.symbol.toLowerCase());
    const missingElements = [];
    
    cryptoSymbols.forEach(symbol => {
        // Check critical elements
        const elements = [
            `${symbol}-price`,
            `${symbol}-holdings`,
            `${symbol}-history`,
            `${symbol}-profit-text`,
            `${symbol}-profit-indicator`
        ];
        
        elements.forEach(id => {
            const element = document.getElementById(id);
            if (!element) {
                missingElements.push(id);
            }
        });
    });
    
    if (missingElements.length > 0) {
        console.warn(`Missing ${missingElements.length} elements: ${missingElements.join(', ')}`);
        console.log("Attempting to recreate crypto cards...");
        
        // Try to fix by recreating the crypto cards
        createCryptoCards();
        attachEventListeners();
        
        // Check again after recreating
        setTimeout(() => {
            const stillMissing = [];
            
            cryptoSymbols.forEach(symbol => {
                const elements = [
                    `${symbol}-price`,
                    `${symbol}-holdings`,
                    `${symbol}-history`,
                    `${symbol}-profit-text`,
                    `${symbol}-profit-indicator`
                ];
                
                elements.forEach(id => {
                    const element = document.getElementById(id);
                    if (!element) {
                        stillMissing.push(id);
                    }
                });
            });
            
            if (stillMissing.length > 0) {
                console.error(`Still missing elements after fix attempt: ${stillMissing.join(', ')}`);
            } else {
                console.log("All elements now present after fix");
            }
        }, 500);
    } else {
        console.log("All required elements found");
    }
}

// Initialize the application when the DOM is ready
whenDomReady(() => {
    // Wait a short time for everything to render completely
    setTimeout(() => {
        initializeApp();
        
        // Request initial system status
        socket.emit('get-system-status');
        
        console.log('Application initialized and ready');
        
        // Request initial data for crypto cards after a delay
        setTimeout(requestInitialData, 2000);
        
        // Verify elements after initialization
        setTimeout(verifyElements, 3000);
    }, 500);
});