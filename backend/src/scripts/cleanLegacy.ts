import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Delete legacy trades without tokenId
    const deleted = await prisma.marketTrade.deleteMany({
        where: { tokenId: null }
    });
    console.log(`Deleted ${deleted.count} legacy MarketTrades without tokenId`);

    // Also delete orphaned positions
    const deletedPositions = await prisma.position.deleteMany({});
    console.log(`Deleted ${deletedPositions.count} Positions`);

    // Delete market states for clean start  
    const deletedStates = await prisma.marketState.deleteMany({});
    console.log(`Deleted ${deletedStates.count} MarketStates`);

    await prisma.$disconnect();
    console.log('Done. Restart bot for clean state.');
}

main();
