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
const CLOB_API_BASE = 'https://clob.polymarket.com';

// Tracked traders
const TRACKED_WALLETS = [
    { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', name: 'RN1' },
    { wallet: '0xc65ca4755436f82d8eb461e65781584b8cadea39', name: 'LOOKINGBACK' },
    { wallet: '0x5350afcd8bd8ceffdf4da32420d6d31be0822fda', name: 'simonbanza' },
    { wallet: '0x5388bc8cb72eb19a3bec0e8f3db6a77f7cd54d5a', name: 'TeemuTeemuTeemu' },
    { wallet: '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee', name: 'kch123' },
    { wallet: '0x0d3b10b8eac8b089c6e4a695e65d8e044167c46b', name: 'bossoskil' }
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
    strategyType: 'STANDARD' | 'LOTTERY';  // Which copy trade strategy to use
}

interface TradeActivity {
    timestamp: number;
    conditionId: string;
    title: string;
    slug: string;
    tokenId: string;        // CLOB token_id (asset) for real-time prices
    outcomeIndex: number;   // 0 or 1 for YES/NO mapping
    outcome: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
}

export class CopyTradeDetector {
    private prisma: PrismaClient;
    private pollInterval: NodeJS.Timeout | null = null;
    private lastSeenTimestamp: Map<string, number> = new Map();
    private skippedClosedMarkets: Set<string> = new Set();  // Track skipped closed markets
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

        logger.info(`Copy Trade Detector started. Tracking ${TRACKED_WALLETS.length} traders: ${TRACKED_WALLETS.map(t => t.name).join(', ')}`);

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
        // Standard copy trade range (65-90¢)
        const ladderLevels = configService.get('ladderLevels') as number[] || [0.65, 0.70, 0.75, 0.80];
        const standardMinPrice = Math.min(...ladderLevels);
        const standardMaxPrice = 0.90;

        // Lottery copy trade range (0-5¢)
        const lotteryConfig = configService.get('copyTradeLottery') as any;
        const lotteryEnabled = lotteryConfig?.enabled ?? false;
        const lotteryMaxPrice = lotteryConfig?.maxPrice ?? 0.05;

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

                    // CRITICAL FIX: Fetch CURRENT price from CLOB using tokenId. If fails, DO NOT TRADE.
                    const currentPrice = await this.fetchCurrentPriceFromClob(trade.tokenId);

                    if (currentPrice === null) {
                        // Only warn once per market to avoid spam
                        if (!this.skippedClosedMarkets.has(trade.conditionId)) {
                            this.skippedClosedMarkets.add(trade.conditionId);
                            logger.warn(`⚠️ Market closed or no orderbook for ${trade.title}, skipping.`, {
                                slug: trade.slug
                            });
                        }
                        continue;
                    }

                    // Determine which strategy applies based on CURRENT price
                    const priceToCheck = currentPrice;

                    // Check standard range (65-90¢)
                    const inStandardRange = priceToCheck >= standardMinPrice && priceToCheck <= standardMaxPrice;

                    // Check lottery range (0-5¢)
                    const inLotteryRange = lotteryEnabled && priceToCheck > 0 && priceToCheck <= lotteryMaxPrice;

                    const inRange = inStandardRange || inLotteryRange;
                    const strategyType: 'STANDARD' | 'LOTTERY' = inLotteryRange ? 'LOTTERY' : 'STANDARD';
                    const status = inRange ? 'IN_RANGE' : 'WATCHING';

                    // Store in TrackedMarket table with tokenId for CLOB price lookup
                    await this.prisma.trackedMarket.create({
                        data: {
                            conditionId: trade.conditionId,
                            slug: trade.slug,
                            tokenId: trade.tokenId,         // CLOB token for real-time prices
                            outcomeIndex: trade.outcomeIndex, // For YES/NO mapping
                            title: trade.title,
                            outcome: trade.outcome,
                            traderName: trader.name,
                            traderWallet: trader.wallet,
                            trackedPrice: trade.price,
                            currentPrice: priceToCheck,
                            status: status,
                            signalTime: new Date(trade.timestamp * 1000),
                            enteredRangeAt: inRange ? new Date() : null
                        }
                    });

                    logger.info(`👁️ Tracked market added: ${status} (${strategyType})`, {
                        trader: trader.name,
                        market: trade.title.substring(0, 40),
                        outcome: trade.outcome,
                        traderPrice: `${(trade.price * 100).toFixed(1)}¢`,
                        currentPrice: `${(priceToCheck * 100).toFixed(1)}¢`,
                        strategy: strategyType,
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
                            timestamp: trade.timestamp,
                            strategyType: strategyType  // LOTTERY or STANDARD
                        };

                        logger.info(`🔔 Copy signal - ${strategyType} IN RANGE, executing!`, {
                            trader: trader.name,
                            market: trade.title.substring(0, 40),
                            price: `${(priceToCheck * 100).toFixed(1)}¢`,
                            strategy: strategyType
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
        await this.checkWatchingMarkets(standardMinPrice, standardMaxPrice, lotteryEnabled, lotteryMaxPrice);
    }

    /**
     * Check WATCHING markets for price entry into our range.
     */
    private async checkWatchingMarkets(
        standardMinPrice: number,
        standardMaxPrice: number,
        lotteryEnabled: boolean,
        lotteryMaxPrice: number
    ): Promise<void> {
        const watchingMarkets = await this.prisma.trackedMarket.findMany({
            where: { status: 'WATCHING' }
        });

        for (const tracked of watchingMarkets) {
            try {
                // Skip if no tokenId - legacy data without CLOB token
                if (!tracked.tokenId) {
                    continue;
                }

                // CRITICAL: Fetch CURRENT price from CLOB using tokenId
                const currentPrice = await this.fetchCurrentPriceFromClob(tracked.tokenId);

                if (currentPrice === null) { continue; }

                // Update current price
                await this.prisma.trackedMarket.update({
                    where: { id: tracked.id },
                    data: { currentPrice }
                });

                // Check if price entered standard range (65-90¢) or lottery range (0-5¢)
                const inStandardRange = currentPrice >= standardMinPrice && currentPrice <= standardMaxPrice;
                const inLotteryRange = lotteryEnabled && currentPrice > 0 && currentPrice <= lotteryMaxPrice;
                const inRange = inStandardRange || inLotteryRange;

                if (inRange) {
                    const strategyType: 'STANDARD' | 'LOTTERY' = inLotteryRange ? 'LOTTERY' : 'STANDARD';

                    // Update status
                    await this.prisma.trackedMarket.update({
                        where: { id: tracked.id },
                        data: {
                            status: 'IN_RANGE',
                            currentPrice,
                            enteredRangeAt: new Date()
                        }
                    });

                    logger.info(`🎯 Tracked market entered range (${strategyType})!`, {
                        market: tracked.title.substring(0, 40),
                        previousPrice: `${(tracked.trackedPrice * 100).toFixed(1)}¢`,
                        currentPrice: `${(currentPrice * 100).toFixed(1)}¢`,
                        strategy: strategyType
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
                        timestamp: Date.now() / 1000,
                        strategyType: strategyType  // LOTTERY or STANDARD
                    };

                    eventBus.emit('copy:signal', signal);
                }
            } catch (error) {
                // Silently continue on fetch errors
            }
        }
    }

    /**
     * Fetch current price from CLOB orderbook using token_id.
     * Returns null if no orderbook exists (market is closed/resolved).
     * NO FALLBACK - if CLOB fails, we skip this trade entirely.
     */
    private async fetchCurrentPriceFromClob(tokenId: string): Promise<number | null> {
        try {
            const response = await axios.get(`${CLOB_API_BASE}/book`, {
                params: { token_id: tokenId },
                timeout: 5000
            });

            // Check for "No orderbook exists" error - market is closed
            if (response.data?.error) {
                logger.debug('Market orderbook not found (likely closed)', { tokenId });
                return null;
            }

            // Get best bid (highest price a buyer is willing to pay)
            if (response.data?.bids?.length > 0) {
                const bestBid = response.data.bids[response.data.bids.length - 1];
                return parseFloat(bestBid.price);
            }

            // If no bids, try asks
            if (response.data?.asks?.length > 0) {
                const bestAsk = response.data.asks[response.data.asks.length - 1];
                return parseFloat(bestAsk.price);
            }

            // No bids or asks = market likely closed
            return null;
        } catch (error: any) {
            // Network error or timeout - could be temporary, return null to skip
            logger.debug('CLOB price fetch failed', { tokenId, error: String(error) });
            return null;
        }
    }

    /**
     * Fetch recent trades from Polymarket API.
     */
    private async fetchRecentTrades(wallet: string): Promise<TradeActivity[]> {
        // Fetch last 24 hours of activity to catch up on missed trades
        const lookback = Math.floor(Date.now() / 1000) - 86400;

        const response = await axios.get(`${DATA_API_BASE}/activity`, {
            params: {
                user: wallet,
                limit: 50,
                startTs: lookback
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
                tokenId: t.asset || '',          // CLOB token_id for real-time prices
                outcomeIndex: t.outcomeIndex ?? 0, // 0 or 1 for YES/NO mapping
                outcome: t.outcome || 'Unknown',
                side: t.side,
                price: t.price || 0,
                size: t.size || 0
            }));
    }
}

export default CopyTradeDetector;

