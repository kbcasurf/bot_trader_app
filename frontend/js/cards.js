// frontend/js/cards.js
// Cryptocurrency Card Module
// Handles rendering and state management for cryptocurrency cards

// Import socket connection from connections module
import * as Connections from './conns.js';

// Configuration for cards
const CARD_CONFIG = {
    // Supported cryptocurrencies
    SUPPORTED_CRYPTOS: [
        { symbol: 'btc', name: 'Bitcoin', image: '/images/btc.svg' },
        { symbol: 'sol', name: 'Solana', image: '/images/sol.svg' },
        { symbol: 'xrp', name: 'Ripple', image: '/images/xrp.svg' },
        { symbol: 'doge', name: 'Dogecoin', image: '/images/doge.svg' },
        { symbol: 'near', name: 'Near', image: '/images/near.svg' },
        { symbol: 'pendle', name: 'Pendle', image: '/images/pendle.svg' }
    ],
    
    // Investment presets
    PRESETS: [50, 100, 150, 200],
    DEFAULT_PRESET: 1, // Index of default preset (100)
    
    // Profit/Loss thresholds for color scales
    PROFIT_THRESHOLD: 5,  // Percentage where profit bar maxes out (green)
    LOSS_THRESHOLD: -5,   // Percentage where loss bar maxes out (red)
    
    // Animation durations in milliseconds
    ANIMATION: {
        PRICE_CHANGE: 1000,
        PROFIT_LOSS: 800
    }
};

// Card state tracking
const cardState = {
    prices: {},          // Current prices for each symbol
    holdings: {},        // Current holdings for each symbol
    profitLoss: {},      // Current profit/loss percentages
    investment: {},      // Selected investment amounts
    thresholds: {},      // Next buy/sell thresholds
    isProcessing: {},    // Processing flags for operations
    priceHistory: {},    // Recent price history for animations
    lastUpdated: {},     // Timestamps of last updates
    elements: {}         // References to DOM elements for each card
};

/**
 * Initialize card module
 */
function initialize() {
    console.log('Initializing card module...');
    
    // Initialize state for all supported cryptocurrencies
    CARD_CONFIG.SUPPORTED_CRYPTOS.forEach(crypto => {
        const symbol = crypto.symbol;
        cardState.prices[symbol] = 0;
        cardState.holdings[symbol] = 0;
        cardState.profitLoss[symbol] = 0;
        cardState.investment[symbol] = CARD_CONFIG.PRESETS[CARD_CONFIG.DEFAULT_PRESET];
        cardState.thresholds[symbol] = { nextBuy: 0, nextSell: 0 };
        cardState.isProcessing[symbol] = false;
        cardState.priceHistory[symbol] = [];
        cardState.lastUpdated[symbol] = 0;
        cardState.elements[symbol] = {};
    });
    
    // Register for connection events
    registerConnectionEvents();
    
    console.log('Card module initialized');
    return true;
}

/**
 * Register for connection events to receive updates
 */
function registerConnectionEvents() {
    // Price updates
    Connections.on('price-update', handlePriceUpdate);
    
    // Transaction updates
    Connections.on('transaction-update', handleTransactionUpdate);
    
    // Holdings updates
    Connections.on('holdings-update', handleHoldingsUpdate);
    
    // Batch data updates
    Connections.on('batch-data-update', handleBatchDataUpdate);
    
    // Order result events
    Connections.on('first-purchase-result', handleFirstPurchaseResult);
    Connections.on('sell-all-result', handleSellAllResult);
}

/**
 * Create a cryptocurrency card
 * @param {Object} crypto - Cryptocurrency info object
 * @param {string} crypto.symbol - Symbol (e.g., 'btc')
 * @param {string} crypto.name - Display name
 * @param {string} crypto.image - Image path
 * @returns {HTMLElement} Card element
 */
