/**
 * Sharkbot Copy Trading Bot - Main Entry Point
 * 
 * Paper trading simulation that tracks a whale's trades on Polymarket.
 */

import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { WhaleTracker } from './services/WhaleTracker';
import { PricePoller } from './services/PricePoller';
import { PaperExecutor } from './services/PaperExecutor';
import { ExitManager } from './services/ExitManager';
import { startDashboardServer } from './api/dashboardServer';
import { COPY_CONFIG } from './config/copyConfig';

// Load environment variables
dotenv.config();

// Initialize Prisma
const prisma = new PrismaClient();

// Initialize services
const whaleTracker = new WhaleTracker(prisma);
const pricePoller = new PricePoller(prisma);
const paperExecutor = new PaperExecutor(prisma);
const exitManager = new ExitManager(prisma);

async function main() {
    console.log('🦈 Sharkbot Copy Trading Bot');
    console.log('============================');
    console.log(`Target: ${COPY_CONFIG.WHALE_ADDRESS}`);
    console.log(`Entry range: ${COPY_CONFIG.ENTRY.MIN_PRICE * 100}% - ${COPY_CONFIG.ENTRY.MAX_PRICE * 100}%`);
    console.log(`Position size: L1=$${COPY_CONFIG.POSITION.L1_SIZE}, L2=$${COPY_CONFIG.POSITION.L2_SIZE}`);
    console.log(`Max exposure: $${COPY_CONFIG.RISK.MAX_EXPOSURE}`);
    console.log('');

    try {
        // Test database connection
        await prisma.$connect();
        console.log('✅ Database connected');

        // Start services
        whaleTracker.start();
        pricePoller.start();
        paperExecutor.start();
        exitManager.start();

        // Start dashboard API server
        const port = parseInt(process.env.PORT || '3001');
        startDashboardServer(prisma, port);

        console.log('');
        console.log('🚀 Bot is running! Press Ctrl+C to stop.');

    } catch (error) {
        console.error('❌ Startup error:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');

    whaleTracker.stop();
    pricePoller.stop();
    paperExecutor.stop();
    exitManager.stop();

    await prisma.$disconnect();
    process.exit(0);
});

// Start the bot
main();
