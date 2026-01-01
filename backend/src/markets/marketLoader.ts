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
    outcomePrices?: string;  // JSON array of prices for each outcome
    clobTokenIds?: string;
    active?: boolean;
    closed?: boolean;
    enableOrderBook?: boolean;
    spread?: number;             // Bid-ask spread
    // Mutually exclusive market group fields
    negRisk?: boolean;           // True = multi-outcome market (only one can win)
    negRiskMarketID?: string;    // Parent group ID for mutually exclusive markets
    groupItemTitle?: string;     // The specific option within the group
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

            // NOTE: negRisk markets are NOT excluded here
            // Instead, we filter to pick the best one per group after this step

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
     * PRIORITIZES MARKETS ENDING SOON - this is the dominant factor!
     * 
     * Scoring factors (max 100 points):
     * 1. Time to resolution: DOMINANT factor (max 50 points)
     *    - 1-3 hours: 50pts (highest priority)
     *    - 3-6 hours: 40pts (high priority) 
     *    - 6-9 hours: 30pts (medium priority)
     *    - 9-12 hours: 20pts (acceptable)
     * 2. Volume 24h: Activity indicator (max 25 points)
     * 3. Liquidity: Execution quality (max 15 points)
     * 4. Volume/Liquidity ratio: Turnover (max 10 points)
     */
    private calculateProfitScore(market: MarketData): number {
        let score = 0;
        const now = new Date();
        const hoursToEnd = (market.endDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        // Factor 1: Time to resolution (max 50 points) - DOMINANT FACTOR
        // Markets ending soonest get highest priority
        if (hoursToEnd <= 3) {
            score += 50;  // 🔥 HIGHEST: Resolves in 1-3 hours
        } else if (hoursToEnd <= 6) {
            score += 40;  // ⚡ HIGH: Resolves in 3-6 hours
        } else if (hoursToEnd <= 9) {
            score += 30;  // 📈 MEDIUM: Resolves in 6-9 hours
        } else if (hoursToEnd <= 12) {
            score += 20;  // ✅ ACCEPTABLE: Resolves in 9-12 hours
        } else {
            score += 5;   // Fallback (shouldn't happen with 12h filter)
        }

        logger.debug(`Market ${market.question.substring(0, 30)}... ends in ${hoursToEnd.toFixed(1)}h, time score: ${score}`);

        // Factor 2: Volume 24h (normalized, max 25 points)
        // Higher volume = more trading activity = more opportunities
        const volumeScore = Math.min(market.volume24h / 100000, 1) * 25;
        score += volumeScore;

        // Factor 3: Liquidity (normalized, max 15 points)
        // Higher liquidity = better price discovery and tighter spreads
        const liquidityScore = Math.min(market.liquidity / 50000, 1) * 15;
        score += liquidityScore;

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
     * Select the BEST market from each negRiskMarketID group.
     * 
     * For multi-outcome markets (negRisk=true), only ONE option can win.
     * Instead of excluding all, we pick the best candidate from each group.
     * 
     * Priority scoring:
     * 1. Highest volume (indicates market confidence)
     * 2. Tightest spread (better execution)
     * 3. Price closest to 0.70-0.85 EV zone (best risk/reward)
     * 4. Higher liquidity
     */
    private selectBestFromNegRiskGroups(markets: MarketData[], rawMarkets: GammaMarket[]): MarketData[] {
        // Build a map of marketId -> raw market data for spread/price info
        const rawMarketMap = new Map<string, GammaMarket>();
        for (const raw of rawMarkets) {
            rawMarketMap.set(raw.id, raw);
        }

        // Separate negRisk and non-negRisk markets
        const nonNegRiskMarkets: MarketData[] = [];
        const negRiskGroups = new Map<string, MarketData[]>();

        for (const market of markets) {
            const raw = rawMarketMap.get(market.marketId);

            if (raw?.negRisk && raw.negRiskMarketID) {
                // Group by negRiskMarketID
                const groupId = raw.negRiskMarketID;
                if (!negRiskGroups.has(groupId)) {
                    negRiskGroups.set(groupId, []);
                }
                negRiskGroups.get(groupId)!.push(market);
            } else {
                // Not a negRisk market, keep as-is
                nonNegRiskMarkets.push(market);
            }
        }

        // For each group, select the best one
        const selectedFromGroups: MarketData[] = [];

        for (const [groupId, groupMarkets] of negRiskGroups) {
            if (groupMarkets.length === 0) continue;

            // Score each market in the group
            const scored = groupMarkets.map(market => {
                const raw = rawMarketMap.get(market.marketId);
                let score = 0;

                // 1. Volume (max 40 points) - higher is better
                score += Math.min(market.volume24h / 100000, 1) * 40;

                // 2. Spread (max 20 points) - tighter (lower) is better
                const spread = raw?.spread ?? 0.05;  // Default to 5% if unknown
                const spreadScore = Math.max(0, 20 - (spread * 200));  // 0% spread = 20pts, 10% spread = 0pts
                score += spreadScore;

                // 3. Price in EV zone 0.70-0.85 (max 25 points)
                // Parse price from raw market
                let price = 0.5;
                if (raw?.outcomePrices) {
                    try {
                        const prices = JSON.parse(raw.outcomePrices);
                        price = parseFloat(prices[0]) || 0.5;  // YES price
                    } catch { }
                }
                // Distance from optimal zone center (0.775)
                const optimalCenter = 0.775;
                const distance = Math.abs(price - optimalCenter);
                // Within 0.70-0.85 is the zone (0.075 from center is edge)
                if (distance <= 0.075) {
                    score += 25;  // In the sweet spot
                } else if (distance <= 0.15) {
                    score += 15;  // Close to sweet spot
                } else if (distance <= 0.25) {
                    score += 5;   // Reasonable
                }

                // 4. Liquidity (max 15 points)
                score += Math.min(market.liquidity / 50000, 1) * 15;

                return { market, score, price };
            });

            // Sort by score descending
            scored.sort((a, b) => b.score - a.score);

            const selected = scored[0];
            selectedFromGroups.push(selected.market);

            logger.info(`📊 NegRisk group selection: ${groupId.substring(0, 16)}...`, {
                groupSize: groupMarkets.length,
                selected: {
                    question: selected.market.question.substring(0, 40),
                    score: selected.score.toFixed(2),
                    price: (selected.price * 100).toFixed(1) + '¢',
                    volume: selected.market.volume24h
                },
                rejected: scored.slice(1).map(s => ({
                    question: s.market.question.substring(0, 30),
                    score: s.score.toFixed(2)
                }))
            });
        }

        const result = [...nonNegRiskMarkets, ...selectedFromGroups];

        if (negRiskGroups.size > 0) {
            logger.info(`NegRisk deduplication: ${markets.length} → ${result.length} markets (${negRiskGroups.size} groups processed)`);
        }

        return result;
    }

    /**
     * Load markets, filter, and persist to database.
     * Prioritizes markets with best profit potential using a scoring algorithm.
     */
    async loadAndPersistMarkets(): Promise<MarketData[]> {
        const rawMarkets = await this.fetchMarkets();
        let filteredMarkets = this.filterMarkets(rawMarkets);

        // CRITICAL: Deduplicate negRisk groups - pick best from each mutually exclusive group
        filteredMarkets = this.selectBestFromNegRiskGroups(filteredMarkets, rawMarkets);

        // Calculate profit score for each market and select the top N
        const topN = configService.get('topNMarkets') || 50;

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
