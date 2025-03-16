import React, { useState, useEffect } from 'react';
import CryptoCard from './components/CryptoCard';
import { getSettings } from './services/api';
import './App.css';

const SUPPORTED_SYMBOLS = ['BTCUSDT', 'XRPUSDT', 'DOGEUSDT', 'SOLUSDT', 'NEARUSDT', 'PENDLEUSDT'];

function App() {
  const [settings, setSettings] = useState({
    profitThreshold: 5,
    lossThreshold: 5
  });
  
  const [settingsLoading, setSettingsLoading] = useState(true);
  
  useEffect(() => {
    const fetchSettings = async () => {
      setSettingsLoading(true);
      try {
        const data = await getSettings();
        console.log('Settings data received:', data);
        setSettings({
          profitThreshold: parseInt(data.find(s => s.setting_key === 'profit_threshold')?.value || '5', 10),
          lossThreshold: parseInt(data.find(s => s.setting_key === 'loss_threshold')?.value || '5', 10),
          additionalPurchaseAmount: parseInt(data.find(s => s.setting_key === 'additional_purchase_amount')?.value || '50', 10),
          maxInvestmentPerSymbol: parseInt(data.find(s => s.setting_key === 'max_investment_per_symbol')?.value || '200', 10)
        });
      } catch (error) {
        console.error('Failed to fetch settings:', error);
      } finally {
        setSettingsLoading(false);
      }
    };
    
    fetchSettings();
  }, []);

  return (
    <div className="app-container">
      <header>
        <h1>Crypto Trading Bot</h1>
      </header>
      
      <main>
        <div className="crypto-grid">
          {SUPPORTED_SYMBOLS.map(symbol => (
            <CryptoCard key={symbol} symbol={symbol} />
          ))}
        </div>
      </main>
      
      {/* Footer with settings information */}
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

export default App;