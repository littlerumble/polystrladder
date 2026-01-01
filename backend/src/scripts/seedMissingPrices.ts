import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function seedMissingPrices() {
    console.log('=== Seeding Missing Prices for Open Trades ===\n');

    const openTrades = await prisma.marketTrade.findMany({
        where: { status: 'OPEN' },
        include: { market: true }
    });

    for (const trade of openTrades) {
        // Check if we have a cached price
        const latestPrice = await prisma.priceHistory.findFirst({
            where: { marketId: trade.marketId },
            orderBy: { timestamp: 'desc' }
        });

        if (latestPrice) {
            console.log(`✅ ${trade.market?.question?.substring(0, 40)}... already has cached price`);

            // Update MarketTrade.currentPrice if NULL
            if (trade.currentPrice === null) {
                const currentPrice = trade.side === 'YES' ? latestPrice.priceYes : latestPrice.priceNo;
                const currentValue = trade.currentShares * currentPrice;
                const unrealizedPnl = currentValue - trade.entryAmount;

                await prisma.marketTrade.update({
                    where: { id: trade.id },
                    data: { currentPrice, unrealizedPnl }
                });
                console.log(`   → Updated trade currentPrice to ${currentPrice.toFixed(3)}`);
            }
        } else {
            console.log(`❌ ${trade.market?.question?.substring(0, 40)}... NO cached price`);

            // Use entry price as fallback (best we have)
            const priceYes = trade.side === 'YES' ? trade.entryPrice : (1 - trade.entryPrice);
            const priceNo = 1 - priceYes;

            console.log(`   → Seeding with entry price: YES=${priceYes.toFixed(3)}, NO=${priceNo.toFixed(3)}`);

            // Create price history entry
            await prisma.priceHistory.create({
                data: {
                    marketId: trade.marketId,
                    priceYes,
                    priceNo,
                    bestBidYes: priceYes,
                    bestAskYes: priceYes,
                    bestBidNo: priceNo,
                    bestAskNo: priceNo,
                    timestamp: new Date()
                }
            });

            // Update MarketTrade
            const currentPrice = trade.side === 'YES' ? priceYes : priceNo;
            await prisma.marketTrade.update({
                where: { id: trade.id },
                data: { currentPrice, unrealizedPnl: 0 }  // 0 P&L at entry price
            });

            console.log(`   ✅ Seeded and updated trade`);
        }
    }

    console.log('\n=== Done ===');
}

seedMissingPrices()
    .catch(e => console.error('Seed failed:', e))
    .finally(async () => await prisma.$disconnect());
