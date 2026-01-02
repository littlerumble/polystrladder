/**
 * PaperExecutor Service
 * 
 * Simulates trade execution for eligible markets.
 * Creates PaperTrade entries when copy signals are triggered.
 * Handles ladder entries (L1 initial, L2 DCA).
 */

import { PrismaClient, TrackedMarket, PaperTrade } from '@prisma/client';
import { COPY_CONFIG } from '../config/copyConfig';

export class PaperExecutor {
    private prisma: PrismaClient;
    private isRunning = false;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Check if we can open a new position on this market
     */
    async canOpenPosition(market: TrackedMarket): Promise<{ allowed: boolean; reason: string }> {
        // Check if already have max positions in this market
        const existingTrades = await this.prisma.paperTrade.findMany({
            where: {
                marketId: market.id,
                status: 'OPEN',
            },
        });

        const totalInvested = existingTrades.reduce((sum, t) => sum + t.costBasis, 0);

        if (totalInvested >= COPY_CONFIG.POSITION.MAX_PER_MARKET) {
            return { allowed: false, reason: `Max per market reached ($${totalInvested})` };
        }

        // Check total exposure across all markets
        const allOpenTrades = await this.prisma.paperTrade.findMany({
            where: { status: 'OPEN' },
        });

        const totalExposure = allOpenTrades.reduce((sum, t) => sum + t.costBasis, 0);

        if (totalExposure >= COPY_CONFIG.RISK.MAX_EXPOSURE) {
            return { allowed: false, reason: `Max total exposure reached ($${totalExposure})` };
        }

        // Check concurrent markets limit
        const uniqueMarkets = new Set(allOpenTrades.map(t => t.marketId));
        if (uniqueMarkets.size >= COPY_CONFIG.RISK.MAX_CONCURRENT_MARKETS && !uniqueMarkets.has(market.id)) {
            return { allowed: false, reason: `Max concurrent markets reached (${uniqueMarkets.size})` };
        }

        return { allowed: true, reason: 'OK' };
    }

    /**
     * Execute a paper trade (L1 initial entry)
     */
    async executeL1Entry(market: TrackedMarket): Promise<PaperTrade | null> {
        const currentPrice = market.currentPrice ?? market.whalePrice;

        // Only check that current price is still ≤ 85% (within our entry range)
        // We buy even if price moved up from whale entry, as long as still in range
        if (currentPrice > COPY_CONFIG.ENTRY.MAX_PRICE) {
            console.log(`[PaperExecutor] Skip L1: price ${(currentPrice * 100).toFixed(1)}% > ${COPY_CONFIG.ENTRY.MAX_PRICE * 100}% max`);
            return null;
        }

        const { allowed, reason } = await this.canOpenPosition(market);
        if (!allowed) {
            console.log(`[PaperExecutor] Skip L1: ${reason}`);
            return null;
        }

        const costBasis = COPY_CONFIG.POSITION.L1_SIZE;
        const shares = costBasis / currentPrice;

        const trade = await this.prisma.paperTrade.create({
            data: {
                marketId: market.id,
                entryPrice: currentPrice,
                shares,
                costBasis,
                ladderLevel: 1,
                currentPrice,
                unrealizedPnl: 0,
                unrealizedPct: 0,
                status: 'OPEN',
            },
        });

        console.log(`[PaperExecutor] 📈 L1 Entry: ${market.title.slice(0, 40)}...`);
        console.log(`  ${market.outcome} @ ${(currentPrice * 100).toFixed(1)}%, $${costBasis}`);

        return trade;
    }

    /**
     * Execute a L2 DCA entry if conditions met
     */
    async executeL2Entry(market: TrackedMarket, existingTrade: PaperTrade): Promise<PaperTrade | null> {
        const currentPrice = market.currentPrice;
        if (!currentPrice) return null;

        // Only L2 if we don't already have one
        const l2Exists = await this.prisma.paperTrade.findFirst({
            where: {
                marketId: market.id,
                ladderLevel: 2,
                status: 'OPEN',
            },
        });

        if (l2Exists) return null;

        // Check if we're down enough (-5%)
        const pctChange = ((currentPrice - existingTrade.entryPrice) / existingTrade.entryPrice) * 100;

        if (pctChange > COPY_CONFIG.POSITION.L2_TRIGGER_PCT) {
            return null; // Not down enough
        }

        // Price protection: still within entry range
        if (currentPrice < COPY_CONFIG.ENTRY.MIN_PRICE || currentPrice > COPY_CONFIG.ENTRY.MAX_PRICE) {
            return null;
        }

        const { allowed, reason } = await this.canOpenPosition(market);
        if (!allowed) {
            console.log(`[PaperExecutor] Skip L2: ${reason}`);
            return null;
        }

        const costBasis = COPY_CONFIG.POSITION.L2_SIZE;
        const shares = costBasis / currentPrice;

        const trade = await this.prisma.paperTrade.create({
            data: {
                marketId: market.id,
                entryPrice: currentPrice,
                shares,
                costBasis,
                ladderLevel: 2,
                currentPrice,
                unrealizedPnl: 0,
                unrealizedPct: 0,
                status: 'OPEN',
            },
        });

        console.log(`[PaperExecutor] 📉 L2 DCA: ${market.title.slice(0, 40)}...`);
        console.log(`  ${market.outcome} @ ${(currentPrice * 100).toFixed(1)}%, $${costBasis}`);

        return trade;
    }

    /**
     * Check for new entry opportunities
     */
    async checkEntries(): Promise<void> {
        // Find eligible markets that don't have any trades yet
        const eligibleMarkets = await this.prisma.trackedMarket.findMany({
            where: {
                copyEligible: true,
                isActive: true,
                isClosed: false,
            },
            include: {
                paperTrades: {
                    where: { status: 'OPEN' },
                },
            },
        });

        for (const market of eligibleMarkets) {
            if (market.paperTrades.length === 0) {
                // No existing trades - try L1 entry
                await this.executeL1Entry(market);
            } else {
                // Have L1 - check for L2
                const l1Trade = market.paperTrades.find(t => t.ladderLevel === 1);
                if (l1Trade) {
                    await this.executeL2Entry(market, l1Trade);
                }
            }
        }
    }

    /**
     * Run one execution cycle
     */
    async poll(): Promise<void> {
        try {
            await this.checkEntries();
        } catch (error) {
            console.error('[PaperExecutor] Error:', error);
        }
    }

    /**
     * Start execution loop
     */
    start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log('[PaperExecutor] Started...');

        // Check every 5 seconds
        setInterval(() => {
            if (this.isRunning) {
                this.poll();
            }
        }, 5000);
    }

    stop(): void {
        this.isRunning = false;
        console.log('[PaperExecutor] Stopped.');
    }
}
