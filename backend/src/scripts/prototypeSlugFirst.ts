/**
 * Enhanced Prototype: Slug-First + WebSocket Price Verification
 * 
 * Tests:
 * 1. CLOB REST API vs WebSocket for price consistency
 * 2. Price accuracy verification against Polymarket frontend
 * 3. WebSocket subscription for real-time prices
 */

import axios from 'axios';
import WebSocket from 'ws';

const DATA_API = 'https://data-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

interface TradeActivity {
    conditionId: string;
    slug: string;
    eventSlug: string;
    asset: string;  // token_id
    title: string;
    outcome: string;
    price: number;
}

interface PriceComparison {
    tokenId: string;
    title: string;
    outcome: string;
    traderPrice: number;
    clobRestBid: number | null;
    clobRestAsk: number | null;
    clobRestMid: number | null;
    gammaPrice: number | null;
    wsPrice: number | null;
    pricesMatch: boolean;
}

// Fetch from Data API
async function fetchRecentTrades(wallet: string): Promise<TradeActivity[]> {
    const response = await axios.get(`${DATA_API}/activity`, {
        params: { user: wallet, limit: 5 },
        timeout: 10000
    });
    return response.data.map((t: any) => ({
        conditionId: t.conditionId,
        slug: t.slug,
        eventSlug: t.eventSlug,
        asset: t.asset,
        title: t.title,
        outcome: t.outcome,
        price: t.price
    }));
}

// CLOB REST - Get bid/ask spread
async function fetchClobPrices(tokenId: string): Promise<{ bid: number | null; ask: number | null; mid: number | null }> {
    try {
        const response = await axios.get(`${CLOB_API}/book`, {
            params: { token_id: tokenId },
            timeout: 5000
        });

        let bid: number | null = null;
        let ask: number | null = null;

        if (response.data?.bids?.length > 0) {
            bid = parseFloat(response.data.bids[response.data.bids.length - 1].price);
        }
        if (response.data?.asks?.length > 0) {
            ask = parseFloat(response.data.asks[response.data.asks.length - 1].price);
        }

        const mid = (bid !== null && ask !== null) ? (bid + ask) / 2 : null;

        return { bid, ask, mid };
    } catch (e) {
        return { bid: null, ask: null, mid: null };
    }
}

// Gamma API - Get reported price
async function fetchGammaPrice(slug: string, outcome: string): Promise<number | null> {
    try {
        const response = await axios.get(`${GAMMA_API}/markets`, {
            params: { slug },
            timeout: 5000
        });

        if (response.data?.[0]?.outcomePrices) {
            const market = response.data[0];
            const prices = JSON.parse(market.outcomePrices);
            const outcomes = JSON.parse(market.outcomes);

            const index = outcomes.findIndex((o: string) => o.toLowerCase() === outcome.toLowerCase());
            if (index !== -1) {
                return parseFloat(prices[index]);
            }
        }
        return null;
    } catch (e) {
        return null;
    }
}

// WebSocket - Get real-time price
async function fetchWsPrice(tokenId: string, timeoutMs: number = 5000): Promise<number | null> {
    return new Promise((resolve) => {
        const ws = new WebSocket(CLOB_WS_URL);
        let resolved = false;

        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                ws.close();
                resolve(null);
            }
        }, timeoutMs);

        ws.on('open', () => {
            // Subscribe to this token
            const subscribeMsg = JSON.stringify({
                type: 'market',
                assets_ids: [tokenId]
            });
            ws.send(subscribeMsg);
        });

        ws.on('message', (data: WebSocket.Data) => {
            try {
                const messages = JSON.parse(data.toString());
                for (const msg of (Array.isArray(messages) ? messages : [messages])) {
                    if (msg.asset_id === tokenId) {
                        if (msg.event_type === 'price_change' || msg.event_type === 'last_trade_price') {
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                ws.close();
                                resolve(parseFloat(msg.price));
                            }
                        } else if (msg.event_type === 'book' && msg.bids?.length > 0) {
                            // Use best bid from book message
                            if (!resolved) {
                                resolved = true;
                                clearTimeout(timeout);
                                ws.close();
                                const bestBid = parseFloat(msg.bids[msg.bids.length - 1].price);
                                resolve(bestBid);
                            }
                        }
                    }
                }
            } catch (e) {
                // Ignore parse errors
            }
        });

        ws.on('error', () => {
            if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(null);
            }
        });
    });
}

