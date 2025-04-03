// backend/js/trading-engine.js - Trading algorithm implementation

const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '/app/.env' });

// Trading thresholds
const TRADING_CONFIG = {
    PROFIT_THRESHOLD: parseFloat(process.env.PROFIT_THRESHOLD), // Percentage profit target
    LOSS_THRESHOLD: parseFloat(process.env.LOSS_THRESHOLD),     // Percentage loss threshold for additional purchases
    ADDITIONAL_PURCHASE_AMOUNT: parseFloat(process.env.ADDITIONAL_PURCHASE_AMOUNT)// Amount in USDT for additional purchases
};

// Module dependencies - will be injected at runtime
let pool = null;
let binanceAPI = null;
let telegramBot = null;

// Initialize the trading engine with required dependencies
function initialize(dbPool, binance, telegram) {
    pool = dbPool;
    binanceAPI = binance;
    telegramBot = telegram;
    console.log('Trading engine initialized with thresholds:', TRADING_CONFIG);
}

// Process a price update for a symbol
async function processPriceUpdate(io, symbol, price) {
    try {
        // Skip processing if price is invalid
        if (!symbol || !price || isNaN(parseFloat(price))) {
            return;
        }

        // Format the symbol for consistency
        const formattedSymbol = formatSymbol(symbol);
        const currentPrice = parseFloat(price);

        // Get reference prices from database
        const references = await getReferencePrices(formattedSymbol);
        
        // Skip if we have no reference data
        if (!references) {
            console.warn(`No reference data for ${formattedSymbol}, skipping price update`);
            return;
        }

        console.log(`Processing price update for ${formattedSymbol}: Current price=${currentPrice}, Next buy=${references.next_buy_threshold}, Next sell=${references.next_sell_threshold}`);

        // Get current holdings
        const holdings = await getHoldings(formattedSymbol);
        
        // Skip if we have no holdings and no initial purchase price (nothing to trade)
        if (holdings.quantity <= 0 && references.initial_purchase_price <= 0) {
            return;
        }
        
        // Check if we need to take action based on the current price
        if (holdings.quantity > 0) {
            // Check if price is at or above sell threshold and we have holdings to sell
            if (currentPrice >= references.next_sell_threshold && references.next_sell_threshold > 0) {
                console.log(`SELL CONDITION MET for ${formattedSymbol}: Current price ${currentPrice} >= Sell threshold ${references.next_sell_threshold}`);
                // Execute sell
                await executeSellForProfit(io, formattedSymbol, currentPrice);
            }
        }
        
        // Check if price is at or below buy threshold (we may want to buy more)
        if (currentPrice <= references.next_buy_threshold * 1.005 && references.next_buy_threshold > 0) {
            console.log(`BUY CONDITION MET for ${formattedSymbol}: Current price ${currentPrice} <= Buy threshold ${references.next_buy_threshold}`);
            // Execute buy with a small buffer (0.5% margin)
            await executeBuyOnDip(io, formattedSymbol, currentPrice);
        }
        
        // Update reference prices with current price for UI display
        await updateReferencePrices(formattedSymbol, currentPrice);
    } catch (error) {
        console.error(`Error processing price update for ${symbol}:`, error);
    }
}

// Get current reference prices for a symbol
async function getReferencePrices(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM reference_prices WHERE symbol = ?',
            [symbol]
        );
        
        if (rows.length === 0) {
            // Initialize reference prices if not found
            const defaultRecord = {
                symbol,
                initial_purchase_price: 0,
                last_purchase_price: 0,
                last_sell_price: 0,
                next_buy_threshold: 0,
                next_sell_threshold: 0
            };
            
            await conn.query(
                'INSERT INTO reference_prices (symbol, initial_purchase_price, last_purchase_price, last_sell_price, next_buy_threshold, next_sell_threshold) VALUES (?, ?, ?, ?, ?, ?)',
                [symbol, 0, 0, 0, 0, 0]
            );
            
            return defaultRecord;
        }
        
        return rows[0];
    } catch (error) {
        console.error('Error getting reference prices:', error);
        return null;
    } finally {
        if (conn) conn.release();
    }
}

