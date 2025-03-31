// Get socket instance from main.js
import { socket } from '../main.js';


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
    
    // Add transactions to the history list
    transactions.forEach(transaction => {
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
}


// Listen for transaction updates
socket.on('transaction-update', (data) => {
    const { symbol, transactions } = data;
    console.log(`Received transaction update for ${symbol}:`, transactions);
    updateTransactionHistory(symbol, transactions);
});

// Listen for holdings updates
socket.on('holdings-update', (data) => {
    const { symbol, amount, profitLossPercent } = data;
    console.log(`Received holdings update for ${symbol}: ${amount} (${profitLossPercent}%)`);
    
    // Update holdings display
    const holdingsElement = document.getElementById(`${symbol.toLowerCase()}-holdings`);
    if (holdingsElement) {
        // Format the holdings amount with 6 decimal places for cryptocurrencies
        holdingsElement.textContent = `${parseFloat(amount).toFixed(6)} ${symbol}`;
    } else {
        console.error(`Holdings element not found for ${symbol}`);
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
    } else {
        console.error(`Profit/loss elements not found for ${symbol}`);
    }
});

export {
    updateTransactionHistory,
};