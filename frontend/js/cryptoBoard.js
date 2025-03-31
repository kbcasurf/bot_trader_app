// Get socket instance from main.js
import { socket } from '../main.js';
import { updateProfitLossIndicator } from './dashboard.js';

// Crypto configuration for supported trading pairs
const supportedCryptos = [
    { symbol: 'BTC', fullName: 'Bitcoin', icon: 'frontend/images/btc.svg' },
    { symbol: 'SOL', fullName: 'Solana', icon: 'frontend/images/sol.svg' },
    { symbol: 'XRP', fullName: 'Ripple', icon: 'frontend/images/xrp.svg' },
    { symbol: 'DOGE', fullName: 'Dogecoin', icon: 'frontend/images/doge.svg' },
    { symbol: 'NEAR', fullName: 'NEAR Protocol', icon: 'frontend/images/near.svg' },
    { symbol: 'PENDLE', fullName: 'Pendle', icon: 'frontend/images/pendle.svg' }
];

// Function to create crypto cards dynamically
function createCryptoCards() {
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
            
            // Update icon - ensure we're getting the correct icon element
            const iconImage = headerContainer.querySelector('.crypto-icon');
            if (iconImage) {
                iconImage.src = crypto.icon;
                iconImage.alt = crypto.fullName;
            } else {
                console.error(`Icon image element not found for ${crypto.symbol}`);
            }
        } else {
            console.error(`Header container not found for ${crypto.symbol}`);
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
    
    // Reattach event listeners after creating new cards
    attachEventListeners();
    
    // Request initial transaction history for all symbols
    requestInitialTransactions();
}

// Function to request initial transaction history for all cards
function requestInitialTransactions() {
    supportedCryptos.forEach(crypto => {
        const symbol = crypto.symbol.toLowerCase();
        
        // Request transactions for this symbol
        socket.emit('get-transactions', { symbol: crypto.symbol + 'USDT' });
    });
}

// Function to validate that all crypto cards were created correctly
function validateCryptoCards() {
    supportedCryptos.forEach(crypto => {
        const symbol = crypto.symbol.toLowerCase();
        const card = document.getElementById(`${symbol}-card`);
        const price = document.getElementById(`${symbol}-price`);
        const icon = card ? card.querySelector('.crypto-icon') : null;
        
        if (!card) {
            console.error(`Missing card element for ${symbol}`);
        }
        
        if (!price) {
            console.error(`Missing price element for ${symbol}`);
        }
        
        if (!icon) {
            console.error(`Missing icon element for ${symbol}`);
        } else {
            console.log(`${symbol} icon src: ${icon.src}`);
        }
    });
}
    
// Function to attach event listeners to dynamically created elements
function attachEventListeners() {
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

// Initialize the crypto board when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Short delay to ensure all elements are rendered
    setTimeout(() => {
        console.log('Creating crypto cards...');
        createCryptoCards();
        
        // Verify cards were created correctly
        validateCryptoCards();
    }, 200);
});

// Listen for price updates
socket.on('price-update', (data) => {
    if (!data) return;
    
    // Extract symbol and price
    let symbol = '';
    let price = 0;
    
    if (data.symbol) {
        symbol = data.symbol;
    } else if (data.s) {
        symbol = data.s;
    } else {
        return;
    }
    
    if (data.price) {
        price = data.price;
    } else if (data.p) {
        price = data.p;
    } else if (data.c) {
        price = data.c;
    } else if (data.a) {
        price = data.a;
    } else if (data.b) {
        price = data.b;
    } else {
        return;
    }
    
    const baseSymbol = symbol.replace('USDT', '').toLowerCase();
    const priceElement = document.getElementById(`${baseSymbol}-price`);
    
    if (priceElement) {
        priceElement.textContent = `Price: $${parseFloat(price).toFixed(2)}`;
    }
});

// Listen for profit/loss updates
socket.on('holdings-update', (data) => {
    const { symbol, amount, profitLossPercent } = data;
    
    // Update profit/loss indicator
    updateProfitLossIndicator(symbol.toLowerCase(), profitLossPercent);
});

export {
    createCryptoCards,
    supportedCryptos,
    validateCryptoCards,
    attachEventListeners,
    requestInitialTransactions
};