# Product Requirements Document: Automated Cryptocurrency Trading Bot

## 1. Product Overview

### 1.1 Purpose
The Automated Cryptocurrency Trading Bot is designed to execute cryptocurrency trades on the Binance platform according to predefined strategies. The system monitors price movements from Binance Price Stream WebSocket and automatically executes buy/sell orders based on percentage-based rules, while keeping users informed via Telegram notifications.

### 1.2 Product Vision
To provide cryptocurrency traders with an automated solution that can execute a simple but effective trading strategy without requiring constant manual monitoring, helping users to potentially capitalize on market volatility while managing risk.

### 1.3 Target Users
- Cryptocurrency traders who want to automate their trading strategy
- Binance platform users with existing USDT balances
- Traders who prefer a "buy the dip, sell the rise" strategy
- Users who want real-time notifications about their trading activities

## 2. System Architecture

### 2.1 High-Level Architecture
The system will consist of three main containerized components:

2.1.1 **Frontend Container**
   - HTML, CSS, JavaScript files
   - User interface for configuration and monitoring
   - Built with Vite UI resources

2.1.2 **Backend Container**
   - Node.js application
   - Connects to Binance API for trading operations
   - Connects to Binance WebSocket Stream for price updates
   - Connects to Telegram API for notifications
   - Implements trading logic and algorithms

2.1.3 **Database Container**
   - MariaDB database
   - Stores trading history and configuration.
   - Maintains state for the trading bot

### 2.2 Component Interactions
- Frontend communicates with Backend via RESTful API and socker.io lib
- Backend connects to Binance via their official API to place book orders and Binance WSS for price updates
- WebSocket connections for real-time price updates
- Backend connects to Telegram via Bot API
- Backend reads/writes to the Database for persistence

### 2.3 Files and folder structure
-root folder
docker-compose.yaml
.env
.gitignore
README.md
	-frontend folder
	Dockerfile
	index.html
	main.js
	package.json
	style.css
		-images	
		all logo images .svg
		-js
		dashboard.js
		cards.js
	-backend folder
	Dockerfile
	main.js
	package.json
		-js
		telegram.js
		binance.js
		dbconns.js
	-database folder
	Dockerfile
	init.sql
	schema.sql

All .js files must be integrated, using the same file to config, middleware, api connections, service files and all of them.

## 3. Functional Requirements

### 3.1 User Interface Requirements

#### 3.1.1 Dashboard Layout
- Display 6 cryptocurrency trading pairs in a 2×3 grid layout
- Trading pairs to include: BTC/USDT, SOL/USDT, XRP/USDT, PENDLE/USDT, DOGE/USDT, NEAR/USDT
- Clean, minimalist design with clear color scheme
- Responsive design for various screen sizes

#### 3.1.2 Cryptocurrency Card Components
Each cryptocurrency card in the dashboard must include:
1. Cryptocurrency logo and pair name (e.g., BTC/USDT)
2. Investment slider with 4 presets: $50, $100, $150, $200 (default: $50)
3. "First Purchase" button to initiate trading
4. Current holdings display showing amount of cryptocurrency owned
5. Profit/loss visualization bar with color gradient (green for profit, red for loss)
6. Transaction history list showing past operations with timestamps and prices
7. "Sell All" button as stop loss strategy

### 3.2 Trading Algorithm Requirements

#### 3.2.1 Initial Purchase
- User selects initial investment amount via slider (options: $50, $100, $150, $200)
- System executes market order on Binance when "Buy Crypto" button is clicked
- Initial purchase price is recorded in database as reference point

#### 3.2.2 Automated Trading Rules
After initial purchase, the system must:
1. **Sell Condition**: When current price received from Binance Market Price Stream is ≥5% above initial purchase price, sell entire cryptocurrency position at market price
2. **Buy Condition**: When current price received from Binance Market Price Stream drops by ≥5% from last purchase price, buy additional $50 worth of cryptocurrency
3. **Continuous Monitoring**: Continue monitoring for 5% price drops to make additional $50 purchases
4. **Exit Strategy**: When price received from Binance Market Price Stream rises to ≥5% above initial purchase price, sell all accumulated cryptocurrency
5. **Sell All**: User must have a "Sell All" button as stop-loss resource

#### 3.2.3 Notification System
- Send Telegram notification for each executed trade (buy/sell)
- Include cryptocurrency pair, operation type, price, quantity, and timestamp in notifications
- Alert user of any system errors or API issues

### 3.3 Database Requirements

