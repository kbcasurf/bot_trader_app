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
    profitThreshold: 100, // Percentage where the profit bar maxes out (green)
    lossThreshold: -100, // Percentage where the loss bar maxes out (red)
    
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
    thresholds: {}, // Will store next buy/sell threshold prices
    initialPrices: {}, // Will store initial purchase prices
    lastBuyPrices: {}, // Will store last purchase prices
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
    
    // Add threshold price display after holdings
    const holdingsElement2 = card.querySelector('.holdings');
    if (holdingsElement2) {
        // Check if thresholds element already exists
        const existingThresholds = card.querySelector('.trade-thresholds');
        if (!existingThresholds) {
            // Only create thresholds element if it doesn't exist
            const thresholdsElement = document.createElement('div');
            thresholdsElement.className = 'trade-thresholds';
            thresholdsElement.innerHTML = `
                <div class="threshold buy">
                    <span class="label">Buy:</span>
                    <span class="value" id="${crypto.symbol}-next-buy-price">$0.00</span>
                </div>
                <div class="threshold sell">
                    <span class="label">Sell:</span>
                    <span class="value" id="${crypto.symbol}-sell-price">$0.00</span>
                </div>
            `;
            
            // Insert after holdings
            holdingsElement2.parentNode.insertBefore(thresholdsElement, holdingsElement2.nextSibling);
        }
    }
    
    // Update state tracking
    uiState.prices[crypto.symbol] = 0;
    uiState.holdings[crypto.symbol] = 0;
    uiState.profitLoss[crypto.symbol] = 0;
    uiState.investments[crypto.symbol] = CONFIG.presets[CONFIG.defaultPreset];
    uiState.isProcessing[crypto.symbol] = false;
/*     uiState.thresholds[crypto.symbol] = {
        nextBuy: 0,
        nextSell: 0
    }; */
    uiState.initialPrices[crypto.symbol] = 0;
    uiState.lastBuyPrices[crypto.symbol] = 0;
    
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
    
    // Update threshold display with new price
    updateThresholdDisplay(symbol);
    
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
        
        // Add automated class if transaction was automated
        if (transaction.automated) {
            item.classList.add('automated');
        }
        
        // Format date
        const date = new Date(transaction.timestamp);
        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        
        // Format transaction details
        item.textContent = `${transaction.type} - ${parseFloat(transaction.quantity).toLocaleString(undefined, { 
            minimumFractionDigits: 8, 
            maximumFractionDigits: 8 
        })} ${symbol.toUpperCase()} at $${parseFloat(transaction.price).toLocaleString(undefined, { 
            minimumFractionDigits: 2, 
            maximumFractionDigits: 2 
        })} - ${formattedDate}`;
        
        // Store the transaction data as a data attribute for easier retrieval
        item.dataset.type = transaction.type;
        item.dataset.price = transaction.price;
        item.dataset.quantity = transaction.quantity;
        item.dataset.timestamp = transaction.timestamp;
        item.dataset.automated = transaction.automated ? 'true' : 'false';
        
        historyList.appendChild(item);
    });
    
    // Update reference prices if provided
    if (data.refPrices) {
        uiState.thresholds[symbol] = {
            nextBuy: parseFloat(data.refPrices.next_buy_threshold) || 0,
            nextSell: parseFloat(data.refPrices.next_sell_threshold) || 0
        };
        
        uiState.initialPrices[symbol] = parseFloat(data.refPrices.initial_purchase_price) || 0;
        uiState.lastBuyPrices[symbol] = parseFloat(data.refPrices.last_purchase_price) || 0;
        
        // Update threshold display
        updateThresholdDisplay(symbol);
    }
    
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
    
    // Update threshold prices if provided
    if (data.nextBuyThreshold !== undefined) {
        uiState.thresholds[symbol] = {
            nextBuy: parseFloat(data.nextBuyThreshold) || 0,
            nextSell: parseFloat(data.nextSellThreshold) || 0
        };
    }
    
    if (data.initialPrice !== undefined) {
        uiState.initialPrices[symbol] = parseFloat(data.initialPrice) || 0;
    }
    
    if (data.lastBuyPrice !== undefined) {
        uiState.lastBuyPrices[symbol] = parseFloat(data.lastBuyPrice) || 0;
    }
    
    // Update state
    uiState.holdings[symbol] = amount;
    uiState.profitLoss[symbol] = profitLossPercent;
    
    // Update UI - holdings
    const holdingsElement = document.getElementById(`${symbol}-holdings`);
    if (holdingsElement) {
        holdingsElement.textContent = `${amount.toLocaleString(undefined, { minimumFractionDigits: 8, maximumFractionDigits: 8 })} ${symbol.toUpperCase()}`;
    }
    
    // Update threshold prices display
    updateThresholdDisplay(symbol);
    
    // Update profit/loss display
    updateProfitLossDisplay(symbol, profitLossPercent);
    
    // Reset processing flag
    uiState.isProcessing[symbol] = false;
    
    // Reset button states
    resetButtonStates(symbol);
}