function createCard(crypto) {
    const symbol = crypto.symbol;
    
    // Create card container
    const card = document.createElement('div');
    card.className = 'crypto-card';
    card.id = `${symbol}-card`;
    
    // Create card content
    card.innerHTML = `
        <div class="crypto-header">
            <div class="crypto-header-left">
                <img src="${crypto.image}" alt="${crypto.name}" class="crypto-icon">
                <h3>${symbol.toUpperCase()}/USDT</h3>
            </div>
            <span class="current-price" id="${symbol}-price">Price: $0.00</span>
        </div>
        <div class="investment-slider">
            <label for="${symbol}-investment">Investment Amount:</label>
            <div class="slider-presets">
                <button class="preset-btn" data-value="50">$50</button>
                <button class="preset-btn active" data-value="100">$100</button>
                <button class="preset-btn" data-value="150">$150</button>
                <button class="preset-btn" data-value="200">$200</button>
            </div>
            <input type="hidden" id="${symbol}-investment" value="100">
        </div>
        <button class="action-btn first-purchase" id="${symbol}-first-purchase">Buy Crypto</button>
        <div class="holdings">
            <p>Current holdings: <span id="${symbol}-holdings">0.00 ${symbol.toUpperCase()}</span></p>
        </div>
        <div class="trade-thresholds">
            <div class="threshold buy">
                <span class="label">Buy:</span>
                <span class="value" id="${symbol}-next-buy-price">$0.00</span>
            </div>
            <div class="threshold sell">
                <span class="label">Sell:</span>
                <span class="value" id="${symbol}-next-sell-price">$0.00</span>
            </div>
        </div>
        <div class="profit-loss-container">
            <div class="profit-loss-bar"></div>
            <div class="profit-loss-indicator" id="${symbol}-profit-indicator"></div>
            <div class="profit-loss-scale">
                <span>-5%</span>
                <span>0%</span>
                <span>+5%</span>
            </div>
            <p class="profit-loss-text">Profit/Loss: <span id="${symbol}-profit-text">0.00%</span></p>
        </div>
        <div class="transaction-history">
            <h4>Transaction History</h4>
            <ul id="${symbol}-history">
                <li class="no-transactions">No transactions yet</li>
            </ul>
        </div>
        <button class="action-btn sell-all" id="${symbol}-sell-all">Sell All</button>
    `;
    
    // Store element references
    cardState.elements[symbol] = {
        card: card,
        priceEl: card.querySelector(`#${symbol}-price`),
        holdingsEl: card.querySelector(`#${symbol}-holdings`),
        investmentEl: card.querySelector(`#${symbol}-investment`),
        firstPurchaseBtn: card.querySelector(`#${symbol}-first-purchase`),
        sellBtn: card.querySelector(`#${symbol}-sell-all`),
        nextBuyEl: card.querySelector(`#${symbol}-next-buy-price`),
        nextSellEl: card.querySelector(`#${symbol}-next-sell-price`),
        profitIndicator: card.querySelector(`#${symbol}-profit-indicator`),
        profitText: card.querySelector(`#${symbol}-profit-text`),
        historyList: card.querySelector(`#${symbol}-history`),
        presetBtns: card.querySelectorAll('.slider-presets .preset-btn')
    };
    
    // Set up event handlers
    setupCardEventHandlers(symbol);
    
    return card;
}

/**
 * Set up event handlers for a cryptocurrency card
 * @param {string} symbol - Cryptocurrency symbol
 */
