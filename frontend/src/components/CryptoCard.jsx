import React, { useState, useEffect } from 'react';
import { fetchCryptoData, startTrading } from '../services/api';

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

  // Format price based on symbol
  const formatPrice = (price, symbol) => {
    if (symbol === 'BTCUSDT') {
      return parseFloat(price).toFixed(2);
    }
    return parseFloat(price).toFixed(4);
  };

  useEffect(() => {
    let isMounted = true;
    let retryCount = 0;
    const maxRetries = 3;
    
    const fetchData = async () => {
      try {
        console.log(`Fetching data for ${symbol}...`);
        const data = await fetchCryptoData(symbol);
        console.log(`Received data for ${symbol}:`, data);
        
        if (isMounted) {
          setCrypto({
            symbol: symbol,
            price: formatPrice(data.price, symbol),
            loading: false,
            error: null,
            fallback: data.fallback
          });
          
          // Reset retry count on success
          retryCount = 0;
        }
      } catch (error) {
        console.error(`Error fetching ${symbol} data:`, error);
        if (isMounted) {
          // If we've exceeded max retries, show error
          if (retryCount >= maxRetries) {
            setCrypto(prev => ({
              ...prev,
              loading: false,
              error: 'Failed to load price data'
            }));
          } else {
            // Otherwise, increment retry count but don't show error yet
            retryCount++;
          }
        }
      }
    };

    fetchData();
    
    // Set up interval to fetch data every 10 seconds (increased from 5)
    const intervalId = setInterval(fetchData, 10000);
    
    return () => {
      isMounted = false;
      clearInterval(intervalId);
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
      setMessage('First Purchase');
    } catch (error) {
      console.error('Trade error:', error);
      setMessage('Error starting trade');
    } finally {
      setIsProcessing(false);
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

  // Update the render method to show when using fallback data
  return (
    <div className="crypto-card">
      <div className="crypto-header">
        <h3>{crypto.symbol}</h3>
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
      
      <button 
        className="trade-button" 
        onClick={handleTrade} 
        disabled={isProcessing}
      >
        {isProcessing ? message : 'First Purchase'}
      </button>
    </div>
  );
};

export default CryptoCard;