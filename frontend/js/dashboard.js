// dashboard.js - Dashboard Management Module
// Responsible for UI updates, state management, and user interactions

// Import connection module
import * as Connections from './conns.js';

// Configuration and state management
const CONFIG = {
    // Supported cryptocurrencies with their symbols and image paths
    cryptos: [
        { symbol: 'btc', name: 'Bitcoin', image: 'images/btc.svg' },
        { symbol: 'sol', name: 'Solana', image: 'images/sol.svg' },
        { symbol: 'xrp', name: 'Ripple', image: 'images/xrp.svg' },
        { symbol: 'pendle', name: 'Pendle', image: 'images/pendle.svg' },
        { symbol: 'doge', name: 'Dogecoin', image: 'images/doge.svg' },
        { symbol: 'near', name: 'Near', image: 'images/near.svg' }
    ],
    
    // Investment preset values
    presets: [50, 100, 150, 200],
    defaultPreset: 1, // Index of default preset (100)
    
    // Profit/Loss thresholds for color changes
    profitThreshold: 5, // Percentage where the profit bar maxes out (green)
    lossThreshold: -5, // Percentage where the loss bar maxes out (red)
    
    // Auto-refresh interval in milliseconds
    refreshInterval: 30000 // 30 seconds
};

// UI state tracking
const uiState = {
    prices: {}, // Current prices for each cryptocurrency
    holdings: {}, // Current holdings
    profitLoss: {}, // Current profit/loss percentage
    investments: {}, // Selected investment amounts
    isProcessing: {}, // Flags for operations in progress
    isDarkMode: false, // Theme state
    lastBuyPrices: {}, // Tracks the last purchase price for each crypto
    initialPrices: {}, // Tracks the initial purchase price for each crypto
    autoBuyEnabled: true, // Flag to enable/disable automatic buying
    autoSellEnabled: true, // Flag to enable/disable automatic selling
    tradingThresholds: {
        buy: -5, // Buy when price drops this percentage from last purchase
        sell: 5  // Sell when price rises this percentage from initial purchase
    }
};

// Interval reference for periodic refreshes
let refreshInterval = null;

// Initialize dashboard after DOM is loaded
function initialize() {
    // Register for connection module events
    registerEventHandlers();
    
    // Create cryptocurrency cards
    createCryptoCards();
    
    // Set up theme toggle
    setupThemeToggle();
    
    // Setup automatic updates
    setupAutoRefresh();
    
    // Log initialization status
    console.log('Dashboard module initialized');
}

// Register event handlers for connection module events
function registerEventHandlers() {
    // Connection status events
    Connections.on('connect', handleConnectionEstablished);
    Connections.on('disconnect', handleConnectionLost);
    
    // Backend service status events
    Connections.on('database-status', updateDatabaseStatus);
    Connections.on('binance-status', updateBinanceStatus);
    Connections.on('telegram-status', updateTelegramStatus);
    Connections.on('websocket-status', updateWebSocketStatus);
    
    // Price update events
    Connections.on('price-update', updatePrice);
    
    // Transaction update events
    Connections.on('transaction-update', updateTransactions);
    
    // Holdings update events
    Connections.on('holdings-update', updateHoldings);
    
    // Order result events
    Connections.on('first-purchase-result', handleFirstPurchaseResult);
    Connections.on('sell-all-result', handleSellAllResult);
}

// Create cryptocurrency cards for all supported cryptos
function createCryptoCards() {
    const cryptoGrid = document.querySelector('.crypto-grid');
    const templateCard = document.getElementById('btc-card');
    
    // If no template card, log error and exit
    if (!templateCard) {
        console.error('BTC template card not found. Cannot create other crypto cards.');
        return;
    }
    
    // Make sure the template card is set specifically for BTC
    configureCryptoCard(templateCard, CONFIG.cryptos[0]);
    
    // Create cards for the rest of the cryptocurrencies (skipping BTC which is index 0)
    for (let i = 1; i < CONFIG.cryptos.length; i++) {
        const crypto = CONFIG.cryptos[i];
        
        // Clone the template card
        const newCard = templateCard.cloneNode(true);
        newCard.id = `${crypto.symbol}-card`;
        
        // Configure the new card
        configureCryptoCard(newCard, crypto);
        
        // Add the new card to the grid
        cryptoGrid.appendChild(newCard);
    }
}

