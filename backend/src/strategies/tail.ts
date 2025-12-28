import { ProposedOrder, Side, StrategyType, MarketState, MarketRegime } from '../core/types.js';
import { configService } from '../config/configService.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Tail Insurance Strategy
 * 
 * Trigger conditions:
 * 1. Regime == LATE_COMPRESSED
 * 2. Opposite side price < tailPriceThreshold (e.g., 0.02)
 * 3. Total exposure > threshold
 * 4. Tail not already active
 * 
 * Order sizing:
 * tailCost = totalExposure * tailExposurePct (0.75%)
 * tailShares = tailCost / tailPrice
 * 
 * This provides massive convexity if an upset occurs.
 */
export function generateTailInsuranceOrder(
    state: MarketState,
    tokenIdNo: string,
    priceNo: number
): ProposedOrder | null {
    const config = configService.getAll();

    // Check trigger conditions
    if (!shouldTriggerTailInsurance(state, priceNo)) {
        return null;
    }

    // Calculate tail cost as percentage of total YES exposure
    const tailCost = state.exposureYes * config.tailExposurePct;

    // Minimum tail cost
    if (tailCost < 1) {
        logger.debug('Tail cost too small, skipping', {
            tailCost,
            exposureYes: state.exposureYes
        });
        return null;
    }

    const tailShares = tailCost / priceNo;

    const order: ProposedOrder = {
        marketId: state.marketId,
        tokenId: tokenIdNo,
        side: Side.NO,
        price: priceNo,
        sizeUsdc: tailCost,
        shares: tailShares,
        strategy: StrategyType.TAIL_INSURANCE,
        strategyDetail: `tail_hedge_at_${priceNo.toFixed(3)}`,
        confidence: 0.95 // High confidence in the hedge value
    };

    logger.strategy('TAIL_TRIGGER', {
        marketId: state.marketId,
        regime: state.regime,
        strategy: 'TAIL_INSURANCE',
        priceYes: state.lastPriceYes,
        priceNo,
        details: {
            tailCost,
            tailShares,
            exposureYes: state.exposureYes,
            convexity: tailShares / tailCost // Potential payout ratio
        }
    });

    return order;
}

/**
 * Check if tail insurance should be triggered.
 */
export function shouldTriggerTailInsurance(
    state: MarketState,
    priceNo: number
): boolean {
    const config = configService.getAll();

    // 1. Must be in LATE_COMPRESSED regime
    if (state.regime !== MarketRegime.LATE_COMPRESSED) {
        return false;
    }

    // 2. Tail price must be very cheap
    if (priceNo >= config.tailPriceThreshold) {
        return false;
    }

    // 3. Must have meaningful YES exposure to hedge
    const minExposureForTail = config.bankroll * 0.01; // At least 1% of bankroll
    if (state.exposureYes < minExposureForTail) {
        return false;
    }

    // 4. Tail not already active
    if (state.tailActive) {
        return false;
    }

    return true;
}

/**
 * Calculate the convexity (potential payout multiplier) of a tail bet.
 */
export function calculateTailConvexity(tailPrice: number): number {
    // At resolution, if NO wins, each share is worth $1
    // Convexity = 1 / tailPrice
    // Example: tailPrice = 0.01 => convexity = 100x
    return 1 / tailPrice;
}

/**
 * Calculate expected value of tail insurance.
 * EV = (probability of upset * (1 - tailPrice)) - (probability of expected * tailPrice)
 * 
 * Since we're buying at very low prices, even a small upset probability
 * can make this positive EV.
 */
export function calculateTailExpectedValue(
    tailPrice: number,
    impliedUpsetProbability: number
): number {
    const payout = 1 - tailPrice; // What we get if NO wins
    const loss = tailPrice;       // What we lose if YES wins

    const ev = (impliedUpsetProbability * payout) - ((1 - impliedUpsetProbability) * loss);
    return ev;
}

/**
 * Mark tail as active for a market.
 */
export function markTailActive(state: MarketState): MarketState {
    return {
        ...state,
        tailActive: true
    };
}

export default generateTailInsuranceOrder;