function setupCardEventHandlers(symbol) {
    const elements = cardState.elements[symbol];
    
    // Investment preset buttons
    elements.presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active class from all buttons
            elements.presetBtns.forEach(b => b.classList.remove('active'));
            
            // Add active class to clicked button
            btn.classList.add('active');
            
            // Update investment value
            const value = parseFloat(btn.dataset.value);
            elements.investmentEl.value = value;
            cardState.investment[symbol] = value;
        });
    });
    
    // First purchase button
    elements.firstPurchaseBtn.addEventListener('click', () => {
        // Skip if already processing
        if (cardState.isProcessing[symbol]) {
            return;
        }
        
        // Get investment amount
        const amount = cardState.investment[symbol];
        
        // Confirm with user
        if (confirm(`Buy ${symbol.toUpperCase()} for $${amount}?`)) {
            // Set processing state
            setProcessingState(symbol, true);
            
            // Execute buy by sending event to backend
            Connections.emit('first-purchase', {
                symbol: symbol.toUpperCase() + 'USDT',
                investment: amount
            });
        }
    });
    
    // Sell all button
    elements.sellBtn.addEventListener('click', () => {
        // Skip if already processing
        if (cardState.isProcessing[symbol]) {
            return;
        }
        
        // Skip if no holdings
        if (cardState.holdings[symbol] <= 0) {
            alert(`You don't have any ${symbol.toUpperCase()} to sell.`);
            return;
        }
        
        // Confirm with user
        if (confirm(`Sell all your ${symbol.toUpperCase()} holdings?`)) {
            // Set processing state
            setProcessingState(symbol, true, 'sell');
            
            // Execute sell by sending event to backend
            Connections.emit('sell-all', {
                symbol: symbol.toUpperCase() + 'USDT'
            });
        }
    });
}

/**
 * Set processing state for a card
 * @param {string} symbol - Cryptocurrency symbol
 * @param {boolean} isProcessing - Whether card is in processing state
 * @param {string} type - Type of operation ('buy' or 'sell')
 */
function setProcessingState(symbol, isProcessing, type = 'buy') {
    const elements = cardState.elements[symbol];
    if (!elements) return;
    
    // Update state
    cardState.isProcessing[symbol] = isProcessing;
    
    if (isProcessing) {
        // Disable buttons and show processing state
        if (type === 'buy') {
            elements.firstPurchaseBtn.classList.add('disabled');
            elements.firstPurchaseBtn.textContent = 'Processing...';
        } else {
            elements.sellBtn.classList.add('disabled');
            elements.sellBtn.textContent = 'Processing...';
        }
    } else {
        // Reset buttons
        elements.firstPurchaseBtn.classList.remove('disabled');
        elements.firstPurchaseBtn.textContent = 'Buy Crypto';
        
        elements.sellBtn.classList.remove('disabled');
        elements.sellBtn.textContent = 'Sell All';
    }
}

/**
 * Handle price update event
 * @param {Object} data - Price update data
 */
function handlePriceUpdate(data) {
    if (!data || !data.symbol || data.price === undefined) {
        return;
    }
    
    const fullSymbol = data.symbol.toUpperCase();
    // Extract base symbol (remove USDT)
    const symbol = fullSymbol.replace('USDT', '').toLowerCase();
    const price = parseFloat(data.price);
    
    // Skip if not a supported crypto
    if (!cardState.prices.hasOwnProperty(symbol)) {
        return;
    }
    
    // Store previous price for animation
    const prevPrice = cardState.prices[symbol];
    
    // Update state
    cardState.prices[symbol] = price;
    cardState.lastUpdated[symbol] = Date.now();
    
    // Add to price history (max 10 entries)
    cardState.priceHistory[symbol].push({ price, timestamp: Date.now() });
    if (cardState.priceHistory[symbol].length > 10) {
        cardState.priceHistory[symbol].shift();
    }
    
    // Update UI with animation
    updateCardPrice(symbol, price, prevPrice);
    
    // Update profit/loss display
    if (cardState.holdings[symbol] > 0) {
        calculateAndUpdateProfitLoss(symbol);
    }
    
    // Update threshold display
    updateThresholdDisplay(symbol);
}

/**
 * Update card price display with animation
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} newPrice - New price
 * @param {number} prevPrice - Previous price
 */
