import React, { useState, useEffect } from 'react';
import './App.css';

// Symbol configuration
const SUPPORTED_SYMBOLS = ['BTCUSDT', 'XRPUSDT', 'DOGEUSDT', 'SOLUSDT', 'NEARUSDT', 'PENDLEUSDT'];
const SYMBOL_IMAGES = {
  'BTCUSDT': 'btc.svg',
  'DOGEUSDT': 'doge.svg',
  'NEARUSDT': 'near.svg',
  'PENDLEUSDT': 'pendle.svg',
  'SOLUSDT': 'sol.svg',
  'XRPUSDT': 'xrp.svg'
};

// API URL from environment variables or default
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// WebSocket connection
let socket = null;

function App() {
  const [settings, setSettings] = useState({
    profitThreshold: 5,
    lossThreshold: 5,
    additionalPurchaseAmount: 50,
    maxInvestmentPerSymbol: 200
  });
  
  const [settingsLoading, setSettingsLoading] = useState(true);
  
  // Initialize WebSocket for price updates
  useEffect(() => {
    initWebSocket();
    
    // Cleanup WebSocket on unmount
    return () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, []);
  
  // Fetch settings on mount
  useEffect(() => {
    fetchSettings();
  }, []);
  
  // Initialize WebSocket connection
  const initWebSocket = () => {
    if (socket) {
      socket.close();
    }
    
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.hostname}:4000/ws`;
    console.log('Connecting to WebSocket:', wsUrl);
    
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
      console.log('WebSocket connection established');
    };
    
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'price') {
          // Dispatch custom event for components to listen to
          window.dispatchEvent(new CustomEvent('PRICE_UPDATE', {
            detail: {
              symbol: data.symbol,
              price: data.price
            }
          }));
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };
    
    socket.onclose = () => {
      console.log('WebSocket connection closed');
      
      // Attempt to reconnect after delay
      setTimeout(() => {
        console.log('Attempting to reconnect WebSocket...');
        initWebSocket();
      }, 3000);
    };
    
    socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  };
  
  // Fetch settings from API
  const fetchSettings = async () => {
    setSettingsLoading(true);
    try {
      const response = await fetch(`${API_URL}/api/binance/settings`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Check if data is an array before using find
      if (Array.isArray(data)) {
        setSettings({
          profitThreshold: parseInt(data.find(s => s.setting_key === 'profit_threshold')?.value || '5', 10),
          lossThreshold: parseInt(data.find(s => s.setting_key === 'loss_threshold')?.value || '5', 10),
          additionalPurchaseAmount: parseInt(data.find(s => s.setting_key === 'additional_purchase_amount')?.value || '50', 10),
          maxInvestmentPerSymbol: parseInt(data.find(s => s.setting_key === 'max_investment_per_symbol')?.value || '200', 10)
        });
      } else {
        // Use default values if data is not an array
        console.warn('Settings data is not an array, using defaults');
        setSettings({
          profitThreshold: 5,
          lossThreshold: 5,
          additionalPurchaseAmount: 50,
          maxInvestmentPerSymbol: 200
        });
      }
    } catch (error) {
      console.error('Failed to fetch settings:', error);
      // Use default values on error
    } finally {
      setSettingsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <header>
        <h1>Crypto Trading Bot</h1>
      </header>
      
      <main>
        <div className="crypto-grid">
          {SUPPORTED_SYMBOLS.map(symbol => (
            <CryptoCard 
              key={symbol} 
              symbol={symbol} 
              imageSrc={`/images/${SYMBOL_IMAGES[symbol] || 'btc.svg'}`}
              apiUrl={API_URL}
            />
          ))}
        </div>
      </main>
      
      <footer>
        {settingsLoading ? (
          <p>Loading settings...</p>
        ) : (
          <p>Trading Bot Settings: Profit Threshold: {settings.profitThreshold}% | Loss Threshold: {settings.lossThreshold}%</p>
        )}
      </footer>
    </div>
  );
}

// CryptoCard component - Now embedded in the same file
function CryptoCard({ symbol, imageSrc, apiUrl }) {
  const [crypto, setCrypto] = useState({
    symbol: symbol,
    price: '0.00',
    loading: true,
    error: null
  });
  const [investmentAmount, setInvestmentAmount] = useState(100);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [isSelling, setIsSelling] = useState(false);

  // Format price based on symbol
  const formatPrice = (price, symbol) => {
    if (symbol === 'BTCUSDT') {
      return parseFloat(price).toFixed(2);
    }
    return parseFloat(price).toFixed(4);
  };

  // Fetch initial data and listen for WebSocket updates
  useEffect(() => {
    let isMounted = true;
    
    // Initial data fetch
    fetchData();
    
    // Listen for WebSocket price updates
    const handlePriceUpdate = (event) => {
      if (event.detail.symbol === symbol && isMounted) {
        setCrypto(prev => ({
          ...prev,
          price: formatPrice(event.detail.price, symbol),
          loading: false,
          error: null
        }));
      }
    };
    
    // Add event listener for price updates
    window.addEventListener('PRICE_UPDATE', handlePriceUpdate);
    
    return () => {
      isMounted = false;
      // Remove event listener
      window.removeEventListener('PRICE_UPDATE', handlePriceUpdate);
    };
  }, [symbol]);

  // Function to fetch data for this cryptocurrency
  const fetchData = async () => {
    try {
      console.log(`Fetching data for ${symbol}...`);
      const response = await fetch(`${apiUrl}/api/binance/price/${symbol}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      setCrypto({
        symbol: symbol,
        price: formatPrice(data.price, symbol),
        loading: false,
        error: null
      });
    } catch (error) {
      console.error(`Error fetching ${symbol} data:`, error);
      setCrypto(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to load price data'
      }));
    }
  };

  const handleInvestmentChange = (e) => {
    setInvestmentAmount(parseInt(e.target.value, 10));
  };

  // Handle "First Purchase" button click
  const handleTrade = async () => {
    setIsProcessing(true);
    setMessage('Processing...');
    
    try {
      console.log(`Starting trade for ${symbol} with amount ${investmentAmount}`);
      
      const response = await fetch(`${apiUrl}/api/binance/trade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol, amount: investmentAmount }),
      });
      
      const data = await response.json();
      console.log('Trade response:', data);
      
      setMessage(data.success ? 'Purchase successful' : 'Purchase completed');
      
      // Refresh data after successful purchase
      setTimeout(() => {
        fetchData();
        setMessage('');
      }, 2000);
    } catch (error) {
      console.error('Trade error:', error);
      setMessage('Error starting trade');
      
      // Clear error message after a delay
      setTimeout(() => {
        setMessage('');
      }, 2000);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle "Sell All" button click with automatic session creation if needed
  const handleSellAll = async () => {
    setIsSelling(true);
    setMessage('Processing sell order...');
    
    try {
      console.log(`Selling all ${symbol}`);
      
      const response = await fetch(`${apiUrl}/api/binance/session/sell-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ symbol }),
      });
      
      const data = await response.json();
      console.log('Sell response:', data);
      
      if (data.success) {
        setMessage('Successfully sold');
      } else if (data.message && data.message.includes('No active session')) {
        setMessage('Creating session first...');
        
        // Create session with default investment amount
        const tradeResponse = await fetch(`${apiUrl}/api/binance/trade`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ symbol, amount: investmentAmount }),
        });
        
        const tradeData = await tradeResponse.json();
        console.log('Auto-generated session response:', tradeData);
        
        if (tradeResponse.ok) {
          // Now try selling again after a short delay
          setTimeout(async () => {
            setMessage('Now selling...');
            
            const secondSellAttempt = await fetch(`${apiUrl}/api/binance/session/sell-all`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ symbol }),
            });
            
            const secondSellData = await secondSellAttempt.json();
            
            if (secondSellData.success) {
              setMessage('Successfully sold');
            } else {
              setMessage(secondSellData.message || 'Error selling');
            }
          }, 1000);
        } else {
          setMessage('Could not create session');
        }
      } else {
        setMessage(data.message || 'Error selling');
      }
      
      // Refresh data after attempting to sell
      setTimeout(() => {
        fetchData();
        setMessage('');
      }, 3000);
    } catch (error) {
      console.error('Sell error:', error);
      setMessage('Error selling crypto');
      
      // Clear error message after a delay
      setTimeout(() => {
        setMessage('');
      }, 2000);
    } finally {
      setTimeout(() => {
        setIsSelling(false);
      }, 3000);
    }
  };

  if (crypto.loading) {
    return (
      <div className="crypto-card loading">
        <p>Loading {symbol} data...</p>
      </div>
    );
  }

  if (crypto.error) {
    return (
      <div className="crypto-card error">
        <p>Error: {crypto.error}</p>
      </div>
    );
  }

  return (
    <div className="crypto-card">
      <div className="crypto-header">
        <div className="crypto-info">
          <img 
            src={imageSrc} 
            alt={symbol} 
            className="crypto-icon" 
          />
          <h3>{crypto.symbol}</h3>
        </div>
        <p className="price">
          {crypto.price} USDT
        </p>
      </div>
      
      <div className="investment-controls">
        <label htmlFor={`investment-${symbol}`}>Investment Amount:</label>
        <input
          type="range"
          id={`investment-${symbol}`}
          min="50"
          max="200"
          step="10"
          value={investmentAmount}
          onChange={handleInvestmentChange}
        />
        <p className="amount">${investmentAmount}</p>
      </div>
      
      <div className="button-group">
        <button 
          className="trade-button" 
          onClick={handleTrade} 
          disabled={isProcessing || isSelling}
        >
          {isProcessing ? message : 'First Purchase'}
        </button>
        
        <button 
          className="sell-button" 
          onClick={handleSellAll} 
          disabled={isProcessing || isSelling}
        >
          {isSelling ? message : 'Sell All'}
        </button>
      </div>
      
      {message && (
        <p className="status-message">{message}</p>
      )}
    </div>
  );
}

export default App;