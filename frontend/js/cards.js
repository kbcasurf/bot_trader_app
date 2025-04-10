// frontend/js/cards.js
// Cryptocurrency Card Module
// Manages the creation and behavior of cryptocurrency cards in the dashboard

// Card configuration
const CARD_CONFIG = {
  // Supported cryptocurrencies with their details
  SUPPORTED_CRYPTOS: [
    { symbol: 'BTC', name: 'Bitcoin', color: '#f7931a' },
    { symbol: 'SOL', name: 'Solana', color: '#00ff9d' },
    { symbol: 'XRP', name: 'Ripple', color: '#346aa9' },
    { symbol: 'PENDLE', name: 'Pendle', color: '#5848ca' },
    { symbol: 'DOGE', name: 'Dogecoin', color: '#c2a633' },
    { symbol: 'NEAR', name: 'NEAR Protocol', color: '#000000' }
  ],
  
  // Investment amounts for slider
  INVESTMENT_AMOUNTS: [50, 100, 150, 200],
  
  // Maximum transaction history items to display
  MAX_HISTORY_ITEMS: 5
};

// Track card data
const cardState = {
  cards: new Map(), // Symbol -> card element
  data: new Map(),  // Symbol -> card data
  socket: null      // Socket.io connection reference
};

/**
 * Initialize the card module with socket connection
 * @param {Object} socket - The socket.io connection
 */
function initialize(socket) {
  cardState.socket = socket;
  
  // Register for price updates
  socket.on('price-update', (data) => {
    updatePrice(data.symbol, data.price);
  });
  
  // Register for batch data updates
  socket.on('batch-data-result', (results) => {
    // Check if we have a USDT balance and emit an event for it
    if (results.USDT && results.USDT.balance !== undefined) {
      const usdtEvent = new CustomEvent('usdt-balance-update', {
        detail: { balance: results.USDT.balance }
      });
      document.dispatchEvent(usdtEvent);
    }
    
    // Process each crypto card data (skip USDT as it's not a card)
    for (const [symbol, data] of Object.entries(results)) {
      if (symbol !== 'USDT') {
        updateCardData(symbol, data);
      }
    }
  });
  
  // Register for single crypto updates
  socket.on('crypto-data-update', (data) => {
    updateCardData(data.symbol, data);
  });
  
  // HIGH PRIORITY: Register for direct threshold updates
  // This is a fast update path for critical threshold changes after trades
  socket.on('threshold-update', (data) => {
    console.log(`[FAST THRESHOLD UPDATE] Received for ${data.symbol}:`, data);
    const symbol = data.symbol;
    const card = cardState.cards.get(symbol);
    
    if (!card) return;
    
    // Update next buy price
    const nextBuyElement = card.querySelector(`#${symbol}-next-buy`);
    if (nextBuyElement && data.nextBuyPrice !== undefined) {
      nextBuyElement.textContent = `$${data.nextBuyPrice.toFixed(4)}`;
      console.log(`Fast-updated next buy price for ${symbol} to $${data.nextBuyPrice.toFixed(4)}`);
    }
    
    // Update next sell price
    const nextSellElement = card.querySelector(`#${symbol}-next-sell`);
    if (nextSellElement && data.nextSellPrice !== undefined) {
      nextSellElement.textContent = data.nextSellPrice > 0
        ? `$${data.nextSellPrice.toFixed(4)}`
        : 'N/A';
      console.log(`Fast-updated next sell price for ${symbol} to ${data.nextSellPrice > 0 ? '$' + data.nextSellPrice.toFixed(4) : 'N/A'}`);
    }
    
    // Store the updated thresholds in the card's data
    if (!cardState.data.has(symbol)) {
      cardState.data.set(symbol, {});
    }
    
    const symbolData = cardState.data.get(symbol);
    symbolData.nextBuyPrice = data.nextBuyPrice;
    symbolData.nextSellPrice = data.nextSellPrice;
  });
}

/**
 * Create cards for all supported cryptocurrencies
 * @returns {Array<HTMLElement>} The created card elements
 */