// Configure a cryptocurrency card with specific data and event handlers
function configureCryptoCard(card, crypto) {
    // Set the symbol and name
    const headerLeft = card.querySelector('.crypto-header-left');
    if (headerLeft) {
        const img = headerLeft.querySelector('img');
        const heading = headerLeft.querySelector('h3');
        
        if (img) {
            // Use absolute paths for images to ensure they load correctly
            img.src = `/images/${crypto.symbol}.svg`;
            img.alt = crypto.name;
        }
        if (heading) heading.textContent = `${crypto.symbol.toUpperCase()}/USDT`;
    }
    
    // Set IDs for all elements
    const priceElement = card.querySelector('.current-price');
    const investmentInput = card.querySelector('input[type="hidden"]');
    const firstPurchaseButton = card.querySelector('.first-purchase');
    const holdingsElement = card.querySelector('.holdings span');
    const profitIndicator = card.querySelector('.profit-loss-indicator');
    const profitText = card.querySelector('.profit-loss-text span');
    const historyList = card.querySelector('.transaction-history ul');
    const sellButton = card.querySelector('.sell-all');
    
    if (priceElement) priceElement.id = `${crypto.symbol}-price`;
    if (investmentInput) investmentInput.id = `${crypto.symbol}-investment`;
    if (firstPurchaseButton) firstPurchaseButton.id = `${crypto.symbol}-first-purchase`;
    if (holdingsElement) holdingsElement.id = `${crypto.symbol}-holdings`;
    if (profitIndicator) profitIndicator.id = `${crypto.symbol}-profit-indicator`;
    if (profitText) profitText.id = `${crypto.symbol}-profit-text`;
    if (historyList) historyList.id = `${crypto.symbol}-history`;
    if (sellButton) sellButton.id = `${crypto.symbol}-sell-all`;
    
    // Update state tracking
    uiState.prices[crypto.symbol] = 0;
    uiState.holdings[crypto.symbol] = 0;
    uiState.profitLoss[crypto.symbol] = 0;
    uiState.investments[crypto.symbol] = CONFIG.presets[CONFIG.defaultPreset];
    uiState.isProcessing[crypto.symbol] = false;
    
    // Set up event handlers for the preset buttons
    const presetButtons = card.querySelectorAll('.slider-presets .preset-btn');
    presetButtons.forEach((button) => {
        // Set active class for the default preset
        if (parseFloat(button.dataset.value) === CONFIG.presets[CONFIG.defaultPreset]) {
            button.classList.add('active');
        }
        
        button.addEventListener('click', () => {
            // Remove active class from all buttons
            presetButtons.forEach(btn => btn.classList.remove('active'));
            
            // Add active class to clicked button
            button.classList.add('active');
            
            // Update investment value
            const value = parseFloat(button.dataset.value);
            investmentInput.value = value;
            uiState.investments[crypto.symbol] = value;
        });
    });
    
    // Set up first purchase button
    if (firstPurchaseButton) {
        firstPurchaseButton.addEventListener('click', () => {
            // Check if another operation is in progress
            if (uiState.isProcessing[crypto.symbol]) {
                console.warn(`Operation already in progress for ${crypto.symbol}`);
                return;
            }
            
            // Get investment amount
            const investmentAmount = uiState.investments[crypto.symbol];
            
            // Confirm purchase
            if (confirm(`Buy ${crypto.name} for $${investmentAmount}?`)) {
                // Set processing flag
                uiState.isProcessing[crypto.symbol] = true;
                firstPurchaseButton.classList.add('disabled');
                firstPurchaseButton.textContent = 'Processing...';
                
                // Execute buy order
                Connections.executeBuyOrder(crypto.symbol, investmentAmount);
                
                // Request transactions update
                Connections.requestTransactions(crypto.symbol);
            }
        });
    }
    
    // Set up sell all button
    if (sellButton) {
        sellButton.addEventListener('click', () => {
            // Check if another operation is in progress
            if (uiState.isProcessing[crypto.symbol]) {
                console.warn(`Operation already in progress for ${crypto.symbol}`);
                return;
            }
            
            // Check if there are holdings to sell
            if (uiState.holdings[crypto.symbol] <= 0) {
                alert(`You don't have any ${crypto.name} to sell.`);
                return;
            }
            
            // Confirm sell
            if (confirm(`Sell all your ${crypto.name} holdings?`)) {
                // Set processing flag
                uiState.isProcessing[crypto.symbol] = true;
                sellButton.classList.add('disabled');
                sellButton.textContent = 'Processing...';
                
                // Execute sell order
                Connections.executeSellOrder(crypto.symbol);
            }
        });
    }
    
    // Request transactions for this cryptocurrency
    setTimeout(() => {
        Connections.requestTransactions(crypto.symbol);
    }, 1000 + CONFIG.cryptos.indexOf(crypto) * 200); // Stagger requests
}

