// Dashboard module for handling the overall dashboard functionality
import { io } from 'socket.io-client';

// Get socket instance from main.js or create a new one if needed
let socket;
try {
    // Try to get existing socket
    socket = io();
} catch (e) {
    // Create new socket if not available
    socket = io('http://localhost:3000');
}

// Function to update transaction history
export function updateTransactionHistory(symbol, transactions) {
    const historyElement = document.getElementById(`${symbol.toLowerCase()}-history`);
    
    if (!historyElement) return;
    
    // Clear existing entries
    historyElement.innerHTML = '';
    
    if (transactions.length === 0) {
        const noTransactionsItem = document.createElement('li');
        noTransactionsItem.classList.add('no-transactions');
        noTransactionsItem.textContent = 'No transactions yet';
        historyElement.appendChild(noTransactionsItem);
        return;
    }
    
    // Add transactions to the history list
    transactions.forEach(transaction => {
        const listItem = document.createElement('li');
        listItem.classList.add(transaction.type.toLowerCase());
        
        // Format the transaction information
        const date = new Date(transaction.timestamp);
        const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
        
        listItem.textContent = `${transaction.type}: ${transaction.amount} ${symbol} at $${transaction.price} (${formattedDate})`;
        
        historyElement.appendChild(listItem);
    });
}

// Listen for transaction updates
socket.on('transaction-update', (data) => {
    const { symbol, transactions } = data;
    updateTransactionHistory(symbol, transactions);
});

// Listen for holdings updates
socket.on('holdings-update', (data) => {
    const { symbol, amount, profitLossPercent } = data;
    
    // Update holdings display
    const holdingsElement = document.getElementById(`${symbol.toLowerCase()}-holdings`);
    if (holdingsElement) {
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
});

export default {
    updateTransactionHistory
};