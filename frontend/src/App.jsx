import React, { useState, useEffect } from 'react'
import { Box, Container, Grid, Typography } from '@mui/material'
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

  useEffect(() => {
    const socket = io('/ws')

    socket.on('priceUpdate', (data) => {
      setPrices(prev => ({ ...prev, [data.symbol]: data.price }))
    })

    socket.on('tradeUpdate', (data) => {
      setTrades(prev => ({
        ...prev,
        [data.symbol]: [...(prev[data.symbol] || []), data]
      }))
    })

    return () => socket.disconnect()
  }, [])

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