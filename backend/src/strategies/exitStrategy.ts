import { ProposedOrder, Side, StrategyType, MarketState, Position } from '../core/types.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Exit Strategy - Trailing Stop with Safety Cap
 * 
 * TRAILING STOP:
 * - Activates when price > 90%
 * - Tracks highest price seen (high water mark)
 * - Exits when price drops 1% from high water mark
 * 
 * SAFETY CAP:
 * - Always exit at 98% (near resolution, prevent gap risk)
 * 
 * STOP LOSS:
 * - Exit if price < 65%
 */

// Exit thresholds
const TRAILING_ACTIVATION_PRICE = 0.90;  // Activate trailing stop above this
const TRAILING_DISTANCE = 0.01;          // 1% trailing stop distance
const SAFETY_CAP_PRICE = 0.98;           // Always exit at this price (safety)
const STOP_LOSS_PRICE = 0.65;            // Stop loss threshold

export interface ExitCheckResult {
    shouldExit: boolean;
    reason: string;
    isProfit: boolean;
    // Trailing stop state updates
    trailingStopActive?: boolean;
    highWaterMark?: number;
}

/**
 * Check if a position should be exited based on trailing stop logic.
 * 
 * Logic:
 * 1. Price >= 98% → SELL (safety cap)
 * 2. Price < 65% → SELL (stop loss)
 * 3. Price >= 90% → Activate trailing stop, track high water mark
 * 4. Price drops 1% from high → SELL (trailing stop triggered)
 */
export function shouldExit(
    position: Position,
    currentPriceYes: number,
    currentPriceNo: number,
    state?: MarketState  // Optional state for trailing stop tracking
): ExitCheckResult {
    // Determine which side we have a position on
    let currentPrice: number;
    let side: string;

    if (position.sharesYes > 0) {
        currentPrice = currentPriceYes;
        side = 'YES';
    } else if (position.sharesNo > 0) {
        currentPrice = currentPriceNo;
        side = 'NO';
    } else {
        return { shouldExit: false, reason: 'No position', isProfit: false };
    }

    // 1. SAFETY CAP - Always exit at 98%
    if (currentPrice >= SAFETY_CAP_PRICE) {
        return {
            shouldExit: true,
            reason: `🎯 SAFETY CAP: ${side} price ${(currentPrice * 100).toFixed(1)}% >= ${SAFETY_CAP_PRICE * 100}%`,
            isProfit: true
        };
    }

    // 2. STOP LOSS - Exit if price drops below threshold
    if (currentPrice < STOP_LOSS_PRICE) {
        return {
            shouldExit: true,
            reason: `🛑 STOP LOSS: ${side} price ${(currentPrice * 100).toFixed(1)}% < ${STOP_LOSS_PRICE * 100}%`,
            isProfit: false
        };
    }

    // 3. TRAILING STOP LOGIC (requires state)
    if (state) {
        const isTrailingActive = state.trailingStopActive;
        const highWaterMark = state.highWaterMark || 0;

        // Check if we should activate trailing stop
        if (!isTrailingActive && currentPrice >= TRAILING_ACTIVATION_PRICE) {
            // Activate trailing stop - don't exit yet, just track
            logger.info('🚀 TRAILING STOP ACTIVATED', {
                marketId: state.marketId,
                side,
                price: (currentPrice * 100).toFixed(1) + '%',
                trailingDistance: (TRAILING_DISTANCE * 100).toFixed(1) + '%'
            });

            return {
                shouldExit: false,
                reason: 'Trailing stop activated - tracking high',
                isProfit: false,
                trailingStopActive: true,
                highWaterMark: currentPrice
            };
        }

        // If trailing stop is active, check if we should update high water mark or exit
        if (isTrailingActive) {
            // Update high water mark if price is higher
            if (currentPrice > highWaterMark) {
                logger.debug('📈 HIGH WATER MARK UPDATED', {
                    marketId: state.marketId,
                    oldHigh: (highWaterMark * 100).toFixed(1) + '%',
                    newHigh: (currentPrice * 100).toFixed(1) + '%'
                });

                return {
                    shouldExit: false,
                    reason: 'High water mark updated',
                    isProfit: false,
                    trailingStopActive: true,
                    highWaterMark: currentPrice
                };
            }

            // Check if price dropped below trailing stop threshold
            const trailStopPrice = highWaterMark * (1 - TRAILING_DISTANCE);
            if (currentPrice <= trailStopPrice) {
                return {
                    shouldExit: true,
                    reason: `📉 TRAILING STOP: ${side} price ${(currentPrice * 100).toFixed(1)}% dropped 1% from high ${(highWaterMark * 100).toFixed(1)}%`,
                    isProfit: true
                };
            }

            // Still above trailing stop, keep holding
            return {
                shouldExit: false,
                reason: `Holding - price ${(currentPrice * 100).toFixed(1)}% above trail stop ${(trailStopPrice * 100).toFixed(1)}%`,
                isProfit: false,
                trailingStopActive: true,
                highWaterMark: highWaterMark
            };
        }
    }

    // No state provided or trailing not active - use simple threshold check
    // (This is a fallback for the first call before state is available)
    if (currentPrice > TRAILING_ACTIVATION_PRICE) {
        return {
            shouldExit: false,
            reason: 'Price above activation - needs state for trailing stop',
            isProfit: false,
            trailingStopActive: true,
            highWaterMark: currentPrice
        };
    }

    return { shouldExit: false, reason: 'Holding position', isProfit: false };
}

/**
 * Generate an exit order - always 100% of position.
 */
export function generateExitOrder(
    state: MarketState,
    position: Position,
    tokenIdYes: string,
    tokenIdNo: string,
    reason: string = 'full_exit'
): ProposedOrder | null {
    let side: Side;
    let tokenId: string;
    let price: number;
    let shares: number;

    if (position.sharesYes > 0) {
        side = Side.YES;
        tokenId = tokenIdYes;
        price = state.lastPriceYes;
        shares = position.sharesYes;  // Always 100%
    } else if (position.sharesNo > 0) {
        side = Side.NO;
        tokenId = tokenIdNo;
        price = state.lastPriceNo;
        shares = position.sharesNo;  // Always 100%
    } else {
        return null;
    }

    const sizeUsdc = shares * price;

    const order: ProposedOrder = {
        marketId: state.marketId,
        tokenId: tokenId,
        side: side,
        price: price,
        sizeUsdc,
        shares: shares,
        strategy: StrategyType.PROFIT_TAKING,
        strategyDetail: reason,
        confidence: 1.0,
        isExit: true
    };

    logger.strategy('EXIT_TRIGGER', {
        marketId: state.marketId,
        regime: state.regime,
        strategy: 'PROFIT_TAKING',
        priceYes: state.lastPriceYes,
        priceNo: state.lastPriceNo,
        details: {
            reason,
            side,
            sharesToSell: shares.toFixed(4),
            sizeUsdc: sizeUsdc.toFixed(2),
            trailingStopActive: state.trailingStopActive,
            highWaterMark: state.highWaterMark
        }
    });

    return order;
}

export default { shouldExit, generateExitOrder };
