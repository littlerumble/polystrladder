/**
 * Test CLOB API directly to verify price fetching
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function testClobApi() {
    console.log('Testing CLOB API price fetching...\n');

    // Get all positions with market data
    const positions = await prisma.position.findMany({
        include: { market: true }
    });

    for (const pos of positions) {
        if (!pos.market) {
            console.log(`No market data for ${pos.marketId}`);
            continue;
        }

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Market: ${pos.market.question?.substring(0, 50)}`);
        console.log(`Market ID: ${pos.marketId}`);
        console.log(`Token IDs stored: ${pos.market.clobTokenIds}`);

        try {
            const tokenIds = JSON.parse(pos.market.clobTokenIds);
            const outcomes: string[] = JSON.parse(pos.market.outcomes || '["Yes", "No"]');
            console.log(`Parsed token IDs: ${JSON.stringify(tokenIds)}`);

            if (!tokenIds || tokenIds.length === 0) {
                console.log('❌ No token IDs found!');
                continue;
            }

            // Use outcomes field to find YES token
            const yesIndex = outcomes.findIndex(o => o.toLowerCase() === 'yes');
            const yesTokenId = yesIndex !== -1 ? tokenIds[yesIndex] : tokenIds[0];
            console.log(`Using YES token ID: ${yesTokenId}`);

            // Fetch orderbook
            const url = `https://clob.polymarket.com/book?token_id=${yesTokenId}`;
            console.log(`Fetching: ${url}`);

            const response = await axios.get(url);
            const book = response.data;

            console.log(`\nOrderbook response status: ${response.status}`);
            console.log(`Bids count: ${book.bids?.length || 0}`);
            console.log(`Asks count: ${book.asks?.length || 0}`);

            if (book.bids && book.bids.length > 0) {
                console.log(`Best bid: ${JSON.stringify(book.bids[0])}`);
            }
            if (book.asks && book.asks.length > 0) {
                console.log(`Best ask: ${JSON.stringify(book.asks[0])}`);
            }

            // Calculate mid price
            const bestBid = book.bids && book.bids.length > 0 ? parseFloat(book.bids[0].price) : undefined;
            const bestAsk = book.asks && book.asks.length > 0 ? parseFloat(book.asks[0].price) : undefined;

            let priceYes: number | undefined;
            if (bestBid !== undefined && bestAsk !== undefined) {
                priceYes = (bestBid + bestAsk) / 2;
            } else if (bestBid !== undefined) {
                priceYes = bestBid;
            } else if (bestAsk !== undefined) {
                priceYes = bestAsk;
            }

            if (priceYes !== undefined) {
                console.log(`\n✅ Calculated YES price: ${priceYes.toFixed(4)} (${(priceYes * 100).toFixed(1)}¢)`);
                console.log(`   NO price: ${(1 - priceYes).toFixed(4)} (${((1 - priceYes) * 100).toFixed(1)}¢)`);
            } else {
                console.log(`\n❌ Could not calculate price - empty orderbook?`);
            }

        } catch (error: any) {
            console.log(`\n❌ Error fetching: ${error.message}`);
            if (error.response) {
                console.log(`   Status: ${error.response.status}`);
                console.log(`   Data: ${JSON.stringify(error.response.data)}`);
            }
        }
    }

    await prisma.$disconnect();
}

testClobApi();
