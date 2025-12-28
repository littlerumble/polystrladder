import { ProposedOrder, Side, StrategyType, MarketState } from '../core/types.js';
import { configService } from '../config/configService.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Ladder Compression Strategy
 * 
 * Logic:
 * 1. Iterate configured ladder levels [0.74, 0.81, 0.90, 0.92, 0.97]
 * 2. For each unfilled level where current price >= ladder level:
 *    - Propose a buy order sized as: size = (bankroll * maxExposure) / ladderLevel
 * 3. Mark level as filled after execution
 * 
 * Why it works:
 * - Exposure grows only as certainty grows
 * - Average entry is controlled
 * - No timing risk
 */
export function generateLadderOrders(
    state: MarketState,
    tokenIdYes: string
): ProposedOrder[] {
    const config = configService.getAll();
    const orders: ProposedOrder[] = [];

    const ladderLevels = config.ladderLevels;
    const maxExposure = config.bankroll * config.maxMarketExposurePct;
    const priceYes = state.lastPriceYes;
    const maxBuyPrice = config.maxBuyPrice || 0.80;

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

    for (const ladderLevel of ladderLevels) {
        // Skip if already filled
        if (filledLevels.has(ladderLevel)) {
            continue;
        }

        // Check if price has reached this ladder level (and is still below max)
        if (priceYes >= ladderLevel && priceYes <= maxBuyPrice) {
            // Calculate order size
            // Size decreases as price increases (buy less at higher prices)
            const sizeUsdc = (maxExposure / ladderLevels.length);
            const shares = sizeUsdc / priceYes;

            const order: ProposedOrder = {
                marketId: state.marketId,
                tokenId: tokenIdYes,
                side: Side.YES,
                price: priceYes,
                sizeUsdc,
                shares,
                strategy: StrategyType.LADDER_COMPRESSION,
                strategyDetail: `ladder_${ladderLevel}`,
                confidence: calculateLadderConfidence(ladderLevel, priceYes)
            };

            orders.push(order);

            logger.strategy('LADDER_TRIGGER', {
                marketId: state.marketId,
                regime: state.regime,
                strategy: 'LADDER_COMPRESSION',
                priceYes,
                priceNo: state.lastPriceNo,
                details: { ladderLevel, sizeUsdc, shares }
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
