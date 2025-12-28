/**
 * Debug Script: Verify Data Accuracy
 * 
 * This script checks for discrepancies between:
 * 1. Stored data in the database
 * 2. Live prices from Polymarket CLOB API
 * 3. Calculated P&L
 * 
 * Run with: npx tsx src/debug/verifyData.ts
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

interface VerificationResult {
    marketId: string;
    question: string;

    // Position Data
    sharesYes: number;
    sharesNo: number;
    avgEntryYes: number | null;
    avgEntryNo: number | null;
    costBasisYes: number;
    costBasisNo: number;

    // Stored P&L
    storedUnrealizedPnl: number;
    storedRealizedPnl: number;

    // Live Prices
    livePriceYes: number | null;
    livePriceNo: number | null;

    // Recalculated Values
    calculatedCurrentValue: number;
    calculatedCostBasis: number;
    calculatedUnrealizedPnl: number;
    calculatedPnlPercent: number;

    // Discrepancy Detection
    pnlDiscrepancy: number;
    isDiscrepant: boolean;
    issues: string[];
}

async function fetchLivePrice(marketId: string): Promise<{ yes: number; no: number } | null> {
    // Use Gamma API which has accurate outcomePrices
    try {
        const response = await axios.get(`https://gamma-api.polymarket.com/markets/${marketId}`, {
            timeout: 5000
        });
        const marketData = response.data;

        if (marketData.outcomePrices) {
            const prices = JSON.parse(marketData.outcomePrices);
            const priceYes = parseFloat(prices[0]);
            const priceNo = parseFloat(prices[1]);

            if (!isNaN(priceYes) && !isNaN(priceNo)) {
                return { yes: priceYes, no: priceNo };
            }
        }
    } catch (error) {
        // Fallback to stored price
    }

    return null;
}


async function verifyAllPositions(): Promise<VerificationResult[]> {
    const positions = await prisma.position.findMany({
        include: { market: true }
    });

    console.log(`\n${'='.repeat(80)}`);
    console.log('POLYMARKET BOT DATA VERIFICATION');
    console.log(`${'='.repeat(80)}\n`);
    console.log(`Found ${positions.length} positions to verify.\n`);

    const results: VerificationResult[] = [];

    for (const pos of positions) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`MARKET: ${pos.market?.question?.substring(0, 60) || pos.marketId}`);
        console.log(`${'─'.repeat(60)}`);

        const issues: string[] = [];

        // Fetch live price from Gamma API
        let livePrice: { yes: number; no: number } | null = null;
        livePrice = await fetchLivePrice(pos.marketId);

        // Also check stored price history
        const storedPrice = await prisma.priceHistory.findFirst({
            where: { marketId: pos.marketId },
            orderBy: { timestamp: 'desc' }
        });

        // Calculate values
        const totalCostBasis = pos.costBasisYes + pos.costBasisNo;

        let currentValue = 0;
        let calculatedPnl = 0;
        let pnlPercent = 0;

        const priceYes = livePrice?.yes ?? storedPrice?.priceYes ?? null;
        const priceNo = livePrice?.no ?? storedPrice?.priceNo ?? null;

        if (priceYes !== null && priceNo !== null) {
            const yesValue = pos.sharesYes * priceYes;
            const noValue = pos.sharesNo * priceNo;
            currentValue = yesValue + noValue;
            calculatedPnl = currentValue - totalCostBasis;
            pnlPercent = totalCostBasis > 0 ? (calculatedPnl / totalCostBasis) * 100 : 0;
        }

        // Check for issues

        // Issue 1: Cost basis vs avgEntry * shares mismatch
        if (pos.avgEntryYes !== null && pos.sharesYes > 0) {
            const expectedCostBasisYes = pos.avgEntryYes * pos.sharesYes;
            const diff = Math.abs(expectedCostBasisYes - pos.costBasisYes);
            if (diff > 0.01) { // Allow small floating point errors
                issues.push(`YES: avgEntry (${pos.avgEntryYes.toFixed(4)}) × shares (${pos.sharesYes.toFixed(4)}) = ${expectedCostBasisYes.toFixed(4)} ≠ stored costBasis (${pos.costBasisYes.toFixed(4)})`);
            }
        }

        if (pos.avgEntryNo !== null && pos.sharesNo > 0) {
            const expectedCostBasisNo = pos.avgEntryNo * pos.sharesNo;
            const diff = Math.abs(expectedCostBasisNo - pos.costBasisNo);
            if (diff > 0.01) {
                issues.push(`NO: avgEntry (${pos.avgEntryNo.toFixed(4)}) × shares (${pos.sharesNo.toFixed(4)}) = ${expectedCostBasisNo.toFixed(4)} ≠ stored costBasis (${pos.costBasisNo.toFixed(4)})`);
            }
        }

        // Issue 2: Direction mismatch (price went UP but showing loss, or vice versa)
        if (pos.avgEntryYes !== null && priceYes !== null && pos.sharesYes > 0) {
            const priceChange = priceYes - pos.avgEntryYes;
            const expectedDirection = priceChange > 0 ? 'profit' : 'loss';
            const actualDirection = calculatedPnl > 0 ? 'profit' : 'loss';

            // For YES positions: price UP = profit, price DOWN = loss
            if (priceChange > 0.01 && calculatedPnl < -0.01) {
                issues.push(`DIRECTION MISMATCH (YES): Price went UP (${pos.avgEntryYes.toFixed(4)} → ${priceYes.toFixed(4)}) but showing LOSS`);
            } else if (priceChange < -0.01 && calculatedPnl > 0.01) {
                issues.push(`DIRECTION MISMATCH (YES): Price went DOWN but showing PROFIT`);
            }
        }

        // Issue 3: Unrealized P&L stored in DB vs calculated
        const pnlDiff = Math.abs(pos.unrealizedPnl - calculatedPnl);
        if (pnlDiff > 0.1) {
            issues.push(`STORED P&L (${pos.unrealizedPnl.toFixed(4)}) vs CALCULATED (${calculatedPnl.toFixed(4)}) - Diff: ${pnlDiff.toFixed(4)}`);
        }

        // Issue 4: avgEntry seems to be a price but costBasis doesn't match
        // Check if avgEntry looks like a percentage vs dollar amount
        if (pos.avgEntryYes !== null) {
            if (pos.avgEntryYes > 1) {
                issues.push(`avgEntryYes (${pos.avgEntryYes}) > 1 - should be a probability 0-1`);
            }
        }

        // Issue 5: Price out of range
        if (priceYes !== null && (priceYes < 0 || priceYes > 1)) {
            issues.push(`Live priceYes (${priceYes}) out of valid range 0-1`);
        }

        // Print detailed info
        console.log('\n📊 Position Details:');
        console.log(`   Shares YES: ${pos.sharesYes.toFixed(4)}`);
        console.log(`   Shares NO:  ${pos.sharesNo.toFixed(4)}`);
        console.log(`   Avg Entry YES: ${pos.avgEntryYes?.toFixed(4) ?? 'N/A'}`);
        console.log(`   Avg Entry NO:  ${pos.avgEntryNo?.toFixed(4) ?? 'N/A'}`);
        console.log(`   Cost Basis YES: $${pos.costBasisYes.toFixed(4)}`);
        console.log(`   Cost Basis NO:  $${pos.costBasisNo.toFixed(4)}`);
        console.log(`   Total Cost Basis: $${totalCostBasis.toFixed(4)}`);

        console.log('\n💰 Prices:');
        console.log(`   Live Price YES: ${priceYes?.toFixed(4) ?? 'N/A'} (${priceYes ? (priceYes * 100).toFixed(1) : 'N/A'}¢)`);
        console.log(`   Live Price NO:  ${priceNo?.toFixed(4) ?? 'N/A'} (${priceNo ? (priceNo * 100).toFixed(1) : 'N/A'}¢)`);
        if (storedPrice) {
            console.log(`   Stored Price YES: ${storedPrice.priceYes.toFixed(4)} (age: ${((Date.now() - storedPrice.timestamp.getTime()) / 1000 / 60).toFixed(1)} min ago)`);
        }

        console.log('\n📈 P&L Calculation:');
        console.log(`   Current Value: $${currentValue.toFixed(4)}`);
        console.log(`   Calculated P&L: $${calculatedPnl.toFixed(4)} (${pnlPercent.toFixed(1)}%)`);
        console.log(`   Stored Unrealized P&L: $${pos.unrealizedPnl.toFixed(4)}`);
        console.log(`   Stored Realized P&L: $${pos.realizedPnl.toFixed(4)}`);

        // Expected vs Actual calculation breakdown
        if (pos.avgEntryYes !== null && priceYes !== null && pos.sharesYes > 0) {
            console.log('\n🔍 YES Position Calculation:');
            console.log(`   Entry: ${pos.avgEntryYes.toFixed(4)} (${(pos.avgEntryYes * 100).toFixed(1)}¢)`);
            console.log(`   Current: ${priceYes.toFixed(4)} (${(priceYes * 100).toFixed(1)}¢)`);
            console.log(`   Change: ${((priceYes - pos.avgEntryYes) * 100).toFixed(2)}¢ (${((priceYes - pos.avgEntryYes) / pos.avgEntryYes * 100).toFixed(1)}%)`);
            console.log(`   Value: ${pos.sharesYes.toFixed(4)} shares × ${priceYes.toFixed(4)} = $${(pos.sharesYes * priceYes).toFixed(4)}`);
        }

        if (issues.length > 0) {
            console.log('\n⚠️  ISSUES DETECTED:');
            issues.forEach((issue, i) => console.log(`   ${i + 1}. ${issue}`));
        } else {
            console.log('\n✅ No issues detected for this position.');
        }

        results.push({
            marketId: pos.marketId,
            question: pos.market?.question ?? 'Unknown',
            sharesYes: pos.sharesYes,
            sharesNo: pos.sharesNo,
            avgEntryYes: pos.avgEntryYes,
            avgEntryNo: pos.avgEntryNo,
            costBasisYes: pos.costBasisYes,
            costBasisNo: pos.costBasisNo,
            storedUnrealizedPnl: pos.unrealizedPnl,
            storedRealizedPnl: pos.realizedPnl,
            livePriceYes: priceYes,
            livePriceNo: priceNo,
            calculatedCurrentValue: currentValue,
            calculatedCostBasis: totalCostBasis,
            calculatedUnrealizedPnl: calculatedPnl,
            calculatedPnlPercent: pnlPercent,
            pnlDiscrepancy: pnlDiff,
            isDiscrepant: issues.length > 0,
            issues
        });
    }

    return results;
}

async function verifyTrades(): Promise<void> {
    console.log(`\n\n${'='.repeat(80)}`);
    console.log('TRADE HISTORY VERIFICATION');
    console.log(`${'='.repeat(80)}\n`);

    const trades = await prisma.trade.findMany({
        include: { market: true },
        orderBy: { timestamp: 'desc' },
        take: 20
    });

    console.log(`Last 20 trades:\n`);

    for (const trade of trades) {
        const isProfitTaking = trade.strategy === 'PROFIT_TAKING';
        const emoji = isProfitTaking ? '💰' : '📥';

        console.log(`${emoji} ${trade.timestamp.toISOString()}`);
        console.log(`   Market: ${trade.market?.question?.substring(0, 50) ?? trade.marketId}`);
        console.log(`   Side: ${trade.side}, Price: ${trade.price.toFixed(4)} (${(trade.price * 100).toFixed(1)}¢)`);
        console.log(`   Size: $${trade.size.toFixed(4)}, Shares: ${trade.shares.toFixed(4)}`);
        console.log(`   Strategy: ${trade.strategy}${trade.strategyDetail ? ` (${trade.strategyDetail})` : ''}`);

        // Verify shares calculation
        const expectedShares = trade.size / trade.price;
        const sharesDiff = Math.abs(expectedShares - trade.shares);
        if (sharesDiff > 0.01) {
            console.log(`   ⚠️  SHARES MISMATCH: size/price = ${expectedShares.toFixed(4)} ≠ ${trade.shares.toFixed(4)}`);
        }

        console.log('');
    }
}

async function verifyPositionVsTrades(): Promise<void> {
    console.log(`\n\n${'='.repeat(80)}`);
    console.log('POSITION vs TRADE RECONCILIATION');
    console.log(`${'='.repeat(80)}\n`);

    const positions = await prisma.position.findMany({
        include: { market: true }
    });

    for (const pos of positions) {
        const trades = await prisma.trade.findMany({
            where: { marketId: pos.marketId },
            orderBy: { timestamp: 'asc' }
        });

        console.log(`\n📊 ${pos.market?.question?.substring(0, 50) ?? pos.marketId}`);
        console.log(`${'─'.repeat(60)}`);

        // Replay trades to calculate expected position
        let expectedSharesYes = 0;
        let expectedSharesNo = 0;
        let expectedCostBasisYes = 0;
        let expectedCostBasisNo = 0;

        for (const trade of trades) {
            const isProfitTaking = trade.strategy === 'PROFIT_TAKING';

            if (isProfitTaking) {
                // Sell
                if (trade.side === 'YES') {
                    const pctSold = expectedSharesYes > 0 ? trade.shares / expectedSharesYes : 1;
                    expectedSharesYes -= trade.shares;
                    expectedCostBasisYes -= expectedCostBasisYes * pctSold;
                } else {
                    const pctSold = expectedSharesNo > 0 ? trade.shares / expectedSharesNo : 1;
                    expectedSharesNo -= trade.shares;
                    expectedCostBasisNo -= expectedCostBasisNo * pctSold;
                }
            } else {
                // Buy
                if (trade.side === 'YES') {
                    expectedSharesYes += trade.shares;
                    expectedCostBasisYes += trade.size;
                } else {
                    expectedSharesNo += trade.shares;
                    expectedCostBasisNo += trade.size;
                }
            }
        }

        console.log(`Trade count: ${trades.length}`);
        console.log('\nExpected from trades:');
        console.log(`   Shares YES: ${expectedSharesYes.toFixed(4)}, Cost Basis: $${expectedCostBasisYes.toFixed(4)}`);
        console.log(`   Shares NO:  ${expectedSharesNo.toFixed(4)}, Cost Basis: $${expectedCostBasisNo.toFixed(4)}`);

        console.log('\nStored in position:');
        console.log(`   Shares YES: ${pos.sharesYes.toFixed(4)}, Cost Basis: $${pos.costBasisYes.toFixed(4)}`);
        console.log(`   Shares NO:  ${pos.sharesNo.toFixed(4)}, Cost Basis: $${pos.costBasisNo.toFixed(4)}`);

        const sharesDiffYes = Math.abs(expectedSharesYes - pos.sharesYes);
        const sharesDiffNo = Math.abs(expectedSharesNo - pos.sharesNo);
        const costDiffYes = Math.abs(expectedCostBasisYes - pos.costBasisYes);
        const costDiffNo = Math.abs(expectedCostBasisNo - pos.costBasisNo);

        if (sharesDiffYes > 0.01 || sharesDiffNo > 0.01 || costDiffYes > 0.01 || costDiffNo > 0.01) {
            console.log('\n⚠️  DISCREPANCY DETECTED:');
            if (sharesDiffYes > 0.01) console.log(`   Shares YES diff: ${sharesDiffYes.toFixed(4)}`);
            if (sharesDiffNo > 0.01) console.log(`   Shares NO diff: ${sharesDiffNo.toFixed(4)}`);
            if (costDiffYes > 0.01) console.log(`   Cost Basis YES diff: $${costDiffYes.toFixed(4)}`);
            if (costDiffNo > 0.01) console.log(`   Cost Basis NO diff: $${costDiffNo.toFixed(4)}`);
        } else {
            console.log('\n✅ Position matches trade history.');
        }
    }
}

async function main(): Promise<void> {
    try {
        const results = await verifyAllPositions();
        await verifyTrades();
        await verifyPositionVsTrades();

        // Summary
        console.log(`\n\n${'='.repeat(80)}`);
        console.log('SUMMARY');
        console.log(`${'='.repeat(80)}\n`);

        const discrepantCount = results.filter(r => r.isDiscrepant).length;
        console.log(`Total positions:    ${results.length}`);
        console.log(`Positions OK:       ${results.length - discrepantCount}`);
        console.log(`Positions w/Issues: ${discrepantCount}`);

        if (discrepantCount > 0) {
            console.log('\n⚠️  POSITIONS WITH ISSUES:');
            results.filter(r => r.isDiscrepant).forEach(r => {
                console.log(`\n   ${r.question.substring(0, 50)}...`);
                r.issues.forEach(issue => console.log(`      - ${issue}`));
            });
        }

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