#### 3.3.1 Data Storage
The database must store:
- Trading history with timestamps
- Purchase/sell prices for each transaction
- Current holdings for each cryptocurrency

#### 3.3.2 Schema Design
Create appropriate tables for:
- Transaction history
- Cryptocurrency configuration

### 3.4 Integration Requirements

#### 3.4.1 Binance API Integration
- Implement market data retrieval for supported trading pairs from Binance WEbSocket Stream using @bookTicker
- Execute spot market orders for buying and selling
- Retrieve account balance information
- Implement rate limiting to comply with Binance API restrictions
- Handle API authentication securely
- All instructions to implement this features are present in item "7. Binance API implementation instructions" at the end of this doc

#### 3.4.2 Telegram API Integration
- Manage a Telegram bot for notifications
- Implement secure user authentication for Telegram
- Send formatted messages for various event types
- Handle message delivery failures and retries

## 4. Non-Functional Requirements

### 4.1 Performance Requirements
- Real-time price updates with maximum 5-second delay
- Order execution with maximum 3-second latency
- Efficient database queries with response times under 500ms

### 4.2 Security Requirements
- Implement HTTPS for all communications
- Store API keys and sensitive information in a .env file at the root of the project
- Implement proper authentication and authorization
- Secure database connections and queries

### 4.3 Reliability Requirements
- System availability target of 99.5%
- Automatic recovery from connection failures
- Graceful degradation during API outages

### 4.4 Scalability Requirements
- Containerized architecture for easy scaling
- Database optimization for growing transaction history

## 5. Technical Specifications

### 5.1 Frontend Technologies
- HTML5, CSS3, JavaScript
- Vite UI components
- Connection with Binance WebSocket for real-time data
- Responsive design framework
- Dockerfile for containerization

### 5.2 Backend Technologies
- Node.js runtime
- Express.js for API development
- Connection with Binance WebSocket for real-time data
- Telegram Bot API library
- Dockerfile for containerization

### 5.3 Database Technologies
- MariaDB database
- SQL initialization scripts
- Dockerfile with MariaDB image

### 5.4 DevOps Requirements
- Docker containers for all components
- Docker Compose for orchestration
- Environment variables management using .env file at the root of the project

## 6. User Flows

### 6.1 Trading Initiation Flow
1. User selects investment amount using slider for chosen cryptocurrency
2. User clicks "Buy Crypto" button
3. System executes spot market order and saves transaction data on db cause it must be used to calculate profit to decide when to buy or sell crypto automatically
4. System begins automated monitoring and transactions as covered in #3.2.2 Automated Trading Rules
5. User receives confirmation notification via Telegram
7. User also can use "Sell All" button as a stop loss strategy

### 6.2 Monitoring Flow
1. User views dashboard to check current status
2. User observes profit/loss visualization
3. User receives real-time notifications on Telegram for trading event


## 7. Binance API implementation instructions

### 7.1 Access to Binance Websocket Market Price Stream
Web Socket Streams for Binance (2025-01-28)
General WSS information
The base endpoint is: wss://stream.binance.com:9443 or wss://stream.binance.com:443
Streams can be accessed either in a single raw stream or in a combined stream.
Raw streams are accessed at /ws/<streamName>
Combined streams are accessed at /stream?streams=<streamName1>/<streamName2>/<streamName3>
Combined stream events are wrapped as follows: {"stream":"<streamName>","data":<rawPayload>}
All symbols for streams are lowercase
A single connection to stream.binance.com is only valid for 24 hours; expect to be disconnected at the 24 hour mark
The websocket server will send a ping frame every 20 seconds.
If the websocket server does not receive a pong frame back from the connection within a minute the connection will be disconnected.
When you receive a ping, you must send a pong with a copy of ping's payload as soon as possible.
Unsolicited pong frames are allowed, but will not prevent disconnection. It is recommended that the payload for these pong frames are empty.
The base endpoint wss://data-stream.binance.vision can be subscribed to receive only market data messages.
User data stream is NOT available from this URL.
All time and timestamp related fields are milliseconds by default. To receive the information in microseconds, please add the parameter timeUnit=MICROSECOND or timeUnit=microsecond in the URL.
For example: /stream?streams=btcusdt@trade&timeUnit=MICROSECOND
Websocket Limits
WebSocket connections have a limit of 5 incoming messages per second. A message is considered:
A PING frame
A PONG frame
A JSON controlled message (e.g. subscribe, unsubscribe)
A connection that goes beyond the limit will be disconnected; IPs that are repeatedly disconnected may be banned.
A single connection can listen to a maximum of 1024 streams.
There is a limit of 300 connections per attempt every 5 minutes per IP.
Live Subscribing/Unsubscribing to streams
The following data can be sent through the websocket instance in order to subscribe/unsubscribe from streams. Examples can be seen below.
The id is used as an identifier to uniquely identify the messages going back and forth. The following formats are accepted:
64-bit signed integer
alphanumeric strings; max length 36
null
In the response, if the result received is null this means the request sent was a success for non-query requests (e.g. Subscribing/Unsubscribing).
Subscribe to a stream
Request

