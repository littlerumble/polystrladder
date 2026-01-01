#!/usr/bin/env npx ts-node
/**
 * Verify Trades and Market Status Script
 * 
 * Cross-checks the provided trade data with:
 * 1. Polymarket API for market resolution status
 * 2. Recalculated PnL values
 * 
 * Usage: npx tsx src/scripts/verifyTradesAndStatus.ts
 */

import axios from 'axios';

interface TradeData {
    marketId: string;
    side: 'YES' | 'NO';
    entryPrice: number;
    currentPrice: number;
    unrealizedPnl: number;
}

interface MarketStatus {
    marketId: string;
    question: string;
    closed: boolean;
    active: boolean;
    resolved: boolean;
    resolutionOutcome: string | null;
    acceptingOrders: boolean;
    endDate: string;
    currentPriceYes: number | null;
    currentPriceNo: number | null;
    tradeSide: 'YES' | 'NO';
    entryPrice: number;
    currentPriceFromData: number;
    unrealizedPnlFromData: number;
    apiCurrentPrice: number | null;
    recalculatedPnl: number | null;
    pnlDifference: number | null;
    shouldBeClosed: boolean;
    closureReason: string;
}

// Trades data from user
const tradesData: TradeData[] = [
    { marketId: '663340', side: 'YES', entryPrice: 0.7107099999999998, currentPrice: 0.675, unrealizedPnl: -6.035492957746442 },
    { marketId: '1056659', side: 'NO', entryPrice: 0.8008000000000001, currentPrice: 0.805, unrealizedPnl: 0.9443700000000206 },
    { marketId: '1028198', side: 'YES', entryPrice: 0.771422217794151, currentPrice: 0.775, unrealizedPnl: 0.6956945050749255 },
    { marketId: '663344', side: 'NO', entryPrice: 0.84084, currentPrice: 0.79, unrealizedPnl: -10.88747963520012 },
    { marketId: '992840', side: 'YES', entryPrice: 0.8198260826427021, currentPrice: 0.805, unrealizedPnl: -3.255354062299233 },
    { marketId: '1038500', side: 'YES', entryPrice: 0.747707904800651, currentPrice: 0.75, unrealizedPnl: 0.4599159183673578 },
    { marketId: '1028204', side: 'NO', entryPrice: 0.7534212968706849, currentPrice: 0.825, unrealizedPnl: 17.10656806431135 },
    { marketId: '1029747', side: 'NO', entryPrice: 0.685, currentPrice: 0.685, unrealizedPnl: -0.04999999999999716 },
    { marketId: '986656', side: 'NO', entryPrice: 0.685, currentPrice: 0.675, unrealizedPnl: -0.7753921253645615 },
    { marketId: '977804', side: 'NO', entryPrice: 0.775775, currentPrice: 0.775, unrealizedPnl: -0.1174033952962219 },
    { marketId: '992822', side: 'YES', entryPrice: 0.8208200000000002, currentPrice: 0.81, unrealizedPnl: -2.308941072568757 },
    { marketId: '986004', side: 'NO', entryPrice: 0.8058050000000002, currentPrice: 0.805, unrealizedPnl: -0.1798799999999972 },
    { marketId: '986673', side: 'NO', entryPrice: 0.7057049999999998, currentPrice: 0.705, unrealizedPnl: -0.1200000000000188 },
    { marketId: '1028166', side: 'YES', entryPrice: 0.7855199929723723, currentPrice: 0.785, unrealizedPnl: -0.1191947665798239 },
    { marketId: '969428', side: 'NO', entryPrice: 0.7257249999999998, currentPrice: 0.73, unrealizedPnl: 0.707586206896508 },
    { marketId: '1060932', side: 'YES', entryPrice: 0.7307299999999999, currentPrice: 0.73, unrealizedPnl: -0.1200000000000188 },
];

async function fetchMarketStatus(marketId: string): Promise<any> {
    try {
        const response = await axios.get(`https://gamma-api.polymarket.com/markets/${marketId}`, {
            timeout: 10000
        });
        return response.data;
    } catch (error: any) {
        console.log(`  ⚠️  Failed to fetch market ${marketId}: ${error.message}`);
        return null;
    }
}

