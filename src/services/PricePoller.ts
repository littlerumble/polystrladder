/**
 * PricePoller Service
 * 
 * Polls CLOB midpoint API to update live prices for tracked markets.
 * Updates currentPrice on TrackedMarket and PaperTrade records.
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { COPY_CONFIG } from '../config/copyConfig';
import { ClobMidpoint } from '../types/api';

export class PricePoller {
    private prisma: PrismaClient;
    private isRunning = false;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Fetch midpoint price for a token from CLOB
     */
    async fetchPrice(tokenId: string): Promise<number | null> {
        try {
            const url = `${COPY_CONFIG.API.CLOB}/midpoint`;
            const response = await axios.get<ClobMidpoint>(url, {
                params: { token_id: tokenId },
                timeout: 5000,
            });

            const mid = response.data?.mid;
            return mid ? parseFloat(mid) : null;
        } catch (error) {
            // Market may be closed or orderbook empty
            return null;
        }
    }

    /**
     * Update prices for all active tracked markets (sequential to avoid rate limits)
     */
    async updateMarketPrices(): Promise<void> {
        // Get all active markets
        const markets = await this.prisma.trackedMarket.findMany({
            where: {
                isActive: true,
                isClosed: false,
            },
        });

        let updated = 0;
        let failed = 0;

        // Fetch prices sequentially to avoid rate limiting
        for (const market of markets) {
            try {
                const price = await this.fetchPrice(market.tokenId);

                if (price !== null) {
                    await this.prisma.trackedMarket.update({
                        where: { id: market.id },
                        data: {
                            currentPrice: price,
                            lastPriceUpdate: new Date(),
                        },
                    });
                    updated++;
                } else {
                    failed++;
                }
            } catch (error) {
                console.error(`[PricePoller] Error updating ${market.tokenId}:`, error);
                failed++;
            }
        }

        if (markets.length > 0) {
            console.log(`[PricePoller] Updated ${updated}/${markets.length} prices (${failed} failed)`);
        }
    }

    /**
     * Update prices for all open paper trades and calculate P&L (sequential)
     */
    async updateTradePrices(): Promise<void> {
        // Get all open trades with their market data
        const trades = await this.prisma.paperTrade.findMany({
            where: { status: 'OPEN' },
            include: { market: true },
        });

        // Process trades sequentially
        for (const trade of trades) {
            if (!trade.market?.currentPrice) continue;

            const currentPrice = trade.market.currentPrice;

            // Calculate P&L
            const unrealizedPnl = (currentPrice - trade.entryPrice) * trade.shares;
            const unrealizedPct = (unrealizedPnl / trade.costBasis) * 100;

            // Update high water mark for trailing TP
            const newHighWaterMark = Math.max(
                trade.highWaterMark || trade.entryPrice,
                currentPrice
            );

            // Check if trailing should be activated (+12%)
            const profitPct = ((currentPrice - trade.entryPrice) / trade.entryPrice) * 100;
            const shouldActivateTrailing = profitPct >= COPY_CONFIG.TAKE_PROFIT.TRIGGER_PCT;

            await this.prisma.paperTrade.update({
                where: { id: trade.id },
                data: {
                    currentPrice,
                    unrealizedPnl,
                    unrealizedPct,
                    highWaterMark: newHighWaterMark,
                    trailingActive: trade.trailingActive || shouldActivateTrailing,
                },
            });
        }
    }

    /**
     * Run one poll cycle
     */
    async poll(): Promise<void> {
        try {
            await this.updateMarketPrices();
            await this.updateTradePrices();
        } catch (error) {
            console.error('[PricePoller] Error:', error);
        }
    }

    /**
     * Start polling loop
     */
    start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log('[PricePoller] Started...');

        // Initial poll
        this.poll();

        // Set up interval
        setInterval(() => {
            if (this.isRunning) {
                this.poll();
            }
        }, COPY_CONFIG.POLLING.PRICE_UPDATE_MS);
    }

    stop(): void {
        this.isRunning = false;
        console.log('[PricePoller] Stopped.');
    }
}
