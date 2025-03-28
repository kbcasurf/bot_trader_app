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
2. Copy the `.env.example` file to `.env`
3. Fill in your Binance API keys, Telegram bot token, and other configuration details in the `.env` file

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

Open your browser and navigate to `http://localhost:8080`

## Trading Strategy

The bot implements a simple but effective "buy the dip, sell the rise" strategy:

1. Initial purchase is made when the user clicks "First Purchase"
2. The bot sells when price increases by 5% from the initial purchase
3. The bot buys more when price drops by 5% from the last purchase
4. The cycle continues until the user manually stops it or uses the "Sell All" button

## Technology Stack

- Frontend: HTML, CSS, JavaScript
- Backend: Node.js, Express
- Database: MariaDB
- Containerization: Docker
- APIs: Binance API, Telegram Bot API

## License

GNU GENERAL PUBLIC LICENSE