// Handle successful connection to backend
function handleConnectionEstablished() {
    console.log('Connection to backend established');
    
    // Update status indicators
    updateBackendStatus(true);
    
    // Request system status
    Connections.requestSystemStatus();
    
    // Request account info
    Connections.requestAccountInfo();
    
    // Request transactions for all cryptocurrencies
    CONFIG.cryptos.forEach(crypto => {
        setTimeout(() => {
            Connections.requestTransactions(crypto.symbol);
        }, 500 + CONFIG.cryptos.indexOf(crypto) * 200); // Stagger requests
    });
}

// Handle lost connection to backend
function handleConnectionLost(reason) {
    console.warn('Connection to backend lost:', reason);
    
    // Update status indicators
    updateBackendStatus(false);
    updateDatabaseStatus(false);
    updateBinanceStatus(false);
    updateTelegramStatus(false);
    updateWebSocketStatus({ connected: false });
}

// Update backend connection status
function updateBackendStatus(isConnected) {
    const statusDot = document.getElementById('backend-status-dot');
    const statusText = document.getElementById('backend-status-text');
    
    if (statusDot && statusText) {
        statusDot.className = isConnected ? 'status-dot connected' : 'status-dot disconnected';
        statusText.textContent = `Backend: ${isConnected ? 'Connected' : 'Disconnected'}`;
    }
}

// Update database connection status
function updateDatabaseStatus(isConnected) {
    const statusDot = document.getElementById('db-status-dot');
    const statusText = document.getElementById('db-status-text');
    
    if (statusDot && statusText) {
        statusDot.className = isConnected ? 'status-dot connected' : 'status-dot disconnected';
        statusText.textContent = `Database: ${isConnected ? 'Connected' : 'Disconnected'}`;
    }
}

// Update Binance API connection status
function updateBinanceStatus(isConnected) {
    const statusDot = document.getElementById('binance-status-dot');
    const statusText = document.getElementById('binance-status-text');
    
    if (statusDot && statusText) {
        statusDot.className = isConnected ? 'status-dot connected' : 'status-dot disconnected';
        statusText.textContent = `Binance: ${isConnected ? 'Connected' : 'Disconnected'}`;
    }
}

// Update Telegram bot connection status
function updateTelegramStatus(isConnected) {
    const statusDot = document.getElementById('telegram-status-dot');
    const statusText = document.getElementById('telegram-status-text');
    
    if (statusDot && statusText) {
        statusDot.className = isConnected ? 'status-dot connected' : 'status-dot disconnected';
        statusText.textContent = `Telegram: ${isConnected ? 'Connected' : 'Disconnected'}`;
    }
}

// Update WebSocket connection status
function updateWebSocketStatus(status) {
    // Optional WebSocket monitor update
    const wsMonitor = document.getElementById('websocket-monitor');
    const wsStatus = document.getElementById('ws-connection-status');
    
    if (wsMonitor && wsStatus) {
        wsMonitor.style.display = 'block';
        wsStatus.textContent = status.connected ? 'Connected' : 'Disconnected';
        wsStatus.className = `status-value ${status.connected ? 'connected' : 'disconnected'}`;
    }
}