function updateCardPrice(symbol, newPrice, prevPrice) {
    const priceEl = cardState.elements[symbol]?.priceEl;
    if (!priceEl) return;
    
    // Format price with thousands separators and 2 decimal places
    const formattedPrice = newPrice.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    
    // Update display
    priceEl.textContent = `Price: $${formattedPrice}`;
    
    // Add price change animation class
    if (prevPrice > 0 && newPrice !== prevPrice) {
        const changeClass = newPrice > prevPrice ? 'price-up' : 'price-down';
        
        // Remove any existing classes
        priceEl.classList.remove('price-up', 'price-down');
        
        // Add new class
        priceEl.classList.add(changeClass);
        
        // Remove class after animation completes
        setTimeout(() => {
            priceEl.classList.remove(changeClass);
        }, CARD_CONFIG.ANIMATION.PRICE_CHANGE);
    }
}

/**
 * Handle transaction update event
 * @param {Object} data - Transaction update data
 */
function handleTransactionUpdate(data) {
    if (!data || !data.symbol) {
        return;
    }
    
    // Extract base symbol (remove USDT)
    const symbol = data.symbol.toLowerCase().replace('usdt', '');
    
    // Skip if not a supported crypto
    if (!cardState.holdings.hasOwnProperty(symbol)) {
        return;
    }
    
    // Update transaction history
    updateTransactionHistory(symbol, data.transactions);
    
    // Store reference prices if provided
    if (data.refPrices) {
        cardState.thresholds[symbol] = {
            nextBuy: parseFloat(data.refPrices.next_buy_threshold) || 0,
            nextSell: parseFloat(data.refPrices.next_sell_threshold) || 0,
            initialPrice: parseFloat(data.refPrices.initial_purchase_price) || 0
        };
        
        // Update threshold display
        updateThresholdDisplay(symbol);
    }
}

/**
 * Update transaction history display
 * @param {string} symbol - Cryptocurrency symbol
 * @param {Array} transactions - Transaction data array
 */
function updateTransactionHistory(symbol, transactions) {
    const historyList = cardState.elements[symbol]?.historyList;
    if (!historyList) return;
    
    // Clear current list
    historyList.innerHTML = '';
    
    // If no transactions, show message
    if (!transactions || transactions.length === 0) {
        const noTxMsg = document.createElement('li');
        noTxMsg.className = 'no-transactions';
        noTxMsg.textContent = 'No transactions yet';
        historyList.appendChild(noTxMsg);
        return;
    }
    
    // Add transactions to list (most recent first)
    transactions.slice(0, 10).forEach(tx => {
        const item = document.createElement('li');
        item.className = tx.type.toLowerCase();
        
        // Add automated class if transaction was automated
        if (tx.automated) {
            item.classList.add('automated');
        }
        
        // Format date
        const date = new Date(tx.timestamp);
        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        
        // Format price and quantity
        const formattedPrice = parseFloat(tx.price).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        const formattedQty = parseFloat(tx.quantity).toLocaleString(undefined, {
            minimumFractionDigits: 8,
            maximumFractionDigits: 8
        });
        
        // Create item content
        item.textContent = `${tx.type} - ${formattedQty} ${symbol.toUpperCase()} at $${formattedPrice} - ${formattedDate}`;
        
        // Add to list
        historyList.appendChild(item);
    });
}

/**
 * Handle holdings update event
 * @param {Object} data - Holdings update data
 */