function parseOutcomePrice(marketData: any, side: 'YES' | 'NO'): number | null {
    try {
        if (marketData.outcomePrices) {
            const prices = JSON.parse(marketData.outcomePrices);
            const outcomes = marketData.outcomes ? JSON.parse(marketData.outcomes) : ['Yes', 'No'];

            const sideIndex = outcomes.findIndex((o: string) =>
                o.toLowerCase() === side.toLowerCase()
            );

            if (sideIndex !== -1 && prices[sideIndex] !== undefined) {
                return parseFloat(prices[sideIndex]);
            }

            // Fallback: YES is index 0, NO is index 1
            return side === 'YES' ? parseFloat(prices[0]) : parseFloat(prices[1]);
        }
    } catch (e) {
        // Fallback
    }
    return null;
}

function estimateShares(unrealizedPnl: number, entryPrice: number, currentPrice: number): number {
    // unrealizedPnl = shares * (currentPrice - entryPrice)
    // shares = unrealizedPnl / (currentPrice - entryPrice)
    const priceDiff = currentPrice - entryPrice;
    if (Math.abs(priceDiff) < 0.0001) return 0;
    return Math.abs(unrealizedPnl / priceDiff);
}

async function main() {
    console.log('═'.repeat(80));
    console.log('TRADE VERIFICATION AND MARKET STATUS CHECK');
    console.log(`Time: ${new Date().toISOString()}`);
    console.log('═'.repeat(80));
    console.log();

    const results: MarketStatus[] = [];

    console.log('Checking each market...\n');

    for (const trade of tradesData) {
        console.log('─'.repeat(60));
        console.log(`Market ID: ${trade.marketId} | Side: ${trade.side}`);

        const marketData = await fetchMarketStatus(trade.marketId);

        if (!marketData) {
            console.log('  Market data unavailable - may be deleted or invalid ID');
            console.log();
            continue;
        }

        const question = marketData.question || 'Unknown';
        console.log(`  Question: ${question.substring(0, 70)}${question.length > 70 ? '...' : ''}`);

        // Market status flags
        const closed = marketData.closed === true || marketData.closed === 'true';
        const active = marketData.active === true || marketData.active === 'true';
        const acceptingOrders = marketData.acceptingOrders === true || marketData.acceptingOrders === 'true';

        // Resolution info
        const resolved = closed && !acceptingOrders;
        let resolutionOutcome: string | null = null;

        if (marketData.resolutionOutcome) {
            resolutionOutcome = marketData.resolutionOutcome;
        } else if (closed) {
            // Check if prices are at resolution values (0 or 1)
            const apiPrice = parseOutcomePrice(marketData, trade.side);
            if (apiPrice !== null && (apiPrice >= 0.99 || apiPrice <= 0.01)) {
                resolutionOutcome = apiPrice >= 0.99 ? trade.side : (trade.side === 'YES' ? 'NO' : 'YES');
            }
        }

        console.log(`  Status: closed=${closed}, active=${active}, acceptingOrders=${acceptingOrders}`);
        console.log(`  Resolved: ${resolved}${resolutionOutcome ? ` (Winner: ${resolutionOutcome})` : ''}`);
        console.log(`  End Date: ${marketData.endDate || 'N/A'}`);

        // Get API current price
        const apiCurrentPrice = parseOutcomePrice(marketData, trade.side);
        console.log(`\n  📊 Price Comparison:`);
        console.log(`     Entry Price:        ${(trade.entryPrice * 100).toFixed(2)}¢`);
        console.log(`     Your Current Price: ${(trade.currentPrice * 100).toFixed(2)}¢`);
        console.log(`     API Current Price:  ${apiCurrentPrice !== null ? (apiCurrentPrice * 100).toFixed(2) + '¢' : 'N/A'}`);

        // Estimate shares from PnL
        const estimatedShares = estimateShares(trade.unrealizedPnl, trade.entryPrice, trade.currentPrice);

        // Recalculate PnL with API price
        let recalculatedPnl: number | null = null;
        let pnlDifference: number | null = null;

        if (apiCurrentPrice !== null && estimatedShares > 0) {
            recalculatedPnl = estimatedShares * (apiCurrentPrice - trade.entryPrice);
            pnlDifference = recalculatedPnl - trade.unrealizedPnl;
        }

        console.log(`\n  💰 PnL Analysis:`);
        console.log(`     Estimated Shares:   ${estimatedShares.toFixed(4)}`);
        console.log(`     Your Unrealized PnL: $${trade.unrealizedPnl.toFixed(4)}`);
        if (recalculatedPnl !== null) {
            console.log(`     Recalculated PnL:   $${recalculatedPnl.toFixed(4)} (using API price)`);
            console.log(`     PnL Difference:     $${pnlDifference!.toFixed(4)}`);
        }

        // Determine if this should be closed
        let shouldBeClosed = false;
        let closureReason = 'Market still open';

        if (resolved) {
            shouldBeClosed = true;
            closureReason = `Market resolved${resolutionOutcome ? ` - ${resolutionOutcome} won` : ''}`;
        } else if (closed && !acceptingOrders) {
            shouldBeClosed = true;
            closureReason = 'Market closed and not accepting orders';
        } else if (marketData.endDate) {
            const endDate = new Date(marketData.endDate);
            const now = new Date();
            if (endDate < now) {
                shouldBeClosed = true;
                closureReason = `Market end date passed (${marketData.endDate})`;
            }
        }

        // Result emoji
        const statusEmoji = shouldBeClosed ? '🔴' : '🟢';
        console.log(`\n  ${statusEmoji} Verdict: ${closureReason}`);

        if (shouldBeClosed && resolutionOutcome) {
            const didWin = resolutionOutcome.toUpperCase() === trade.side;
            console.log(`     You held: ${trade.side} → ${didWin ? '✅ WON' : '❌ LOST'}`);
            if (didWin) {
                console.log(`     Expected payout: $${(estimatedShares * (1 - trade.entryPrice)).toFixed(4)} profit`);
            } else {
                console.log(`     Expected loss: $${(estimatedShares * trade.entryPrice).toFixed(4)}`);
            }
        }

        results.push({
            marketId: trade.marketId,
            question: question,
            closed,
            active,
            resolved,
            resolutionOutcome,
            acceptingOrders,
            endDate: marketData.endDate || 'N/A',
            currentPriceYes: parseOutcomePrice(marketData, 'YES'),
            currentPriceNo: parseOutcomePrice(marketData, 'NO'),
            tradeSide: trade.side,
            entryPrice: trade.entryPrice,
            currentPriceFromData: trade.currentPrice,
            unrealizedPnlFromData: trade.unrealizedPnl,
            apiCurrentPrice,
            recalculatedPnl,
            pnlDifference,
            shouldBeClosed,
            closureReason
        });

        console.log();

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('SUMMARY');
    console.log('═'.repeat(80));

    const openMarkets = results.filter(r => !r.shouldBeClosed);
    const shouldBeClosedMarkets = results.filter(r => r.shouldBeClosed);
    const resolvedMarkets = results.filter(r => r.resolved);

    console.log(`\nTotal Positions: ${results.length}`);
    console.log(`Still Open (should remain open): ${openMarkets.length}`);
    console.log(`Should Be Closed: ${shouldBeClosedMarkets.length}`);
    console.log(`Fully Resolved: ${resolvedMarkets.length}`);

    if (shouldBeClosedMarkets.length > 0) {
        console.log('\n⚠️  MARKETS THAT SHOULD BE CLOSED:');
        for (const m of shouldBeClosedMarkets) {
            console.log(`   • ${m.marketId}: ${m.closureReason}`);
            console.log(`     ${m.question.substring(0, 60)}...`);
        }
    }

    if (openMarkets.length > 0) {
        console.log('\n🟢 MARKETS STILL LEGITIMATELY OPEN:');
        for (const m of openMarkets) {
            const priceDiff = m.apiCurrentPrice !== null
                ? ((m.apiCurrentPrice - m.currentPriceFromData) * 100).toFixed(2)
                : 'N/A';
            console.log(`   • ${m.marketId} (${m.tradeSide}): Entry@${(m.entryPrice * 100).toFixed(1)}¢, Now@${m.apiCurrentPrice !== null ? (m.apiCurrentPrice * 100).toFixed(1) : '?'}¢ (diff from your data: ${priceDiff}¢)`);
        }
    }

    // PnL Accuracy Check
    console.log('\n📊 PNL ACCURACY CHECK:');
    const significantDiffs = results.filter(r => r.pnlDifference !== null && Math.abs(r.pnlDifference) > 0.5);
    if (significantDiffs.length > 0) {
        console.log('   Markets with significant PnL differences (>$0.50):');
        for (const m of significantDiffs) {
            console.log(`   • ${m.marketId}: Your PnL: $${m.unrealizedPnlFromData.toFixed(2)}, Recalculated: $${m.recalculatedPnl?.toFixed(2)}, Diff: $${m.pnlDifference?.toFixed(2)}`);
        }
    } else {
        console.log('   ✅ All PnL values are within acceptable tolerance');
    }

    console.log('\n' + '═'.repeat(80));
    console.log('END OF REPORT');
    console.log('═'.repeat(80));
}

main().catch(console.error);
