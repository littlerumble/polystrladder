import WebSocket from 'ws';
import axios from 'axios';

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

async function main() {
    console.log('🔍 Finding a live market to test...');

    // 1. Get a live market from Gamma
    let marketId: string;
    let tokens: string[] = [];

    try {
        const resp = await axios.get('https://gamma-api.polymarket.com/markets?limit=1&active=true&closed=false');
        if (resp.data && resp.data.length > 0) {
            const m = resp.data[0];
            marketId = m.id;
            tokens = JSON.parse(m.clobTokenIds);
            console.log(`✅ Found market: "${m.question}"`);
            console.log(`   ID: ${marketId}`);
            console.log(`   Tokens: ${tokens.join(', ')}`);
        } else {
            console.error('❌ No active markets found to test');
            process.exit(1);
        }
    } catch (err) {
        console.error('❌ Failed to fetch market:', err);
        process.exit(1);
    }

    // 2. Connect to WebSocket
    console.log('\n🔌 Connecting to WebSocket...');
    const ws = new WebSocket(CLOB_WS_URL);

    ws.on('open', () => {
        console.log('✅ WebSocket Connected!');

        // 3. Subscribe
        const msg = {
            type: 'subscribe',
            assets_ids: tokens
        };
        ws.send(JSON.stringify(msg));
        console.log(`📨 Subscribed. Waiting for updates...`);
    });

    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (Array.isArray(msg)) {
            msg.forEach(m => processMsg(m, marketId));
        } else {
            processMsg(msg, marketId);
        }
    });

    ws.on('error', (err) => {
        console.error('❌ WebSocket Error:', err);
    });

    // Stop after 15 seconds
    setTimeout(() => {
        console.log('\n🛑 Test complete.');
        ws.close();
        process.exit(0);
    }, 15000);
}

// Rate limit gamma calls to avoid spamming during this test
let lastGammaCheck = 0;

async function processMsg(msg: any, marketId: string) {
    if (msg.event_type === 'price_change' || msg.event_type === 'book') {
        const timestamp = msg.timestamp || 'No Timestamp';

        let localPriceStr = '';
        if (msg.event_type === 'price_change') {
            localPriceStr = `WS Price: ${msg.price}`;
        } else {
            const bestBid = msg.bids?.[0]?.price || 'N/A';
            const bestAsk = msg.asks?.[0]?.price || 'N/A';
            localPriceStr = `WS Book: ${bestBid} / ${bestAsk}`;
        }

        // Only check Gamma every ~2 seconds to compare
        if (Date.now() - lastGammaCheck > 2000) {
            lastGammaCheck = Date.now();
            try {
                const resp = await axios.get(`https://gamma-api.polymarket.com/markets/${marketId}`);
                const prices = JSON.parse(resp.data.outcomePrices);
                const outcomes = JSON.parse(resp.data.outcomes);
                const gammaStr = `Gamma API: ${prices[0]} / ${prices[1]} (${outcomes[0]}/${outcomes[1]})`;

                console.log(`\n⚖️  COMPARISON @ ${new Date().toISOString()}`);
                console.log(`   ${localPriceStr} (Token: ${msg.asset_id})`);
                console.log(`   ${gammaStr}`);

            } catch (err) {
                console.log('   (Gamma fetch failed)');
            }
        } else {
            // Just log WS update without comparison
            // console.log(`   (WS Update skipped comparison to save rate limit)`);
        }
    }
}

main();
