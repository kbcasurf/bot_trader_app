// API base URL
const API_BASE_URL = 'http://localhost:3000/api';

// Cryptocurrency data
const cryptoData = [
    {
        symbol: 'BTCUSDT',
        baseAsset: 'BTC',
        name: 'Bitcoin',
        logoUrl: './public/images/btc.svg',
        investmentAmount: 50,
        hasFirstPurchase: false,
        price: 0,
        quantity: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: []
    },
    {
        symbol: 'SOLUSDT',
        baseAsset: 'SOL',
        name: 'Solana',
        logoUrl: './public/images/sol.svg',
        investmentAmount: 50,
        hasFirstPurchase: false,
        price: 0,
        quantity: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: []
    },
    {
        symbol: 'XRPUSDT',
        baseAsset: 'XRP',
        name: 'XRP',
        logoUrl: './public/images/xrp.svg',
        investmentAmount: 50,
        hasFirstPurchase: false,
        price: 0,
        quantity: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: []
    },
    {
        symbol: 'PENDLEUSDT',
        baseAsset: 'PENDLE',
        name: 'Pendle',
        logoUrl: './public/images/pendle.svg',
        investmentAmount: 50,
        hasFirstPurchase: false,
        price: 0,
        quantity: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: []
    },
    {
        symbol: 'DOGEUSDT',
        baseAsset: 'DOGE',
        name: 'Dogecoin',
        logoUrl: './public/images/doge.svg',
        investmentAmount: 50,
        hasFirstPurchase: false,
        price: 0,
        quantity: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: []
    },
    {
        symbol: 'NEARUSDT',
        baseAsset: 'NEAR',
        name: 'NEAR Protocol',
        logoUrl: './public/images/near.svg',
        investmentAmount: 50,
        hasFirstPurchase: false,
        price: 0,
        quantity: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: []
    }
];

// Create Vue app
const app = new Vue({
    el: '#app',
    data: {
        cryptocurrencies: cryptoData,
        isConnected: false,
        websockets: {},
        error: null
    },
    methods: {
        // Initialize WebSocket connections for real-time price updates
        initWebSockets() {
            this.cryptocurrencies.forEach(crypto => {
                const symbol = crypto.symbol.toLowerCase();
                const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@ticker`);
                
                ws.onopen = () => {
                    console.log(`WebSocket connected for ${crypto.symbol}`);
                    this.isConnected = true;
                };
                
                ws.onmessage = (event) => {
                    const data = JSON.parse(event.data);
                    crypto.price = parseFloat(data.c); // Current price
                    
                    // Update profit/loss if first purchase was made
                    if (crypto.hasFirstPurchase) {
                        this.updateProfitLoss(crypto);
                    }
                };
                
                ws.onerror = (error) => {
                    console.error(`WebSocket error for ${crypto.symbol}:`, error);
                    this.isConnected = false;
                };
                
                ws.onclose = () => {
                    console.log(`WebSocket closed for ${crypto.symbol}`);
                    this.isConnected = false;
                    // Try to reconnect after 5 seconds
                    setTimeout(() => this.initWebSocket(crypto), 5000);
                };
                
                this.websockets[crypto.symbol] = ws;
            });
        },
        
        // Make the first purchase
        async makeFirstPurchase(crypto) {
            try {
                const response = await axios.post(`${API_BASE_URL}/binance/start-session`, {
                    symbol: crypto.symbol,
                    amount: crypto.investmentAmount
                });
                
                if (response.data.success) {
                    crypto.hasFirstPurchase = true;
                    
                    // Get the session data
                    await this.loadSessionData(crypto);
                    
                    // Get order history
                    await this.loadOrderHistory(crypto);
                    
                    // Show success message
                    alert(`First purchase of ${crypto.name} successful!`);
                }
            } catch (error) {
                console.error('Error making first purchase:', error);
                alert(`Error making first purchase: ${error.response?.data?.error || error.message}`);
            }
        },
        
        // Load session data for a cryptocurrency
        async loadSessionData(crypto) {
            try {
                const response = await axios.get(`${API_BASE_URL}/binance/sessions/${crypto.symbol}`);
                
                if (response.data) {
                    const session = response.data;
                    crypto.hasFirstPurchase = true;
                    crypto.quantity = parseFloat(session.total_quantity);
                    crypto.initialPrice = parseFloat(session.initial_price);
                    crypto.initialAmount = parseFloat(session.initial_amount);
                    crypto.totalInvested = parseFloat(session.total_invested);
                    
                    this.updateProfitLoss(crypto);
                }
            } catch (error) {
                console.error(`Error loading session data for ${crypto.symbol}:`, error);
            }
        },
        
        // Load order history for a cryptocurrency
        async loadOrderHistory(crypto) {
            try {
                const response = await axios.get(`${API_BASE_URL}/binance/orders/${crypto.symbol}`);
                
                if (response.data && response.data.length > 0) {
                    crypto.orders = response.data.map(order => ({
                        id: order.id,
                        side: order.side,
                        price: parseFloat(order.price),
                        quantity: parseFloat(order.quantity),
                        timestamp: new Date(order.timestamp)
                    }));
                }
            } catch (error) {
                console.error(`Error loading order history for ${crypto.symbol}:`, error);
            }
        },
        
        // Update profit/loss calculations
        updateProfitLoss(crypto) {
            if (!crypto.hasFirstPurchase) return;
            
            const currentValue = crypto.price * crypto.quantity;
            crypto.profitLoss = currentValue - crypto.totalInvested;
            crypto.profitLossPercentage = (crypto.profitLoss / crypto.totalInvested) * 100;
        },
        
        // Get color for profit/loss bar
        getProfitLossColor(percentage) {
            if (percentage > 0) {
                // Green gradient for profits
                const intensity = Math.min(percentage / 10, 1); // Cap at 10% for full intensity
                return `rgba(46, 204, 113, ${0.3 + intensity * 0.7})`; // From light to dark green
            } else {
                // Red gradient for losses
                const intensity = Math.min(Math.abs(percentage) / 10, 1); // Cap at 10% for full intensity
                return `rgba(231, 76, 60, ${0.3 + intensity * 0.7})`; // From light to dark red
            }
        },
        
        // Format timestamp to readable time
        formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
        },
        
        // Initialize the app
        async initialize() {
            try {
                // Initialize WebSockets for real-time price updates
                this.initWebSockets();
                
                // Load initial data for all cryptocurrencies
                for (const crypto of this.cryptocurrencies) {
                    await this.loadSessionData(crypto);
                    
                    if (crypto.hasFirstPurchase) {
                        await this.loadOrderHistory(crypto);
                    }
                }
            } catch (error) {
                console.error('Error initializing app:', error);
                this.error = error.message;
            }
        }
    },
    mounted() {
        this.initialize();
    },
    beforeDestroy() {
        // Close all WebSocket connections
        Object.values(this.websockets).forEach(ws => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
    }
});