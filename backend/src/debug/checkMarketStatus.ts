/**
 * Check market status - are these markets still active?
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

async function checkMarketStatus() {
    console.log('Checking market status...\n');

    const positions = await prisma.position.findMany({
        include: { market: true }
    });

    const now = new Date();
    console.log(`Current time: ${now.toISOString()}\n`);

    for (const pos of positions) {
        if (!pos.market) continue;

        console.log(`${'─'.repeat(60)}`);
        console.log(`Market: ${pos.market.question}`);
        console.log(`End Date: ${pos.market.endDate.toISOString()}`);

        const timeDiff = pos.market.endDate.getTime() - now.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);

        if (timeDiff < 0) {
            console.log(`⚠️  MARKET ENDED ${Math.abs(hoursDiff).toFixed(1)} hours ago!`);
        } else {
            console.log(`✅ Market ends in ${hoursDiff.toFixed(1)} hours`);
        }

        console.log(`Closed flag: ${pos.market.closed}`);
        console.log(`Active flag: ${pos.market.active}`);

        // Try to get the actual market info from Polymarket API
        try {
            // Use the Gamma API to get market info
            const response = await axios.get(`https://gamma-api.polymarket.com/markets/${pos.marketId}`);
            const marketData = response.data;

            console.log(`\nAPI Response:`);
            console.log(`  Closed: ${marketData.closed}`);
            console.log(`  Active: ${marketData.active}`);
            console.log(`  Accepting orders: ${marketData.acceptingOrders}`);
            console.log(`  End Date: ${marketData.endDate}`);

            // Get the actual outcomes and current prices
            if (marketData.outcomePrices) {
                const prices = JSON.parse(marketData.outcomePrices);
                console.log(`  Outcome Prices: ${JSON.stringify(prices)}`);
            }

        } catch (error: any) {
            console.log(`\nCouldn't fetch from Gamma API: ${error.message}`);

            // Try CLOB API market endpoint
            try {
                const tokenIds = JSON.parse(pos.market.clobTokenIds);
                const outcomes: string[] = JSON.parse(pos.market.outcomes || '["Yes", "No"]');
                const yesIndex = outcomes.findIndex(o => o.toLowerCase() === 'yes');
                const yesTokenId = yesIndex !== -1 ? tokenIds[yesIndex] : tokenIds[0];
                const clobResponse = await axios.get(`https://clob.polymarket.com/markets/${yesTokenId}`);
                console.log(`CLOB market response: ${JSON.stringify(clobResponse.data)}`);
            } catch (e: any) {
                console.log(`CLOB API also failed: ${e.message}`);
            }
        }

        console.log('');
    }

    await prisma.$disconnect();
}

checkMarketStatus();
