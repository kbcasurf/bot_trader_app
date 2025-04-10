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
- Infrastructure-as-Code with Terraform for OCI Free Tier deployment
- Comprehensive security pipeline with SonarQube, Checkov, and OWASP ZAP

## Setup Instructions

### Prerequisites

- Docker and Docker Compose installed
- Binance account with API keys
- Telegram bot token and chat ID

### Configuration

1. Clone this repository
2. Create a `.env` file in the root directory with the following variables:
```
# Database Configuration
DB_USER=trading_bot_user
DB_PASSWORD=your_secure_password
DB_NAME=crypto_trading_bot
MYSQL_ROOT_PASSWORD=your_secure_root_password

# Binance API Configuration
BINANCE_API_KEY=your_binance_api_key
BINANCE_API_SECRET=your_binance_api_secret
BINANCE_API_URL=https://api.binance.com
BINANCE_WEBSOCKET_URL=wss://stream.binance.com:9443

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_CHAT_ID=your_telegram_chat_id
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

Open your browser and navigate to `http://localhost:8080`

## Cloud Deployment

The project includes Terraform configurations to deploy the application on Oracle Cloud Infrastructure (OCI) Free Tier.

See the [Infrastructure README](./infrastructure/README.md) for detailed setup instructions.

## Trading Strategy

The bot implements a simple but effective "buy the dip, sell the rise" strategy:

1. Initial purchase is made when the user clicks "First Purchase"
2. The bot sells when price increases by 5% from the initial purchase
3. The bot buys more when price drops by 5% from the last purchase
4. The cycle continues until the user manually stops it or uses the "Sell All" button

## Technology Stack

- Frontend: HTML, CSS, JavaScript with Vite
- Backend: Node.js, Express
- Database: MariaDB
- Containerization: Docker
- APIs: Binance API, Telegram Bot API
- Infrastructure: Terraform, Oracle Cloud Infrastructure
- Security: SonarQube (SAST), Checkov (IaC), OWASP ZAP (DAST)

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

## Security Pipeline

This project uses GitHub Actions for continuous integration and security scanning:

- **SonarQube**: Static Application Security Testing (SAST)
- **Checkov**: Infrastructure-as-Code security scanning for Terraform
- **OWASP ZAP**: Dynamic Application Security Testing (DAST)

See the [GitHub Workflows](./.github/workflows/code-analysis.yml) for implementation details.

## License

GNU GENERAL PUBLIC LICENSE