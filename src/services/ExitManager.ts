/**
 * ExitManager Service
 * 
 * Monitors open paper trades and triggers exits based on:
 * - Trailing take profit (+12% trigger, -4% trail)
 * - Stop loss (-12%)
 * - Whale dumps (if whale sells the market)
 * - Time stop (<10 min remaining)
 * - Stagnation (<2% move in 10 min)
 */

import { PrismaClient, PaperTrade, TrackedMarket } from '@prisma/client';
import { COPY_CONFIG } from '../config/copyConfig';
import { ExitSignal } from '../types/api';

type PaperTradeWithMarket = PaperTrade & { market: TrackedMarket };

export class ExitManager {
    private prisma: PrismaClient;
    private isRunning = false;
    private priceHistory: Map<string, { price: number; timestamp: Date }[]> = new Map();

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Record price for stagnation detection
     */
    recordPrice(marketId: string, price: number): void {
        if (!this.priceHistory.has(marketId)) {
            this.priceHistory.set(marketId, []);
        }

        const history = this.priceHistory.get(marketId)!;
        history.push({ price, timestamp: new Date() });

        // Keep only last 15 minutes of data
        const cutoff = new Date(Date.now() - 15 * 60 * 1000);
        this.priceHistory.set(
            marketId,
            history.filter(h => h.timestamp > cutoff)
        );
    }

    /**
     * Check for price stagnation
     */
    isStagnant(marketId: string): boolean {
        const history = this.priceHistory.get(marketId);
        if (!history || history.length < 2) return false;

        const { STAGNATION_MINUTES, STAGNATION_THRESHOLD_PCT } = COPY_CONFIG.EXIT;
        const cutoff = new Date(Date.now() - STAGNATION_MINUTES * 60 * 1000);
        const relevantPrices = history.filter(h => h.timestamp > cutoff);

        if (relevantPrices.length < 2) return false;

        const minPrice = Math.min(...relevantPrices.map(h => h.price));
        const maxPrice = Math.max(...relevantPrices.map(h => h.price));

        const pctRange = ((maxPrice - minPrice) / minPrice) * 100;
        return pctRange < STAGNATION_THRESHOLD_PCT;
    }

    /**
     * Check if a market is an esports market
     */
    isEsports(slug: string): boolean {
        const lowerSlug = slug.toLowerCase();
        return COPY_CONFIG.ESPORTS.SLUG_PATTERNS.some(pattern =>
            lowerSlug.includes(pattern.toLowerCase())
        );
    }

    /**
     * Check all exit conditions for a trade
     */
    async checkExitConditions(trade: PaperTradeWithMarket): Promise<ExitSignal | null> {
        const { currentPrice, entryPrice, highWaterMark, trailingActive } = trade;
        const market = trade.market;

        if (!currentPrice) return null;

        // Record price for stagnation tracking
        this.recordPrice(market.id, currentPrice);

        const profitPct = ((currentPrice - entryPrice) / entryPrice) * 100;
        const isEsports = this.isEsports(market.slug);

        // ESPORTS: Fixed take profit at 14%
        if (isEsports && profitPct >= COPY_CONFIG.ESPORTS.FIXED_TP_PCT) {
            return {
                type: 'TP_FIXED',
                reason: `Esports fixed TP: ${profitPct.toFixed(1)}% >= ${COPY_CONFIG.ESPORTS.FIXED_TP_PCT}%`,
                paperTradeId: trade.id,
                exitPrice: currentPrice,
            };
        }

        // ESPORTS: Wider stop loss at -25%
        if (isEsports && profitPct <= COPY_CONFIG.ESPORTS.STOP_LOSS_PCT) {
            return {
                type: 'STOP_LOSS',
                reason: `Esports stop loss: ${profitPct.toFixed(1)}% <= ${COPY_CONFIG.ESPORTS.STOP_LOSS_PCT}%`,
                paperTradeId: trade.id,
                exitPrice: currentPrice,
            };
        }

        // 1. Hard cap - exit at 95%
        if (currentPrice >= COPY_CONFIG.TAKE_PROFIT.HARD_CAP_PRICE) {
            return {
                type: 'HARD_CAP',
                reason: `Price ${(currentPrice * 100).toFixed(1)}% hit hard cap (95%)`,
                paperTradeId: trade.id,
                exitPrice: currentPrice,
            };
        }

        // 2. Trailing take profit (dynamic: 3% normal, 2% for fast spikes)
        if (trailingActive && highWaterMark) {
            const dropFromPeak = ((highWaterMark - currentPrice) / highWaterMark) * 100;
            const peakProfitPct = ((highWaterMark - entryPrice) / entryPrice) * 100;

            // Detect "fast spike": if we hit 20%+ profit quickly, use tighter 2% trail
            // Otherwise use normal 3% trail
            const isFastSpike = peakProfitPct >= 20; // High profit = likely fast move
            const trailPct = isFastSpike
                ? (COPY_CONFIG.TAKE_PROFIT.TRAIL_PCT_FAST || 2)
                : (COPY_CONFIG.TAKE_PROFIT.TRAIL_PCT || 3);

            if (dropFromPeak >= trailPct) {
                // SAFETY: Only exit if we're still in profit (at least MIN_PROFIT_PCT above entry)
                const minProfitPct = COPY_CONFIG.TAKE_PROFIT.MIN_PROFIT_PCT || 0;
                if (profitPct >= minProfitPct) {
                    return {
                        type: 'TP_TRAIL',
                        reason: `${isFastSpike ? 'Fast spike' : 'Trailing'} stop: ${dropFromPeak.toFixed(1)}% drop from ${(highWaterMark * 100).toFixed(1)}% (trail: ${trailPct}%, profit: ${profitPct.toFixed(1)}%)`,
                        paperTradeId: trade.id,
                        exitPrice: currentPrice,
                    };
                }
                // Else: trailing stop triggered but we're below min profit, hold position
            }
        }

        // 3. Stop loss
        if (profitPct <= COPY_CONFIG.STOP_LOSS.TRIGGER_PCT) {
            return {
                type: 'STOP_LOSS',
                reason: `Stop loss hit: ${profitPct.toFixed(1)}% loss`,
                paperTradeId: trade.id,
                exitPrice: currentPrice,
            };
        }

        // 4. Time stop - check if market is ending soon
        if (market.endDate) {
            const minutesRemaining = (market.endDate.getTime() - Date.now()) / (1000 * 60);

            if (minutesRemaining <= COPY_CONFIG.EXIT.TIME_REMAINING_MINUTES) {
                return {
                    type: 'TIME_STOP',
                    reason: `Time stop: ${Math.floor(minutesRemaining)} min remaining`,
                    paperTradeId: trade.id,
                    exitPrice: currentPrice,
                };
            }
        }

        // 5. Stagnation - only check if trade has been open for at least STAGNATION_MINUTES
        const tradeAgeMinutes = (Date.now() - trade.entryTime.getTime()) / (1000 * 60);
        if (tradeAgeMinutes >= COPY_CONFIG.EXIT.STAGNATION_MINUTES && this.isStagnant(market.id)) {
            return {
                type: 'STAGNATION',
                reason: `Stagnation: <${COPY_CONFIG.EXIT.STAGNATION_THRESHOLD_PCT}% move in ${COPY_CONFIG.EXIT.STAGNATION_MINUTES} min`,
                paperTradeId: trade.id,
                exitPrice: currentPrice,
            };
        }

        return null; // No exit triggered
    }

