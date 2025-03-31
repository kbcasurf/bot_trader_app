// Get socket instance from main.js
import { socket } from '../main.js';
import { updateProfitLossIndicator } from './cryptoBoard.js';

/**
 * Function to update transaction history
 * @param {string} symbol Cryptocurrency symbol
 * @param {Array} transactions List of transactions
 */
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
    
    // Add transactions to the history list (most recent first)
    transactions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach(transaction => {
            const listItem = document.createElement('li');
            listItem.classList.add(transaction.type.toLowerCase());
            
            // Format the transaction information
            const date = new Date(transaction.timestamp);
            const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
            
            // Format price and quantity with proper precision
            const price = parseFloat(transaction.price).toFixed(2);
            const quantity = parseFloat(transaction.quantity).toFixed(6);
            
            listItem.textContent = `${transaction.type}: ${quantity} ${symbol} at $${price} (${formattedDate})`;
            
            historyElement.appendChild(listItem);
        });
        
    // Calculate and update profit/loss
    calculateProfitLoss(symbol, transactions);
}

/**
 * Calculate profit and loss based on transaction history
 * @param {string} symbol Cryptocurrency symbol
 * @param {Array} transactions List of transactions
 */
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
    const unrealizedPL = currentValue - costBasis;
    
    // Calculate realized profit/loss from sells
    const realizedPL = totalSellAmount - (totalBuyAmount * (totalSellQuantity / totalBuyQuantity));
    
    // Total profit/loss (realized + unrealized)
    const totalPL = realizedPL + unrealizedPL;
    
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
    
    // Update profit/loss indicator position
    updateProfitLossIndicator(symbol.toLowerCase(), plPercentage);
    
    console.log(`${symbol} P/L: ${plPercentage.toFixed(2)}% (${unrealizedPL.toFixed(2)} USDT)`);
}

// Listen for transaction updates
socket.on('transaction-update', (data) => {
    const { symbol, transactions } = data;
    console.log(`Received transaction update for ${symbol}:`, transactions);
    updateTransactionHistory(symbol, transactions);
});

// Listen for holdings updates (only update amount, profit loss is handled separately)
socket.on('holdings-update', (data) => {
    const { symbol, amount } = data;
    console.log(`Received holdings update for ${symbol}: ${amount}`);
    
    // Update holdings display
    const holdingsElement = document.getElementById(`${symbol.toLowerCase()}-holdings`);
    if (holdingsElement) {
        // Format the holdings amount with 6 decimal places for cryptocurrencies
        holdingsElement.textContent = `${parseFloat(amount).toFixed(6)} ${symbol}`;
    } else {
        console.error(`Holdings element not found for ${symbol}`);
    }
    
    // Request transaction history to recalculate profit/loss
    socket.emit('get-transactions', { symbol: symbol + 'USDT' });
});

// Request transactions when needed
function requestTransactions(symbol) {
    socket.emit('get-transactions', { symbol: symbol + 'USDT' });
}

export {
    updateTransactionHistory,
    calculateProfitLoss,
    requestTransactions
};