function createAllCards() {
  return CARD_CONFIG.SUPPORTED_CRYPTOS.map(createCard);
}

/**
 * Create a card element for a cryptocurrency
 * @param {Object} crypto - The cryptocurrency configuration
 * @returns {HTMLElement} The created card element
 */
function createCard(crypto) {
  const { symbol, name, color } = crypto;
  
  // Create card element
  const card = document.createElement('div');
  card.className = 'crypto-card';
  card.id = `card-${symbol.toLowerCase()}`;
  card.dataset.symbol = symbol;
  
  // We no longer need to set individual colors as we use a unified color in CSS
  // card.style.setProperty('--crypto-color', color);
  
  // Create card HTML
  card.innerHTML = `
    <div class="card-header">
      <img src="images/${symbol.toLowerCase()}.svg" alt="${name}" class="crypto-logo" onerror="this.src='images/generic.svg'">
      <div class="crypto-title">
        <h3>${name}</h3>
        <span class="pair-name">${symbol}/USDT</span>
      </div>
    </div>
    
    <div class="card-price">
      <span class="price-label">Current Price:</span>
      <span class="price-value" id="${symbol}-price">Loading...</span>
    </div>
    
    <div class="card-controls">
      <div class="investment-slider-container">
        <label for="${symbol}-investment">Investment Amount:</label>
        <input type="range" id="${symbol}-investment" class="investment-slider"
          min="0" max="${CARD_CONFIG.INVESTMENT_AMOUNTS.length - 1}" value="0" step="1">
        <div class="slider-labels">
          ${CARD_CONFIG.INVESTMENT_AMOUNTS.map((amount, index) => 
            `<span data-value="${index}">$${amount}</span>`
          ).join('')}
        </div>
        <div class="selected-amount">
          <span>Selected: $<span id="${symbol}-amount">${CARD_CONFIG.INVESTMENT_AMOUNTS[0]}</span></span>
        </div>
      </div>
      
      <div class="action-buttons">
        <button id="${symbol}-buy" class="buy-button">Buy ${symbol}</button>
        <button id="${symbol}-sell" class="sell-button" disabled>Sell All</button>
      </div>
    </div>
    
    <div class="card-holdings">
      <div class="holdings-info">
        <span class="holdings-label">Current Holdings:</span>
        <span class="holdings-value" id="${symbol}-holdings">0 ${symbol}</span>
      </div>
      
      <div class="next-prices">
        <div class="next-buy">
          <span class="next-label">Next Buy:</span>
          <span class="next-value" id="${symbol}-next-buy">$0.00</span>
        </div>
        <div class="next-sell">
          <span class="next-label">Next Sell:</span>
          <span class="next-value" id="${symbol}-next-sell">$0.00</span>
        </div>
      </div>
    </div>
    
    <div class="profit-loss-container">
      <div class="profit-loss-label">Profit/Loss:</div>
      <div class="profit-loss-bar">
        <div class="profit-loss-indicator" id="${symbol}-profit-indicator"></div>
      </div>
      <div class="profit-loss-value" id="${symbol}-profit-value">0.00%</div>
    </div>
    
    <div class="transaction-history">
      <h4>Transaction History</h4>
      <ul class="history-list" id="${symbol}-history">
        <li class="history-placeholder">No transactions yet</li>
      </ul>
    </div>
  `;
  
  // Store card in state
  cardState.cards.set(symbol, card);
  
  // Set up event listeners after the card is added to the DOM
  setTimeout(() => {
    setupCardEventListeners(symbol);
  }, 0);
  
  return card;
}

/**
 * Set up event listeners for a cryptocurrency card
 * @param {string} symbol - The cryptocurrency symbol
 */