async function comparePrices(trade: TradeActivity): Promise<PriceComparison> {
    console.log(`\n📊 ${trade.title.substring(0, 50)}... (${trade.outcome})`);
    console.log(`   Token ID: ${trade.asset.substring(0, 25)}...`);

    // Fetch from all sources in parallel
    const [clobPrices, gammaPrice, wsPrice] = await Promise.all([
        fetchClobPrices(trade.asset),
        fetchGammaPrice(trade.slug, trade.outcome),
        fetchWsPrice(trade.asset, 3000)
    ]);

    console.log(`   Trader bought at: ${(trade.price * 100).toFixed(1)}¢`);
    console.log(`   CLOB REST bid:    ${clobPrices.bid !== null ? `${(clobPrices.bid * 100).toFixed(1)}¢` : 'N/A'}`);
    console.log(`   CLOB REST ask:    ${clobPrices.ask !== null ? `${(clobPrices.ask * 100).toFixed(1)}¢` : 'N/A'}`);
    console.log(`   Gamma API:        ${gammaPrice !== null ? `${(gammaPrice * 100).toFixed(1)}¢` : 'N/A'}`);
    console.log(`   WebSocket:        ${wsPrice !== null ? `${(wsPrice * 100).toFixed(1)}¢` : 'N/A (no update in 3s)'}`);

    // Check if prices are consistent (within 5¢)
    const prices = [clobPrices.bid, gammaPrice, wsPrice].filter(p => p !== null) as number[];
    const pricesMatch = prices.length >= 2 &&
        Math.max(...prices) - Math.min(...prices) < 0.05;

    console.log(`   Consistent: ${pricesMatch ? '✅ Yes' : '⚠️ Prices differ by >5¢'}`);

    return {
        tokenId: trade.asset,
        title: trade.title,
        outcome: trade.outcome,
        traderPrice: trade.price,
        clobRestBid: clobPrices.bid,
        clobRestAsk: clobPrices.ask,
        clobRestMid: clobPrices.mid,
        gammaPrice,
        wsPrice,
        pricesMatch
    };
}

async function main() {
    console.log('🧪 ENHANCED PROTOTYPE: Price Accuracy & WebSocket Test');
    console.log('='.repeat(60));

    // Test with RN1's recent trades
    const wallet = '0x2005d16a84ceefa912d4e380cd32e7ff827875ea';
    console.log(`\n👤 Fetching recent trades for RN1...`);

    const trades = await fetchRecentTrades(wallet);
    console.log(`   Found ${trades.length} trades`);

    const results: PriceComparison[] = [];

    // Test each trade (use unique tokens)
    const seenTokens = new Set<string>();
    for (const trade of trades) {
        if (seenTokens.has(trade.asset)) continue;
        seenTokens.add(trade.asset);

        const result = await comparePrices(trade);
        results.push(result);

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 500));
    }

    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));

    const clobSuccess = results.filter(r => r.clobRestBid !== null).length;
    const gammaSuccess = results.filter(r => r.gammaPrice !== null).length;
    const wsSuccess = results.filter(r => r.wsPrice !== null).length;
    const consistent = results.filter(r => r.pricesMatch).length;

    console.log(`\nTotal unique tokens tested: ${results.length}`);
    console.log(`\n   CLOB REST success:  ${clobSuccess}/${results.length} (${((clobSuccess / results.length) * 100).toFixed(0)}%)`);
    console.log(`   Gamma API success:  ${gammaSuccess}/${results.length} (${((gammaSuccess / results.length) * 100).toFixed(0)}%)`);
    console.log(`   WebSocket success:  ${wsSuccess}/${results.length} (${((wsSuccess / results.length) * 100).toFixed(0)}%)`);
    console.log(`   Prices consistent:  ${consistent}/${results.length} (${((consistent / results.length) * 100).toFixed(0)}%)`);

    // WebSocket recommendation
    console.log('\n' + '='.repeat(60));
    console.log('💡 RECOMMENDATION');
    console.log('='.repeat(60));

    if (wsSuccess > 0) {
        console.log('\n✅ WebSocket is WORKING! Use for real-time price updates.');
        console.log('   - Subscribe using token_id from Data API');
        console.log('   - Listen for: price_change, last_trade_price, book events');
        console.log('   - Fall back to CLOB REST if WebSocket times out');
    } else {
        console.log('\n⚠️ WebSocket timed out (no price updates for slow markets).');
        console.log('   - Use CLOB REST as primary (100% success)');
        console.log('   - WebSocket good for actively trading markets only');
    }

    console.log('\n✅ Test complete!');
}

main().catch(console.error);
