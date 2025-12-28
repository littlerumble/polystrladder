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
     * Fetch all active markets from Gamma API.
     */
    async fetchMarkets(): Promise<GammaMarket[]> {
        try {
            logger.info('Fetching markets from Gamma API...');

            const response = await axios.get<GammaMarket[]>(`${GAMMA_API_BASE}/markets`, {
                params: {
                    closed: false,
                    active: true,
                    enableOrderBook: true,
                    limit: 500,
                    order: 'volume24hr',
                    ascending: false
                }
            });

            logger.info(`Fetched ${response.data.length} markets from API`);
            return response.data;
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

            // Check category filters
            const category = market.category || market.events?.[0]?.category || '';
            const subcategory = market.subcategory || market.events?.[0]?.subcategory || '';

            // Exclude certain categories (only if category is not empty)
            if (category && config.excludedCategories.some(exc =>
                category.toLowerCase().includes(exc.toLowerCase()) ||
                subcategory.toLowerCase().includes(exc.toLowerCase())
            )) {
                return false;
            }

            // Include only allowed categories (skip if list is empty or category is null/empty)
            if (config.allowedCategories.length > 0 && category) {
                const inAllowed = config.allowedCategories.some(allowed =>
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

            // Sports keyword filtering - check if question contains sports-related terms
            const sportsKeywords = config.sportsKeywords || [];
            if (sportsKeywords.length > 0) {
                const questionLower = (market.question || '').toLowerCase();
                const descLower = (market.description || '').toLowerCase();
                const hasSportsKeyword = sportsKeywords.some((keyword: string) =>
                    questionLower.includes(keyword.toLowerCase()) ||
                    descLower.includes(keyword.toLowerCase())
                );
                if (!hasSportsKeyword) {
                    return false;
                }
                logger.debug(`Sports market found: ${market.question?.substring(0, 50)}...`);
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
            volume24h: market.volume24hr || 0,
            liquidity: market.liquidityNum || parseFloat(market.liquidity || '0') || 0,
            outcomes,
            clobTokenIds,
            active: market.active ?? true,
            closed: market.closed ?? false
        };
    }

    /**
     * Load markets, filter, and persist to database.
     */
    async loadAndPersistMarkets(): Promise<MarketData[]> {
        const rawMarkets = await this.fetchMarkets();
        let filteredMarkets = this.filterMarkets(rawMarkets);

        // Sort by liquidity (best price discovery first) and take top N
        const topN = configService.get('topNMarkets') || 10;
        filteredMarkets = filteredMarkets
            .sort((a, b) => b.liquidity - a.liquidity)
            .slice(0, topN);

        logger.info(`Selected top ${filteredMarkets.length} markets by liquidity`, {
            topN,
            selected: filteredMarkets.map(m => m.question.substring(0, 40))
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