// Update reference prices with new calculations
async function updateReferencePrices(symbol, currentPrice = null) {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get the first buy transaction (for initial purchase price)
        const firstBuyResult = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? AND type = "BUY" ORDER BY timestamp ASC LIMIT 1',
            [symbol]
        );
        
        // Get the most recent buy transaction (for last purchase price)
        const lastBuyResult = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? AND type = "BUY" ORDER BY timestamp DESC LIMIT 1',
            [symbol]
        );
        
        // Get the most recent sell transaction (for last sell price)
        const lastSellResult = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? AND type = "SELL" ORDER BY timestamp DESC LIMIT 1',
            [symbol]
        );
        
        // Get configuration for this symbol
        const configResult = await conn.query(
            'SELECT * FROM configuration WHERE symbol = ?',
            [symbol]
        );
        
        const config = configResult.length > 0 ? configResult[0] : {
            buy_threshold_percent: TRADING_CONFIG.LOSS_THRESHOLD,
            sell_threshold_percent: TRADING_CONFIG.PROFIT_THRESHOLD,
            additional_purchase_amount: TRADING_CONFIG.ADDITIONAL_PURCHASE_AMOUNT
        };
        
        // Extract the prices
        const initialPurchasePrice = firstBuyResult.length > 0 ? parseFloat(firstBuyResult[0].price) : 0;
        const lastPurchasePrice = lastBuyResult.length > 0 ? parseFloat(lastBuyResult[0].price) : 0;
        const lastSellPrice = lastSellResult.length > 0 ? parseFloat(lastSellResult[0].price) : 0;
        
        // Calculate the thresholds
        let nextBuyThreshold = 0;
        let nextSellThreshold = 0;
        
        if (lastPurchasePrice > 0 && initialPurchasePrice > 0) {
            // If we have an initial purchase, set sell threshold at 5% above that
            nextSellThreshold = initialPurchasePrice * (1 + (config.sell_threshold_percent / 100));
            
            // Set buy threshold at 5% below the last purchase price
            nextBuyThreshold = lastPurchasePrice * (1 - (config.buy_threshold_percent / 100));
        } else if (lastSellPrice > 0) {
            // If we've sold everything but have a last sell price, set buy threshold at 5% below that
            nextBuyThreshold = lastSellPrice * (1 - (config.buy_threshold_percent / 100));
            nextSellThreshold = 0; // No sell threshold until we buy again
        }
        
        // Update the reference prices in the database
        await conn.query(
            `UPDATE reference_prices 
             SET initial_purchase_price = ?, 
                 last_purchase_price = ?, 
                 last_sell_price = ?, 
                 next_buy_threshold = ?, 
                 next_sell_threshold = ?
             WHERE symbol = ?`,
            [initialPurchasePrice, lastPurchasePrice, lastSellPrice, nextBuyThreshold, nextSellThreshold, symbol]
        );
        
        // Return the updated values
        return {
            initial_purchase_price: initialPurchasePrice,
            last_purchase_price: lastPurchasePrice,
            last_sell_price: lastSellPrice,
            next_buy_threshold: nextBuyThreshold,
            next_sell_threshold: nextSellThreshold,
            current_price: currentPrice
        };
    } catch (error) {
        console.error('Error updating reference prices:', error);
        return null;
    } finally {
        if (conn) conn.release();
    }
}

// Get current holdings for a symbol
async function getHoldings(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM holdings WHERE symbol = ?',
            [symbol]
        );
        return rows[0] || { symbol, quantity: 0, avg_price: 0 };
    } catch (error) {
        console.error('Error getting holdings:', error);
        return { symbol, quantity: 0, avg_price: 0 };
    } finally {
        if (conn) conn.release();
    }
}

