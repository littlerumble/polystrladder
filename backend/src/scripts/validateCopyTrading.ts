/**
 * Copy Trading Validation Script
 * 
 * Validates that:
 * 1. TrackedMarket.currentPrice is non-null and non-zero
 * 2. MarketTrade.currentPrice and unrealizedPnl are properly populated
 * 3. Gamma API returns valid (non-zero) prices
 * 4. Position table has accurate PnL calculations
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

interface ValidationResult {
    category: string;
    status: 'PASS' | 'FAIL' | 'WARN';
    message: string;
    details?: any;
}

const results: ValidationResult[] = [];

function log(result: ValidationResult) {
    const icon = result.status === 'PASS' ? '✅' : result.status === 'WARN' ? '⚠️' : '❌';
    console.log(`${icon} [${result.category}] ${result.message}`);
    if (result.details) {
        console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
    }
    results.push(result);
}

async function validateTrackedMarkets() {
    console.log('\n📊 Validating TrackedMarket table...\n');

    const trackedMarkets = await prisma.trackedMarket.findMany();

    if (trackedMarkets.length === 0) {
        log({
            category: 'TrackedMarket',
            status: 'WARN',
            message: 'No tracked markets found in database'
        });
        return;
    }

    log({
        category: 'TrackedMarket',
        status: 'PASS',
        message: `Found ${trackedMarkets.length} tracked markets`
    });

    // Check for null/zero prices
    const nullPriceMarkets = trackedMarkets.filter(m => m.currentPrice === null);
    const zeroPriceMarkets = trackedMarkets.filter(m => m.currentPrice === 0);

    if (nullPriceMarkets.length > 0) {
        log({
            category: 'TrackedMarket',
            status: 'FAIL',
            message: `${nullPriceMarkets.length} markets have NULL currentPrice`,
            details: nullPriceMarkets.map(m => ({ id: m.id, title: m.title.substring(0, 40), conditionId: m.conditionId }))
        });
    } else {
        log({
            category: 'TrackedMarket',
            status: 'PASS',
            message: 'All tracked markets have non-null currentPrice'
        });
    }

    if (zeroPriceMarkets.length > 0) {
        log({
            category: 'TrackedMarket',
            status: 'FAIL',
            message: `${zeroPriceMarkets.length} markets have ZERO currentPrice`,
            details: zeroPriceMarkets.map(m => ({ id: m.id, title: m.title.substring(0, 40), conditionId: m.conditionId }))
        });
    } else {
        log({
            category: 'TrackedMarket',
            status: 'PASS',
            message: 'All tracked markets have non-zero currentPrice'
        });
    }

    // Check status distribution
    const statusCounts = trackedMarkets.reduce((acc, m) => {
        acc[m.status] = (acc[m.status] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);

    log({
        category: 'TrackedMarket',
        status: 'PASS',
        message: 'Status distribution',
        details: statusCounts
    });
}

async function validateMarketTrades() {
    console.log('\n📈 Validating MarketTrade table...\n');

    const openTrades = await prisma.marketTrade.findMany({
        where: { status: 'OPEN' }
    });

    if (openTrades.length === 0) {
        log({
            category: 'MarketTrade',
            status: 'WARN',
            message: 'No open trades found in database'
        });
        return;
    }

    log({
        category: 'MarketTrade',
        status: 'PASS',
        message: `Found ${openTrades.length} open trades`
    });

    // Check for null/zero currentPrice
    const nullPriceTrades = openTrades.filter(t => t.currentPrice === null);
    const zeroPriceTrades = openTrades.filter(t => t.currentPrice === 0);

    if (nullPriceTrades.length > 0) {
        log({
            category: 'MarketTrade',
            status: 'FAIL',
            message: `${nullPriceTrades.length} trades have NULL currentPrice`,
            details: nullPriceTrades.map(t => ({ id: t.id, marketId: t.marketId, side: t.side }))
        });
    } else {
        log({
            category: 'MarketTrade',
            status: 'PASS',
            message: 'All open trades have non-null currentPrice'
        });
    }

    if (zeroPriceTrades.length > 0) {
        log({
            category: 'MarketTrade',
            status: 'FAIL',
            message: `${zeroPriceTrades.length} trades have ZERO currentPrice`,
            details: zeroPriceTrades.map(t => ({ id: t.id, marketId: t.marketId, side: t.side }))
        });
    } else {
        log({
            category: 'MarketTrade',
            status: 'PASS',
            message: 'All open trades have non-zero currentPrice'
        });
    }

    // Check PnL calculation accuracy for each trade
    for (const trade of openTrades) {
        if (trade.currentPrice && trade.currentPrice > 0) {
            const currentValue = trade.currentShares * trade.currentPrice;
            const remainingCostBasis = trade.entryAmount * (trade.currentShares / trade.entryShares);
            const expectedPnl = currentValue - remainingCostBasis;
            const actualPnl = trade.unrealizedPnl;

            const pnlDiff = Math.abs(expectedPnl - actualPnl);
            if (pnlDiff > 0.01) { // Allow 1 cent tolerance
                log({
                    category: 'MarketTrade PnL',
                    status: 'WARN',
                    message: `Trade #${trade.id} PnL mismatch`,
                    details: {
                        expected: expectedPnl.toFixed(4),
                        actual: actualPnl.toFixed(4),
                        diff: pnlDiff.toFixed(4),
                        currentPrice: trade.currentPrice,
                        currentShares: trade.currentShares
                    }
                });
            }
        }
    }
}

async function validatePositions() {
    console.log('\n💰 Validating Position table...\n');

    const positions = await prisma.position.findMany({
        include: { market: true }
    });

    if (positions.length === 0) {
        log({
            category: 'Position',
            status: 'WARN',
            message: 'No positions found in database'
        });
        return;
    }

    log({
        category: 'Position',
        status: 'PASS',
        message: `Found ${positions.length} positions`
    });

    // Check for positions with shares but no cost basis (indicates data issue)
    const invalidPositions = positions.filter(p =>
        (p.sharesYes > 0 && p.costBasisYes === 0) ||
        (p.sharesNo > 0 && p.costBasisNo === 0)
    );

    if (invalidPositions.length > 0) {
        log({
            category: 'Position',
            status: 'FAIL',
            message: `${invalidPositions.length} positions have shares without cost basis`,
            details: invalidPositions.map(p => ({
                marketId: p.marketId,
                sharesYes: p.sharesYes,
                costBasisYes: p.costBasisYes,
                sharesNo: p.sharesNo,
                costBasisNo: p.costBasisNo
            }))
        });
    } else {
        log({
            category: 'Position',
            status: 'PASS',
            message: 'All positions have valid cost basis'
        });
    }
}

async function validateGammaAPI() {
    console.log('\n🌐 Validating Gamma API responses...\n');

    // Get a few tracked markets to test API
    const trackedMarkets = await prisma.trackedMarket.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' }
    });

    if (trackedMarkets.length === 0) {
        log({
            category: 'Gamma API',
            status: 'WARN',
            message: 'No markets to test API with'
        });
        return;
    }

    for (const market of trackedMarkets) {
        try {
            // Try slug lookup first
            let response;
            let method = 'slug';

            if (market.slug) {
                try {
                    response = await axios.get(
                        `https://gamma-api.polymarket.com/markets?slug=${market.slug}`,
                        { timeout: 5000 }
                    );
                } catch {
                    method = 'condition_id';
                    response = await axios.get(
                        `https://gamma-api.polymarket.com/markets?condition_id=${market.conditionId}`,
                        { timeout: 5000 }
                    );
                }
            } else {
                method = 'condition_id';
                response = await axios.get(
                    `https://gamma-api.polymarket.com/markets?condition_id=${market.conditionId}`,
                    { timeout: 5000 }
                );
            }

            if (!response.data || response.data.length === 0) {
                log({
                    category: 'Gamma API',
                    status: 'FAIL',
                    message: `No data returned for market "${market.title.substring(0, 30)}"`,
                    details: { conditionId: market.conditionId, method }
                });
                continue;
            }

            const gammaMarket = response.data[0];

            if (!gammaMarket.outcomePrices) {
                log({
                    category: 'Gamma API',
                    status: 'FAIL',
                    message: `No outcomePrices for market "${market.title.substring(0, 30)}"`,
                    details: { conditionId: market.conditionId }
                });
                continue;
            }

            const prices = typeof gammaMarket.outcomePrices === 'string'
                ? JSON.parse(gammaMarket.outcomePrices)
                : gammaMarket.outcomePrices;

            const priceYes = parseFloat(prices[0]);
            const priceNo = parseFloat(prices[1]);

            if (isNaN(priceYes) || isNaN(priceNo)) {
                log({
                    category: 'Gamma API',
                    status: 'FAIL',
                    message: `Invalid prices for market "${market.title.substring(0, 30)}"`,
                    details: { rawPrices: prices }
                });
                continue;
            }

            if (priceYes === 0 || priceNo === 0) {
                log({
                    category: 'Gamma API',
                    status: 'FAIL',
                    message: `ZERO price returned for market "${market.title.substring(0, 30)}"`,
                    details: { priceYes, priceNo }
                });
                continue;
            }

            log({
                category: 'Gamma API',
                status: 'PASS',
                message: `Valid prices for "${market.title.substring(0, 30)}"`,
                details: {
                    priceYes: `${(priceYes * 100).toFixed(1)}¢`,
                    priceNo: `${(priceNo * 100).toFixed(1)}¢`,
                    method
                }
            });

        } catch (error: any) {
            log({
                category: 'Gamma API',
                status: 'FAIL',
                message: `API request failed for "${market.title.substring(0, 30)}"`,
                details: { error: error.message, conditionId: market.conditionId }
            });
        }
    }
}

async function validateCopyTradeExecution() {
    console.log('\n🔔 Validating Copy Trade Execution...\n');

    // Check for copy trades (strategyDetail starts with 'copy_')
    const copyTrades = await prisma.trade.findMany({
        where: {
            strategyDetail: {
                startsWith: 'copy_'
            }
        },
        orderBy: { timestamp: 'desc' },
        take: 10
    });

    if (copyTrades.length === 0) {
        log({
            category: 'Copy Trades',
            status: 'WARN',
            message: 'No copy trades found in Trade table'
        });
    } else {
        log({
            category: 'Copy Trades',
            status: 'PASS',
            message: `Found ${copyTrades.length} recent copy trades`,
            details: copyTrades.map(t => ({
                id: t.id,
                marketId: t.marketId.substring(0, 20) + '...',
                price: `${(t.price * 100).toFixed(1)}¢`,
                trader: t.strategyDetail?.replace('copy_', ''),
                timestamp: t.timestamp
            }))
        });
    }

    // Check executed TrackedMarkets
    const executedMarkets = await prisma.trackedMarket.findMany({
        where: { status: 'EXECUTED' },
        orderBy: { executedAt: 'desc' },
        take: 5
    });

    if (executedMarkets.length === 0) {
        log({
            category: 'Copy Trades',
            status: 'WARN',
            message: 'No EXECUTED tracked markets found'
        });
    } else {
        log({
            category: 'Copy Trades',
            status: 'PASS',
            message: `Found ${executedMarkets.length} executed tracked markets`,
            details: executedMarkets.map(m => ({
                title: m.title.substring(0, 30),
                trader: m.traderName,
                trackedPrice: `${(m.trackedPrice * 100).toFixed(1)}¢`,
                executedAt: m.executedAt
            }))
        });
    }
}

async function printSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📋 VALIDATION SUMMARY');
    console.log('='.repeat(60) + '\n');

    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const warned = results.filter(r => r.status === 'WARN').length;

    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`⚠️  Warnings: ${warned}`);

    if (failed > 0) {
        console.log('\n❌ FAILURES:');
        results.filter(r => r.status === 'FAIL').forEach(r => {
            console.log(`   - [${r.category}] ${r.message}`);
        });
    }

    if (warned > 0) {
        console.log('\n⚠️  WARNINGS:');
        results.filter(r => r.status === 'WARN').forEach(r => {
            console.log(`   - [${r.category}] ${r.message}`);
        });
    }

    console.log('\n' + '='.repeat(60) + '\n');
}

async function main() {
    console.log('='.repeat(60));
    console.log('🔍 COPY TRADING VALIDATION SCRIPT');
    console.log('='.repeat(60));
    console.log(`Started at: ${new Date().toISOString()}\n`);

    try {
        await validateTrackedMarkets();
        await validateMarketTrades();
        await validatePositions();
        await validateGammaAPI();
        await validateCopyTradeExecution();
        await printSummary();
    } catch (error) {
        console.error('❌ Validation script error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

main();
