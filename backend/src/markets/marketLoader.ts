import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { MarketData } from '../core/types.js';
import { configService } from '../config/configService.js';
import { marketLogger as logger } from '../core/logger.js';
import eventBus from '../core/eventBus.js';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

interface GammaMarket {
    id: string;
    question: string;
    description?: string;
    category?: string;
    subcategory?: string;
    endDate?: string;
    gameStartTime?: string; // When the match/event actually starts
    volume24hr?: number;
    liquidityNum?: number;
    liquidity?: string;
    outcomes?: string;
    clobTokenIds?: string;
    active?: boolean;
    closed?: boolean;
    enableOrderBook?: boolean;
    events?: Array<{
        category?: string;
        subcategory?: string;
    }>;
}

/**
 * Market Loader - Fetches and filters markets from Polymarket Gamma API.
 */
export class MarketLoader {
    private prisma: PrismaClient;
    private refreshInterval: NodeJS.Timeout | null = null;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Fetch all active markets from Gamma API with pagination.
     */
    async fetchMarkets(): Promise<GammaMarket[]> {
        try {
            logger.info('Fetching markets from Gamma API (with pagination)...');

            let allMarkets: GammaMarket[] = [];
            let offset = 0;
            const pageSize = 500;

            while (true) {
                const response = await axios.get<GammaMarket[]>(`${GAMMA_API_BASE}/markets`, {
                    params: {
                        closed: false,
                        active: true,
                        enableOrderBook: true,
                        limit: pageSize,
                        offset: offset,
                        order: 'volume24hr',
                        ascending: false
                    }
                });

                allMarkets = allMarkets.concat(response.data);
                logger.debug(`Fetched page at offset ${offset}: ${response.data.length} markets`);

                if (response.data.length < pageSize) {
                    break; // Last page
                }
                offset += pageSize;

                // Safety limit to prevent infinite loop
                if (offset > 5000) {
                    logger.warn('Reached pagination safety limit of 5000 markets');
                    break;
                }
            }

            logger.info(`Fetched total of ${allMarkets.length} markets from API (${Math.ceil(allMarkets.length / pageSize)} pages)`);
            return allMarkets;
        } catch (error) {
            logger.error('Failed to fetch markets', { error: String(error) });
            throw error;
        }
    }

