import { ProposedOrder, Side, StrategyType, MarketState } from '../core/types.js';
import { configService } from '../config/configService.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Ladder Compression Strategy - Confidence-Tiered Entries
 * 
 * Philosophy:
 * - Minimal exposure early (when consensus is weak)
 * - Real size only after 60%+ (consensus forming)
 * - Heavy size after 75%+ (strong consensus)
 * 
 * Ladder Levels (configurable):
 * - Level 1: 60% → Small position (10% of max exposure)
 * - Level 2: 65% → Small position (15% of max exposure)
 * - Level 3: 70% → Medium position (25% of max exposure)
 * - Level 4: 75% → Large position (25% of max exposure)
 * - Level 5: 80% → Large position (25% of max exposure)
 * 
 * Total: 100% of max exposure spread across levels
 * 
 * Why it works:
 * - No exposure in uncertain markets (55% and below)
 * - Exposure grows ONLY as consensus grows
 * - Heaviest size when confidence is highest
 * - Average entry reflects conviction, not timing
 */

// Confidence weights for each ladder level (must sum to 1.0)
// Lower levels = less capital, higher levels = more capital
const CONFIDENCE_WEIGHTS = [0.10, 0.15, 0.25, 0.25, 0.25];

export function generateLadderOrders(
    state: MarketState,
    tokenIdYes: string
): ProposedOrder[] {
    const config = configService.getAll();
    const orders: ProposedOrder[] = [];

    const ladderLevels: number[] = config.ladderLevels;
    const maxExposure = config.bankroll * config.maxMarketExposurePct;
    const priceYes = state.lastPriceYes;
    const maxBuyPrice = config.maxBuyPrice || 0.85;

    // Don't buy if price is already too high (no upside left)
    if (priceYes > maxBuyPrice) {
        logger.debug('Price too high for ladder entry', {
            marketId: state.marketId,
            priceYes,
            maxBuyPrice
        });
        return orders;
    }

    // Track which levels are already filled
    const filledLevels = new Set(state.ladderFilled);

    for (let i = 0; i < ladderLevels.length; i++) {
        const ladderLevel = ladderLevels[i];

        // Skip if already filled
        if (filledLevels.has(ladderLevel)) {
            continue;
        }

        // Check if price has reached this ladder level (and is still below max)
        if (priceYes >= ladderLevel && priceYes <= maxBuyPrice) {
            // Use confidence-weighted sizing
            // Higher levels get more capital
            const weight = CONFIDENCE_WEIGHTS[i] ?? (1 / ladderLevels.length);
            const sizeUsdc = maxExposure * weight;
            const shares = sizeUsdc / priceYes;

            const order: ProposedOrder = {
                marketId: state.marketId,
                tokenId: tokenIdYes,
                side: Side.YES,
                price: priceYes,
                sizeUsdc,
                shares,
                strategy: StrategyType.LADDER_COMPRESSION,
                strategyDetail: `ladder_${ladderLevel}_weight_${(weight * 100).toFixed(0)}pct`,
                confidence: calculateLadderConfidence(ladderLevel, priceYes)
            };

            orders.push(order);

            logger.strategy('LADDER_TRIGGER', {
                marketId: state.marketId,
                regime: state.regime,
                strategy: 'LADDER_COMPRESSION',
                priceYes,
                priceNo: state.lastPriceNo,
                details: {
                    ladderLevel,
                    sizeUsdc,
                    shares,
                    weight: `${(weight * 100).toFixed(0)}%`,
                    tier: i + 1
                }
            });
        }
    }

    return orders;
}

/**
 * Calculate confidence multiplier for ladder orders.
 * Higher ladder levels = higher confidence in outcome.
 */
function calculateLadderConfidence(ladderLevel: number, currentPrice: number): number {
    // Base confidence from ladder level (higher level = more confident)
    const baseConfidence = ladderLevel;

    // Bonus if price is significantly above ladder level
    const priceBonus = Math.min((currentPrice - ladderLevel) * 2, 0.1);

    return Math.min(baseConfidence + priceBonus, 1.0);
}

/**
 * Get the next unfilled ladder level for a market.
 */
export function getNextLadderLevel(state: MarketState): number | null {
    const config = configService.getAll();
    const filledLevels = new Set(state.ladderFilled);

    for (const level of config.ladderLevels) {
        if (!filledLevels.has(level)) {
            return level;
        }
    }

    return null; // All levels filled
}

/**
 * Check if all ladder levels are filled.
 */
export function isLadderComplete(state: MarketState): boolean {
    const config = configService.getAll();
    return state.ladderFilled.length >= config.ladderLevels.length;
}

/**
 * Mark a ladder level as filled.
 */
export function markLadderFilled(state: MarketState, level: number): MarketState {
    if (!state.ladderFilled.includes(level)) {
        return {
            ...state,
            ladderFilled: [...state.ladderFilled, level]
        };
    }
    return state;
}

export default generateLadderOrders;
