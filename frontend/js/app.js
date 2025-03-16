// Set Vue to production mode
Vue.config.productionTip = false;

// API base URL - Use environment variable or fallback
const API_BASE_URL = process.env.VITE_API_URL || '/api';
const WEBSOCKET_URL = process.env.VITE_WEBSOCKET_URL || 'wss://stream.binance.com:9443/ws';
const DEFAULT_INVESTMENT = parseInt(process.env.VITE_DEFAULT_INVESTMENT || 50);
const INVESTMENT_STEPS = parseInt(process.env.VITE_INVESTMENT_STEPS || 50);
const MAX_INVESTMENT = parseInt(process.env.VITE_MAX_INVESTMENT || 200);

// Cryptocurrency data
const cryptoData = [
    {
        name: 'Bitcoin',
        symbol: 'BTC/USDT',
        image: '/public/images/btc.svg',
        price: 0,
        investmentAmount: DEFAULT_INVESTMENT,
        hasFirstPurchase: false,
        quantity: 0,
        totalInvested: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: [],
        loading: false,
        error: null
    },
    {
        name: 'Solana',
        symbol: 'SOL/USDT',
        image: '/public/images/sol.svg',
        price: 0,
        investmentAmount: 50,
        hasFirstPurchase: false,
        quantity: 0,
        totalInvested: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: [],
        loading: false,
        error: null
    },
    {
        name: 'XRP',
        symbol: 'XRP/USDT',
        image: '/public/images/xrp.svg',
        price: 0,
        investmentAmount: 50,
        hasFirstPurchase: false,
        quantity: 0,
        totalInvested: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: [],
        loading: false,
        error: null
    },
    {
        name: 'Pendle',
        symbol: 'PENDLE/USDT',
        image: '/public/images/pendle.svg',
        price: 0,
        investmentAmount: 50,
        hasFirstPurchase: false,
        quantity: 0,
        totalInvested: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: [],
        loading: false,
        error: null
    },
    {
        name: 'Dogecoin',
        symbol: 'DOGE/USDT',
        image: '/public/images/doge.svg',
        price: 0,
        investmentAmount: 50,
        hasFirstPurchase: false,
        quantity: 0,
        totalInvested: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: [],
        loading: false,
        error: null
    },
    {
        name: 'NEAR Protocol',
        symbol: 'NEAR/USDT',
        image: '/public/images/near.svg',
        price: 0,
        investmentAmount: 50,
        hasFirstPurchase: false,
        quantity: 0,
        totalInvested: 0,
        profitLoss: 0,
        profitLossPercentage: 0,
        orders: [],
        loading: false,
        error: null
    }
];