// Update cryptocurrency price
function updatePrice(data) {
    // Check for valid data
    if (!data || !data.symbol || !data.price) {
        console.warn('Invalid price update data:', data);
        return;
    }
    
    const symbol = data.symbol.toLowerCase();
    const price = parseFloat(data.price);
    
    // Update state
    uiState.prices[symbol] = price;
    
    // Update UI
    const priceElement = document.getElementById(`${symbol}-price`);
    if (priceElement) {
        priceElement.textContent = `Price: $${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    
    // Update profit/loss if we have holdings
    updateProfitLoss(symbol);
}

// Update transaction history
function updateTransactions(data) {
    // Check for valid data
    if (!data || !data.transactions) {
        console.warn('Invalid transaction data:', data);
        return;
    }
    
    const symbol = data.symbol.toLowerCase();
    const transactions = data.transactions;
    
    // Get the history list element
    const historyList = document.getElementById(`${symbol}-history`);
    if (!historyList) {
        console.warn(`History list element not found for ${symbol}`);
        return;
    }
    
    // Clear the list
    historyList.innerHTML = '';
    
    // If no transactions, show message
    if (!transactions.length) {
        const noTransactionsItem = document.createElement('li');
        noTransactionsItem.className = 'no-transactions';
        noTransactionsItem.textContent = 'No transactions yet';
        historyList.appendChild(noTransactionsItem);
        return;
    }
    
    // Add transactions to the list
    transactions.forEach(transaction => {
        const item = document.createElement('li');
        item.className = transaction.type.toLowerCase();
        
        // Format date
        const date = new Date(transaction.timestamp);
        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        
        // Format transaction details
        item.textContent = `${transaction.type} - ${transaction.quantity} ${symbol.toUpperCase()} at ${parseFloat(transaction.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - ${formattedDate}`;
        
        // Store the transaction data as a data attribute for easier retrieval
        item.dataset.type = transaction.type;
        item.dataset.price = transaction.price;
        item.dataset.quantity = transaction.quantity;
        item.dataset.timestamp = transaction.timestamp;
        
        historyList.appendChild(item);
    });
    
    // Clear any cached transaction data for this symbol
    if (window.transactionCache && window.transactionCache[symbol]) {
        delete window.transactionCache[symbol];
    }
    
    // Recalculate profit/loss with new transaction data
    if (uiState.prices[symbol] && uiState.holdings[symbol] !== undefined) {
        // Small delay to ensure the DOM is updated
        setTimeout(() => {
            updateProfitLoss(symbol);
        }, 100);
    }
}

// Update holdings
function updateHoldings(data) {
    // Check for valid data
    if (!data || !data.symbol) {
        console.warn('Invalid holdings data:', data);
        return;
    }
    
    const symbol = data.symbol.toLowerCase();
    const amount = parseFloat(data.amount) || 0;
    const profitLossPercent = parseFloat(data.profitLossPercent) || 0;
    
    // Update state
    uiState.holdings[symbol] = amount;
    uiState.profitLoss[symbol] = profitLossPercent;
    
    // Update UI - holdings
    const holdingsElement = document.getElementById(`${symbol}-holdings`);
    if (holdingsElement) {
        holdingsElement.textContent = `${amount.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 })} ${symbol.toUpperCase()}`;
    }
    
    // Update profit/loss display
    updateProfitLossDisplay(symbol, profitLossPercent);
    
    // Reset processing flag
    uiState.isProcessing[symbol] = false;
    
    // Reset button states
    resetButtonStates(symbol);
}

// Update profit/loss and trigger trading decisions
function updateProfitLoss(symbol) {
    // Skip if we don't have both price and holdings
    if (!uiState.prices[symbol] || !uiState.holdings[symbol] === undefined) {
        return;
    }
    
    // Get current price
    const currentPrice = uiState.prices[symbol];
    
    // Get stored transaction data for this symbol
    const transactions = getTransactionsForSymbol(symbol);
    if (!transactions || transactions.length === 0) {
        return; // No transactions yet, nothing to calculate
    }
    
    // Get initial purchase price (the very first buy transaction)
    const initialBuyTx = transactions.find(tx => tx.type.toLowerCase() === 'buy');
    const initialPrice = initialBuyTx ? parseFloat(initialBuyTx.price) : null;
    
    // Get last purchase price (the most recent buy transaction)
    const buyTransactions = transactions.filter(tx => tx.type.toLowerCase() === 'buy');
    const lastBuyTx = buyTransactions.length > 0 ? 
        buyTransactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] : null;
    const lastPurchasePrice = lastBuyTx ? parseFloat(lastBuyTx.price) : null;
    
    // Skip if we don't have the necessary price data
    if (!initialPrice || !lastPurchasePrice) {
        return;
    }
    
    // Calculate profit/loss percentage from initial price
    const profitLossPercent = ((currentPrice - initialPrice) / initialPrice) * 100;
    
    // Calculate percentage change from last purchase
    const percentFromLastPurchase = ((currentPrice - lastPurchasePrice) / lastPurchasePrice) * 100;
    
    // Store profit/loss percentage in state
    uiState.profitLoss[symbol] = profitLossPercent;
    
    // Update the display
    updateProfitLossDisplay(symbol, profitLossPercent);
    
    // Check if we need to take action (only if not currently processing)
    if (uiState.isProcessing[symbol]) {
        return;
    }
    
    // TRADING AUTOMATION LOGIC
    
    // If price is 5% above initial purchase price, sell all holdings
    if (profitLossPercent >= 5) {
        console.log(`${symbol.toUpperCase()}: Price is 5% above initial purchase. Triggering sell.`);
        // Only sell if we have holdings
        if (uiState.holdings[symbol] > 0) {
            triggerSellAll(symbol);
        }
    }
    // If price is 5% below last purchase price, buy more
    else if (percentFromLastPurchase <= -5) {
        console.log(`${symbol.toUpperCase()}: Price is 5% below last purchase. Triggering buy.`);
        triggerBuyMore(symbol);
    }
}

// Get transactions for a specific symbol
function getTransactionsForSymbol(symbol) {
    // Look for transactions in data we have
    // Note: This function assumes transactions are stored in the DOM or a global cache
    // You might need to adapt this based on how you're storing transaction data
    
    const historyList = document.getElementById(`${symbol}-history`);
    
    // If we don't have transactions in the DOM, we have none to process
    if (!historyList || historyList.querySelector('.no-transactions')) {
        return [];
    }
    
    // Parse transaction history from DOM if needed
    // For now, we'll use a mock implementation
    // In a real implementation, you'd want to store this data properly
    const transactionItems = historyList.querySelectorAll('li:not(.no-transactions)');
    
    // Check if we've already parsed the transactions
    if (window.transactionCache && window.transactionCache[symbol]) {
        return window.transactionCache[symbol];
    }
    
    // Initialize cache if needed
    if (!window.transactionCache) {
        window.transactionCache = {};
    }
    
    // Parse transactions from DOM
    const transactions = [];
    transactionItems.forEach(item => {
        // Parse transaction details from text
        // Format example: "BUY - 0.001 BTC at $40000.00 - 2023-01-01 12:00"
        const text = item.textContent;
        const type = item.classList.contains('buy') ? 'BUY' : 'SELL';
        
        // Extract price using regex
        const priceMatch = text.match(/at \$([0-9,.]+)/);
        const price = priceMatch ? priceMatch[1].replace(/,/g, '') : null;
        
        // Extract quantity using regex
        const qtyMatch = text.match(/([0-9.]+) [A-Z]+/);
        const quantity = qtyMatch ? qtyMatch[1] : null;
        
        // Approximate timestamp (we don't need exact timestamps for this purpose)
        const timestamp = new Date().toISOString();
        
        if (price && quantity) {
            transactions.push({
                type,
                price,
                quantity,
                timestamp
            });
        }
    });
    
    // Cache the parsed transactions
    window.transactionCache[symbol] = transactions;
    
    return transactions;
}

// Trigger a sell all operation
function triggerSellAll(symbol) {
    // Abort if already processing
    if (uiState.isProcessing[symbol]) {
        return;
    }
    
    // Get UI elements
    const sellButton = document.getElementById(`${symbol}-sell-all`);
    
    // Set processing state
    uiState.isProcessing[symbol] = true;
    
    // Update UI
    if (sellButton) {
        sellButton.classList.add('disabled');
        sellButton.textContent = 'Auto-Selling...';
    }
    
    // Log the action
    console.log(`Auto-executing sell for ${symbol.toUpperCase()} based on 5% profit threshold`);
    
    // Execute the sell order
    Connections.executeSellOrder(symbol);
}

// Trigger a buy more operation
function triggerBuyMore(symbol) {
    // Abort if already processing
    if (uiState.isProcessing[symbol]) {
        return;
    }
    
    // Get UI elements
    const buyButton = document.getElementById(`${symbol}-first-purchase`);
    
    // Use the standard amount for additional purchases ($50)
    const additionalPurchaseAmount = 50;
    
    // Set processing state
    uiState.isProcessing[symbol] = true;
    
    // Update UI
    if (buyButton) {
        buyButton.classList.add('disabled');
        buyButton.textContent = 'Auto-Buying...';
    }
    
    // Log the action
    console.log(`Auto-executing buy for ${symbol.toUpperCase()} based on 5% dip threshold - Amount: ${additionalPurchaseAmount}`);
    
    // Execute buy order with fixed additional amount ($50)
    Connections.executeBuyOrder(symbol, additionalPurchaseAmount);
}

// Update profit/loss display
function updateProfitLossDisplay(symbol, percentage) {
    const indicator = document.getElementById(`${symbol}-profit-indicator`);
    const text = document.getElementById(`${symbol}-profit-text`);
    
    if (indicator && text) {
        // Calculate position on the profit/loss bar (0-100%)
        const range = CONFIG.profitThreshold - CONFIG.lossThreshold;
        const position = ((percentage - CONFIG.lossThreshold) / range) * 100;
        
        // Constrain position to 0-100%
        const clampedPosition = Math.max(0, Math.min(100, position));
        
        // Set indicator position
        indicator.style.left = `${clampedPosition}%`;
        
        // Set text with appropriate color
        text.textContent = `${percentage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
        
        if (percentage > 0) {
            text.className = 'profit';
        } else if (percentage < 0) {
            text.className = 'loss';
        } else {
            text.className = '';
        }
    }
}

// Handle first purchase result
function handleFirstPurchaseResult(result) {
    // No symbol in result, can't determine which cryptocurrency
    if (!result) {
        console.warn('Invalid first purchase result:', result);
        return;
    }
    
    // Extract symbol from result if available, otherwise reset all
    let symbolToReset = null;
    if (result.symbol) {
        symbolToReset = result.symbol.replace('USDT', '').toLowerCase();
    }
    
    if (symbolToReset) {
        // Reset only the specific symbol
        uiState.isProcessing[symbolToReset] = false;
        resetButtonStates(symbolToReset);
        
        // Clear transaction cache for this symbol
        if (window.transactionCache && window.transactionCache[symbolToReset]) {
            delete window.transactionCache[symbolToReset];
        }
        
        // Request updated transaction data
        Connections.requestTransactions(symbolToReset);
    } else {
        // For now, we'll reset all processing flags for simplicity
        CONFIG.cryptos.forEach(crypto => {
            uiState.isProcessing[crypto.symbol] = false;
            resetButtonStates(crypto.symbol);
        });
    }
    
    // Show appropriate message
    if (result.success) {
        console.log('First purchase successful');
    } else {
        alert(`Purchase failed: ${result.error || 'Unknown error'}`);
    }
}

// Handle sell all result
function handleSellAllResult(result) {
    // No symbol in result, can't determine which cryptocurrency
    if (!result) {
        console.warn('Invalid sell all result:', result);
        return;
    }
    
    // Extract symbol from result if available, otherwise reset all
    let symbolToReset = null;
    if (result.symbol) {
        symbolToReset = result.symbol.replace('USDT', '').toLowerCase();
    }
    
    if (symbolToReset) {
        // Reset only the specific symbol
        uiState.isProcessing[symbolToReset] = false;
        resetButtonStates(symbolToReset);
        
        // Clear transaction cache for this symbol
        if (window.transactionCache && window.transactionCache[symbolToReset]) {
            delete window.transactionCache[symbolToReset];
        }
        
        // Request updated transaction data
        Connections.requestTransactions(symbolToReset);
    } else {
        // For now, we'll reset all processing flags for simplicity
        CONFIG.cryptos.forEach(crypto => {
            uiState.isProcessing[crypto.symbol] = false;
            resetButtonStates(crypto.symbol);
        });
    }
    
    // Show appropriate message
    if (result.success) {
        console.log('Sell all successful');
    } else {
        alert(`Sell failed: ${result.error || 'Unknown error'}`);
    }
}

// Handle buy result (for both manual and automatic buys)
function handleBuyResult(result) {
    if (!result) {
        console.warn('Invalid buy result:', result);
        return;
    }
    
    // Extract symbol if available
    let symbolToUpdate = null;
    if (result.symbol) {
        symbolToUpdate = result.symbol.replace('USDT', '').toLowerCase();
    } else if (result.newBalance !== undefined) {
        // Try to determine symbol from other fields if possible
        // This would need adaptation based on your API response format
    }
    
    // Reset processing state if we have a symbol
    if (symbolToUpdate) {
        uiState.isProcessing[symbolToUpdate] = false;
        resetButtonStates(symbolToUpdate);
        
        // Clear transaction cache for this symbol
        if (window.transactionCache && window.transactionCache[symbolToUpdate]) {
            delete window.transactionCache[symbolToUpdate];
        }
        
        // Request updated data
        Connections.requestTransactions(symbolToUpdate);
    } else {
        // Reset all if we can't determine the specific symbol
        CONFIG.cryptos.forEach(crypto => {
            uiState.isProcessing[crypto.symbol] = false;
            resetButtonStates(crypto.symbol);
        });
    }
    
    // Log result
    if (result.success) {
        console.log('Buy operation successful');
    } else {
        console.error('Buy operation failed:', result.error || 'Unknown error');
    }
}

// Handle sell result (for both manual and automatic sells)
function handleSellResult(result) {
    if (!result) {
        console.warn('Invalid sell result:', result);
        return;
    }
    
    // Extract symbol if available
    let symbolToUpdate = null;
    if (result.symbol) {
        symbolToUpdate = result.symbol.replace('USDT', '').toLowerCase();
    } else if (result.newBalance !== undefined) {
        // Try to determine symbol from other fields if possible
        // This would need adaptation based on your API response format
    }
    
    // Reset processing state if we have a symbol
    if (symbolToUpdate) {
        uiState.isProcessing[symbolToUpdate] = false;
        resetButtonStates(symbolToUpdate);
        
        // Clear transaction cache for this symbol
        if (window.transactionCache && window.transactionCache[symbolToUpdate]) {
            delete window.transactionCache[symbolToUpdate];
        }
        
        // Request updated data
        Connections.requestTransactions(symbolToUpdate);
    } else {
        // Reset all if we can't determine the specific symbol
        CONFIG.cryptos.forEach(crypto => {
            uiState.isProcessing[crypto.symbol] = false;
            resetButtonStates(crypto.symbol);
        });
    }
    
    // Log result
    if (result.success) {
        console.log('Sell operation successful');
    } else {
        console.error('Sell operation failed:', result.error || 'Unknown error');
    }
}

// Reset button states after operation completes
function resetButtonStates(symbol) {
    const buyButton = document.getElementById(`${symbol}-first-purchase`);
    const sellButton = document.getElementById(`${symbol}-sell-all`);
    
    if (buyButton) {
        buyButton.classList.remove('disabled');
        buyButton.textContent = 'Buy Crypto';
    }
    
    if (sellButton) {
        sellButton.classList.remove('disabled');
        sellButton.textContent = 'Sell All';
    }
}

// Set up theme toggle
function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    
    if (themeToggle) {
        // Check for saved theme preference
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggle.checked = true;
            uiState.isDarkMode = true;
        }
        
        // Add event listener for theme toggle
        themeToggle.addEventListener('change', () => {
            if (themeToggle.checked) {
                document.body.classList.add('dark-mode');
                localStorage.setItem('theme', 'dark');
                uiState.isDarkMode = true;
            } else {
                document.body.classList.remove('dark-mode');
                localStorage.setItem('theme', 'light');
                uiState.isDarkMode = false;
            }
        });
    }
}

// Set up automatic refresh
function setupAutoRefresh() {
    // Clear any existing interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
    }
    
    // Start new refresh interval
    refreshInterval = setInterval(() => {
        // Request system status
        Connections.requestSystemStatus();
        
        // Request transactions for all cryptocurrencies
        CONFIG.cryptos.forEach(crypto => {
            Connections.requestTransactions(crypto.symbol);
        });
        
        console.log('Auto-refresh: Updated data from server');
    }, CONFIG.refreshInterval);
}

// Export public API
export {
    initialize
};