    /**
     * Filter markets based on configuration criteria.
     */
    filterMarkets(markets: GammaMarket[]): MarketData[] {
        const config = configService.getAll();
        const now = new Date();
        const maxResolutionTime = new Date(now.getTime() + config.maxTimeToResolutionHours * 60 * 60 * 1000);

        const filtered = markets.filter(market => {
            // Must have orderbook enabled
            if (!market.enableOrderBook) return false;

            // Must have CLOB token IDs
            if (!market.clobTokenIds) return false;

            // Must be active and not closed
            if (!market.active || market.closed) return false;

            // Must have end date
            if (!market.endDate) return false;

            const endDate = new Date(market.endDate);

            // Must resolve within max time window
            if (endDate > maxResolutionTime) return false;

            // Must not have already ended
            if (endDate <= now) return false;

            // BONUS: Sports events typically have gameStartTime - log for debugging
            // Don't strictly require it since some sports markets might not have it
            if (market.gameStartTime) {
                logger.debug(`Sports event detected: ${market.question?.substring(0, 40)}... starts at ${market.gameStartTime}`);
            }

            // Check category filters
            const category = market.category || market.events?.[0]?.category || '';
            const subcategory = market.subcategory || market.events?.[0]?.subcategory || '';
            const questionLower = (market.question || '').toLowerCase();
            const descLower = (market.description || '').toLowerCase();
            const eventTitles = (market.events || []).map((e: any) => (e.title || '').toLowerCase()).join(' ');
            const allText = `${questionLower} ${descLower} ${eventTitles}`;

            // CRITICAL: Exclude by checking question/description/event titles (since category is often NULL)
            const hasExcludedTerm = config.excludedCategories.some((exc: string) => {
                const excLower = exc.toLowerCase();
                return allText.includes(excLower) ||
                    category.toLowerCase().includes(excLower) ||
                    subcategory.toLowerCase().includes(excLower);
            });
            if (hasExcludedTerm) {
                logger.debug(`Excluded market (matched excluded term): ${market.question?.substring(0, 50)}...`);
                return false;
            }

            // Include only allowed categories (skip if list is empty or category is null/empty)
            if (config.allowedCategories.length > 0 && category) {
                const inAllowed = config.allowedCategories.some((allowed: string) =>
                    category.toLowerCase().includes(allowed.toLowerCase()) ||
                    subcategory.toLowerCase().includes(allowed.toLowerCase())
                );
                if (!inAllowed) return false;
            }

            // Volume filter
            const volume24h = market.volume24hr || 0;
            if (volume24h < config.minVolume24h) return false;

            // Liquidity filter
            const liquidity = market.liquidityNum || parseFloat(market.liquidity || '0') || 0;
            if (liquidity < config.minLiquidity) return false;

            // Must be binary (2 outcomes)
            try {
                const outcomes = JSON.parse(market.outcomes || '[]');
                if (outcomes.length !== 2) return false;
            } catch {
                return false;
            }

            // MANDATORY: Sports keyword filtering - market MUST match at least one sports keyword
            // This is the PRIMARY filter since categories are always NULL on Polymarket
            const sportsKeywords = config.sportsKeywords || [];
            if (sportsKeywords.length > 0) {
                const questionLower = (market.question || '').toLowerCase();
                const descLower = (market.description || '').toLowerCase();
                const eventTitles = (market.events || []).map((e: any) => (e.title || '').toLowerCase()).join(' ');
                const allSearchText = `${questionLower} ${descLower} ${eventTitles}`;

                const matchedKeyword = sportsKeywords.find((keyword: string) => {
                    const kw = keyword.toLowerCase();
                    return allSearchText.includes(kw);
                });

                if (!matchedKeyword) {
                    // NO sports keyword found - REJECT this market
                    return false;
                }

                logger.debug(`✅ Sports market included: "${market.question?.substring(0, 40)}..." matched keyword: "${matchedKeyword}"`);
            } else {
                // No keywords configured - reject all (fail safe)
                logger.warn('No sportsKeywords configured - rejecting all markets');
                return false;
            }

            return true;
        });

        logger.info(`Filtered to ${filtered.length} eligible markets`, {
            total: markets.length,
            filtered: filtered.length,
            sportsKeywordsCount: (config.sportsKeywords || []).length
        });

        return filtered.map(this.normalizeMarket);
    }

    /**
     * Normalize Gamma API market to internal MarketData format.
     */
    private normalizeMarket(market: GammaMarket): MarketData {
        let outcomes: string[] = [];
        let clobTokenIds: string[] = [];

        try {
            outcomes = JSON.parse(market.outcomes || '["Yes", "No"]');
        } catch {
            outcomes = ['Yes', 'No'];
        }

        try {
            clobTokenIds = JSON.parse(market.clobTokenIds || '[]');
        } catch {
            clobTokenIds = [];
        }

        return {
            marketId: market.id,
            question: market.question,
            description: market.description,
            category: market.category || market.events?.[0]?.category || 'Unknown',
            subcategory: market.subcategory || market.events?.[0]?.subcategory,
            endDate: new Date(market.endDate || Date.now()),
            gameStartTime: market.gameStartTime ? new Date(market.gameStartTime) : undefined,
            volume24h: market.volume24hr || 0,
            liquidity: market.liquidityNum || parseFloat(market.liquidity || '0') || 0,
            outcomes,
            clobTokenIds,
            active: market.active ?? true,
            closed: market.closed ?? false
        };
    }

