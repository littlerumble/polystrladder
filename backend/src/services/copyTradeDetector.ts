/**
 * Copy Trade Detector
 * 
 * Polls tracked traders for BUY signals in our ladder bucket.
 * When detected, emits a signal to trigger our ladder strategy.
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { systemLogger as logger } from '../core/logger.js';
import { configService } from '../config/configService.js';
import eventBus from '../core/eventBus.js';

const DATA_API_BASE = 'https://data-api.polymarket.com';

// Tracked traders
const TRACKED_WALLETS = [
    { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', name: 'RN1' },
    { wallet: '0xc65ca4755436f82d8eb461e65781584b8cadea39', name: 'LOOKINGBACK' },
    { wallet: '0x5350afcd8bd8ceffdf4da32420d6d31be0822fda', name: 'TRADER3' },
    { wallet: '0x5388bc8cb72eb19a3bec0e8f3db6a77f7cd54d5a', name: 'TRADER4' }
];

export interface CopySignal {
    traderName: string;
    traderWallet: string;
    conditionId: string;
    marketSlug: string;
    marketTitle: string;
    outcome: string;
    price: number;
    timestamp: number;
}

interface TradeActivity {
    timestamp: number;
    conditionId: string;
    title: string;
    slug: string;
    outcome: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
}

export class CopyTradeDetector {
    private prisma: PrismaClient;
    private pollInterval: NodeJS.Timeout | null = null;
    private lastSeenTimestamp: Map<string, number> = new Map();
    private enabled: boolean = true;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Start polling tracked traders for copy signals.
     */
    start(): void {
        if (!this.enabled) {
            return;
        }

        logger.info('Copy Trade Detector started');

        // Initial poll
        this.poll();

        // Poll every 2 seconds for fast copy trading
        this.pollInterval = setInterval(() => this.poll(), 2000);
    }

    /**
     * Stop polling.
     */
    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        logger.info('Copy Trade Detector stopped');
    }

    /**
     * Poll all tracked traders for new trades.
     */
    private async poll(): Promise<void> {
        const ladderLevels = configService.get('ladderLevels') as number[] || [0.65, 0.70, 0.75, 0.80];
        const minPrice = Math.min(...ladderLevels);
        const maxPrice = 0.90;

        for (const trader of TRACKED_WALLETS) {
            try {
                const trades = await this.fetchRecentTrades(trader.wallet);

                // Get last seen timestamp for this trader
                const lastSeen = this.lastSeenTimestamp.get(trader.wallet) || 0;

                // Find ALL new BUY trades (recent within 24h)
                const now = Math.floor(Date.now() / 1000);
                const oneDayAgo = now - 86400;

                const newTrades = trades.filter(t =>
                    t.side === 'BUY' &&
                    t.timestamp > lastSeen &&
                    t.timestamp > oneDayAgo
                );



                // Update last seen timestamp
                if (trades.length > 0) {
                    const maxTs = Math.max(...trades.map(t => t.timestamp));
                    this.lastSeenTimestamp.set(trader.wallet, maxTs);
                }

                // Process each new trade
                for (const trade of newTrades) {
                    // Check if already tracked
                    const existing = await this.prisma.trackedMarket.findUnique({
                        where: { conditionId: trade.conditionId }
                    });

                    if (existing) {
                        continue;
                    }

                    // CRITICAL FIX: Fetch CURRENT price. If fails, DO NOT TRADE.
                    const currentPrice = await this.fetchCurrentPrice(trade.conditionId, trade.outcome, trade.slug);

                    if (currentPrice === null) {
                        logger.warn(`⚠️ Could not fetch current price for ${trade.title}, skipping copy trade.`, {
                            conditionId: trade.conditionId,
                            slug: trade.slug
                        });
                        continue;
                    }

                    // Judge based on CURRENT price
                    const priceToCheck = currentPrice;

                    // Judge based on CURRENT price
                    const inRange = priceToCheck >= minPrice && priceToCheck <= maxPrice;
                    const status = inRange ? 'IN_RANGE' : 'WATCHING';

                    // Store in TrackedMarket table
                    await this.prisma.trackedMarket.create({
                        data: {
                            conditionId: trade.conditionId,
                            slug: trade.slug,           // Store slug
                            title: trade.title,
                            outcome: trade.outcome,
                            traderName: trader.name,
                            traderWallet: trader.wallet,
                            trackedPrice: trade.price,     // Original trader entry
                            currentPrice: priceToCheck,    // Current market price
                            status: status,
                            signalTime: new Date(trade.timestamp * 1000),
                            enteredRangeAt: inRange ? new Date() : null
                        }
                    });

                    logger.info(`👁️ Tracked market added: ${status}`, {
                        trader: trader.name,
                        market: trade.title.substring(0, 40),
                        outcome: trade.outcome,
                        traderPrice: `${(trade.price * 100).toFixed(1)}¢`,
                        currentPrice: `${(priceToCheck * 100).toFixed(1)}¢`,
                        inRange
                    });

                    // If in range (CURRENT PRICE), emit copy signal to execute
                    if (inRange) {
                        const signal: CopySignal = {
                            traderName: trader.name,
                            traderWallet: trader.wallet,
                            conditionId: trade.conditionId,
                            marketSlug: trade.slug,
                            marketTitle: trade.title,
                            outcome: trade.outcome,
                            price: priceToCheck, // Use CURRENT price for execution
                            timestamp: trade.timestamp
                        };

                        logger.info('🔔 Copy signal - IN RANGE (Current Price), executing!', {
                            trader: trader.name,
                            market: trade.title.substring(0, 40),
                            price: `${(priceToCheck * 100).toFixed(1)}¢`
                        });

                        eventBus.emit('copy:signal', signal);
                    }
                }

            } catch (error) {
                logger.error('Failed to poll trader', {
                    trader: trader.name,
                    error: String(error)
                });
            }
        }

        // Also check WATCHING markets for price entry into range
        await this.checkWatchingMarkets(minPrice, maxPrice);
    }

    /**
     * Check WATCHING markets for price entry into our range.
     */
    private async checkWatchingMarkets(minPrice: number, maxPrice: number): Promise<void> {
        const watchingMarkets = await this.prisma.trackedMarket.findMany({
            where: { status: 'WATCHING' }
        });

        for (const tracked of watchingMarkets) {
            try {
                // Fetch current price correctly handling outcome
                const currentPrice = await this.fetchCurrentPrice(tracked.conditionId, tracked.outcome, tracked.slug);

                if (currentPrice === null) continue;

                // Update current price
                await this.prisma.trackedMarket.update({
                    where: { id: tracked.id },
                    data: { currentPrice }
                });

                // Check if price entered our range
                if (currentPrice >= minPrice && currentPrice <= maxPrice) {
                    // Update status
                    await this.prisma.trackedMarket.update({
                        where: { id: tracked.id },
                        data: {
                            status: 'IN_RANGE',
                            currentPrice,
                            enteredRangeAt: new Date()
                        }
                    });

                    logger.info('🎯 Tracked market entered range!', {
                        market: tracked.title.substring(0, 40),
                        previousPrice: `${(tracked.trackedPrice * 100).toFixed(1)}¢`,
                        currentPrice: `${(currentPrice * 100).toFixed(1)}¢`
                    });

                    // Emit copy signal
                    const signal: CopySignal = {
                        traderName: tracked.traderName,
                        traderWallet: tracked.traderWallet,
                        conditionId: tracked.conditionId,
                        marketSlug: tracked.slug,
                        marketTitle: tracked.title,
                        outcome: tracked.outcome,
                        price: currentPrice,
                        timestamp: Date.now() / 1000
                    };

                    eventBus.emit('copy:signal', signal);
                }
            } catch (error) {
                // Silently continue on fetch errors
            }
        }
    }

    /**
     * Helper to fetch current price for a specific outcome safely.
     * Uses Gamma Markets/Events API via slug to find the market.
     */
    private async fetchCurrentPrice(conditionId: string, outcome: string, slug?: string): Promise<number | null> {
        try {
            let gammaMarket = null;

            // 1. Try fetching by SLUG (Markets API) - Most precise if slug is Market Slug
            if (slug) {
                try {
                    const response = await axios.get(`https://gamma-api.polymarket.com/markets?slug=${slug}`);
                    if (Array.isArray(response.data) && response.data.length > 0) {
                        // Find specific market if multiple (unlikely for slug) or just take first matching conditionId
                        gammaMarket = response.data.find((m: any) => m.conditionId === conditionId);
                        if (!gammaMarket) gammaMarket = response.data[0]; // Fallback to first if conditionId not found (unlikely)
                    }
                } catch (e) {
                    // Ignore
                }

                // 2. Fallback: Try fetching by SLUG (Events API) - If slug is Event Slug
                if (!gammaMarket) {
                    try {
                        const response = await axios.get(`https://gamma-api.polymarket.com/events?slug=${slug}`);
                        if (Array.isArray(response.data) && response.data.length > 0) {
                            const event = response.data[0];
                            if (event.markets && Array.isArray(event.markets)) {
                                gammaMarket = event.markets.find((m: any) => m.conditionId === conditionId);
                            }
                        }
                    } catch (e) {
                        // Ignore
                    }
                }
            }

            // 3. Fallback: Try fetching by Condition ID directly (Gamma API usually fails this, but keeps it as last resort)
            if (!gammaMarket) {
                try {
                    const response = await axios.get(`https://gamma-api.polymarket.com/markets/${conditionId}`);
                    gammaMarket = response.data;
                } catch (e) {
                    // Fail
                }
            }

            if (!gammaMarket || !gammaMarket.outcomePrices) return null;

            const prices = typeof gammaMarket.outcomePrices === 'string'
                ? JSON.parse(gammaMarket.outcomePrices)
                : gammaMarket.outcomePrices;

            const outcomes = gammaMarket.outcomes && typeof gammaMarket.outcomes === 'string'
                ? JSON.parse(gammaMarket.outcomes)
                : (gammaMarket.outcomes || ['Yes', 'No']);

            // Find index of outcome
            const index = outcomes.findIndex((o: string) => o.toLowerCase() === outcome.toLowerCase());

            if (index !== -1 && prices[index] !== undefined) {
                return parseFloat(prices[index]);
            }

            // Fallback for simple Yes/No if outcomes not found or matching
            if (outcome.toLowerCase() === 'yes' && prices[0] !== undefined) return parseFloat(prices[0]);
            if (outcome.toLowerCase() === 'no' && prices[1] !== undefined) return parseFloat(prices[1]);

            return null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Fetch recent trades from Polymarket API.
     */
    private async fetchRecentTrades(wallet: string): Promise<TradeActivity[]> {
        // Fetch last 5 minutes of activity
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (5 * 60);

        const response = await axios.get(`${DATA_API_BASE}/activity`, {
            params: {
                user: wallet,
                limit: 50,
                startTs: fiveMinutesAgo
            },
            timeout: 10000
        });

        return response.data
            .filter((t: any) => t.type === 'TRADE')
            .map((t: any) => ({
                timestamp: t.timestamp,
                conditionId: t.conditionId,
                title: t.title || 'Unknown Market',
                slug: t.slug || '',
                outcome: t.outcome || 'Unknown',
                side: t.side,
                price: t.price || 0,
                size: t.size || 0
            }));
    }
}

export default CopyTradeDetector;