{
  "method": "SUBSCRIBE",
  "params": [
    "btcusdt@aggTrade",
    "btcusdt@depth"
  ],
  "id": 1
}
Response

{
  "result": null,
  "id": 1
}

For our purposes, we'll use this one as a multiple <symbol>@bookTicker stream.
Individual Symbol Book Ticker Streams
Pushes any update to the best bid or ask's price or quantity in real-time for a specified symbol. Multiple <symbol>@bookTicker streams can be subscribed to over one connection.

Stream Name: <symbol>@bookTicker

Update Speed: Real-time

Payload:

{
  "u":400900217,     // order book updateId
  "s":"BNBUSDT",     // symbol
  "b":"25.35190000", // best bid price
  "B":"31.21000000", // best bid qty
  "a":"25.36520000", // best ask price
  "A":"40.66000000"  // best ask qty
}

For example: wss://stream.binance.com:9443/ws/stream?streams=btcusdt@bookTicker/nearusdt@bookTicker/solusdt@bookTicker/.... and so on.


### 7.2 Access to Binance API and authentication instructions
Public Rest API for Binance SPOT Testnet
Last Updated: 2025-03-05

General API Information
The base endpoint is https://testnet.binance.vision/api
All endpoints return either a JSON object or array.
Data is returned in ascending order. Oldest first, newest last.
All time and timestamp related fields in the JSON responses are in milliseconds by default. To receive the information in microseconds, please add the header X-MBX-TIME-UNIT:MICROSECOND or X-MBX-TIME-UNIT:microsecond.
Timestamp parameters (e.g. startTime, endTime, timestamp) can be passed in milliseconds or microseconds.
HTTP Return Codes
HTTP 4XX return codes are used for malformed requests; the issue is on the sender's side.
HTTP 403 return code is used when the WAF Limit (Web Application Firewall) has been violated.
HTTP 409 return code is used when a cancelReplace order partially succeeds. (i.e. if the cancellation of the order fails but the new order placement succeeds.)
HTTP 429 return code is used when breaking a request rate limit.
HTTP 418 return code is used when an IP has been auto-banned for continuing to send requests after receiving 429 codes.
HTTP 5XX return codes are used for internal errors; the issue is on Binance's side. It is important to NOT treat this as a failure operation; the execution status is UNKNOWN and could have been a success.
Error Codes
Any endpoint can return an ERROR
Sample Payload below:

{
  "code": -1121,
  "msg": "Invalid symbol."
}
Specific error codes and messages are defined in Errors Codes.
General Information on Endpoints
For GET endpoints, parameters must be sent as a query string.
For POST, PUT, and DELETE endpoints, the parameters may be sent as a query string or in the request body with content type application/x-www-form-urlencoded. You may mix parameters between both the query string and request body if you wish to do so.
Parameters may be sent in any order.
If a parameter sent in both the query string and request body, the query string parameter will be used.
LIMITS
General Info on Limits
The following intervalLetter values for headers:
SECOND => S
MINUTE => M
HOUR => H
DAY => D
intervalNum describes the amount of the interval. For example, intervalNum 5 with intervalLetter M means "Every 5 minutes".
The /api/v3/exchangeInfo rateLimits array contains objects related to the exchange's RAW_REQUESTS, REQUEST_WEIGHT, and ORDERS rate limits. These are further defined in the ENUM definitions section under Rate limiters (rateLimitType).
Requests fail with HTTP status code 429 when you exceed the request rate limit.
IP Limits
Every request will contain X-MBX-USED-WEIGHT-(intervalNum)(intervalLetter) in the response headers which has the current used weight for the IP for all request rate limiters defined.
Each route has a weight which determines for the number of requests each endpoint counts for. Heavier endpoints and endpoints that do operations on multiple symbols will have a heavier weight.
When a 429 is received, it's your obligation as an API to back off and not spam the API.
Repeatedly violating rate limits and/or failing to back off after receiving 429s will result in an automated IP ban (HTTP status 418).
IP bans are tracked and scale in duration for repeat offenders, from 2 minutes to 3 days.
A Retry-After header is sent with a 418 or 429 responses and will give the number of seconds required to wait, in the case of a 429, to prevent a ban, or, in the case of a 418, until the ban is over.
The limits on the API are based on the IPs, not the API keys.
Unfilled Order Count
Every successful order response will contain a X-MBX-ORDER-COUNT-(intervalNum)(intervalLetter) header indicating how many orders you have placed for that interval.

