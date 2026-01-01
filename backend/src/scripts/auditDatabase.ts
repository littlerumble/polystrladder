import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3001';

async function auditDatabase() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           DATABASE AUDIT & API VERIFICATION            ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // 1. MarketTrade Table
    console.log('═══════════════════════════════════════════════════════════');
    console.log('1. MARKET TRADES (Primary P&L Source)');
    console.log('═══════════════════════════════════════════════════════════');

    const marketTrades = await prisma.marketTrade.findMany({
        include: { market: true }
    });

    const openTrades = marketTrades.filter(t => t.status === 'OPEN');
    const closedTrades = marketTrades.filter(t => t.status === 'CLOSED');

    console.log(`Total: ${marketTrades.length} | OPEN: ${openTrades.length} | CLOSED: ${closedTrades.length}`);

    let totalInvested = 0;
    let totalUnrealized = 0;
    let totalRealized = 0;

    console.log('\n--- OPEN Trades ---');
    for (const t of openTrades) {
        totalInvested += t.entryAmount;
        totalUnrealized += t.unrealizedPnl;
        console.log(`  [${t.side}] ${t.market?.question?.substring(0, 40) || t.marketId.substring(0, 20)}...`);
        console.log(`    Entry: $${t.entryAmount.toFixed(2)} @ ${(t.entryPrice * 100).toFixed(1)}¢ | Current: ${t.currentPrice ? (t.currentPrice * 100).toFixed(1) + '¢' : 'N/A'}`);
        console.log(`    Shares: ${t.currentShares.toFixed(2)} | Unrealized P&L: $${t.unrealizedPnl.toFixed(2)}`);
    }

    console.log('\n--- CLOSED Trades ---');
    for (const t of closedTrades) {
        totalRealized += t.profitLoss;
        const isWin = t.profitLoss > 0;
        console.log(`  [${isWin ? '✅' : '❌'}] ${t.market?.question?.substring(0, 40) || t.marketId.substring(0, 20)}...`);
        console.log(`    Entry: $${t.entryAmount.toFixed(2)} @ ${(t.entryPrice * 100).toFixed(1)}¢ → Exit: $${t.exitAmount?.toFixed(2) || 0} @ ${(t.exitPrice || 0) * 100}¢`);
        console.log(`    P&L: $${t.profitLoss.toFixed(2)} (${t.profitLossPct.toFixed(1)}%) | Reason: ${t.exitReason?.substring(0, 50) || 'N/A'}`);
    }

    console.log('\n--- Summary ---');
    console.log(`  Total Invested (Open): $${totalInvested.toFixed(2)}`);
    console.log(`  Total Unrealized P&L:  $${totalUnrealized.toFixed(2)}`);
    console.log(`  Total Realized P&L:    $${totalRealized.toFixed(2)}`);

    // 2. Compare with API
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('2. API RESPONSE COMPARISON');
    console.log('═══════════════════════════════════════════════════════════');

    try {
        const portfolioRes = await axios.get(`${API_BASE}/api/portfolio`);
        const portfolio = portfolioRes.data;

        console.log('\n/api/portfolio values:');
        console.log(`  realizedPnl:   $${portfolio.realizedPnl?.toFixed(2) || 'N/A'}`);
        console.log(`  unrealizedPnl: $${portfolio.unrealizedPnl?.toFixed(2) || 'N/A'}`);
        console.log(`  positionCount: ${portfolio.positionCount}`);
        console.log(`  closedCount:   ${portfolio.closedCount}`);
        console.log(`  winCount:      ${portfolio.winCount}`);
        console.log(`  lossCount:     ${portfolio.lossCount}`);

        // Check for discrepancies
        console.log('\n--- Discrepancy Check ---');
        const realizedMatch = Math.abs(portfolio.realizedPnl - totalRealized) < 0.01;
        const unrealizedMatch = Math.abs(portfolio.unrealizedPnl - totalUnrealized) < 0.01;
        const openCountMatch = portfolio.positionCount === openTrades.length;
        const closedCountMatch = portfolio.closedCount === closedTrades.length;

        console.log(`  Realized P&L:   ${realizedMatch ? '✅ Match' : `❌ DB: $${totalRealized.toFixed(2)} vs API: $${portfolio.realizedPnl?.toFixed(2)}`}`);
        console.log(`  Unrealized P&L: ${unrealizedMatch ? '✅ Match' : `❌ DB: $${totalUnrealized.toFixed(2)} vs API: $${portfolio.unrealizedPnl?.toFixed(2)}`}`);
        console.log(`  Open Count:     ${openCountMatch ? '✅ Match' : `❌ DB: ${openTrades.length} vs API: ${portfolio.positionCount}`}`);
        console.log(`  Closed Count:   ${closedCountMatch ? '✅ Match' : `❌ DB: ${closedTrades.length} vs API: ${portfolio.closedCount}`}`);

        // Check /api/trades/closed
        const closedRes = await axios.get(`${API_BASE}/api/trades/closed`);
        const apiClosedTrades = closedRes.data;
        console.log(`\n/api/trades/closed count: ${apiClosedTrades.length}`);

        // Check /api/trades/active
        const activeRes = await axios.get(`${API_BASE}/api/trades/active`);
        const apiActiveTrades = activeRes.data;
        console.log(`/api/trades/active count: ${apiActiveTrades.length}`);

    } catch (error) {
        console.log(`  ❌ API Error: ${error}`);
    }

    // 3. Position Table (legacy)
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('3. POSITION TABLE (Legacy - should match MarketTrade OPEN)');
    console.log('═══════════════════════════════════════════════════════════');

    const positions = await prisma.position.findMany({
        include: { market: true }
    });

    console.log(`Total Positions: ${positions.length}`);
    for (const p of positions) {
        console.log(`  ${p.market?.question?.substring(0, 40) || p.marketId.substring(0, 20)}...`);
        console.log(`    YES: ${p.sharesYes.toFixed(2)} @ ${p.avgEntryYes?.toFixed(3) || 'N/A'} | NO: ${p.sharesNo.toFixed(2)} @ ${p.avgEntryNo?.toFixed(3) || 'N/A'}`);
    }

    // 4. TrackedMarket Table
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('4. TRACKED MARKETS (Copy Trading)');
    console.log('═══════════════════════════════════════════════════════════');

    const trackedMarkets = await prisma.trackedMarket.findMany({
        orderBy: { signalTime: 'desc' },
        take: 10
    });

    const statusCounts: Record<string, number> = {};
    trackedMarkets.forEach(t => {
        statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    });

    console.log(`Recent 10 tracked markets by status:`);
    Object.entries(statusCounts).forEach(([status, count]) => {
        console.log(`  ${status}: ${count}`);
    });

    // 5. BotConfig
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('5. BOT CONFIG');
    console.log('═══════════════════════════════════════════════════════════');

    const botConfig = await prisma.botConfig.findFirst();
    if (botConfig) {
        console.log(`  Bankroll:       $${botConfig.bankroll.toFixed(2)}`);
        console.log(`  Locked Profits: $${botConfig.lockedProfits.toFixed(2)}`);
    } else {
        console.log('  No BotConfig found (will use defaults)');
    }

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║                    AUDIT COMPLETE                       ║');
    console.log('╚════════════════════════════════════════════════════════╝');
}

auditDatabase()
    .catch(e => console.error('Audit failed:', e))
    .finally(async () => await prisma.$disconnect());
