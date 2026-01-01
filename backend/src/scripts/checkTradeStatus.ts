import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("=== MarketTrade Status Distribution ===");

    // Get all trades grouped by status
    const trades = await prisma.marketTrade.findMany();

    console.log(`Total MarketTrade records: ${trades.length}`);

    const statusCounts: Record<string, number> = {};
    trades.forEach(t => {
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    });

    Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
    });

    // Check closed trades P&L
    console.log("\n=== Closed Trades P&L ===");
    const closed = trades.filter(t => t.status === 'CLOSED');
    console.log(`Closed trades count: ${closed.length}`);
    const totalPnL = closed.reduce((sum, t) => sum + t.profitLoss, 0);
    console.log(`Total realized P&L: $${totalPnL.toFixed(2)}`);

    // Show first few trades regardless of status
    console.log("\n=== Sample Trades (Any Status) ===");
    trades.slice(0, 5).forEach(t => {
        console.log(`[${t.status}] ${t.marketId.substring(0, 20)}... | P&L: $${t.profitLoss.toFixed(2)} | Entry: $${t.entryAmount.toFixed(2)}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
