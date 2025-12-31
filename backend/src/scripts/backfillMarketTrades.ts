import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Backfill MarketTrade table from existing Position data.
 * Run this once after adding MarketTrade table.
 */
async function backfillMarketTrades() {
    console.log('Backfilling MarketTrade from Position data...');

    // Get all positions
    const positions = await prisma.position.findMany({
        include: { market: true }
    });

    console.log(`Found ${positions.length} positions to migrate`);

    for (const pos of positions) {
        // Check if already migrated
        const existing = await prisma.marketTrade.findFirst({
            where: { marketId: pos.marketId }
        });

        if (existing) {
            console.log(`Skipping ${pos.marketId} - already exists`);
            continue;
        }

        // Create MarketTrade for YES side if we have shares
        if (pos.sharesYes > 0 && pos.costBasisYes > 0) {
            const entryPrice = pos.avgEntryYes || (pos.costBasisYes / pos.sharesYes);
            await prisma.marketTrade.create({
                data: {
                    marketId: pos.marketId,
                    side: 'YES',
                    status: 'OPEN',
                    entryPrice,
                    entryShares: pos.sharesYes,
                    entryAmount: pos.costBasisYes,
                    entryTime: new Date(),  // We don't have original time
                    currentShares: pos.sharesYes,
                    profitLoss: pos.realizedPnl,
                    profitLossPct: 0,
                    unrealizedPnl: pos.unrealizedPnl
                }
            });
            console.log(`Created MarketTrade for YES: ${pos.marketId}`);
        }

        // Create MarketTrade for NO side if we have shares
        if (pos.sharesNo > 0 && pos.costBasisNo > 0) {
            const entryPrice = pos.avgEntryNo || (pos.costBasisNo / pos.sharesNo);
            await prisma.marketTrade.create({
                data: {
                    marketId: pos.marketId,
                    side: 'NO',
                    status: 'OPEN',
                    entryPrice,
                    entryShares: pos.sharesNo,
                    entryAmount: pos.costBasisNo,
                    entryTime: new Date(),
                    currentShares: pos.sharesNo,
                    profitLoss: pos.realizedPnl,
                    profitLossPct: 0,
                    unrealizedPnl: pos.unrealizedPnl
                }
            });
            console.log(`Created MarketTrade for NO: ${pos.marketId}`);
        }
    }

    const count = await prisma.marketTrade.count();
    console.log(`Done! MarketTrade now has ${count} records`);
}

backfillMarketTrades()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
