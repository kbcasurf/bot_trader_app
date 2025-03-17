import React, { useState, useEffect } from 'react';
import { fetchCryptoData, startTrading, sellAllCrypto } from '../services/api';

const CryptoCard = ({ symbol }) => {
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

  // Get the correct image based on symbol
  const getCryptoImage = (symbol) => {
    const symbolMap = {
      'BTCUSDT': 'btc.svg',
      'DOGEUSDT': 'doge.svg',
      'NEARUSDT': 'near.svg',
      'PENDLEUSDT': 'pendle.svg',
      'SOLUSDT': 'sol.svg',
      'XRPUSDT': 'xrp.svg'
    };
    
    return `/images/${symbolMap[symbol] || 'btc.svg'}`;
  };

  // Format price based on symbol
  const formatPrice = (price, symbol) => {
    if (symbol === 'BTCUSDT') {
      return parseFloat(price).toFixed(2);
    }
    return parseFloat(price).toFixed(4);
  };

  // Function to fetch cryptocurrency data
  const fetchData = async () => {
    try {
      console.log(`Fetching data for ${symbol}...`);
      const data = await fetchCryptoData(symbol);
      
      setCrypto({
        symbol: symbol,
        price: formatPrice(data.price, symbol),
        loading: false,
        error: null,
        fallback: data.fallback
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

  const handleInvestmentChange = (e) => {
    setInvestmentAmount(parseInt(e.target.value, 10));
  };

  const handleTrade = async () => {
    setIsProcessing(true);
    setMessage('Processing purchase...');
    
    try {
      console.log(`Starting trade for ${symbol} with amount ${investmentAmount}`);
      const response = await startTrading(symbol, investmentAmount);
      console.log('Trade response:', response);
      setMessage('Purchase successful');
      
      // Refresh data after trade
      setTimeout(() => {
        fetchData();
        setMessage('');
      }, 2000);
    } catch (error) {
      console.error('Trade error:', error);
      setMessage('Error purchasing');
      
      // Clear message after delay
      setTimeout(() => {
        setMessage('');
      }, 2000);
    } finally {
      setIsProcessing(false);
    }
  };

  // All-in-one function that handles the entire sell process
  const handleSellAll = async () => {
    setIsSelling(true);
    setMessage('Processing sell order...');
    
    try {
      console.log(`Selling all ${symbol}`);
      
      // 1. Try to sell first
      const sellResponse = await sellAllCrypto(symbol);
      console.log('Initial sell response:', sellResponse);
      
      // 2. If "No active session" error, create a session first
      if (sellResponse.message && sellResponse.message.includes('No active session')) {
        setMessage('Creating session first...');
        
        // Create trading session
        const tradeResponse = await startTrading(symbol, investmentAmount);
        console.log('Session creation response:', tradeResponse);
        
        // Wait a moment for the session to be fully created
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Try selling again
        setMessage('Now selling...');
        const secondSellResponse = await sellAllCrypto(symbol);
        console.log('Second sell attempt response:', secondSellResponse);
        
        setMessage(secondSellResponse.success ? 'Successfully sold' : secondSellResponse.message || 'Operation completed');
      } else if (sellResponse.message && sellResponse.message.includes('already closed')) {
        // Session is already closed - nothing to sell
        setMessage('No active session to sell');
      } else {
        // Initial sell attempt result
        setMessage(sellResponse.success ? 'Successfully sold' : sellResponse.message || 'Operation completed');
      }
      
      // Refresh data after selling
      setTimeout(() => {
        fetchData();
        setMessage('');
      }, 2000);
    } catch (error) {
      console.error('Sell process error:', error);
      setMessage('Error during sell process');
      
      // Clear message after delay
      setTimeout(() => {
        setMessage('');
      }, 2000);
    } finally {
      setTimeout(() => {
        setIsSelling(false);
      }, 2000);
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
            src={getCryptoImage(symbol)} 
            alt={symbol} 
            className="crypto-icon" 
          />
          <h3>{crypto.symbol}</h3>
        </div>
        <p className="price">
          {crypto.price} USDT
          {crypto.fallback && <span className="fallback-indicator"> (cached)</span>}
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
          {isProcessing ? 'Processing...' : 'First Purchase'}
        </button>
        
        <button 
          className="sell-button" 
          onClick={handleSellAll} 
          disabled={isProcessing || isSelling}
        >
          {isSelling ? 'Processing...' : 'Sell All'}
        </button>
      </div>
      
      {message && (
        <p className="status-message">{message}</p>
      )}
    </div>
  );
};

export default CryptoCard;