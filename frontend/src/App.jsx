import React, { useState, useEffect, useCallback } from 'react'
import { Box, Container, Grid, Typography, Alert, Snackbar } from '@mui/material'
import CryptoCard from './components/CryptoCard'
import { io } from 'socket.io-client'

const CRYPTO_PAIRS = [
  { symbol: 'BTC/USDT', name: 'Bitcoin', image: '/images/btc.svg' },
  { symbol: 'SOL/USDT', name: 'Solana', image: '/images/sol.svg' },
  { symbol: 'XRP/USDT', name: 'Ripple', image: '/images/xrp.svg' },
  { symbol: 'PENDLE/USDT', name: 'Pendle', image: '/images/pendle.svg' },
  { symbol: 'DOGE/USDT', name: 'Dogecoin', image: '/images/doge.svg' },
  { symbol: 'NEAR/USDT', name: 'NEAR Protocol', image: '/images/near.svg' }
]

function App() {
  const [prices, setPrices] = useState({})
  const [trades, setTrades] = useState({})
  const [connectionStatus, setConnectionStatus] = useState('connecting')
  const [error, setError] = useState(null)
  const [reconnectAttempts, setReconnectAttempts] = useState(0)
  const maxReconnectAttempts = 5

  const connectToSocket = useCallback(() => {
    setConnectionStatus('connecting')
    
    // Get API URL from environment or use default
    const apiUrl = import.meta.env.VITE_API_URL || ''
    const socket = io(apiUrl, {
      reconnectionAttempts: maxReconnectAttempts,
      reconnectionDelay: 1000,
      timeout: 10000
    })

    socket.on('connect', () => {
      setConnectionStatus('connected')
      setError(null)
      setReconnectAttempts(0)
    })

    socket.on('priceUpdate', (data) => {
      setPrices(prev => ({ ...prev, [data.symbol]: data.price }))
    })

    socket.on('tradeUpdate', (data) => {
      setTrades(prev => ({
        ...prev,
        [data.symbol]: [...(prev[data.symbol] || []), data]
      }))
    })

    socket.on('error', (err) => {
      setError(`Connection error: ${err.message || 'Unknown error'}`)
      setConnectionStatus('error')
    })

    socket.on('disconnect', () => {
      setConnectionStatus('disconnected')
    })

    socket.on('reconnect_attempt', (attempt) => {
      setReconnectAttempts(attempt)
      setConnectionStatus('reconnecting')
    })

    socket.on('reconnect_failed', () => {
      setConnectionStatus('failed')
      setError('Failed to connect to server after multiple attempts')
    })

    return socket
  }, [])

  useEffect(() => {
    const socket = connectToSocket()
    return () => socket.disconnect()
  }, [connectToSocket])

  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Typography 
        variant="h4" 
        component="h1" 
        gutterBottom 
        align="center"
        sx={{
          fontSize: '2rem',
          fontWeight: 500,
          color: 'text.primary',
          mb: 4,
          letterSpacing: '0.02em'
        }}
      >
        Crypto Trading Dashboard
      </Typography>
      <Box sx={{ flexGrow: 1 }}>
        <Grid container spacing={4}>
          {CRYPTO_PAIRS.map((pair) => (
            <Grid item xs={12} sm={6} md={4} key={pair.symbol}>
              <CryptoCard
                pair={pair}
                currentPrice={prices[pair.symbol]}
                trades={trades[pair.symbol] || []}
              />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Container>
  )
}

export default App