// Execute a buy order when price drops below threshold
async function executeBuyOnDip(io, symbol, currentPrice) {
    let conn;
    try {
        console.log(`Executing automated buy for ${symbol} at ${currentPrice} (dip detected)`);
        
        // Get configuration for this symbol
        conn = await pool.getConnection();
        const configResult = await conn.query(
            'SELECT * FROM configuration WHERE symbol = ?',
            [symbol]
        );
        
        const config = configResult.length > 0 ? configResult[0] : {
            additional_purchase_amount: TRADING_CONFIG.ADDITIONAL_PURCHASE_AMOUNT
        };
        
        // Use configured amount for additional purchase
        const amount = parseFloat(config.additional_purchase_amount);
        
        // Execute the buy order
        const result = await binanceAPI.executeBuyOrder(symbol, amount, 'usdt');
        
        if (!result.success) {
            console.error(`Automated buy failed for ${symbol}:`, result.error);
            return false;
        }
        
        console.log(`Executed automated buy for ${symbol} at ${currentPrice}. New buy threshold: ${refPrices.next_buy_threshold}, New sell threshold: ${refPrices.next_sell_threshold}`);
        
        // Record the transaction in database
        await conn.query(
            'INSERT INTO transactions (symbol, type, price, quantity, investment, automated) VALUES (?, ?, ?, ?, ?, ?)',
            [symbol, 'BUY', currentPrice, result.amount, amount, true]
        );
        
        // Update holdings
        await updateHoldings(symbol);
        
        // Update reference prices
        await updateReferencePrices(symbol, currentPrice);
        
        // Send Telegram notification
        if (telegramBot) {
            await telegramBot.sendTradeNotification({
                symbol: symbol,
                type: 'BUY',
                price: currentPrice,
                quantity: result.amount,
                investment: amount,
                timestamp: Date.now(),
                automated: true
            });
        }
        
        // Broadcast the transaction to all clients
        const transactions = await getTransactions(symbol);
        io.emit('transaction-update', {
            symbol: symbol.replace('USDT', ''),
            transactions: transactions,
            success: true,
            refPrices: await getReferencePrices(symbol)
        });
        
        // Broadcast holdings update
        const holdings = await getHoldings(symbol);
        const refPrices = await getReferencePrices(symbol);
        
        io.emit('holdings-update', {
            symbol: symbol.replace('USDT', ''),
            amount: holdings.quantity,
            avgPrice: holdings.avg_price,
            initialPrice: refPrices.initial_purchase_price,
            lastBuyPrice: refPrices.last_purchase_price,
            nextBuyThreshold: refPrices.next_buy_threshold,
            nextSellThreshold: refPrices.next_sell_threshold,
            profitLossPercent: calculateProfitLoss(holdings.avg_price, currentPrice)
        });
        
        return true;
    } catch (error) {
        console.error(`Error executing automated buy for ${symbol}:`, error);
        return false;
    } finally {
        if (conn) conn.release();
    }
}

// Execute a sell order when price rises above threshold
async function executeSellForProfit(io, symbol, currentPrice) {
    let conn;
    try {
        console.log(`Executing automated sell for ${symbol} at ${currentPrice} (profit target reached)`);
        
        // Get current holdings
        const holdings = await getHoldings(symbol);
        
        if (holdings.quantity <= 0) {
            console.log(`No holdings to sell for ${symbol}`);
            return false;
        }
        
        // Execute the sell order
        const result = await binanceAPI.executeSellOrder(symbol, holdings.quantity, 'amount');
        
        if (!result.success) {
            console.error(`Automated sell failed for ${symbol}:`, result.error);
            return false;
        }
        
        console.log(`Automated sell successful for ${symbol}:`, result);
        
        // Calculate the total value of the sale
        const saleValue = holdings.quantity * currentPrice;
        
        // Record the transaction in database
        conn = await pool.getConnection();
        
        await conn.query(
            'INSERT INTO transactions (symbol, type, price, quantity, investment, automated) VALUES (?, ?, ?, ?, ?, ?)',
            [symbol, 'SELL', currentPrice, holdings.quantity, saleValue, true]
        );
        
        // Update holdings (set to zero)
        await conn.query(
            'UPDATE holdings SET quantity = 0, avg_price = 0 WHERE symbol = ?',
            [symbol]
        );
        
        // Update reference prices
        await updateReferencePrices(symbol, currentPrice);
        
        // Send Telegram notification
        if (telegramBot) {
            await telegramBot.sendTradeNotification({
                symbol: symbol,
                type: 'SELL',
                price: currentPrice,
                quantity: holdings.quantity,
                investment: saleValue,
                timestamp: Date.now(),
                automated: true
            });
        }
        
        // Broadcast the transaction to all clients
        const transactions = await getTransactions(symbol);
        io.emit('transaction-update', {
            symbol: symbol.replace('USDT', ''),
            transactions: transactions,
            success: true,
            refPrices: await getReferencePrices(symbol)
        });
        
        // Broadcast holdings update
        io.emit('holdings-update', {
            symbol: symbol.replace('USDT', ''),
            amount: 0,
            avgPrice: 0,
            initialPrice: 0,
            lastBuyPrice: (await getReferencePrices(symbol)).last_purchase_price,
            lastSellPrice: currentPrice,
            nextBuyThreshold: currentPrice * (1 - (TRADING_CONFIG.LOSS_THRESHOLD / 100)),
            nextSellThreshold: 0,
            profitLossPercent: 0
        });
        
        return true;
    } catch (error) {
        console.error(`Error executing automated sell for ${symbol}:`, error);
        return false;
    } finally {
        if (conn) conn.release();
    }
}