    /**
     * Calculate profit potential score for a market.
     * Higher score = better opportunity for profit.
     * 
     * Scoring factors:
     * 1. Price in tradeable range (60-85%): Best for ladder strategy
     * 2. Volume 24h: Higher volume = more trading activity
     * 3. Liquidity: Better spreads and execution
     * 4. Time to resolution: Closer = less risk of reversal
     */
    private calculateProfitScore(market: MarketData): number {
        let score = 0;

        // We don't have live prices here, so use volume and liquidity as proxies
        // The actual price filtering happens when strategies run

        // Factor 1: Volume 24h (normalized, max 40 points)
        // Higher volume = more trading activity = more opportunities
        const volumeScore = Math.min(market.volume24h / 100000, 1) * 40;
        score += volumeScore;

        // Factor 2: Liquidity (normalized, max 30 points)
        // Higher liquidity = better price discovery and tighter spreads
        const liquidityScore = Math.min(market.liquidity / 50000, 1) * 30;
        score += liquidityScore;

        // Factor 3: Time to resolution (max 20 points)
        // Closer to resolution = less time for thesis to break
        const now = new Date();
        const hoursToEnd = (market.endDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursToEnd <= 6) {
            score += 20;  // Best: resolves very soon
        } else if (hoursToEnd <= 24) {
            score += 15;  // Good: resolves today
        } else if (hoursToEnd <= 48) {
            score += 10;  // OK: resolves in 2 days
        } else {
            score += 5;   // Acceptable: resolves within 72h
        }

        // Factor 4: Volume/Liquidity ratio (max 10 points)
        // High ratio = active market with good turnover
        if (market.liquidity > 0) {
            const turnover = market.volume24h / market.liquidity;
            const turnoverScore = Math.min(turnover, 10);  // Cap at 10x
            score += turnoverScore;
        }

        return score;
    }

    /**
     * Load markets, filter, and persist to database.
     * Prioritizes markets with best profit potential using a scoring algorithm.
     */
    async loadAndPersistMarkets(): Promise<MarketData[]> {
        const rawMarkets = await this.fetchMarkets();
        let filteredMarkets = this.filterMarkets(rawMarkets);

        // Calculate profit score for each market and select the top N
        const topN = configService.get('topNMarkets') || 10;

        // Score and sort markets by profit potential
        const scoredMarkets = filteredMarkets.map(market => {
            const score = this.calculateProfitScore(market);
            return { market, score };
        });

        scoredMarkets.sort((a, b) => b.score - a.score);

        filteredMarkets = scoredMarkets.slice(0, topN).map(s => s.market);

        logger.info(`Selected top ${filteredMarkets.length} markets by PROFIT POTENTIAL`, {
            topN,
            topScores: scoredMarkets.slice(0, 5).map(s => ({
                question: s.market.question.substring(0, 35),
                score: s.score.toFixed(2)
            }))
        });

        // Persist to database
        for (const market of filteredMarkets) {
            await this.prisma.market.upsert({
                where: { id: market.marketId },
                update: {
                    question: market.question,
                    description: market.description,
                    category: market.category,
                    subcategory: market.subcategory,
                    endDate: market.endDate,
                    gameStartTime: market.gameStartTime,
                    volume24h: market.volume24h,
                    liquidity: market.liquidity,
                    outcomes: JSON.stringify(market.outcomes),
                    clobTokenIds: JSON.stringify(market.clobTokenIds),
                    active: market.active,
                    closed: market.closed
                },
                create: {
                    id: market.marketId,
                    question: market.question,
                    description: market.description,
                    category: market.category,
                    subcategory: market.subcategory,
                    endDate: market.endDate,
                    gameStartTime: market.gameStartTime,
                    volume24h: market.volume24h,
                    liquidity: market.liquidity,
                    outcomes: JSON.stringify(market.outcomes),
                    clobTokenIds: JSON.stringify(market.clobTokenIds),
                    active: market.active,
                    closed: market.closed
                }
            });
        }

        logger.info(`Persisted ${filteredMarkets.length} markets to database`);
        eventBus.emit('market:filtered', filteredMarkets);

        return filteredMarkets;
    }

    /**
     * Start periodic market refresh.
     */
    startPeriodicRefresh(): void {
        const interval = configService.get('marketRefreshIntervalMs');

        this.refreshInterval = setInterval(async () => {
            try {
                await this.loadAndPersistMarkets();
            } catch (error) {
                logger.error('Periodic market refresh failed', { error: String(error) });
            }
        }, interval);

        logger.info(`Started periodic market refresh every ${interval / 1000}s`);
    }

    /**
     * Stop periodic refresh.
     */
    stopPeriodicRefresh(): void {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            logger.info('Stopped periodic market refresh');
        }
    }
}

export default MarketLoader;
