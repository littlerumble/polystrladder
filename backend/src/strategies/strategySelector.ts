import { MarketRegime, StrategyType } from '../core/types.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Strategy Selector - Maps market regime to appropriate strategy.
 * 
 * Mapping:
 * - LATE_COMPRESSED  → LADDER_COMPRESSION (ride the wave)
 * - HIGH_VOLATILITY  → VOLATILITY_ABSORPTION (both sides)
 * - MID_CONSENSUS    → LADDER_COMPRESSION (scaled entries)
 * - EARLY_UNCERTAIN  → VOLATILITY_ABSORPTION (straddle)
 */
export function selectStrategy(regime: MarketRegime): StrategyType {
    switch (regime) {
        case MarketRegime.LATE_COMPRESSED:
            // Market is near resolution with high certainty
            // Use ladder to scale in as price compresses
            return StrategyType.LADDER_COMPRESSION;

        case MarketRegime.HIGH_VOLATILITY:
            // Market is swinging, absorb volatility on both sides
            return StrategyType.VOLATILITY_ABSORPTION;

        case MarketRegime.MID_CONSENSUS:
            // Stable consensus forming, ladder in
            return StrategyType.LADDER_COMPRESSION;

        case MarketRegime.EARLY_UNCERTAIN:
            // High uncertainty, straddle both sides
            return StrategyType.VOLATILITY_ABSORPTION;

        default:
            logger.warn(`Unknown regime: ${regime}, defaulting to NONE`);
            return StrategyType.NONE;
    }
}

/**
 * Check if tail insurance should be considered.
 * Returns true if conditions are favorable for tail hedging.
 */
export function shouldConsiderTailInsurance(
    regime: MarketRegime,
    tailPriceNo: number,
    totalExposureYes: number,
    tailPriceThreshold: number,
    minExposureForTail: number
): boolean {
    // Only consider in late compressed regimes
    if (regime !== MarketRegime.LATE_COMPRESSED) {
        return false;
    }

    // Tail price must be very cheap (< 2%)
    if (tailPriceNo >= tailPriceThreshold) {
        return false;
    }

    // Must have meaningful exposure to hedge
    if (totalExposureYes < minExposureForTail) {
        return false;
    }

    return true;
}

/**
 * Get strategy description for logging.
 */
export function getStrategyDescription(strategy: StrategyType): string {
    switch (strategy) {
        case StrategyType.LADDER_COMPRESSION:
            return 'Ladder Compression: Scaled entries as certainty grows';
        case StrategyType.VOLATILITY_ABSORPTION:
            return 'Volatility Absorption: Both-side positioning';
        case StrategyType.TAIL_INSURANCE:
            return 'Tail Insurance: Cheap convexity bet on upset';
        case StrategyType.NONE:
            return 'No action';
        default:
            return 'Unknown strategy';
    }
}

export default selectStrategy;
