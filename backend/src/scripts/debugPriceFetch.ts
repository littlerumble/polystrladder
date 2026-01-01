import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function debugPriceFetch() {
    console.log('=== Debugging Price Fetch for Open Trades ===\n');

    const openTrades = await prisma.marketTrade.findMany({
        where: { status: 'OPEN' },
        include: { market: true }
    });

    for (const trade of openTrades) {
        console.log(`\n--- Trade: ${trade.market?.question?.substring(0, 50) || trade.marketId} ---`);
        console.log(`Market ID: ${trade.marketId}`);
        console.log(`Current stored price: ${trade.currentPrice || 'NULL'}`);

        // Try Gamma API with condition_id
        console.log('\n1. Trying Gamma API (condition_id)...');
        try {
            const res = await axios.get(`https://gamma-api.polymarket.com/markets?condition_id=${trade.marketId}`, { timeout: 5000 });
            if (res.data && res.data.length > 0) {
                const market = res.data[0];
                console.log(`   ✅ Found! outcomePrices: ${market.outcomePrices}`);
                const prices = JSON.parse(market.outcomePrices);
                console.log(`   YES: ${prices[0]}, NO: ${prices[1]}`);
            } else {
                console.log(`   ❌ No results`);
            }
        } catch (e: any) {
            console.log(`   ❌ Error: ${e.message}`);
        }

        // Try Gamma API with slug
        if (trade.market?.id) {
            console.log('\n2. Trying Gamma API (market slug from DB)...');
            // Extract slug from question or try direct lookup
            try {
                // Try by market ID directly
                const res = await axios.get(`https://gamma-api.polymarket.com/markets/${trade.market.id}`, { timeout: 5000 });
                if (res.data) {
                    console.log(`   ✅ Found! outcomePrices: ${res.data.outcomePrices}`);
                } else {
                    console.log(`   ❌ No results`);
                }
            } catch (e: any) {
                console.log(`   ❌ Error: ${e.message}`);
            }
        }

        // Check CLOB token IDs
        if (trade.market?.clobTokenIds) {
            console.log('\n3. Checking CLOB Token IDs...');
            try {
                const tokenIds = JSON.parse(trade.market.clobTokenIds);
                console.log(`   Token IDs: ${tokenIds}`);

                // Try CLOB API
                const yesToken = tokenIds[0];
                if (yesToken) {
                    const clobRes = await axios.get(
                        `https://clob.polymarket.com/book?token_id=${yesToken}`,
                        { timeout: 5000 }
                    );
                    if (clobRes.data) {
                        const bestBid = clobRes.data.bids?.[0]?.price;
                        const bestAsk = clobRes.data.asks?.[0]?.price;
                        console.log(`   ✅ CLOB: Bid=${bestBid}, Ask=${bestAsk}`);
                    }
                }
            } catch (e: any) {
                console.log(`   ❌ CLOB Error: ${e.message}`);
            }
        }

        // Check DB price history
        console.log('\n4. Checking DB Price History...');
        const latestPrice = await prisma.priceHistory.findFirst({
            where: { marketId: trade.marketId },
            orderBy: { timestamp: 'desc' }
        });
        if (latestPrice) {
            console.log(`   ✅ Found cached price: YES=${latestPrice.priceYes}, NO=${latestPrice.priceNo}`);
            console.log(`   Cached at: ${latestPrice.timestamp}`);
        } else {
            console.log(`   ❌ No cached price`);
        }
    }
}

debugPriceFetch()
    .catch(e => console.error('Debug failed:', e))
    .finally(async () => await prisma.$disconnect());
