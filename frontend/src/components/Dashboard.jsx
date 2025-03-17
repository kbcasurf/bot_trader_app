import React, { useState, useEffect } from 'react';
import api from '../services/api';
import SessionCard from './SessionCard';
import NewSessionForm from './NewSessionForm';
import { toast } from 'react-toastify';

const Dashboard = () => {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  
  // Define the fetchInitialData function
  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const response = await api.get('/binance/sessions');
      setSessions(response.data);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      setError('Failed to load sessions. Please try again later.');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchInitialData();
    
    // Set up polling to refresh data
    const interval = setInterval(() => {
      fetchInitialData();
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, []);
  
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-8">Trading Dashboard</h1>
      
      <NewSessionForm onSessionCreated={fetchInitialData} />
      
      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-6">
          {error}
        </div>
      )}
      
      {loading && sessions.length === 0 ? (
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <>
          {sessions.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">No active trading sessions. Start one above!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sessions.map(session => (
                <SessionCard 
                  key={session.id} 
                  session={session} 
                  onSessionUpdate={fetchInitialData} 
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Dashboard;