function setupCardEventListeners(symbol) {
  // Get elements
  const card = cardState.cards.get(symbol);
  if (!card) return;
  
  // Investment slider
  const slider = card.querySelector(`#${symbol}-investment`);
  const amountDisplay = card.querySelector(`#${symbol}-amount`);
  
  if (slider && amountDisplay) {
    slider.addEventListener('input', () => {
      const index = parseInt(slider.value, 10);
      const amount = CARD_CONFIG.INVESTMENT_AMOUNTS[index];
      amountDisplay.textContent = amount;
    });
  }
  
  // Buy button
  const buyButton = card.querySelector(`#${symbol}-buy`);
  if (buyButton) {
    buyButton.addEventListener('click', () => {
      // Get selected investment amount
      const amountIndex = parseInt(slider.value, 10);
      const amount = CARD_CONFIG.INVESTMENT_AMOUNTS[amountIndex];
      
      // Disable button to prevent double-clicks
      buyButton.disabled = true;
      buyButton.textContent = 'Processing...';
      
      // Send buy request to server
      cardState.socket.emit('buy-crypto', {
        symbol: symbol,
        amount: amount
      });
      
      // Listen for response
      cardState.socket.once('buy-result', (result) => {
        // Re-enable button
        buyButton.disabled = false;
        buyButton.textContent = `Buy ${symbol}`;
        
        // Show notification
        const notificationEvent = new CustomEvent('showNotification', {
          detail: {
            message: result.success 
              ? `Successfully bought ${symbol}` 
              : `Failed to buy ${symbol}: ${result.error}`,
            type: result.success ? 'success' : 'error'
          }
        });
        document.dispatchEvent(notificationEvent);
      });
    });
  }
  
  // Sell button
  const sellButton = card.querySelector(`#${symbol}-sell`);
  if (sellButton) {
    sellButton.addEventListener('click', () => {
      // Disable button to prevent double-clicks
      sellButton.disabled = true;
      sellButton.textContent = 'Processing...';
      
      // Send sell request to server
      cardState.socket.emit('sell-crypto', {
        symbol: symbol
      });
      
      // Listen for response
      cardState.socket.once('sell-result', (result) => {
        // Re-enable button if we still have holdings
        sellButton.textContent = `Sell All`;
        
        // Show notification
        const notificationEvent = new CustomEvent('showNotification', {
          detail: {
            message: result.success 
              ? `Successfully sold all ${symbol}` 
              : `Failed to sell ${symbol}: ${result.error}`,
            type: result.success ? 'success' : 'error'
          }
        });
        document.dispatchEvent(notificationEvent);
      });
    });
  }
}

/**
 * Update the price display for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} price - The current price
 */
function updatePrice(symbol, price) {
  const card = cardState.cards.get(symbol);
  if (!card) return;
  
  // Update price display
  const priceElement = card.querySelector(`#${symbol}-price`);
  if (priceElement) {
    // Format price with 4 decimal places for all values
    const formattedPrice = price.toLocaleString(undefined, { 
      minimumFractionDigits: 4, 
      maximumFractionDigits: 4 
    });
    
    priceElement.textContent = `$${formattedPrice}`;
    
    // Store price in card data
    if (!cardState.data.has(symbol)) {
      cardState.data.set(symbol, {});
    }
    
    cardState.data.get(symbol).price = price;
  }
}

/**
 * Update a cryptocurrency card with new data
 * @param {string} symbol - The cryptocurrency symbol
 * @param {Object} data - The card data
 */
function updateCardData(symbol, data) {
  const card = cardState.cards.get(symbol);
  if (!card || !data) return;
  
  // Store data
  cardState.data.set(symbol, {
    ...cardState.data.get(symbol),
    ...data
  });
  
  // Update price if available
  if (data.price) {
    updatePrice(symbol, data.price);
  }
  
  // Update holdings
  const holdingsElement = card.querySelector(`#${symbol}-holdings`);
  if (holdingsElement && data.holdings !== undefined) {
    // Always format holdings with 4 decimal places for consistency
    holdingsElement.textContent = `${parseFloat(data.holdings).toFixed(4)} ${symbol}`;
    
    // Enable/disable sell button based on holdings
    const sellButton = card.querySelector(`#${symbol}-sell`);
    if (sellButton) {
      sellButton.disabled = data.holdings <= 0;
    }
  }
  
  // Update next buy price
  const nextBuyElement = card.querySelector(`#${symbol}-next-buy`);
  if (nextBuyElement && data.nextBuyPrice !== undefined) {
    nextBuyElement.textContent = `$${data.nextBuyPrice.toFixed(4)}`;
  }
  
  // Update next sell price
  const nextSellElement = card.querySelector(`#${symbol}-next-sell`);
  if (nextSellElement && data.nextSellPrice !== undefined) {
    nextSellElement.textContent = data.nextSellPrice > 0
      ? `$${data.nextSellPrice.toFixed(4)}`
      : 'N/A';
  }
  
  // Update profit/loss indicator
  if (data.profitLossPercentage !== undefined) {
    updateProfitLossIndicator(symbol, data.profitLossPercentage);
  }
  
  // Update transaction history
  if (data.history && Array.isArray(data.history)) {
    updateTransactionHistory(symbol, data.history);
  }
}

