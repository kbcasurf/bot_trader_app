import React, { useState, useEffect } from 'react';
import { fetchCryptoData, startTrading, sellAllCrypto, checkSessionStatus } from '../services/api';

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

  // Function to fetch data for this cryptocurrency
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
    setMessage('Processing...');
    
    try {
      console.log(`Starting trade for ${symbol} with amount ${investmentAmount}`);
      const response = await startTrading(symbol, investmentAmount);
      console.log('Trade response:', response);
      
      if (response.success) {
        setMessage('Purchase successful');
      } else {
        setMessage(response.message || 'Purchase completed');
      }
      
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

  const handleSellAll = async () => {
    setIsSelling(true);
    setMessage('Processing sell order...');
    
    try {
      console.log(`Selling all ${symbol}`);
      const response = await sellAllCrypto(symbol);
      console.log('Sell response:', response);
      
      if (response.success) {
        setMessage('Successfully sold');
      } else {
        // If "No active session" response, try to create one first
        if (response.message && response.message.includes('No active session')) {
          setMessage('Creating session first...');
          
          // Create session with default investment amount
          const tradeResponse = await startTrading(symbol, investmentAmount);
          console.log('Auto-generated session response:', tradeResponse);
          
          if (tradeResponse.success) {
            // Now try selling again after a short delay
            setTimeout(async () => {
              setMessage('Now selling...');
              const secondSellAttempt = await sellAllCrypto(symbol);
              
              if (secondSellAttempt.success) {
                setMessage('Successfully sold');
              } else {
                setMessage(secondSellAttempt.message || 'Error selling');
              }
            }, 1000);
          } else {
            setMessage('Could not create session');
          }
        } else {
          setMessage(response.message || 'Error selling');
        }
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
};

export default CryptoCard;