// Update holdings for a symbol based on transactions
async function updateHoldings(symbol) {
    let conn;
    try {
        conn = await pool.getConnection();
        
        // Get all buy transactions
        const buyTransactions = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? AND type = "BUY"',
            [symbol]
        );
        
        // Get all sell transactions
        const sellTransactions = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? AND type = "SELL"',
            [symbol]
        );
        
        // Calculate total bought
        let totalBought = 0;
        let totalSpent = 0;
        
        buyTransactions.forEach(tx => {
            totalBought += parseFloat(tx.quantity);
            totalSpent += parseFloat(tx.investment);
        });
        
        // Calculate total sold
        let totalSold = 0;
        
        sellTransactions.forEach(tx => {
            totalSold += parseFloat(tx.quantity);
        });
        
        // Calculate remaining quantity
        const remainingQuantity = Math.max(0, totalBought - totalSold);
        
        // Calculate average price (if any holdings remain)
        let avgPrice = 0;
        if (remainingQuantity > 0) {
            avgPrice = totalSpent / totalBought;
        }
        
        // Update holdings
        await conn.query(
            'INSERT INTO holdings (symbol, quantity, avg_price) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE quantity = ?, avg_price = ?',
            [symbol, remainingQuantity, avgPrice, remainingQuantity, avgPrice]
        );
        
        return { quantity: remainingQuantity, avgPrice };
    } catch (error) {
        console.error('Error updating holdings:', error);
        return null;
    } finally {
        if (conn) conn.release();
    }
}

// Get recent transactions for a symbol
async function getTransactions(symbol, limit = 10) {
    let conn;
    try {
        conn = await pool.getConnection();
        const rows = await conn.query(
            'SELECT * FROM transactions WHERE symbol = ? ORDER BY timestamp DESC LIMIT ?',
            [symbol, limit]
        );
        return rows;
    } catch (error) {
        console.error('Error getting transactions:', error);
        return [];
    } finally {
        if (conn) conn.release();
    }
}

// Helper function to ensure proper symbol format
function formatSymbol(symbol) {
    // If symbol already includes USDT, return it unchanged
    if (symbol.toUpperCase().endsWith('USDT')) {
        return symbol.toUpperCase();
    }
    
    // Otherwise, add USDT suffix
    return symbol.toUpperCase() + 'USDT';
}

// Calculate profit/loss percentage
function calculateProfitLoss(avgPrice, currentPrice) {
    if (avgPrice <= 0 || currentPrice <= 0) return 0;
    return ((currentPrice - avgPrice) / avgPrice) * 100;
}

// Export the module
module.exports = {
    initialize,
    processPriceUpdate,
    getReferencePrices,
    updateReferencePrices,
    getHoldings,
    calculateProfitLoss,
    getTransactions,
    executeBuyOnDip,
    executeSellForProfit,
    updateHoldings
};