/**
 * Update the profit/loss indicator for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @param {number} percentage - The profit/loss percentage
 */
function updateProfitLossIndicator(symbol, percentage) {
  const card = cardState.cards.get(symbol);
  if (!card) return;
  
  const indicator = card.querySelector(`#${symbol}-profit-indicator`);
  const valueDisplay = card.querySelector(`#${symbol}-profit-value`);
  
  if (!indicator || !valueDisplay) return;
  
  // Limit percentage to range for UI (-100% to +100%)
  const clampedPercentage = Math.max(-100, Math.min(100, percentage));
  
  // Calculate position and color
  const position = 50 + (clampedPercentage / 2); // Convert to 0-100 scale centered at 50
  indicator.style.left = `${position}%`;
  
  // Set color based on positive/negative
  if (percentage > 0) {
    indicator.style.backgroundColor = '#4caf50'; // Green for profit
  } else if (percentage < 0) {
    indicator.style.backgroundColor = '#f44336'; // Red for loss
  } else {
    indicator.style.backgroundColor = '#9e9e9e'; // Grey for neutral
  }
  
  // Update value text
  valueDisplay.textContent = `${percentage.toFixed(2)}%`;
  valueDisplay.style.color = percentage > 0 ? '#4caf50' : (percentage < 0 ? '#f44336' : '#9e9e9e');
}

/**
 * Update the transaction history list for a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @param {Array} history - The transaction history
 */
function updateTransactionHistory(symbol, history) {
  const card = cardState.cards.get(symbol);
  if (!card) return;
  
  const historyList = card.querySelector(`#${symbol}-history`);
  if (!historyList) return;
  
  // Clear current history
  historyList.innerHTML = '';
  
  // Add history items or placeholder
  if (history.length === 0) {
    historyList.innerHTML = '<li class="history-placeholder">No transactions yet</li>';
  } else {
    // Get the most recent transactions up to the maximum
    const recentHistory = history.slice(0, CARD_CONFIG.MAX_HISTORY_ITEMS);
    
    recentHistory.forEach(transaction => {
      const { action, quantity, price, created_at } = transaction;
      
      // Format date
      const date = new Date(created_at);
      const formattedDate = date.toLocaleDateString();
      const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      // Create list item
      const li = document.createElement('li');
      li.className = `history-item ${action.toLowerCase()}`;
      
      li.innerHTML = `
        <span class="transaction-type">${action.toUpperCase()}</span>
        <span class="transaction-amount">${parseFloat(quantity).toFixed(4)} ${symbol}</span>
        <span class="transaction-price">$${parseFloat(price).toFixed(4)}</span>
        <span class="transaction-time">${formattedDate} ${formattedTime}</span>
      `;
      
      historyList.appendChild(li);
    });
  }
}

/**
 * Get the price of a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @returns {number} The current price
 */
function getPrice(symbol) {
  const data = cardState.data.get(symbol);
  return data ? data.price : 0;
}

/**
 * Get the holdings of a cryptocurrency
 * @param {string} symbol - The cryptocurrency symbol
 * @returns {number} The current holdings
 */
function getHolding(symbol) {
  const data = cardState.data.get(symbol);
  return data ? data.holdings : 0;
}

// Export public API
export {
  CARD_CONFIG,
  initialize,
  createAllCards,
  updatePrice,
  updateCardData,
  getPrice,
  getHolding
};