import React, { useState } from 'react'
import { Box, Card, CardContent, Typography, Button, Slider, LinearProgress } from '@mui/material'
import { styled } from '@mui/material/styles'

const InvestmentSlider = styled(Slider)(({ theme }) => ({
  '& .MuiSlider-mark': {
    backgroundColor: '#bfbfbf',
    height: 8,
    width: 1,
    '&.MuiSlider-markActive': {
      backgroundColor: 'currentColor',
    },
  },
}))

const marks = [
  { value: 50, label: '$50' },
  { value: 100, label: '$100' },
  { value: 150, label: '$150' },
  { value: 200, label: '$200' },
]

const CryptoCard = ({ pair, currentPrice, trades }) => {
  const [investment, setInvestment] = useState(50)
  const [isFirstPurchase, setIsFirstPurchase] = useState(true)

  const totalInvestment = trades.reduce((sum, trade) => 
    sum + (trade.type === 'buy' ? trade.amount : -trade.amount), 0)

  const profitLoss = trades.length > 0
    ? ((currentPrice - trades[0].price) / trades[0].price) * 100
    : 0

  const getProgressColor = (value) => {
    if (value > 0) return `rgba(0, 255, 0, ${Math.min(Math.abs(value) / 10, 1)})`
    return `rgba(255, 0, 0, ${Math.min(Math.abs(value) / 10, 1)})`
  }

  const handleFirstPurchase = async () => {
    try {
      const response = await fetch('/api/trade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: pair.symbol,
          amount: investment,
          type: 'buy'
        })
      })
      
      if (response.ok) {
        setIsFirstPurchase(false)
      }
    } catch (error) {
      console.error('Failed to execute trade:', error)
    }
  }

  return (
    <Card sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 3,
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      bgcolor: 'background.paper',
      transition: 'transform 0.2s ease-in-out',
      '&:hover': {
        transform: 'translateY(-4px)'
      }
    }}>
      <CardContent sx={{ p: 3 }}>
        <Box sx={{ mb: 3 }}>
          {isFirstPurchase && (
            <>
              <Typography variant="subtitle1" sx={{ mb: 1, fontWeight: 500, fontSize: '0.95rem' }}>
                Select Investment Amount
              </Typography>
              <InvestmentSlider
                value={investment}
                onChange={(_, value) => setInvestment(value)}
                step={null}
                marks={marks}
                min={50}
                max={200}
                sx={{ mb: 2.5 }}
              />
              <Button
                variant="contained"
                fullWidth
                onClick={handleFirstPurchase}
                sx={{
                  mb: 2,
                  borderRadius: 2,
                  textTransform: 'none',
                  py: 1,
                  fontSize: '0.9rem',
                  fontWeight: 500
                }}
              >
                First Purchase
              </Button>
            </>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2.5 }}>
          <Box
            component="img"
            src={`/images/${pair.symbol.toLowerCase()}.svg`}
            alt={pair.name}
            sx={{
              width: 64,
              height: 64,
              mr: 2,
              borderRadius: '50%',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
            }}
          />
          <Box>
            <Typography variant="h6" component="div" sx={{ fontSize: '1.1rem', fontWeight: 600, mb: 0.5 }}>
              {pair.symbol}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.85rem' }}>
              ${currentPrice?.toFixed(2) || '---'}
            </Typography>
          </Box>
        </Box>

        {!isFirstPurchase && (
          <>
            <Typography variant="body2" gutterBottom>
              Total Investment: ${totalInvestment.toFixed(2)}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" sx={{ mr: 1 }}>
                P/L: {profitLoss.toFixed(2)}%
              </Typography>
              <Box sx={{ flexGrow: 1 }}>
                <LinearProgress
                  variant="determinate"
                  value={Math.min(Math.abs(profitLoss), 100)}
                  sx={{
                    height: 8,
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    '& .MuiLinearProgress-bar': {
                      backgroundColor: getProgressColor(profitLoss)
                    }
                  }}
                />
              </Box>
            </Box>

            <Box sx={{ mt: 2, maxHeight: 150, overflowY: 'auto' }}>
              <Typography variant="subtitle2" gutterBottom>
                Recent Trades
              </Typography>
              {trades.slice(-5).map((trade, index) => (
                <Typography key={index} variant="body2" color="text.secondary">
                  {new Date(trade.timestamp).toLocaleTimeString()}: {trade.type.toUpperCase()} @ ${trade.price.toFixed(2)}
                </Typography>
              ))}
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export default CryptoCard