To monitor this, refer to GET api/v3/rateLimit/order.
Rejected/unsuccessful orders are not guaranteed to have X-MBX-ORDER-COUNT-** headers in the response.
If you have exceeded this, you will receive a 429 error without the Retry-After header.
Please note that if your orders are consistently filled by trades, you can continuously place orders on the API. For more information, please see Spot Unfilled Order Count Rules.
The number of unfilled orders is tracked for each account.
Data Sources
The API system is asynchronous, so some delay in the response is normal and expected.
Each endpoint has a data source indicating where the data is being retrieved, and thus which endpoints have the most up-to-date response.
These are the three sources, ordered by least to most potential for delays in data updates.

Matching Engine - the data is from the Matching Engine
Memory - the data is from a server's local or external memory
Database - the data is taken directly from a database
Some endpoints can have more than 1 data source. (e.g. Memory => Database) This means that the endpoint will check the first Data Source, and if it cannot find the value it's looking for it will check the next one.

Endpoint security type
Each endpoint has a security type that determines how you will interact with it. This is stated next to the NAME of the endpoint.
If no security type is stated, assume the security type is NONE.
API-keys are passed into the Rest API via the X-MBX-APIKEY header.
API-keys and secret-keys are case sensitive.
API-keys can be configured to only access certain types of secure endpoints.
For example, one API-key could be used for TRADE only,
while another API-key can access everything except for TRADE routes.
By default, API-keys can access all secure routes.
Security Type	Description
NONE	Endpoint can be accessed freely.
TRADE	Endpoint requires sending a valid API-Key and signature.
USER_DATA	Endpoint requires sending a valid API-Key and signature.
USER_STREAM	Endpoint requires sending a valid API-Key.
TRADE and USER_DATA endpoints are SIGNED endpoints.
SIGNED (TRADE and USER_DATA) Endpoint security
SIGNED endpoints require an additional parameter, signature, to be sent in the query string or request body.
The signature is not case sensitive.
Please consult the examples below on how to compute signature, depending on which API key type you are using.
Timing security
A SIGNED endpoint also requires a parameter, timestamp, to be sent which should be the millisecond timestamp of when the request was created and sent.

An additional parameter, recvWindow, may be sent to specify the number of milliseconds after timestamp the request is valid for. If recvWindow is not sent, it defaults to 5000.

The logic is as follows:

if (timestamp < (serverTime + 1000) && (serverTime - timestamp) <= recvWindow) {
  // process request
} else {
  // reject request
}
Serious trading is about timing. Networks can be unstable and unreliable, which can lead to requests taking varying amounts of time to reach the servers. With recvWindow, you can specify that the request must be processed within a certain number of milliseconds or be rejected by the server.

It is recommended to use a small recvWindow of 5000 or less! The max cannot go beyond 60,000!

SIGNED Endpoint Examples for POST /api/v3/order
HMAC Keys
Here is a step-by-step example of how to send a valid signed payload from the Linux command line using echo, openssl, and curl.

Key	Value
apiKey	vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A
secretKey	NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j
Parameter	Value
symbol	LTCBTC
side	BUY
type	LIMIT
timeInForce	GTC
quantity	1
price	0.1
recvWindow	5000
timestamp	1499827319559
Example 1: As a request body
requestBody: symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559

HMAC SHA256 signature:

[linux]$ echo -n "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559" | openssl dgst -sha256 -hmac "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
(stdin)= c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71
curl command:

(HMAC SHA256)
[linux]$ curl -H "X-MBX-APIKEY: vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A" -X POST 'https://api.binance.com/api/v3/order' -d 'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559&signature=c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71'
Example 2: As a query string
queryString: symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559

HMAC SHA256 signature:

[linux]$ echo -n "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559" | openssl dgst -sha256 -hmac "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
(stdin)= c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71
curl command:

(HMAC SHA256)
[linux]$ curl -H "X-MBX-APIKEY: vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A" -X POST 'https://api.binance.com/api/v3/order?symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559&signature=c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71'
Example 3: Mixed query string and request body
queryString: symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC

