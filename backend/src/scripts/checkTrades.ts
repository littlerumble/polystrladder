import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Check all MarketTrades
    const trades = await prisma.marketTrade.findMany({
        select: { id: true, marketId: true, tokenId: true, side: true, status: true }
    });

    console.log('MarketTrades:');
    trades.forEach(t => {
        console.log(`  #${t.id}: ${t.side} ${t.status}, tokenId: ${t.tokenId || 'NULL'}`);
    });

    await prisma.$disconnect();
}

main();