    /**
     * Execute an exit (close the paper trade)
     */
    async executeExit(trade: PaperTradeWithMarket, signal: ExitSignal): Promise<void> {
        const holdTimeMinutes = Math.floor(
            (Date.now() - trade.entryTime.getTime()) / (1000 * 60)
        );

        const realizedPnl = (signal.exitPrice - trade.entryPrice) * trade.shares;
        const realizedPct = (realizedPnl / trade.costBasis) * 100;

        await this.prisma.paperTrade.update({
            where: { id: trade.id },
            data: {
                exitPrice: signal.exitPrice,
                exitTime: new Date(),
                exitReason: signal.type,
                realizedPnl,
                realizedPct,
                holdTimeMinutes,
                status: 'CLOSED',
                currentPrice: signal.exitPrice,
                unrealizedPnl: 0,
                unrealizedPct: 0,
            },
        });

        const pnlSign = realizedPnl >= 0 ? '+' : '';
        console.log(`[ExitManager] 🚪 EXIT: ${trade.market.title.slice(0, 40)}...`);
        console.log(`  Reason: ${signal.reason}`);
        console.log(`  P&L: ${pnlSign}$${realizedPnl.toFixed(2)} (${pnlSign}${realizedPct.toFixed(1)}%)`);
        console.log(`  Hold time: ${holdTimeMinutes} min`);
    }

    /**
     * Check for whale dumps (whale selling the market)
     */
    async checkWhaleDumps(): Promise<void> {
        // Find markets where whale has sold recently
        const recentSells = await this.prisma.whaleTradeLog.findMany({
            where: {
                side: 'SELL',
                timestamp: {
                    gte: new Date(Date.now() - 60 * 1000), // Last 60 seconds
                },
            },
        });

        for (const sell of recentSells) {
            // Find our open trades in this market
            const trades = await this.prisma.paperTrade.findMany({
                where: {
                    market: { conditionId: sell.conditionId },
                    status: 'OPEN',
                },
                include: { market: true },
            });

            for (const trade of trades) {
                const signal: ExitSignal = {
                    type: 'WHALE_DUMP',
                    reason: `Whale sold at ${(sell.price * 100).toFixed(1)}%`,
                    paperTradeId: trade.id,
                    exitPrice: trade.market.currentPrice || trade.currentPrice,
                };

                await this.executeExit(trade as PaperTradeWithMarket, signal);
            }
        }
    }

    /**
     * Run one exit check cycle
     */
    async poll(): Promise<void> {
        try {
            // Check for whale dumps first (time critical)
            await this.checkWhaleDumps();

            // Get all open trades
            const trades = await this.prisma.paperTrade.findMany({
                where: { status: 'OPEN' },
                include: { market: true },
            });

            for (const trade of trades) {
                const signal = await this.checkExitConditions(trade as PaperTradeWithMarket);

                if (signal) {
                    await this.executeExit(trade as PaperTradeWithMarket, signal);
                }
            }
        } catch (error) {
            console.error('[ExitManager] Error:', error);
        }
    }

    /**
     * Start exit monitoring loop
     */
    start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log('[ExitManager] Started...');

        // Check frequently for exits
        setInterval(() => {
            if (this.isRunning) {
                this.poll();
            }
        }, COPY_CONFIG.POLLING.EXIT_CHECK_MS);
    }

    stop(): void {
        this.isRunning = false;
        console.log('[ExitManager] Stopped.');
    }
}
