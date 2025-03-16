# Crypto Trading Bot

A cryptocurrency trading bot that automates trading strategies on Binance.

## Features

- Dashboard with 6 cryptocurrencies (BTC, SOL, XRP, PENDLE, DOGE, NEAR)
- Automated trading based on price movements
- Real-time price updates via WebSockets
- Telegram notifications for trade executions
- Profit/loss visualization

## Architecture

- **Frontend**: HTML, CSS, JavaScript with Vue.js
- **Backend**: Node.js with Express
- **Database**: MariaDB
- **Containerization**: Docker

## Setup Instructions

### Prerequisites

- Docker and Docker Compose
- Binance API key and secret
- Telegram Bot token and chat ID

### Configuration

1. Clone the repository
2. Create a `.env` file in the root directory with your credentials:
```env
# Database Configuration
DB_HOST=db
DB_USER=your_db_user
DB_PASSWORD=your_secure_password
DB_NAME=bottrader

# Binance API Configuration
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id

# MySQL Root Password
MYSQL_ROOT_PASSWORD=your_secure_root_password

# Frontend Configuration
VITE_API_URL=http://backend:4000

# Backend Port
PORT=4000
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