function handleHoldingsUpdate(data) {
    if (!data || !data.symbol) {
        return;
    }
    
    // Extract base symbol (remove USDT)
    const symbol = data.symbol.toLowerCase().replace('usdt', '');
    
    // Skip if not a supported crypto
    if (!cardState.holdings.hasOwnProperty(symbol)) {
        return;
    }
    
    // Update state
    cardState.holdings[symbol] = parseFloat(data.amount) || 0;
    cardState.lastUpdated[symbol] = Date.now();
    
    // If profit/loss percentage is provided, use it
    if (data.profitLossPercent !== undefined) {
        cardState.profitLoss[symbol] = parseFloat(data.profitLossPercent);
        updateProfitLossDisplay(symbol, cardState.profitLoss[symbol]);
    }
    
    // If thresholds are provided, update them
    if (data.nextBuyThreshold !== undefined && data.nextSellThreshold !== undefined) {
        cardState.thresholds[symbol] = {
            nextBuy: parseFloat(data.nextBuyThreshold) || 0,
            nextSell: parseFloat(data.nextSellThreshold) || 0,
            initialPrice: parseFloat(data.initialPrice) || cardState.thresholds[symbol]?.initialPrice || 0
        };
        
        // Update threshold display
        updateThresholdDisplay(symbol);
    }
    
    // Update holdings display
    updateHoldingsDisplay(symbol);
    
    // Reset processing state
    setProcessingState(symbol, false);
}

/**
 * Update holdings display
 * @param {string} symbol - Cryptocurrency symbol
 */
function updateHoldingsDisplay(symbol) {
    const holdingsEl = cardState.elements[symbol]?.holdingsEl;
    if (!holdingsEl) return;
    
    // Format holdings with 8 decimal places
    const formattedHoldings = cardState.holdings[symbol].toLocaleString(undefined, {
        minimumFractionDigits: 8,
        maximumFractionDigits: 8
    });
    
    // Update display
    holdingsEl.textContent = `${formattedHoldings} ${symbol.toUpperCase()}`;
}

/**
 * Update threshold display
 * @param {string} symbol - Cryptocurrency symbol
 */
function updateThresholdDisplay(symbol) {
    const nextBuyEl = cardState.elements[symbol]?.nextBuyEl;
    const nextSellEl = cardState.elements[symbol]?.nextSellEl;
    if (!nextBuyEl || !nextSellEl) return;
    
    const thresholds = cardState.thresholds[symbol] || { nextBuy: 0, nextSell: 0 };
    const currentPrice = cardState.prices[symbol] || 0;
    
    // Update buy threshold
    if (thresholds.nextBuy > 0) {
        const formattedBuy = thresholds.nextBuy.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        nextBuyEl.textContent = `$${formattedBuy}`;
        
        // Add visual indicator if price is close to threshold
        if (currentPrice > 0 && currentPrice <= thresholds.nextBuy * 1.01) {
            nextBuyEl.classList.add('imminent');
        } else {
            nextBuyEl.classList.remove('imminent');
        }
    } else {
        nextBuyEl.textContent = 'N/A';
        nextBuyEl.classList.remove('imminent');
    }
    
    // Update sell threshold
    if (thresholds.nextSell > 0) {
        const formattedSell = thresholds.nextSell.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        
        nextSellEl.textContent = `$${formattedSell}`;
        
        // Add visual indicator if price is close to threshold
        if (currentPrice > 0 && currentPrice >= thresholds.nextSell * 0.99) {
            nextSellEl.classList.add('imminent');
        } else {
            nextSellEl.classList.remove('imminent');
        }
    } else {
        nextSellEl.textContent = 'N/A';
        nextSellEl.classList.remove('imminent');
    }
}

/**
 * Calculate and update profit/loss display
 * @param {string} symbol - Cryptocurrency symbol
 */
function calculateAndUpdateProfitLoss(symbol) {
    // Skip if no holdings
    if (cardState.holdings[symbol] <= 0) {
        cardState.profitLoss[symbol] = 0;
        updateProfitLossDisplay(symbol, 0);
        return;
    }
    
    // Get current price
    const currentPrice = cardState.prices[symbol] || 0;
    
    // If thresholds include initial price, use that
    const initialPrice = cardState.thresholds[symbol]?.initialPrice || 0;
    
    // If we have valid data, calculate profit/loss
    if (currentPrice > 0 && initialPrice > 0) {
        const profitLoss = ((currentPrice - initialPrice) / initialPrice) * 100;
        cardState.profitLoss[symbol] = profitLoss;
        updateProfitLossDisplay(symbol, profitLoss);
    }
}

