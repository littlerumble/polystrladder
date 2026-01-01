/**
 * Reset Database Script
 * 
 * Clears all trading data while preserving markets.
 * Use this to start fresh.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function resetDatabase() {
    console.log('🔄 Resetting database...\n');

    try {
        // Delete in correct order (respecting foreign keys)

        console.log('Deleting PnL snapshots...');
        const pnlCount = await prisma.pnlSnapshot.deleteMany({});
        console.log(`✅ Deleted ${pnlCount.count} PnL snapshots\n`);

        console.log('Deleting strategy events...');
        const eventsCount = await prisma.strategyEvent.deleteMany({});
        console.log(`✅ Deleted ${eventsCount.count} strategy events\n`);

        console.log('Deleting price history...');
        const priceCount = await prisma.priceHistory.deleteMany({});
        console.log(`✅ Deleted ${priceCount.count} price history records\n`);

        console.log('Deleting market trades...');
        const marketTradesCount = await prisma.marketTrade.deleteMany({});
        console.log(`✅ Deleted ${marketTradesCount.count} market trades\n`);

        console.log('Deleting trades...');
        const tradesCount = await prisma.trade.deleteMany({});
        console.log(`✅ Deleted ${tradesCount.count} trades\n`);

        console.log('Deleting positions...');
        const positionsCount = await prisma.position.deleteMany({});
        console.log(`✅ Deleted ${positionsCount.count} positions\n`);

        console.log('Deleting market states...');
        const statesCount = await prisma.marketState.deleteMany({});
        console.log(`✅ Deleted ${statesCount.count} market states\n`);

        console.log('Deleting tracked markets...');
        const trackedCount = await prisma.trackedMarket.deleteMany({});
        console.log(`✅ Deleted ${trackedCount.count} tracked markets\n`);

        console.log('Deleting markets...');
        const marketsCount = await prisma.market.deleteMany({});
        console.log(`✅ Deleted ${marketsCount.count} markets\n`);

        console.log('Resetting bot config...');
        await prisma.botConfig.upsert({
            where: { id: 1 },
            update: {
                lockedProfits: 0
            },
            create: {
                id: 1,
                bankroll: 5000,
                lockedProfits: 0
            }
        });
        console.log('✅ Reset bot config\n');

        console.log('✨ Database reset complete!\n');

    } catch (error) {
        console.error('❌ Error resetting database:', error);
    } finally {
        await prisma.$disconnect();
    }
}

resetDatabase();
