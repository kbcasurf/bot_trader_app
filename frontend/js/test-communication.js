(function() {
    // Create debugging panel
    function createDebugPanel() {
        const panel = document.createElement('div');
        panel.id = 'debug-panel';
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background-color: rgba(44, 62, 80, 0.9);
            color: white;
            padding: 15px;
            border-radius: 5px;
            box-shadow: 0 0 10px rgba(0,0,0,0.3);
            z-index: 9999;
            width: 300px;
            max-height: 400px;
            overflow-y: auto;
        `;
        
        panel.innerHTML = `
            <h3 style="margin-top: 0; margin-bottom: 10px; color: white;">Debug Tools</h3>
            <div class="debug-controls">
                <button id="debug-test-prices" style="margin: 5px; padding: 5px 10px; background: #3498db; color: white; border: none; border-radius: 3px; cursor: pointer;">Test Prices</button>
                <button id="debug-fix-ids" style="margin: 5px; padding: 5px 10px; background: #2ecc71; color: white; border: none; border-radius: 3px; cursor: pointer;">Fix IDs</button>
                <button id="debug-validate" style="margin: 5px; padding: 5px 10px; background: #e74c3c; color: white; border: none; border-radius: 3px; cursor: pointer;">Validate DOM</button>
                <button id="debug-toggle" style="margin: 5px; padding: 5px 10px; background: #f39c12; color: white; border: none; border-radius: 3px; cursor: pointer;">Hide</button>
            </div>
            <div id="debug-log" style="margin-top: 10px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto;"></div>
        `;
        
        document.body.appendChild(panel);
        
        // Add event listeners
        document.getElementById('debug-test-prices').addEventListener('click', testPrices);
        document.getElementById('debug-fix-ids').addEventListener('click', fixIds);
        document.getElementById('debug-validate').addEventListener('click', validateDom);
        
        // Toggle button to hide/show the panel
        document.getElementById('debug-toggle').addEventListener('click', function() {
            const panel = document.getElementById('debug-panel');
            if (panel.style.width === '300px') {
                panel.style.width = '100px';
                panel.style.height = '40px';
                this.textContent = 'Show';
                document.querySelectorAll('#debug-panel > *:not(.debug-controls)').forEach(el => {
                    el.style.display = 'none';
                });
                document.querySelectorAll('#debug-panel .debug-controls button:not(#debug-toggle)').forEach(el => {
                    el.style.display = 'none';
                });
            } else {
                panel.style.width = '300px';
                panel.style.height = 'auto';
                this.textContent = 'Hide';
                document.querySelectorAll('#debug-panel > *').forEach(el => {
                    el.style.display = 'block';
                });
                document.querySelectorAll('#debug-panel .debug-controls button').forEach(el => {
                    el.style.display = 'inline-block';
                });
            }
        });
    }
    
    // Log to debug panel
    function debugLog(message) {
        const log = document.getElementById('debug-log');
        if (log) {
            const entry = document.createElement('div');
            entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
            log.appendChild(entry);
            log.scrollTop = log.scrollHeight;
        }
        console.log(`[Debug] ${message}`);
    }
    
    // Test price updates
    function testPrices() {
        debugLog('Testing price updates...');
        
        const symbols = ['BTC', 'SOL', 'XRP', 'DOGE', 'PENDLE', 'NEAR'];
        let updateCount = 0;
        
        symbols.forEach(symbol => {
            const price = (Math.random() * 1000).toFixed(2);
            const symbolId = `${symbol.toLowerCase()}-price`;
            const element = document.getElementById(symbolId);
            
            if (element) {
                element.textContent = `Price: $${price}`;
                debugLog(`✅ Updated ${symbolId} to $${price}`);
                updateCount++;
                
                // Also try to send a WebSocket event if socket is available
                if (window.socket) {
                    window.socket.emit('manual-price-update', {
                        symbol: `${symbol}USDT`,
                        price: price
                    });
                }
            } else {
                debugLog(`❌ Element not found: ${symbolId}`);
            }
        });
        
        debugLog(`Updated ${updateCount}/${symbols.length} price elements`);
    }
    
    // Fix element IDs
    function fixIds() {
        debugLog('Fixing element IDs...');
        
        const symbols = ['BTC', 'SOL', 'XRP', 'DOGE', 'PENDLE', 'NEAR'];
        let fixCount = 0;
        
        symbols.forEach(symbol => {
            const lowercase = symbol.toLowerCase();
            const card = document.getElementById(`${lowercase}-card`);
            
            if (!card) {
                debugLog(`❌ Card not found: ${lowercase}-card`);
                return;
            }
            
            // Fix all elements with IDs in this card
            const elementsWithIds = card.querySelectorAll('[id]');
            elementsWithIds.forEach(element => {
                // Check if ID starts with correct symbol prefix
                if (!element.id.startsWith(lowercase + '-')) {
                    const oldId = element.id;
                    const expectedId = oldId.replace(/^[a-z]+-/, `${lowercase}-`);
                    element.id = expectedId;
                    debugLog(`✅ Fixed ID: ${oldId} → ${expectedId}`);
                    fixCount++;
                }
            });
            
            // Special check for price element
            const priceElement = card.querySelector('.current-price');
            if (priceElement && priceElement.id !== `${lowercase}-price`) {
                const oldId = priceElement.id;
                priceElement.id = `${lowercase}-price`;
                debugLog(`✅ Fixed price element ID: ${oldId} → ${lowercase}-price`);
                fixCount++;
            }
        });
        
        debugLog(`Fixed ${fixCount} element IDs`);
    }
    
    // Validate DOM structure
    function validateDom() {
        debugLog('Validating DOM structure...');
        
        const symbols = ['BTC', 'SOL', 'XRP', 'DOGE', 'PENDLE', 'NEAR'];
        let totalElements = 0;
        let missingElements = [];
        
        symbols.forEach(symbol => {
            const lowercase = symbol.toLowerCase();
            
            // Check critical elements
            const elements = [
                { id: `${lowercase}-card`, name: 'Card' },
                { id: `${lowercase}-price`, name: 'Price display' },
                { id: `${lowercase}-holdings`, name: 'Holdings' },
                { id: `${lowercase}-profit-bar`, name: 'Profit bar' },
                { id: `${lowercase}-profit-text`, name: 'Profit text' },
                { id: `${lowercase}-history`, name: 'Transaction history' },
                { id: `${lowercase}-first-purchase`, name: 'First purchase button' },
                { id: `${lowercase}-sell-all`, name: 'Sell all button' }
            ];
            
            elements.forEach(element => {
                totalElements++;
                const el = document.getElementById(element.id);
                
                if (!el) {
                    missingElements.push(`${element.id} (${element.name})`);
                    debugLog(`❌ Missing: ${element.id}`);
                }
            });
        });
        
        const missingCount = missingElements.length;
        if (missingCount === 0) {
            debugLog(`✅ All ${totalElements} required elements found!`);
        } else {
            debugLog(`❌ Missing ${missingCount}/${totalElements} elements`);
            missingElements.forEach(element => {
                debugLog(`   - ${element}`);
            });
        }
        
        // Check WebSocket connection
        if (window.socket) {
            if (window.socket.connected) {
                debugLog(`✅ WebSocket is connected`);
                
                // Try to trigger a test event
                window.socket.emit('test-binance-stream');
                debugLog(`✅ Sent test-binance-stream event`);
            } else {
                debugLog(`❌ WebSocket is not connected`);
            }
        } else {
            debugLog(`❌ Socket object not found in window`);
        }
    }
    
    // Initialize debug panel
    setTimeout(() => {
        createDebugPanel();
        debugLog('Debug panel initialized');
        
        // Make socket object accessible from window for debugging
        if (typeof socket !== 'undefined') {
            window.socket = socket;
            debugLog('Socket object exposed to window.socket');
        }
    }, 2000); // Wait for page to fully load
})();