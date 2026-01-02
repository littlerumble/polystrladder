/**
 * Test 1: Trade Detection Validation
 * 
 * Validates that Data API returns all required fields:
 * - conditionId (market identifier)
 * - slug (for metadata lookup)
 * - asset (token_id for CLOB price lookup)
 * - outcome (YES/NO)
 * - outcomeIndex (0 or 1)
 * 
 * This confirms we can get everything needed at detection time.
 */

import axios from 'axios';

const DATA_API = 'https://data-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';

// Tracked traders
const TEST_WALLETS = [
    { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', name: 'RN1' },
    { wallet: '0xc65ca4755436f82d8eb461e65781584b8cadea39', name: 'LOOKINGBACK' },
];

interface DataApiTrade {
    timestamp: number;
    conditionId: string;
    title: string;
    slug: string;
    eventSlug: string;
    asset: string;          // ✅ Token ID - CRITICAL for CLOB
    outcome: string;        // "Yes" or "No" or custom
    outcomeIndex: number;   // 0 or 1 - CRITICAL for YES/NO mapping
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
}

async function fetchTradesFromDataApi(wallet: string): Promise<DataApiTrade[]> {
    const response = await axios.get(`${DATA_API}/activity`, {
        params: { user: wallet, limit: 10 },
        timeout: 10000
    });

    return response.data
        .filter((t: any) => t.type === 'TRADE')
        .map((t: any) => ({
            timestamp: t.timestamp,
            conditionId: t.conditionId,
            title: t.title || 'Unknown',
            slug: t.slug || '',
            eventSlug: t.eventSlug || '',
            asset: t.asset || '',           // Token ID
            outcome: t.outcome || '',
            outcomeIndex: t.outcomeIndex,   // 0 or 1
            side: t.side,
            price: t.price || 0,
            size: t.size || 0
        }));
}

async function validateTokenWithClob(tokenId: string): Promise<{ success: boolean; price: number | null }> {
    try {
        const response = await axios.get(`${CLOB_API}/book`, {
            params: { token_id: tokenId },
            timeout: 5000
        });

        if (response.data?.bids?.length > 0) {
            const bestBid = parseFloat(response.data.bids[response.data.bids.length - 1].price);
            return { success: true, price: bestBid };
        }
        return { success: true, price: null };
    } catch (e: any) {
        return { success: false, price: null };
    }
}

async function main() {
    console.log('🧪 TEST 1: Trade Detection Validation');
    console.log('='.repeat(60));
    console.log('Validating Data API returns all required fields for copy trading.\n');

    let totalTrades = 0;
    let hasAsset = 0;
    let hasOutcomeIndex = 0;
    let hasSlug = 0;
    let clobSuccess = 0;

    for (const trader of TEST_WALLETS) {
        console.log(`\n👤 ${trader.name} (${trader.wallet.substring(0, 10)}...)`);

        const trades = await fetchTradesFromDataApi(trader.wallet);
        console.log(`   Found ${trades.length} trades\n`);

        for (const trade of trades.slice(0, 5)) {
            totalTrades++;

            console.log(`   📊 ${trade.title.substring(0, 40)}...`);
            console.log(`      Outcome: ${trade.outcome} (index: ${trade.outcomeIndex})`);
            console.log(`      Slug: ${trade.slug || '❌ MISSING'}`);
            console.log(`      Token ID: ${trade.asset ? trade.asset.substring(0, 25) + '...' : '❌ MISSING'}`);

            if (trade.asset) hasAsset++;
            if (trade.outcomeIndex !== undefined) hasOutcomeIndex++;
            if (trade.slug) hasSlug++;

            // Validate token works with CLOB
            if (trade.asset) {
                const clob = await validateTokenWithClob(trade.asset);
                if (clob.success) {
                    clobSuccess++;
                    console.log(`      CLOB Price: ${clob.price !== null ? `${(clob.price * 100).toFixed(1)}¢ ✅` : 'No bids ⚠️'}`);
                } else {
                    console.log(`      CLOB: ❌ Failed to fetch`);
                }
            }

            console.log('');
        }
    }

    // Summary
    console.log('='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`\nTotal trades tested: ${totalTrades}`);
    console.log(`\n   Has asset (token_id):  ${hasAsset}/${totalTrades} ${hasAsset === totalTrades ? '✅' : '⚠️'}`);
    console.log(`   Has outcomeIndex:      ${hasOutcomeIndex}/${totalTrades} ${hasOutcomeIndex === totalTrades ? '✅' : '⚠️'}`);
    console.log(`   Has slug:              ${hasSlug}/${totalTrades} ${hasSlug === totalTrades ? '✅' : '⚠️'}`);
    console.log(`   CLOB lookup success:   ${clobSuccess}/${totalTrades} ${clobSuccess === totalTrades ? '✅' : '⚠️'}`);

    if (hasAsset === totalTrades && hasOutcomeIndex === totalTrades && hasSlug === totalTrades && clobSuccess === totalTrades) {
        console.log('\n✅ ALL TESTS PASSED! Data API returns everything needed.');
        console.log('   - asset (token_id) → Use for CLOB/WebSocket prices');
        console.log('   - outcomeIndex    → Use for YES/NO mapping');
        console.log('   - slug            → Use for Gamma metadata');
    } else {
        console.log('\n⚠️ Some fields missing - review results above.');
    }
}

main().catch(console.error);
