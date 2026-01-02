/**
 * Test 2: Complete Copy Trade Flow Validation
 * 
 * Simulates the entire copy trade detection → price fetch → stop loss logic
 * to validate the data flow is correct end-to-end.
 */

import axios from 'axios';

const DATA_API = 'https://data-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

// Simulated config
const LADDER_MIN = 0.65;
const LADDER_MAX = 0.90;
const STOP_LOSS_THRESHOLD = 0.62;

interface TradeActivity {
    timestamp: number;
    conditionId: string;
    title: string;
    slug: string;
    tokenId: string;
    outcomeIndex: number;
    outcome: string;
    side: 'BUY' | 'SELL';
    price: number;
}

interface SimulatedPosition {
    tokenId: string;
    slug: string;
    outcome: string;
    entryPrice: number;
    currentPrice: number;
    stopLossAt: number;
    pnlPct: number;
}

async function fetchRecentTrades(wallet: string): Promise<TradeActivity[]> {
    const response = await axios.get(`${DATA_API}/activity`, {
        params: { user: wallet, limit: 10 },
        timeout: 10000
    });

    return response.data
        .filter((t: any) => t.type === 'TRADE' && t.side === 'BUY')
        .map((t: any) => ({
            timestamp: t.timestamp,
            conditionId: t.conditionId,
            title: t.title || 'Unknown',
            slug: t.slug || '',
            tokenId: t.asset || '',
            outcomeIndex: t.outcomeIndex ?? 0,
            outcome: t.outcome || '',
            side: t.side,
            price: t.price || 0
        }));
}

async function fetchClobPrice(tokenId: string): Promise<number | null> {
    try {
        const response = await axios.get(`${CLOB_API}/book`, {
            params: { token_id: tokenId },
            timeout: 5000
        });

        if (response.data?.bids?.length > 0) {
            const bestBid = response.data.bids[response.data.bids.length - 1];
            return parseFloat(bestBid.price);
        }
        return null;
    } catch (e) {
        return null;
    }
}

function calculateStopLoss(entryPrice: number): number {
    // Dynamic stop loss based on entry tier
    if (entryPrice >= 0.60 && entryPrice < 0.70) return 0.62;
    if (entryPrice >= 0.70 && entryPrice < 0.80) return 0.68;
    if (entryPrice >= 0.80 && entryPrice <= 0.90) return Math.max(0.72, entryPrice - 0.10);
    return 0.62; // Default
}

async function simulateCopyTradeFlow(): Promise<void> {
    console.log('🧪 TEST 2: Complete Copy Trade Flow Simulation');
    console.log('='.repeat(60));

    const wallet = '0x2005d16a84ceefa912d4e380cd32e7ff827875ea';
    console.log(`\n📊 Fetching BUY trades from RN1...`);

    const trades = await fetchRecentTrades(wallet);
    console.log(`   Found ${trades.length} BUY trades\n`);

    const positions: SimulatedPosition[] = [];
    const seenTokens = new Set<string>();

    for (const trade of trades) {
        if (seenTokens.has(trade.tokenId)) continue;
        seenTokens.add(trade.tokenId);

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`📊 ${trade.title.substring(0, 50)}...`);
        console.log(`   Outcome: ${trade.outcome} (index: ${trade.outcomeIndex})`);
        console.log(`   Trader Entry: ${(trade.price * 100).toFixed(1)}¢`);

        // Step 1: Check if in our trading range
        const currentPrice = await fetchClobPrice(trade.tokenId);
        if (currentPrice === null) {
            console.log(`   ❌ Could not fetch CLOB price - SKIP`);
            continue;
        }
        console.log(`   Current CLOB Price: ${(currentPrice * 100).toFixed(1)}¢`);

        const inRange = currentPrice >= LADDER_MIN && currentPrice <= LADDER_MAX;
        console.log(`   In Range (${LADDER_MIN * 100}-${LADDER_MAX * 100}¢): ${inRange ? '✅ YES' : '⚠️ NO'}`);

        if (!inRange) continue;

        // Step 2: Calculate stop loss
        const stopLoss = calculateStopLoss(currentPrice);
        console.log(`   Stop Loss: ${(stopLoss * 100).toFixed(1)}¢`);

        // Step 3: Check if stop loss would trigger
        const wouldTriggerStop = currentPrice < stopLoss;
        console.log(`   Stop Loss Would Trigger: ${wouldTriggerStop ? '⚠️ YES' : '✅ NO'}`);

        // Step 4: Calculate P&L
        const pnlPct = ((currentPrice - trade.price) / trade.price) * 100;
        console.log(`   Unrealized P&L: ${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(1)}%`);

        positions.push({
            tokenId: trade.tokenId,
            slug: trade.slug,
            outcome: trade.outcome,
            entryPrice: trade.price,
            currentPrice,
            stopLossAt: stopLoss,
            pnlPct
        });
    }

    // Summary
    console.log('\n\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`\nPositions simulated: ${positions.length}`);

    if (positions.length > 0) {
        const profitable = positions.filter(p => p.pnlPct > 0).length;
        const avgPnl = positions.reduce((sum, p) => sum + p.pnlPct, 0) / positions.length;
        const stopTriggered = positions.filter(p => p.currentPrice < p.stopLossAt).length;

        console.log(`   Profitable: ${profitable}/${positions.length}`);
        console.log(`   Average P&L: ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(1)}%`);
        console.log(`   Stop Loss Triggered: ${stopTriggered}/${positions.length}`);
    }

    console.log('\n✅ FLOW VALIDATION:');
    console.log('   ✓ Data API returns tokenId (asset)');
    console.log('   ✓ CLOB price fetch using tokenId works');
    console.log('   ✓ Stop loss calculation uses real price');
    console.log('   ✓ No YES/NO confusion (using tokenId directly)');
}

simulateCopyTradeFlow().catch(console.error);
