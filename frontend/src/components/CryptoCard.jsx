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

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      try {
        const data = await fetchCryptoData(symbol);
        if (isMounted) {
          // Update the price formatting to handle different decimal places based on the symbol
          const formatPrice = (price, symbol) => {
            // Bitcoin typically shows fewer decimal places than other cryptocurrencies
            if (symbol === 'BTCUSDT') {
              return parseFloat(price).toFixed(2);
            }
            return parseFloat(price).toFixed(4);
          };
          
          // Then in the useEffect:
          setCrypto({
            symbol: symbol,
            price: formatPrice(data.price, symbol),
            loading: false,
            error: null
          });
        }
      } catch (error) {
        if (isMounted) {
          setCrypto(prev => ({
            ...prev,
            loading: false,
            error: 'Failed to load price data'
          }));
          console.error(`Error fetching ${symbol} data:`, error);
        }
      }
    };

    fetchData();
    
    // Set up interval to fetch data every 5 seconds
    const intervalId = setInterval(fetchData, 5000);
    
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
      const response = await startTrading(symbol, investmentAmount);
      setMessage('First Purchase');
      console.log('Trade response:', response);
    } catch (error) {
      setMessage('Error starting trade');
      console.error('Trade error:', error);
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

  return (
    <div className="crypto-card">
      <div className="crypto-header">
        <h3>{crypto.symbol}</h3>
        <p className="price">{crypto.price} USDT</p>
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