// Update threshold display
function updateThresholdDisplay(symbol) {
    const nextBuyElement = document.getElementById(`${symbol}-next-buy-price`);
    const nextSellElement = document.getElementById(`${symbol}-sell-price`);
    
    if (!nextBuyElement || !nextSellElement) {
        return;
    }
    
    const thresholds = uiState.thresholds[symbol] || { nextBuy: 0, nextSell: 0 };
    const currentPrice = uiState.prices[symbol] || 0;
    
    // Update next buy price
    if (thresholds.nextBuy > 0) {
        nextBuyElement.textContent = `$${thresholds.nextBuy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        
        // Add visual indicator if price is close to buy threshold
        if (currentPrice <= thresholds.nextBuy * 1.01) {
            nextBuyElement.classList.add('imminent');
        } else {
            nextBuyElement.classList.remove('imminent');
        }
    } else {
        nextBuyElement.textContent = 'N/A';
        nextBuyElement.classList.remove('imminent');
    }
    
    // Update sell price
    if (thresholds.nextSell > 0) {
        nextSellElement.textContent = `$${thresholds.nextSell.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        
        // Add visual indicator if price is close to sell threshold
        if (currentPrice >= thresholds.nextSell * 0.99) {
            nextSellElement.classList.add('imminent');
        } else {
            nextSellElement.classList.remove('imminent');
        }
    } else {
        nextSellElement.textContent = 'N/A';
        nextSellElement.classList.remove('imminent');
    }
}

// Update profit/loss and trigger trading decisions
function updateProfitLoss(symbol) {
    // Skip if we don't have both price and holdings
    if (!uiState.prices[symbol] || uiState.holdings[symbol] === undefined) {
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
    
    // Store profit/loss percentage in state
    uiState.profitLoss[symbol] = profitLossPercent;
    
    // Update the display
    updateProfitLossDisplay(symbol, profitLossPercent);
}

// Get transactions for a specific symbol
function getTransactionsForSymbol(symbol) {
    // Look for transactions in data we have
    const historyList = document.getElementById(`${symbol}-history`);
    
    // If we don't have transactions in the DOM, we have none to process
    if (!historyList || historyList.querySelector('.no-transactions')) {
        return [];
    }
    
    // Parse transaction history from DOM if needed
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
        const type = item.classList.contains('buy') ? 'BUY' : 'SELL';
        
        // Extract price using data attributes
        const price = item.dataset.price || null;
        const quantity = item.dataset.quantity || null;
        const timestamp = item.dataset.timestamp || new Date().toISOString();
        const automated = item.dataset.automated === 'true';
        
        if (price && quantity) {
            transactions.push({
                type,
                price,
                quantity,
                timestamp,
                automated
            });
        }
    });
    
    // Cache the parsed transactions
    window.transactionCache[symbol] = transactions;
    
    return transactions;
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
        // Reset all processing flags for simplicity
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
        // Reset all processing flags for simplicity
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