import { MarketRegime } from '../core/types.js';
import { configService } from '../config/configService.js';

interface PricePoint {
    price: number;
    timestamp: Date;
}

/**
 * Calculate standard deviation of prices.
 */
function calculateStdDev(prices: number[]): number {
    if (prices.length < 2) return 0;

    const mean = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const squaredDiffs = prices.map(p => Math.pow(p - mean, 2));
    const variance = squaredDiffs.reduce((sum, sq) => sum + sq, 0) / prices.length;

    return Math.sqrt(variance);
}

/**
 * Regime Classifier - Determines the trading regime for a market.
 * 
 * Classification rules:
 * 1. LATE_COMPRESSED: time < 6h AND max(priceYes, priceNo) > 0.85
 * 2. HIGH_VOLATILITY: stddev(price) > threshold
 * 3. EARLY_UNCERTAIN: price ∈ [0.45, 0.55]
 * 4. MID_CONSENSUS: default
 */
export function classifyRegime(
    timeToResolutionMs: number,
    currentPriceYes: number,
    priceHistory: PricePoint[],
    currentPriceNo?: number  // Optional for symmetric detection
): MarketRegime {
    const config = configService.getAll();
    const lateResolutionMs = config.lateResolutionHours * 60 * 60 * 1000;
    const volatilityWindowMs = config.volatilityWindowMinutes * 60 * 1000;

    // Use max of YES/NO for symmetric detection (strong NO markets count too)
    // If priceNo not provided, assume 1 - priceYes for binary markets
    const effectivePriceNo = currentPriceNo ?? (1 - currentPriceYes);
    const maxPrice = Math.max(currentPriceYes, effectivePriceNo);

    // Check for LATE_COMPRESSED
    // Less than 6 hours to resolution AND price is highly compressed (>0.85)
    if (timeToResolutionMs < lateResolutionMs && maxPrice > config.lateCompressedPriceThreshold) {
        return MarketRegime.LATE_COMPRESSED;
    }

    // Calculate volatility from recent price history
    const now = Date.now();
    const recentPrices = priceHistory
        .filter(p => (now - p.timestamp.getTime()) < volatilityWindowMs)
        .map(p => p.price);

    if (recentPrices.length >= 3) {
        const stddev = calculateStdDev(recentPrices);

        // Check for HIGH_VOLATILITY
        if (stddev > config.volatilityThreshold) {
            return MarketRegime.HIGH_VOLATILITY;
        }
    }

    // Check for EARLY_UNCERTAIN
    // Price is close to 50/50, high uncertainty
    if (currentPriceYes >= config.earlyUncertainPriceMin &&
        currentPriceYes <= config.earlyUncertainPriceMax) {
        return MarketRegime.EARLY_UNCERTAIN;
    }

    // Default to MID_CONSENSUS
    return MarketRegime.MID_CONSENSUS;
}

/**
 * Get human-readable description of a regime.
 */
export function getRegimeDescription(regime: MarketRegime): string {
    switch (regime) {
        case MarketRegime.EARLY_UNCERTAIN:
            return 'Early stage, high uncertainty (50/50 territory)';
        case MarketRegime.MID_CONSENSUS:
            return 'Mid stage, stable consensus forming';
        case MarketRegime.LATE_COMPRESSED:
            return 'Late stage, price compressed near resolution';
        case MarketRegime.HIGH_VOLATILITY:
            return 'High volatility, price swinging significantly';
        default:
            return 'Unknown regime';
    }
}

/**
 * Check if regime transition is significant (for logging).
 */
export function isSignificantTransition(
    oldRegime: MarketRegime,
    newRegime: MarketRegime
): boolean {
    if (oldRegime === newRegime) return false;

    // Transitions to/from HIGH_VOLATILITY are always significant
    if (oldRegime === MarketRegime.HIGH_VOLATILITY ||
        newRegime === MarketRegime.HIGH_VOLATILITY) {
        return true;
    }

    // Transition to LATE_COMPRESSED is significant
    if (newRegime === MarketRegime.LATE_COMPRESSED) {
        return true;
    }

    return true; // All transitions are worth noting
}

export default classifyRegime;
