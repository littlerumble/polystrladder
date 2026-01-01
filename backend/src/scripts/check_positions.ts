
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Checking Open MarketTrades...");
    const trades = await prisma.marketTrade.findMany({
        where: { status: 'OPEN' }
    });
    console.log(`Found ${trades.length} OPEN MarketTrades.`);

    for (const t of trades) {
        console.log(`MarketTrade ${t.id} - MarketId: ${t.marketId}`);
        const pos = await prisma.position.findUnique({
            where: { marketId: t.marketId }
        });
        if (pos) {
            console.log(`  MATCH: Position found. Shares: ${pos.sharesYes}/${pos.sharesNo}`);
        } else {
            console.log(`  ERROR: No Position found for MarketId ${t.marketId}!`);
        }
    }
}

main()
    .catch(console.error)
    .finally(async () => await prisma.$disconnect());
