import { MarketRegime, StrategyType } from '../core/types.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Strategy Selector - Consensus Detection with Delayed Commitment
 * 
 * Philosophy:
 * - Do NOTHING in uncertain markets (don't straddle, don't guess)
 * - Enter ONLY after directional pressure appears
 * - Ride consensus with confidence-tiered ladder
 * 
 * Mapping:
 * - LATE_COMPRESSED  → LADDER_COMPRESSION (strong consensus, ride it)
 * - MID_CONSENSUS    → LADDER_COMPRESSION (consensus forming, scale in)
 * - HIGH_VOLATILITY  → NONE (too noisy, wait)
 * - EARLY_UNCERTAIN  → NONE (no consensus yet, don't enter)
 */
export function selectStrategy(regime: MarketRegime): StrategyType {
    switch (regime) {
        case MarketRegime.LATE_COMPRESSED:
            // Strong consensus near resolution - ride the wave
            return StrategyType.LADDER_COMPRESSION;

        case MarketRegime.MID_CONSENSUS:
            // Consensus is forming - scale in with ladder
            return StrategyType.LADDER_COMPRESSION;

        case MarketRegime.HIGH_VOLATILITY:
            // Market is swinging - DO NOT ENTER
            // Wait for volatility to settle and consensus to emerge
            logger.info('HIGH_VOLATILITY detected - waiting for consensus');
            return StrategyType.NONE;

        case MarketRegime.EARLY_UNCERTAIN:
            // 50/50 territory - DO NOT ENTER
            // No consensus yet, wait for directional pressure
            logger.info('EARLY_UNCERTAIN detected - waiting for directional pressure');
            return StrategyType.NONE;

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
            return 'Ladder Compression: Confidence-tiered entries as consensus grows';
        case StrategyType.VOLATILITY_ABSORPTION:
            return 'Volatility Absorption: DISABLED - waiting for consensus';
        case StrategyType.TAIL_INSURANCE:
            return 'Tail Insurance: Cheap convexity bet on upset';
        case StrategyType.NONE:
            return 'No action - waiting for consensus to form';
        default:
            return 'Unknown strategy';
    }
}

export default selectStrategy;
