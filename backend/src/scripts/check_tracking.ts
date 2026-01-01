
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("Checking Tracked Markets (Last 24h)...");

    // Use Date object for DateTime fields
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // 1. Check Tracked Markets
    const tracked = await prisma.trackedMarket.findMany({
        where: {
            signalTime: {
                gte: oneDayAgo
            }
        },
        orderBy: {
            signalTime: 'desc'
        },
        take: 50 // Increased limit
    });

    console.log(`Found ${tracked.length} tracked markets in last 24h.`);
    tracked.forEach(t => {
        console.log(`[${t.status}] ${t.traderName} - ${t.slug} (Entry: ${t.trackedPrice} / Current: ${t.currentPrice}) - ${t.signalTime.toISOString()}`);
    });

    // 2. Check Executed Trades
    console.log("\nChecking Executed Trades (Last 24h)...");
    const trades = await prisma.trade.findMany({
        where: {
            timestamp: {
                gte: oneDayAgo // Use Date object
            }
        },
        orderBy: {
            timestamp: 'desc'
        },
        take: 50
    });

    console.log(`Found ${trades.length} executed trades in last 24h.`);
    trades.forEach(t => {
        console.log(`[${t.side}] ${t.marketId} - Size: ${t.size} - Price: ${t.price} - ${t.timestamp.toISOString()}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