// Create Vue app
const app = new Vue({
    el: '#app',
    data: {
        cryptocurrencies: cryptoData,
        isConnected: false,
        websockets: {},
        error: null,
        loading: true
    },
    methods: {
        // Format timestamp to readable time
        formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.toLocaleTimeString() + ' ' + date.toLocaleDateString();
        },
        
        // Initialize WebSocket connections for real-time price updates
        initializeWebSockets() {
            this.cryptocurrencies.forEach(crypto => {
                try {
                    const symbol = crypto.symbol.replace('/', '').toLowerCase();
                    const ws = new WebSocket(`${WEBSOCKET_URL}/${symbol}@ticker`);
                    
                    ws.onopen = () => {
                        console.log(`WebSocket connection established for ${crypto.symbol}`);
                        this.isConnected = true;
                    };
                    
                    ws.onmessage = (event) => {
                        try {
                            const data = JSON.parse(event.data);
                            crypto.price = parseFloat(data.c).toFixed(2);
                            
                            // Update profit/loss if first purchase has been made
                            if (crypto.hasFirstPurchase && crypto.quantity > 0) {
                                const currentValue = crypto.quantity * crypto.price;
                                crypto.profitLoss = currentValue - crypto.totalInvested;
                                crypto.profitLossPercentage = (crypto.profitLoss / crypto.totalInvested) * 100;
                            }
                        } catch (error) {
                            console.error(`Error processing WebSocket data for ${crypto.symbol}:`, error);
                        }
                    };
                    
                    ws.onerror = (error) => {
                        console.error(`WebSocket error for ${crypto.symbol}:`, error);
                        this.isConnected = false;
                    };
                    
                    ws.onclose = () => {
                        console.log(`WebSocket connection closed for ${crypto.symbol}`);
                        this.isConnected = false;
                        
                        // Attempt to reconnect after 5 seconds
                        setTimeout(() => {
                            this.initializeWebSockets();
                        }, 5000);
                    };
                    
                    this.websockets[crypto.symbol] = ws;
                } catch (error) {
                    console.error(`Error setting up WebSocket for ${crypto.symbol}:`, error);
                }
            });
        },
        
        // Load session data for a cryptocurrency
        async loadSessionData(crypto) {
            try {
                console.log(`Loading session data for ${crypto.symbol}`);
                const symbol = crypto.symbol.replace('/', '');
                const response = await axios.get(`${API_BASE_URL}/binance/sessions/${symbol}`);
                
                if (response.data && response.data.active) {
                    // Update crypto with session data
                    crypto.hasFirstPurchase = true;
                    crypto.quantity = response.data.total_quantity;
                    crypto.totalInvested = response.data.total_invested;
                    crypto.profitLoss = response.data.profit_loss;
                    crypto.profitLossPercentage = (crypto.profitLoss / crypto.totalInvested) * 100;
                }
            } catch (error) {
                console.error(`Error loading session data for ${crypto.symbol}:`, error);
                crypto.error = `Error loading session data: ${error.message}`;
            }
        },
        
        // Load order history for a cryptocurrency
        async loadOrderHistory(crypto) {
            try {
                console.log(`Loading order history for ${crypto.symbol}`);
                const symbol = crypto.symbol.replace('/', '');
                const response = await axios.get(`${API_BASE_URL}/binance/orders/${symbol}`);
                
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
        
        // Make the first purchase
        async makeFirstPurchase(crypto) {
            try {
                crypto.loading = true;
                crypto.error = null;
                
                console.log(`Making first purchase for ${crypto.symbol} with amount $${crypto.investmentAmount}`);
                
                const response = await axios.post(`${API_BASE_URL}/binance/start-session`, {
                    symbol: crypto.symbol.replace('/', ''),
                    amount: crypto.investmentAmount
                });
                
                if (response.data && response.data.success) {
                    crypto.hasFirstPurchase = true;
                    
                    // Get the session data
                    await this.loadSessionData(crypto);
                    
                    // Get order history
                    await this.loadOrderHistory(crypto);
                    
                    // Show success message
                    alert(`First purchase of ${crypto.name} successful!`);
                } else {
                    throw new Error(response.data?.error || 'Unknown error occurred');
                }
            } catch (error) {
                console.error('Error making first purchase:', error);
                crypto.error = `Error making first purchase: ${error.response?.data?.error || error.message}`;
                alert(`Error making first purchase: ${error.response?.data?.error || error.message}`);
            } finally {
                crypto.loading = false;
            }
        },
        
        // Initialize the application
        async initialize() {
            try {
                this.loading = true;
                
                // Initialize WebSocket connections for real-time price updates
                this.initializeWebSockets();
                
                // Load session data for all cryptocurrencies
                for (const crypto of this.cryptocurrencies) {
                    await this.loadSessionData(crypto);
                    
                    if (crypto.hasFirstPurchase) {
                        await this.loadOrderHistory(crypto);
                    }
                }
            } catch (error) {
                console.error('Error initializing application:', error);
                this.error = `Error initializing application: ${error.message}`;
            } finally {
                this.loading = false;
            }
        }
    },
    mounted() {
        // Initialize the application when Vue is mounted
        this.initialize();
    },
    beforeDestroy() {
        // Close all WebSocket connections when Vue is destroyed
        Object.values(this.websockets).forEach(ws => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.close();
            }
        });
    }
});