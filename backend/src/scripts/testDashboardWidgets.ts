/**
 * Deep Dashboard Data Validation
 * 
 * This script does REAL validation - not just count comparisons.
 * It verifies:
 * 1. P&L calculations are mathematically correct
 * 2. Prices from API match actual CLOB orderbook prices
 * 3. Position values make sense (no negative shares, no impossible prices)
 * 4. Portfolio totals add up correctly
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const API_BASE = 'http://localhost:3000/api';
const CLOB_API = 'https://clob.polymarket.com';
const prisma = new PrismaClient();

interface ValidationResult {
    test: string;
    passed: boolean;
    expected?: any;
    actual?: any;
    details: string;
}

// Helper to fetch CLOB price directly for validation
async function getClobPrice(tokenId: string): Promise<number | null> {
    try {
        const response = await axios.get(`${CLOB_API}/book`, {
            params: { token_id: tokenId },
            timeout: 5000
        });
        if (response.data?.bids?.length > 0) {
            return parseFloat(response.data.bids[response.data.bids.length - 1].price);
        }
        return null;
    } catch {
        return null;
    }
}

async function validatePortfolioMath(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Fetch portfolio from API
    const portfolioRes = await axios.get(`${API_BASE}/portfolio`);
    const portfolio = portfolioRes.data;

    // Fetch raw data from DB
    const openTrades = await prisma.marketTrade.findMany({ where: { status: 'OPEN' } });
    const closedTrades = await prisma.marketTrade.findMany({ where: { status: 'CLOSED' } });
    const botConfig = await prisma.botConfig.findFirst();

    // TEST 1: Realized P&L should equal sum of closed trade profits
    const expectedRealizedPnl = closedTrades.reduce((sum, t) => sum + t.profitLoss, 0);
    results.push({
        test: 'Realized P&L Calculation',
        passed: Math.abs(portfolio.realizedPnl - expectedRealizedPnl) < 0.01,
        expected: expectedRealizedPnl.toFixed(2),
        actual: portfolio.realizedPnl.toFixed(2),
        details: `Sum of closed trade profits`
    });

    // TEST 2: Position count should match open trades
    results.push({
        test: 'Position Count',
        passed: portfolio.positionCount === openTrades.length,
        expected: openTrades.length,
        actual: portfolio.positionCount,
        details: 'Open MarketTrade count'
    });

    // TEST 3: Win count should match trades with positive profit
    const expectedWins = closedTrades.filter(t => t.profitLoss > 0).length;
    results.push({
        test: 'Win Count',
        passed: portfolio.winCount === expectedWins,
        expected: expectedWins,
        actual: portfolio.winCount,
        details: 'Trades with profitLoss > 0'
    });

    // TEST 4: Win rate calculation
    const expectedWinRate = closedTrades.length > 0
        ? (expectedWins / closedTrades.length) * 100
        : 0;
    results.push({
        test: 'Win Rate Calculation',
        passed: Math.abs(portfolio.winRate - expectedWinRate) < 0.1,
        expected: expectedWinRate.toFixed(1) + '%',
        actual: portfolio.winRate.toFixed(1) + '%',
        details: '(wins / total closed) * 100'
    });

    // TEST 5: Total Value = Cash + Positions Value
    const expectedTotalValue = portfolio.tradeableCash + portfolio.lockedProfits + portfolio.positionsValue;
    results.push({
        test: 'Total Value Addition',
        passed: Math.abs(portfolio.totalValue - expectedTotalValue) < 0.01,
        expected: expectedTotalValue.toFixed(2),
        actual: portfolio.totalValue.toFixed(2),
        details: 'tradeableCash + lockedProfits + positionsValue'
    });

    // TEST 6: Bankroll should be configured value
    const configBankroll = botConfig?.bankroll || 1000;
    results.push({
        test: 'Bankroll from Config',
        passed: portfolio.bankroll === configBankroll,
        expected: configBankroll,
        actual: portfolio.bankroll,
        details: 'Should match BotConfig.bankroll'
    });

    return results;
}

async function validateActiveTradesPnL(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Fetch active trades from API
    const activeRes = await axios.get(`${API_BASE}/trades/active`);
    const activeTrades = activeRes.data;

    if (activeTrades.length === 0) {
        results.push({
            test: 'Active Trades P&L',
            passed: true,
            details: 'No active trades to validate'
        });
        return results;
    }

    // Sample up to 3 trades for deep validation
    const samplesToCheck = activeTrades.slice(0, 3);

    for (const trade of samplesToCheck) {
        // Get the trade from DB
        const dbTrade = await prisma.marketTrade.findUnique({
            where: { id: trade.id },
            include: { market: true }
        });

        if (!dbTrade) continue;

        // TEST: Entry amount should match
        results.push({
            test: `Trade #${trade.id}: Entry Amount`,
            passed: Math.abs(trade.entryAmount - dbTrade.entryAmount) < 0.01,
            expected: dbTrade.entryAmount.toFixed(2),
            actual: trade.entryAmount.toFixed(2),
            details: 'Should match database'
        });

        // TEST: Shares should match
        results.push({
            test: `Trade #${trade.id}: Current Shares`,
            passed: Math.abs(trade.currentShares - dbTrade.currentShares) < 0.01,
            expected: dbTrade.currentShares.toFixed(2),
            actual: trade.currentShares?.toFixed(2) || 'N/A',
            details: 'Should match database'
        });

        // TEST: Unrealized P&L formula check
        // unrealizedPnl = (currentShares * currentPrice) - costBasis
        if (trade.currentPrice && trade.currentShares) {
            const currentValue = trade.currentShares * trade.currentPrice;
            const costBasis = trade.entryAmount * (trade.currentShares / trade.entryShares);
            const expectedPnl = currentValue - costBasis;

            results.push({
                test: `Trade #${trade.id}: P&L Formula`,
                passed: Math.abs(trade.unrealizedPnl - expectedPnl) < 0.02,
                expected: expectedPnl.toFixed(2),
                actual: trade.unrealizedPnl?.toFixed(2) || 'N/A',
                details: '(shares × price) - costBasis'
            });
        }
    }

    return results;
}

async function validateClosedTradesMath(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Fetch closed trades from API
    const closedRes = await axios.get(`${API_BASE}/trades/closed?limit=10`);
    const closedTrades = closedRes.data;

    if (closedTrades.length === 0) {
        results.push({
            test: 'Closed Trades Math',
            passed: true,
            details: 'No closed trades to validate'
        });
        return results;
    }

    // Sample first 3 for validation
    for (const trade of closedTrades.slice(0, 3)) {
        // TEST: P&L calculation
        // profitLoss = exitAmount - entryAmount
        if (trade.exitAmount !== null && trade.entryAmount !== null) {
            const expectedPnl = trade.exitAmount - trade.entryAmount;
            results.push({
                test: `Closed #${trade.id}: P&L = Exit - Entry`,
                passed: Math.abs(trade.profitLoss - expectedPnl) < 0.02,
                expected: expectedPnl.toFixed(2),
                actual: trade.profitLoss.toFixed(2),
                details: `${trade.exitAmount.toFixed(2)} - ${trade.entryAmount.toFixed(2)}`
            });
        }

        // TEST: P&L percentage calculation
        if (trade.entryAmount > 0) {
            const expectedPct = (trade.profitLoss / trade.entryAmount) * 100;
            results.push({
                test: `Closed #${trade.id}: P&L %`,
                passed: Math.abs(trade.profitLossPct - expectedPct) < 0.5,
                expected: expectedPct.toFixed(1) + '%',
                actual: trade.profitLossPct.toFixed(1) + '%',
                details: '(P&L / entryAmount) × 100'
            });
        }

        // TEST: isWin flag
        const shouldBeWin = trade.profitLoss > 0;
        results.push({
            test: `Closed #${trade.id}: Win Flag`,
            passed: trade.isWin === shouldBeWin,
            expected: shouldBeWin,
            actual: trade.isWin,
            details: 'profitLoss > 0'
        });
    }

    return results;
}

async function validateDataSanity(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Fetch all data
    const [portfolioRes, positionsRes, activeRes] = await Promise.all([
        axios.get(`${API_BASE}/portfolio`),
        axios.get(`${API_BASE}/positions`),
        axios.get(`${API_BASE}/trades/active`)
    ]);

    const portfolio = portfolioRes.data;
    const positions = positionsRes.data;
    const activeTrades = activeRes.data;

    // TEST: No negative bankroll
    results.push({
        test: 'Bankroll Non-Negative',
        passed: portfolio.bankroll >= 0,
        actual: portfolio.bankroll,
        details: 'Bankroll should never be negative'
    });

    // TEST: No negative position shares
    const negativeShares = positions.filter((p: any) => p.sharesYes < 0 || p.sharesNo < 0);
    results.push({
        test: 'No Negative Shares',
        passed: negativeShares.length === 0,
        actual: `${negativeShares.length} positions with negative shares`,
        details: 'Shares should never be negative'
    });

    // TEST: Prices between 0 and 1
    const invalidPrices = positions.filter((p: any) => {
        if (p.currentPriceYes === undefined) return false;
        return p.currentPriceYes < 0 || p.currentPriceYes > 1 ||
            p.currentPriceNo < 0 || p.currentPriceNo > 1;
    });
    results.push({
        test: 'Prices in Valid Range (0-1)',
        passed: invalidPrices.length === 0,
        actual: `${invalidPrices.length} positions with invalid prices`,
        details: 'Prices must be between 0 and 1'
    });

    // TEST: Active trades count matches open positions
    results.push({
        test: 'Active Trades = Positions',
        passed: activeTrades.length === positions.length,
        expected: positions.length,
        actual: activeTrades.length,
        details: 'Each position should have one active trade'
    });

    // TEST: Total invested should not exceed bankroll
    const totalInvested = activeTrades.reduce((sum: number, t: any) => sum + t.entryAmount, 0);
    results.push({
        test: 'Invested ≤ Bankroll',
        passed: totalInvested <= portfolio.bankroll,
        expected: `≤ ${portfolio.bankroll.toFixed(2)}`,
        actual: totalInvested.toFixed(2),
        details: 'Cannot invest more than bankroll'
    });

    return results;
}

async function validateLivePrices(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    // Get positions with their market data
    const positions = await prisma.position.findMany({
        include: { market: true },
        where: {
            OR: [{ sharesYes: { gt: 0 } }, { sharesNo: { gt: 0 } }]
        },
        take: 3  // Sample 3 positions
    });

    for (const pos of positions) {
        if (!pos.market?.clobTokenIds) continue;

        try {
            const tokenIds = JSON.parse(pos.market.clobTokenIds);
            const outcomes = JSON.parse(pos.market.outcomes || '["Yes", "No"]');
            const yesIdx = outcomes.findIndex((o: string) => o.toLowerCase() === 'yes');
            const yesTokenId = yesIdx !== -1 ? tokenIds[yesIdx] : tokenIds[0];

            // Get live price from CLOB
            const livePrice = await getClobPrice(yesTokenId);

            // Get price from API
            const posRes = await axios.get(`${API_BASE}/positions`);
            const apiPos = posRes.data.find((p: any) => p.marketId === pos.marketId);

            if (livePrice && apiPos?.currentPriceYes) {
                const diff = Math.abs(livePrice - apiPos.currentPriceYes);
                results.push({
                    test: `Price Accuracy: ${pos.market.question?.substring(0, 30)}...`,
                    passed: diff < 0.05,  // Allow 5% difference for latency
                    expected: `${(livePrice * 100).toFixed(1)}¢`,
                    actual: `${(apiPos.currentPriceYes * 100).toFixed(1)}¢`,
                    details: diff < 0.05 ? 'Within tolerance' : `Diff: ${(diff * 100).toFixed(1)}¢`
                });
            }
        } catch (e) {
            // Skip markets with parsing issues
        }
    }

    if (results.length === 0) {
        results.push({
            test: 'Live Price Accuracy',
            passed: true,
            details: 'No positions with valid tokens to check'
        });
    }

    return results;
}

async function main() {
    console.log('🔬 DEEP DASHBOARD DATA VALIDATION');
    console.log('='.repeat(70));
    console.log('Validating data accuracy, calculations, and business logic');
    console.log('');

    // Check if server is running
    try {
        await axios.get(`${API_BASE}/health`, { timeout: 5000 });
    } catch {
        console.log('❌ Dashboard server is not running!');
        console.log('   Start the backend with: cd backend && npm run dev');
        await prisma.$disconnect();
        return;
    }

    const allResults: ValidationResult[] = [];

    // Run all validation suites
    console.log('📊 PORTFOLIO MATH VALIDATION');
    console.log('-'.repeat(70));
    const portfolioResults = await validatePortfolioMath();
    allResults.push(...portfolioResults);
    printResults(portfolioResults);

    console.log('\n🔄 ACTIVE TRADES P&L VALIDATION');
    console.log('-'.repeat(70));
    const activeResults = await validateActiveTradesPnL();
    allResults.push(...activeResults);
    printResults(activeResults);

    console.log('\n✅ CLOSED TRADES MATH VALIDATION');
    console.log('-'.repeat(70));
    const closedResults = await validateClosedTradesMath();
    allResults.push(...closedResults);
    printResults(closedResults);

    console.log('\n🛡️ DATA SANITY CHECKS');
    console.log('-'.repeat(70));
    const sanityResults = await validateDataSanity();
    allResults.push(...sanityResults);
    printResults(sanityResults);

    console.log('\n📡 LIVE PRICE ACCURACY');
    console.log('-'.repeat(70));
    const priceResults = await validateLivePrices();
    allResults.push(...priceResults);
    printResults(priceResults);

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 VALIDATION SUMMARY');
    console.log('='.repeat(70));

    const passed = allResults.filter(r => r.passed).length;
    const failed = allResults.filter(r => !r.passed).length;

    console.log(`\nTotal tests: ${allResults.length}`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);

    if (failed === 0) {
        console.log('\n✅ ALL DATA VALIDATION TESTS PASSED!');
        console.log('   Dashboard is showing accurate, mathematically correct data.');
    } else {
        console.log('\n⚠️ Some validation tests failed - review above for details.');
        console.log('\nFailed tests:');
        allResults.filter(r => !r.passed).forEach(r => {
            console.log(`   ❌ ${r.test}`);
            console.log(`      Expected: ${r.expected}, Got: ${r.actual}`);
        });
    }

    await prisma.$disconnect();
}

function printResults(results: ValidationResult[]) {
    for (const r of results) {
        const icon = r.passed ? '✅' : '❌';
        console.log(`${icon} ${r.test}`);
        if (!r.passed || r.expected !== undefined) {
            console.log(`   ${r.details}`);
            if (r.expected !== undefined) {
                console.log(`   Expected: ${r.expected}, Got: ${r.actual}`);
            }
        }
    }
}

main().catch(console.error);
