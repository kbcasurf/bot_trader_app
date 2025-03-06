# Crypto Trading Bot

An automated cryptocurrency trading bot with real-time price monitoring, automated trading strategies, and Telegram notifications.

## Features

- Real-time price monitoring for multiple trading pairs
- Automated trading strategy execution
- Telegram notifications for trade alerts
- Web-based dashboard interface
- Database storage for trade history
- Secure API integration with Binance

## Trading Pairs

The bot currently supports the following trading pairs:
- BTC/USDT
- SOL/USDT
- XRP/USDT
- PENDLE/USDT
- DOGE/USDT
- NEAR/USDT

## Trading Strategy

The bot implements a simple trading strategy:
- Sells when price increases by 5% from the initial buy price
- Buys more when price drops by 5% (dollar-cost averaging)
- Automatically tracks and manages positions

## Prerequisites

- Docker and Docker Compose
- Binance API credentials
- Telegram Bot Token and Chat ID
- Node.js (for local development)

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd bot_trader_app
```

2. Create a `.env` file in the root directory with the following variables:
```env
# Backend Configuration
PORT=4000
FRONTEND_URL=http://localhost:3000

# Database Configuration
DB_HOST=database
DB_USER=your_db_user
DB_PASSWORD=your_db_password
DB_NAME=bot_trader

# Binance API Configuration
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
```

3. Start the application using Docker Compose:
```bash
docker-compose up -d
```

The application will be available at:
- Frontend: http://localhost:3000
- Backend: http://localhost:4000

## Development Setup

### Backend
1. Navigate to the backend directory:
```bash
cd backend
npm install
npm start
```

### Frontend
1. Navigate to the frontend directory:
```bash
cd frontend
npm install
npm run dev
```

## Usage

1. Access the web dashboard at http://localhost:3000
2. Monitor real-time price updates for supported trading pairs
3. Initial purchases can be made through the dashboard interface
4. The bot will automatically execute trades based on the configured strategy
5. Trade notifications will be sent to your configured Telegram chat

## Monitoring

- Check the `error.log` and `combined.log` files in the backend directory for system logs
- Monitor trade history in the MySQL database
- View real-time notifications in your Telegram chat

## Security Considerations

- Store API keys securely in environment variables
- Use strong passwords for the database
- Regularly monitor trading activity and system logs
- Keep the system and dependencies updated

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

                    GNU GENERAL PUBLIC LICENSE
                     Version 3, 29 June 2007