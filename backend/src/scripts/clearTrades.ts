#!/usr/bin/env npx ts-node
/**
 * Clear Trades Script
 * 
 * Clears all trading activity while preserving market data for future use.
 * 
 * Tables CLEARED:
 * - Trade (individual trades)
 * - MarketTrade (trade lifecycle)
 * - Position (current holdings)
 * - MarketState (ladder levels, trailing stops)
 * - PnlSnapshot (portfolio history)
 * - StrategyEvent (debug logs)
 * - PriceHistory (price ticks)
 * 
 * Tables PRESERVED:
 * - Market (market metadata)
 * - BotConfig (bankroll settings)
 * 
 * Usage: npx ts-node src/scripts/clearTrades.ts
 */

import { PrismaClient } from '@prisma/client';

async function clearTrades() {
    const prisma = new PrismaClient();

    console.log('🧹 Clearing trading data...\n');

    try {
        // Delete in order to respect foreign key constraints
        // Child tables first, then parent-related

        console.log('Deleting PnlSnapshot...');
        const pnl = await prisma.pnlSnapshot.deleteMany();
        console.log(`  ✓ Deleted ${pnl.count} records`);

        console.log('Deleting StrategyEvent...');
        const events = await prisma.strategyEvent.deleteMany();
        console.log(`  ✓ Deleted ${events.count} records`);

        console.log('Deleting PriceHistory...');
        const prices = await prisma.priceHistory.deleteMany();
        console.log(`  ✓ Deleted ${prices.count} records`);

        console.log('Deleting Trade...');
        const trades = await prisma.trade.deleteMany();
        console.log(`  ✓ Deleted ${trades.count} records`);

        console.log('Deleting MarketTrade...');
        const marketTrades = await prisma.marketTrade.deleteMany();
        console.log(`  ✓ Deleted ${marketTrades.count} records`);

        console.log('Deleting Position...');
        const positions = await prisma.position.deleteMany();
        console.log(`  ✓ Deleted ${positions.count} records`);

        console.log('Deleting MarketState...');
        const states = await prisma.marketState.deleteMany();
        console.log(`  ✓ Deleted ${states.count} records`);

        // Show what's preserved
        const marketCount = await prisma.market.count();
        const configCount = await prisma.botConfig.count();

        console.log('\n✅ Trading data cleared!\n');
        console.log('📊 Preserved:');
        console.log(`  - ${marketCount} markets`);
        console.log(`  - ${configCount} bot config(s)`);

    } catch (error) {
        console.error('❌ Error clearing trades:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

clearTrades();
