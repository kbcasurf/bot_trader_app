import React, { useState } from 'react';
import api from '../services/api';
import { toast } from 'react-toastify';

const SessionCard = ({ session, onSessionUpdate }) => {
  const [loading, setLoading] = useState(false);

  const handleSellAll = async () => {
    try {
      setLoading(true);
      console.log(`Selling all ${session.symbol}`);
      
      const response = await api.post('/binance/session/sell-all', { 
        symbol: session.symbol 
      });
      
      console.log('Sell response:', response.data);
      
      if (response.data.success) {
        toast.success(`Successfully sold all ${session.symbol}`);
        // Use onSessionUpdate instead of fetchInitialData
        if (typeof onSessionUpdate === 'function') {
          onSessionUpdate();
        } else {
          // If onSessionUpdate is not provided, refresh the page
          setTimeout(() => {
            window.location.reload();
          }, 1500);
        }
      } else {
        toast.error(`Error: ${response.data.message}`);
      }
    } catch (error) {
      console.error('Sell error:', error);
      toast.error(`Error selling ${session.symbol}: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Rest of the component...
}

export default SessionCard;