/**
 * Update profit/loss display
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} percentage - Profit/loss percentage
 */
function updateProfitLossDisplay(symbol, percentage) {
    const indicator = cardState.elements[symbol]?.profitIndicator;
    const text = cardState.elements[symbol]?.profitText;
    
    if (!indicator || !text) return;
    
    // Format percentage
    const formattedPercentage = percentage.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    
    // Update text with appropriate color
    text.textContent = `${formattedPercentage}%`;
    
    if (percentage > 0) {
        text.className = 'profit';
    } else if (percentage < 0) {
        text.className = 'loss';
    } else {
        text.className = '';
    }
    
    // Calculate position on profit/loss bar (0-100%)
    const range = CARD_CONFIG.PROFIT_THRESHOLD - CARD_CONFIG.LOSS_THRESHOLD;
    const normalizedPercentage = Math.max(
        CARD_CONFIG.LOSS_THRESHOLD, 
        Math.min(CARD_CONFIG.PROFIT_THRESHOLD, percentage)
    );
    
    const position = ((normalizedPercentage - CARD_CONFIG.LOSS_THRESHOLD) / range) * 100;
    
    // Animate indicator position
    indicator.style.transition = `left ${CARD_CONFIG.ANIMATION.PROFIT_LOSS}ms ease-out`;
    indicator.style.left = `${position}%`;
}

/**
 * Handle batch data update event (more efficient)
 * @param {Object} response - Batch data response
 */
function handleBatchDataUpdate(response) {
    if (!response || !response.success) {
        console.error('Batch data update failed:', response?.error || 'Unknown error');
        return;
    }
    
    const batchData = response.data;
    if (!batchData) return;
    
    // Process each symbol's data
    Object.entries(batchData).forEach(([symbol, data]) => {
        // Extract base symbol by removing USDT
        const baseSymbol = symbol.replace('USDT', '').toLowerCase();
        
        // Skip if not supported
        if (!cardState.prices.hasOwnProperty(baseSymbol)) return;
        
        // Process transactions if they exist
        if (data.transactions && Array.isArray(data.transactions)) {
            updateTransactionHistory(baseSymbol, data.transactions);
        }
        
        // Process holdings if they exist
        if (data.holdings) {
            cardState.holdings[baseSymbol] = parseFloat(data.holdings.quantity) || 0;
            updateHoldingsDisplay(baseSymbol);
        }
        
        // Process reference prices if they exist
        if (data.refPrices) {
            cardState.thresholds[baseSymbol] = {
                nextBuy: parseFloat(data.refPrices.next_buy_threshold) || 0,
                nextSell: parseFloat(data.refPrices.next_sell_threshold) || 0,
                initialPrice: parseFloat(data.refPrices.initial_purchase_price) || 0
            };
            
            // Update threshold display
            updateThresholdDisplay(baseSymbol);
            
            // Calculate and update profit/loss
            calculateAndUpdateProfitLoss(baseSymbol);
        }
        
        // If current price is included, update it
        if (data.currentPrice) {
            const currentPrice = parseFloat(data.currentPrice);
            const previousPrice = cardState.prices[baseSymbol] || 0;
            
            cardState.prices[baseSymbol] = currentPrice;
            updateCardPrice(baseSymbol, currentPrice, previousPrice);
        }
    });
    
    // Reset all processing states
    Object.keys(cardState.isProcessing).forEach(symbol => {
        setProcessingState(symbol, false);
    });
}

/**
 * Handle first purchase result event
 * @param {Object} result - First purchase result
 */
