# Automated Cryptocurrency Trading Bot

An automated trading bot that executes cryptocurrency trades on the Binance platform according to predefined strategies.

## Project Overview

This trading bot monitors price movements from Binance Price Stream WebSocket and automatically executes buy/sell orders based on percentage-based rules, while keeping users informed via Telegram notifications.

## Features

- Automated trading with "buy the dip, sell the rise" strategy
- Real-time price monitoring via Binance WebSocket
- Telegram notifications for trade events
- User-friendly dashboard for configuration and monitoring
- Containerized architecture using Docker


## Setup Instructions

### Prerequisites

- Docker and Docker Compose installed
- Binance account with API keys
- Telegram bot token and chat ID

### Configuration

1. Clone this repository
2. Create a `.env` file in the root directory by copying from the provided `.env.example`:
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

# Trading Configuration
# Percentage thresholds for buy/sell (decimal format: 0.01 = 1%)
TRADING_BUY_THRESHOLD=0.01
TRADING_SELL_THRESHOLD=0.01
# Default investment amount for auto-trading operations (in USDT)
TRADING_DEFAULT_INVESTMENT=50
```

### Running the Application Locally

```bash
# Start all services
docker-compose up -d

# Check logs
docker-compose logs -f

# Stop all services
docker-compose down
```

### Accessing the Dashboard

Open your browser and navigate to `http://localhost`

## Cloud Deployment with SSL

The project includes Traefik as a reverse proxy to handle HTTPS with automatic Let's Encrypt certificate management.

### VPS Deployment with Let's Encrypt

1. Clone the repository to your VPS
2. Create a `.env` file with proper configuration, especially:
   ```
   EXTERNAL_HOST=your-domain.com
   VITE_BACKEND_URL=https://your-domain.com
   ACME_EMAIL=your-email@example.com
   ```
3. Make sure your domain name (configured in `EXTERNAL_HOST`) points to your VPS IP address
4. Launch the application:
   ```bash
   docker-compose up -d
   ```

Traefik will automatically:
- Obtain and renew Let's Encrypt certificates for your domain
- Redirect HTTP traffic to HTTPS
- Route requests to the appropriate services

The dashboard will be available at `https://your-domain.com` and PHPMyAdmin at `https://admin.your-domain.com`

## Trading Strategy

The bot implements a simple but effective "buy the dip, sell the rise" strategy:

1. Initial purchase is made when the user clicks "Buy" button
2. The bot sells when price increases by the configured percentage (default 1%) from the last transaction price
3. The bot buys more when price drops by the configured percentage (default 1%) from the last transaction price
4. The cycle continues until the user manually stops it or uses the "Sell All" button

The buy/sell thresholds and default investment amount can be customized in the .env file using these variables:
- `TRADING_BUY_THRESHOLD`: Percentage drop required to trigger a buy (default: 0.01 or 1%)
- `TRADING_SELL_THRESHOLD`: Percentage rise required to trigger a sell (default: 0.01 or 1%)
- `TRADING_DEFAULT_INVESTMENT`: Default USDT amount for automatic buy operations (default: 50 USDT)

## Technology Stack

- Frontend: HTML, CSS, JavaScript with Vite
- Backend: Node.js, Express
- Database: MariaDB
- Containerization: Docker
- APIs: Binance API, Telegram Bot API


## Development

To run the services individually for development:

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

## License

GNU GENERAL PUBLIC LICENSE