// CryptoBoard module for handling cryptocurrency-specific functionality
import { io } from 'socket.io-client';

// Get socket instance from main.js or create a new one if needed
let socket;
try {
    // Try to get existing socket
    socket = io();
} catch (e) {
    // Create new socket if not available
    socket = io('http://backend:3000');
}

// Track WebSocket trading status
let tradingActive = false;

// Crypto configuration for supported trading pairs
const supportedCryptos = [
    { symbol: 'BTC', fullName: 'Bitcoin' },
    { symbol: 'SOL', fullName: 'Solana' },
    { symbol: 'XRP', fullName: 'Ripple' },
    { symbol: 'PENDLE', fullName: 'Pendle' },
    { symbol: 'DOGE', fullName: 'Dogecoin' },
    { symbol: 'NEAR', fullName: 'NEAR Protocol' }
];

// Function to create crypto cards dynamically
function createCryptoCards() {
    const gridElement = document.querySelector('.crypto-grid');
    
    // Clear existing cards except for the BTC one which is in the HTML
    const existingCards = gridElement.querySelectorAll('.crypto-card:not(#btc-card)');
    existingCards.forEach(card => card.remove());
    
    // Create cards for each supported crypto except BTC (already in HTML)
    supportedCryptos.slice(1).forEach(crypto => {
        const symbol = crypto.symbol.toLowerCase();
        
        // Clone the BTC card and modify it
        const btcCard = document.getElementById('btc-card');
        const newCard = btcCard.cloneNode(true);
        
        // Update IDs and content
        newCard.id = `${symbol}-card`;
        
        // Update header
        const header = newCard.querySelector('h3');
        header.textContent = `${crypto.symbol}/USDT`;
        
        // Update price
        const price = newCard.querySelector('.current-price');
        price.id = `${symbol}-price`;
        price.textContent = 'Price: $0.00';
        
        // Update investment input
        const investmentInput = newCard.querySelector('input[type="hidden"]');
        investmentInput.id = `${symbol}-investment`;
        
        // Update buttons
        const firstPurchaseBtn = newCard.querySelector('.first-purchase');
        firstPurchaseBtn.id = `${symbol}-first-purchase`;
        
        const sellAllBtn = newCard.querySelector('.sell-all');
        sellAllBtn.id = `${symbol}-sell-all`;
        
        // Update holdings
        const holdings = newCard.querySelector('.holdings span');
        holdings.id = `${symbol}-holdings`;
        holdings.textContent = `0.00 ${crypto.symbol}`;
        
        // Update profit/loss elements
        const profitBar = newCard.querySelector('.bar-fill');
        profitBar.id = `${symbol}-profit-bar`;
        
        const profitText = newCard.querySelector('.profit-loss-text span');
        profitText.id = `${symbol}-profit-text`;
        
        // Update transaction history
        const historyList = newCard.querySelector('.transaction-history ul');
        historyList.id = `${symbol}-history`;
        
        // Add the new card to the grid
        gridElement.appendChild(newCard);
    });
    
    // Reattach event listeners after creating new cards
    attachEventListeners();
    
    // Apply current trading status to buttons
    updateTradingButtonsState();
}

// Function to attach event listeners to dynamically created elements
function attachEventListeners() {
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
            
            // Emit sell all event to backend
            socket.emit('sell-all', {
                symbol: symbol
            });
        });
    });
}

// Function to update trading buttons based on WebSocket connection status
function updateTradingButtonsState() {
    const tradingButtons = document.querySelectorAll('.first-purchase, .sell-all');
    
    if (tradingActive) {
        tradingButtons.forEach(button => {
            button.disabled = false;
            button.classList.remove('disabled');
        });
    } else {
        tradingButtons.forEach(button => {
            button.disabled = true;
            button.classList.add('disabled');
        });
    }
}

// Initialize the crypto board when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    createCryptoCards();
});

// Listen for price updates
socket.on('price-update', (data) => {
    const baseSymbol = data.symbol.replace('USDT', '').toLowerCase();
    const priceElement = document.getElementById(`${baseSymbol}-price`);
    
    if (priceElement) {
        priceElement.textContent = `Price: $${parseFloat(data.price).toFixed(2)}`;
    }
});

// Listen for trading status updates
socket.on('trading-status', (status) => {
    tradingActive = status.active;
    updateTradingButtonsState();
});

export default {
    createCryptoCards,
    supportedCryptos,
    updateTradingButtonsState
};