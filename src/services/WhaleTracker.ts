/**
 * WhaleTracker Service
 * 
 * Polls the whale's trades and creates TrackedMarket entries.
 * Determines copy eligibility based on strategy rules.
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { COPY_CONFIG } from '../config/copyConfig';
import { WhaleTrade, GammaMarket, ParsedGammaMarket, CopySignal, ClobMarket } from '../types/api';

export class WhaleTracker {
    private prisma: PrismaClient;
    private isRunning = false;
    private lastProcessedTimestamp: Map<string, number> = new Map();
    private gameStartTimeCache: Map<string, Date | null> = new Map();

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Fetch CLOB market to get game_start_time
     */
    async fetchClobMarket(conditionId: string): Promise<ClobMarket | null> {
        try {
            const url = `${COPY_CONFIG.API.CLOB}/markets/${conditionId}`;
            const response = await axios.get<ClobMarket>(url, { timeout: 5000 });
            return response.data;
        } catch (error) {
            return null;
        }
    }

    /**
     * Check if a game is currently LIVE (game_start_time < now)
     */
    async isGameLive(conditionId: string): Promise<{ isLive: boolean; gameStartTime: Date | null; reason: string }> {
        // Check cache first
        if (this.gameStartTimeCache.has(conditionId)) {
            const cachedStartTime = this.gameStartTimeCache.get(conditionId);
            if (cachedStartTime) {
                const isLive = cachedStartTime <= new Date();
                return {
                    isLive,
                    gameStartTime: cachedStartTime,
                    reason: isLive ? 'LIVE' : `PRE-GAME (starts ${cachedStartTime.toISOString()})`,
                };
            }
        }

        // Fetch from CLOB
        const market = await this.fetchClobMarket(conditionId);

        if (!market) {
            return { isLive: true, gameStartTime: null, reason: 'LIVE (no CLOB data)' };
        }

        if (!market.game_start_time) {
            // Non-sports market, treat as live
            return { isLive: true, gameStartTime: null, reason: 'LIVE (no game_start_time)' };
        }

        const gameStartTime = new Date(market.game_start_time);
        this.gameStartTimeCache.set(conditionId, gameStartTime);

        const now = new Date();
        const isLive = gameStartTime <= now;

        if (!isLive) {
            const minUntilStart = Math.floor((gameStartTime.getTime() - now.getTime()) / 60000);
            return {
                isLive: false,
                gameStartTime,
                reason: `PRE-GAME (starts in ${minUntilStart} min)`,
            };
        }

        return { isLive: true, gameStartTime, reason: 'LIVE' };
    }

    /**
     * Fetch recent trades from the whale
     */
    /**
     * Fetch recent trades from the whale
     */
    async fetchWhaleTrades(address: string, limit = 50): Promise<WhaleTrade[]> {
        const url = `${COPY_CONFIG.API.DATA}/trades`;
        const response = await axios.get<WhaleTrade[]>(url, {
            params: {
                user: address,
                limit,
            },
        });
        return response.data;
    }

    /**
     * Fetch market data by slug from Gamma API
     */
    async fetchMarketBySlug(slug: string): Promise<ParsedGammaMarket | null> {
        try {
            const url = `${COPY_CONFIG.API.GAMMA}/markets`;
            const response = await axios.get<GammaMarket[]>(url, {
                params: { slug },
            });

            if (!response.data || response.data.length === 0) {
                return null;
            }

            const market = response.data[0];
            return this.parseGammaMarket(market);
        } catch (error) {
            console.error(`Error fetching market ${slug}:`, error);
            return null;
        }
    }

    /**
     * Parse Gamma market JSON strings into arrays
     */
    private parseGammaMarket(market: GammaMarket): ParsedGammaMarket {
        return {
            id: market.id,
            conditionId: market.conditionId,
            slug: market.slug,
            question: market.question,
            outcomes: JSON.parse(market.outcomes || '[]'),
            outcomePrices: JSON.parse(market.outcomePrices || '[]').map(Number),
            clobTokenIds: JSON.parse(market.clobTokenIds || '[]'),
            endDate: market.endDate ? new Date(market.endDate) : null,
            active: market.active,
            closed: market.closed,
        };
    }

    /**
     * Evaluate if a whale trade is eligible for copying
     */
    evaluateCopyEligibility(trade: WhaleTrade): CopySignal {
        const { ENTRY, IGNORE } = COPY_CONFIG;

        // Check if it's a buy
        if (trade.side !== 'BUY') {
            return {
                type: 'INELIGIBLE',
                reason: `SKIP: Side is ${trade.side}, not BUY`,
                trade,
            };
        }

        // Check price range (entry band)
        if (trade.price < ENTRY.MIN_PRICE) {
            return {
                type: 'INELIGIBLE',
                reason: `SKIP: Price ${(trade.price * 100).toFixed(1)}% < ${ENTRY.MIN_PRICE * 100}% min`,
                trade,
            };
        }

        if (trade.price > ENTRY.MAX_PRICE) {
            return {
                type: 'INELIGIBLE',
                reason: `SKIP: Price ${(trade.price * 100).toFixed(1)}% > ${ENTRY.MAX_PRICE * 100}% max`,
                trade,
            };
        }

        // Check minimum trade size (conviction filter)
        if (trade.size * trade.price < ENTRY.MIN_WHALE_SIZE) {
            return {
                type: 'INELIGIBLE',
                reason: `SKIP: Trade size $${(trade.size * trade.price).toFixed(2)} < $${ENTRY.MIN_WHALE_SIZE} min`,
                trade,
            };
        }

        // Check ignored slug patterns (esports etc.)
        for (const pattern of IGNORE.SLUG_PATTERNS) {
            if (trade.slug.toLowerCase().includes(pattern)) {
                return {
                    type: 'INELIGIBLE',
                    reason: `SKIP: Slug matches ignore pattern "${pattern}"`,
                    trade,
                };
            }
        }

        // Check outcome filter if specified
        if (COPY_CONFIG.OUTCOME_FILTER && !COPY_CONFIG.OUTCOME_FILTER.includes(trade.outcome)) {
            return {
                type: 'INELIGIBLE',
                reason: `SKIP: Outcome "${trade.outcome}" not in allowed list`,
                trade,
            };
        }

        // All checks passed!
        return {
            type: 'ELIGIBLE',
            reason: `ELIGIBLE: ${trade.outcome} at ${(trade.price * 100).toFixed(1)}%`,
            trade,
        };
    }

    /**
     * Process a whale trade - log it and create/update TrackedMarket
     */
    async processTrade(trade: WhaleTrade): Promise<void> {
        // Check if we've already processed this trade
        const existing = await this.prisma.whaleTradeLog.findUnique({
            where: { txHash: trade.transactionHash },
        });

        if (existing) {
            return; // Already processed
        }

        // Log the trade
        await this.prisma.whaleTradeLog.create({
            data: {
                conditionId: trade.conditionId,
                tokenId: trade.asset,
                slug: trade.slug,
                title: trade.title,
                outcome: trade.outcome,
                outcomeIndex: trade.outcomeIndex,
                side: trade.side,
                price: trade.price,
                size: trade.size,
                timestamp: new Date(trade.timestamp * 1000),
                txHash: trade.transactionHash,
                processed: false,
            },
        });

        // Evaluate basic eligibility first
        let signal = this.evaluateCopyEligibility(trade);

        // If passed basic checks, also check if game is LIVE
        if (signal.type === 'ELIGIBLE' && COPY_CONFIG.ENTRY.LIVE_ONLY) {
            const liveCheck = await this.isGameLive(trade.conditionId);

            if (!liveCheck.isLive) {
                signal = {
                    type: 'INELIGIBLE',
                    reason: `SKIP: ${liveCheck.reason}`,
                    trade,
                };
            } else {
                // Update reason to show it's live
                signal.reason = `ELIGIBLE: ${trade.outcome} at ${(trade.price * 100).toFixed(1)}% (${liveCheck.reason})`;
            }
        }

        // Check if we're already tracking this specific TOKEN (outcome)
        // Important: Use tokenId, not conditionId, because a single market has 2 tokens (Yes/No)
        let trackedMarket = await this.prisma.trackedMarket.findUnique({
            where: { tokenId: trade.asset },
        });

        if (!trackedMarket) {
            // Create new tracked market
            trackedMarket = await this.prisma.trackedMarket.create({
                data: {
                    conditionId: trade.conditionId,
                    slug: trade.slug,
                    eventSlug: trade.eventSlug,
                    title: trade.title,
                    tokenId: trade.asset,
                    outcome: trade.outcome,
                    outcomeIndex: trade.outcomeIndex,
                    whalePrice: trade.price,
                    whaleSize: trade.size,
                    whaleSide: trade.side,
                    whaleTimestamp: new Date(trade.timestamp * 1000),
                    whaleTxHash: trade.transactionHash,
                    copierAddress: trade.proxyWallet,
                    copierName: COPY_CONFIG.WHALE_NAMES[trade.proxyWallet] || trade.proxyWallet.slice(0, 8),
                    currentPrice: trade.price,
                    lastPriceUpdate: new Date(),
                    copyEligible: signal.type === 'ELIGIBLE',
                    copyReason: signal.reason,
                },
            });

            console.log(`[WhaleTracker] New market: ${trade.title.slice(0, 50)}...`);
            console.log(`  ${signal.reason}`);
        } else {
            // Market exists - update whale info if this is a new trade
            // Only update if whale is adding to position
            if (trade.side === 'BUY') {
                await this.prisma.trackedMarket.update({
                    where: { id: trackedMarket.id },
                    data: {
                        whaleSize: trackedMarket.whaleSize + trade.size,
                        // Update eligibility based on latest price
                        copyEligible: signal.type === 'ELIGIBLE',
                        copyReason: signal.reason,
                        // Ensure copier info is set if missing (for existing records)
                        copierAddress: trade.proxyWallet,
                        copierName: COPY_CONFIG.WHALE_NAMES[trade.proxyWallet] || trade.proxyWallet.slice(0, 8),
                    },
                });
                console.log(`[WhaleTracker] Updated market: ${trade.title.slice(0, 50)}...`);
            }
        }

        // Mark trade as processed
        await this.prisma.whaleTradeLog.update({
            where: { txHash: trade.transactionHash },
            data: { processed: true, processedAt: new Date() },
        });
    }

    /**
     * Poll for new trades and process them
     */
    async poll(): Promise<void> {
        try {
            for (const address of COPY_CONFIG.WHALE_ADDRESSES) {
                // Get last processed timestamp for this whale, default to 0
                const lastProcessed = this.lastProcessedTimestamp.get(address) || 0;

                const trades = await this.fetchWhaleTrades(address, 20);

                // Process newest first (they come sorted by timestamp desc)
                let maxTimestamp = lastProcessed;

                for (const trade of trades) {
                    // Skip if we've already processed trades up to this timestamp
                    if (trade.timestamp <= lastProcessed) {
                        continue;
                    }

                    await this.processTrade(trade);

                    if (trade.timestamp > maxTimestamp) {
                        maxTimestamp = trade.timestamp;
                    }
                }

                // Update last processed timestamp for this whale
                this.lastProcessedTimestamp.set(address, maxTimestamp);
            }
        } catch (error) {
            console.error('[WhaleTracker] Poll error:', error);
        }
    }

    /**
     * Backfill missing copier info for existing markets
     * Assumes "Unknown" markets belong to the Original Whale (first address)
     */
    async backfillCopierInfo(): Promise<void> {
        try {
            const originalWhale = COPY_CONFIG.WHALE_ADDRESSES[0];
            const originalName = COPY_CONFIG.WHALE_NAMES[originalWhale];

            // Update TrackedMarkets where copierAddress is null
            const result = await this.prisma.trackedMarket.updateMany({
                where: {
                    copierAddress: null,
                },
                data: {
                    copierAddress: originalWhale,
                    copierName: originalName,
                },
            });

            if (result.count > 0) {
                console.log(`[WhaleTracker] Backfilled ${result.count} markets with original whale info.`);
            }
        } catch (error) {
            console.error('[WhaleTracker] Backfill error:', error);
        }
    }

    /**
     * Start polling loop
     */
    start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        console.log('[WhaleTracker] Started polling...');

        // Run backfill once on start
        this.backfillCopierInfo();

        // Initial poll
        this.poll();

        // Set up interval
        setInterval(() => {
            if (this.isRunning) {
                this.poll();
            }
        }, COPY_CONFIG.POLLING.WHALE_TRADES_MS);
    }

    /**
     * Stop polling
     */
    stop(): void {
        this.isRunning = false;
        console.log('[WhaleTracker] Stopped.');
    }
}