function handleFirstPurchaseResult(result) {
    if (!result) return;
    
    // Extract symbol if available, otherwise reset all
    const fullSymbol = result.symbol || '';
    const symbolToReset = fullSymbol.replace('USDT', '').toLowerCase();
    
    if (symbolToReset && cardState.isProcessing.hasOwnProperty(symbolToReset)) {
        // Reset processing state for specific symbol
        setProcessingState(symbolToReset, false);
        
        // Show appropriate message
        if (result.success) {
            console.log(`${symbolToReset.toUpperCase()} purchase successful`);
        } else {
            alert(`Purchase failed: ${result.error || 'Unknown error'}`);
        }
    } else {
        // Reset all processing states
        Object.keys(cardState.isProcessing).forEach(sym => {
            setProcessingState(sym, false);
        });
    }
}

/**
 * Handle sell all result event
 * @param {Object} result - Sell all result
 */
function handleSellAllResult(result) {
    if (!result) return;
    
    // Extract symbol if available, otherwise reset all
    const fullSymbol = result.symbol || '';
    const symbolToReset = fullSymbol.replace('USDT', '').toLowerCase();
    
    if (symbolToReset && cardState.isProcessing.hasOwnProperty(symbolToReset)) {
        // Reset processing state for specific symbol
        setProcessingState(symbolToReset, false, 'sell');
        
        // Show appropriate message
        if (result.success) {
            console.log(`${symbolToReset.toUpperCase()} sold successfully`);
        } else {
            alert(`Sell failed: ${result.error || 'Unknown error'}`);
        }
    } else {
        // Reset all processing states
        Object.keys(cardState.isProcessing).forEach(sym => {
            setProcessingState(sym, false, 'sell');
        });
    }
}

/**
 * Create all cryptocurrency cards
 * @returns {Array} Array of card elements
 */
function createAllCards() {
    return CARD_CONFIG.SUPPORTED_CRYPTOS.map(crypto => createCard(crypto));
}

/**
 * Update all cards with new data
 */
function updateAllCards() {
    CARD_CONFIG.SUPPORTED_CRYPTOS.forEach(crypto => {
        const symbol = crypto.symbol;
        
        // Update displays
        updateCardPrice(symbol, cardState.prices[symbol] || 0, 0);
        updateHoldingsDisplay(symbol);
        updateThresholdDisplay(symbol);
        updateProfitLossDisplay(symbol, cardState.profitLoss[symbol] || 0);
    });
}

/**
 * Get investment amount for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @returns {number} Investment amount
 */
function getInvestmentAmount(symbol) {
    return cardState.investment[symbol] || CARD_CONFIG.PRESETS[CARD_CONFIG.DEFAULT_PRESET];
}

/**
 * Set investment amount for a symbol
 * @param {string} symbol - Cryptocurrency symbol
 * @param {number} amount - Investment amount
 */
function setInvestmentAmount(symbol, amount) {
    if (!cardState.investment.hasOwnProperty(symbol)) return;
    
    // Update state
    cardState.investment[symbol] = amount;
    
    // Update input value
    const investmentEl = cardState.elements[symbol]?.investmentEl;
    if (investmentEl) {
        investmentEl.value = amount;
    }
    
    // Update preset buttons
    const presetBtns = cardState.elements[symbol]?.presetBtns;
    if (presetBtns) {
        // Remove active class from all buttons
        presetBtns.forEach(btn => btn.classList.remove('active'));
        
        // Add active class to matching button if any
        presetBtns.forEach(btn => {
            if (parseFloat(btn.dataset.value) === amount) {
                btn.classList.add('active');
            }
        });
    }
}

// Export all functions as ES module exports
export {
    initialize,
    createCard,
    createAllCards,
    updateAllCards,
    handlePriceUpdate,
    handleTransactionUpdate,
    handleHoldingsUpdate,
    handleBatchDataUpdate,
    getInvestmentAmount,
    setInvestmentAmount,
    CARD_CONFIG
};