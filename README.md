# Automated Cryptocurrency Trading Bot

A fully automated cryptocurrency trading bot that executes trades on the Binance platform according to configurable threshold-based strategies, with real-time monitoring and notifications.

## Project Overview

This trading bot monitors cryptocurrency price movements in real-time through Binance's WebSocket API and automatically executes buy and sell orders based on configurable percentage-based thresholds, implementing a "buy the dip, sell the rise" strategy.

## Key Features

- **Automated Trading Strategy**: 
  - Makes initial purchase when instructed by the user
  - Sells when price increases by a configurable percentage (default 1%)
  - Buys more when price drops by a configurable percentage (default 1%)
  - Continues the cycle automatically until disabled

- **Real-time Price Monitoring**: 
  - Connects to Binance WebSocket for live price updates
  - Supports multiple cryptocurrencies (BTC, SOL, XRP, PENDLE, DOGE, NEAR)

- **User Interface**:
  - Web-based dashboard showing current holdings, prices, and profit/loss
  - Individual cards for each supported cryptocurrency
  - Control buttons for manual buying and selling
  - Auto-trading toggle with activity indicator

- **Notifications**:
  - Telegram integration for trade notifications and system alerts

- **Database Integration**:
  - Records all trades and maintains transaction history
  - Stores reference prices for trading algorithms
  - Tracks account balances and holdings

## Technology Stack

- **Frontend**: HTML, CSS, JavaScript with Vite
- **Backend**: Node.js, Express
- **Database**: MariaDB
- **Real-time Communication**: Socket.IO
- **APIs**: Binance API (WebSocket and REST), Telegram Bot API
- **Containerization**: Docker, Docker Compose

## Architecture

The application follows a microservices architecture:

1. **Frontend Service**: Web UI served via Nginx
2. **Backend Service**: Core trading logic and API integrations
3. **Database Service**: MariaDB for data persistence

## Setup Instructions

### Prerequisites

- Docker and Docker Compose installed
- Binance account with API keys
- Telegram bot token and chat ID

### Configuration

1. Clone this repository
2. Create a `.env` file in the root directory by copying from the provided example:
```
# Database Configuration
DB_USER=trading_bot_user
DB_PASSWORD=your_secure_password
DB_NAME=crypto_trading_bot
MYSQL_ROOT_PASSWORD=your_secure_root_password

# Additional Configuration
PORT=3000
DB_CONNECTION_LIMIT=10
DB_CONNECT_TIMEOUT=20000
API_TIMEOUT_MS=10000
WS_RECONNECT_DELAY=2000
WS_MAX_RECONNECT_DELAY=60000
WS_HEARTBEAT_TIMEOUT=30000

# Binance API Configuration
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret
# Testnet (default)
BINANCE_API_URL=https://testnet.binance.vision
BINANCE_WEBSOCKET_URL=wss://testnet.binance.vision

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# External Access Configuration
EXTERNAL_HOST=VPS_IP_ADDRESS
VITE_BACKEND_URL=http://VPS_IP_ADDRESS:3000

# WebSocket connection settings
SOCKET_TRANSPORTS=websocket,polling
SOCKET_UPGRADE=true

# Use BAKE for building the Docker image
COMPOSE_BAKE=true
```

### Running the Application

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Accessing the Dashboard

Open your browser and navigate to `http://localhost` or your configured external host

## Trading Strategy

The bot implements a percentage-based trading strategy:

1. Initial purchase is made when the user clicks "First Purchase" for a cryptocurrency
2. Reference prices are set based on the initial purchase:
   - After a buy, next_buy_price is set to purchase price - buy threshold
   - After a buy, next_sell_price is set to purchase price + sell threshold
3. Automated trading rules:
   - If price falls to or below next_buy_price, the bot buys more
   - If price rises to or above next_sell_price, the bot sells all holdings
   - After each transaction, reference prices are recalculated

## Development

For development purposes, you can run services individually:

### Frontend
```bash
cd frontend
npm install
npm start
```

### Backend
```bash
cd backend
npm install
npm run dev
```

## Recent Improvements

Recent updates include:
- Production environment optimizations
- Threshold configuration options
- Algorithm refinements
- Transaction price calculation fixes

## License

GNU GENERAL PUBLIC LICENSE