requestBody: quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559

HMAC SHA256 signature:

[linux]$ echo -n "symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTCquantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559" | openssl dgst -sha256 -hmac "NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j"
(stdin)= 0fd168b8ddb4876a0358a8d14d0c9f3da0e9b20c5d52b2a00fcf7d1c602f9a77
curl command:

(HMAC SHA256)
[linux]$ curl -H "X-MBX-APIKEY: vmPUZE6mv9SD5VNHk4HlWFsOr6aKE2zvsw0MuIgwCIPy6utIco14y7Ju91duEh8A" -X POST 'https://api.binance.com/api/v3/order?symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC' -d 'quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559&signature=0fd168b8ddb4876a0358a8d14d0c9f3da0e9b20c5d52b2a00fcf7d1c602f9a77'
Note that the signature is different in example 3. There is no & between "GTC" and "quantity=1".



We need to review the whole code in the project and make some important changes. There are a lot of duplicated, in fact, the same function written in different files, causing confusion and braking the app in some cases.

We'll try a different approach from the one we're working until now.. We'll have more files, each one executing a specific role.

This way we'll have less code in each file, and a better separate of duties and roles.
- backend
	- js
	telegram.js
	binance.js
	dbconns.js
	
main.js

- frontend
	- js
	dashboard.js	
	cards.js
main.js

Following, the detailed instructions on how this app must work, including detailed instructions about the specific role for each the the files.

backend/telegram.js - This file is ready to use. It has all necessary configurations to connect with telegram API using API key and user ID. It also has the functions to send messages when events occur in runtime.
All functions on any other files which needs to send messages and notifications must use this file content.

backend/binance.js - This file is also ready to use. It has all necessary configurations to connect with Binance API using API key and secret. There are also the configurations to subscribe to websocket using ws lib, functions to create buy and sell orders on the book and a polling workaroung method to keep price updating if websocket connection went down.
All functions on any other files which needs to buy or sell crypto, receive price updates, user account information or any other information related to Binance, must refer to this file.
It manages the user clicking buy or sell crypto buttons using the interface or automatic trading executed by bot. The flow for the first case must be like this:
1 - user selects amount of crypto and click the purchase button;
2 - the binance.js file will process the requisition, format, sign, and send it to binance;
3 - binance.js file must confirm the transaction to assure it's really executed, and them, send the feedback which will call a function in dbconns.js to write the transaction data in the DB;
4 - dbconns.js must call frontend/cards.js file with new values to update them in the user interface (transaction list, next buy price, next sell price, current holdings and profit/loss percentage).

P.S.: The mechanism must be the same when bot is running automatically. In this case, only the start procedure will be different;
1 - binance.js file has a monitor which reads the price updates received from binance and compares it to the information "Next buy" or "Next Sell" received from cards.js file, also present and showed in the index page;
2 - If the price drops below "Next buy" price, an order must be placed to buy $50 in crypto. If the price rises over "Next Sell", bot must book an order to sell all amount of crypto in the account, both sending data to binance.js functions to place the order;
3 - the binance.js file will process the requisition, format, sign, and send it to binance;
4 - binance.js file must confirm the transaction to assure it's really executed, and them, send the feedback which will call a function in dbconns.js to write the transaction data in the DB;
5 - dbconns.js must call frontend/cards.js file with new values to update them in the user interface (transaction list, next buy price, next sell price, current holdings and profit/loss percentage).

backend/dbconns.js - This file will be responsible to intermediate any database interactions. It will be called when user loads the index page, when cards.js file asks for information from database to compound each cryptocurrency card with transaction list, next buy price, next sell price, current holdings and profit/loss percentage. It also has the function to write in the database all information received from binance.js about the operations executed by bot or by the user.

Ok, now we'll gonna tackle frontend files.
frontend/dashboard.js - This file is responsible to receive all information necessary and compose the environment for the index page. This also involves create the crypto card which will be cloned and place the connections/API monitor below the cryptocards dashboard. It's also important to receive information about USDT available in account to purchase crypto and show it to the user inside the monitor dashboard.

frontend/cards.js - This file has the role to replicate the base card present in dashboard.js file for all cryptocurrencies, receive data from backend/dbconns.js as transaction list, next buy price, next sell price, current holdings and profit/loss percentage and place it in the dashboard, receive price updates for each crypto from backend/binance.js and show it to the user.

Well, that's it.. Let's make it happen.

