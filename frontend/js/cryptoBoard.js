// Get socket instance from main.js or create a new one if needed
import { socket } from '../main.js';

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
    
    // DEBUG: Log the BTC card structure
    const btcCard = document.getElementById('btc-card');
    if (btcCard) {
        console.log('Original BTC card found:', btcCard);
        console.log('BTC card HTML:', btcCard.innerHTML.substring(0, 200));
        const btcPrice = btcCard.querySelector('.current-price');
        console.log('BTC price element:', btcPrice);
        if (btcPrice) {
            console.log('BTC price ID:', btcPrice.id);
            console.log('BTC price content:', btcPrice.textContent);
        }
    } else {
        console.error('BTC card not found in the DOM!');
    }
    
    // Create cards for each supported crypto except BTC (already in HTML)
    supportedCryptos.slice(1).forEach(crypto => {
        const symbol = crypto.symbol.toLowerCase();
        
        // Clone the BTC card
        if (btcCard) {
            const newCard = btcCard.cloneNode(true);
            newCard.id = `${symbol}-card`;
            
            // Update card header
            const header = newCard.querySelector('.crypto-header h3');
            if (header) {
                header.textContent = `${crypto.symbol}/USDT`;
            }
            
            // Find ALL elements with IDs and update them
            const elementsWithIds = newCard.querySelectorAll('[id]');
            elementsWithIds.forEach(element => {
                // Replace 'btc' with the new symbol in all IDs
                const newId = element.id.replace('btc', symbol);
                element.id = newId;
                console.log(`Updated ID from ${element.id} to ${newId}`);
            });
            
            // Make sure price element has correct ID and content
            const price = newCard.querySelector('.current-price');
            if (price) {
                // Double-check it has the correct ID
                if (price.id !== `${symbol}-price`) {
                    console.warn(`Price element ID mismatch. Current: ${price.id}, Expected: ${symbol}-price`);
                    price.id = `${symbol}-price`;
                }
                price.textContent = 'Price: $0.00';
            }
            
            // Update holdings display
            const holdings = newCard.querySelector('.holdings span');
            if (holdings) {
                holdings.textContent = `0.00 ${crypto.symbol}`;
            }
            
            // Add the new card to the grid
            gridElement.appendChild(newCard);
        }
    });
    
    // After creating cards, verify all price elements
    const allPriceElements = document.querySelectorAll('.current-price');
    console.log('All price elements after card creation:', allPriceElements.length);
    allPriceElements.forEach(el => {
        console.log('Price element ID:', el.id, 'Content:', el.textContent);
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
            if (!tradingActive) {
                alert('Trading is currently paused due to WebSocket connection issues. Please try again when connection is restored.');
                return;
            }
            
            const card = this.closest('.crypto-card');
            const symbol = card.id.replace('-card', '').toUpperCase() + 'USDT';
            const holdingsElement = card.querySelector('.holdings span');
            
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
    if (!data) return;
    
    let symbol = '';
    if (data.symbol) {
        symbol = data.symbol;
    } else if (data.s) {
        symbol = data.s;
    } else {
        return;
    }
    
    const baseSymbol = symbol.replace('USDT', '').toLowerCase();
    const priceElement = document.getElementById(`${baseSymbol}-price`);
    
    if (priceElement) {
        let price = 0;
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
        
        priceElement.textContent = `Price: $${parseFloat(price).toFixed(2)}`;
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