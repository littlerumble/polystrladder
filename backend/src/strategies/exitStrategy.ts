import { ProposedOrder, Side, StrategyType, MarketState, Position } from '../core/types.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Exit Strategy - Simple Price-Based Exit
 * 
 * TAKE PROFIT: Exit 100% if price > 0.90
 * STOP LOSS: Exit 100% if price < 0.65
 * 
 * No partial exits, no moon bags. All or nothing.
 */

// Exit thresholds
const TAKE_PROFIT_PRICE = 0.90;
const STOP_LOSS_PRICE = 0.65;

export interface ExitCheckResult {
    shouldExit: boolean;
    reason: string;
    isProfit: boolean;
}

/**
 * Check if a position should be exited based on price thresholds.
 * 
 * Exit if:
 * - Price > 0.90 (take profit)
 * - Price < 0.65 (stop loss)
 */
export function shouldExit(
    position: Position,
    currentPriceYes: number,
    currentPriceNo: number
): ExitCheckResult {
    // Check YES position
    if (position.sharesYes > 0) {
        if (currentPriceYes > TAKE_PROFIT_PRICE) {
            return {
                shouldExit: true,
                reason: `💰 TAKE PROFIT: YES price ${(currentPriceYes * 100).toFixed(1)}% > ${TAKE_PROFIT_PRICE * 100}%`,
                isProfit: true
            };
        }
        if (currentPriceYes < STOP_LOSS_PRICE) {
            return {
                shouldExit: true,
                reason: `🛑 STOP LOSS: YES price ${(currentPriceYes * 100).toFixed(1)}% < ${STOP_LOSS_PRICE * 100}%`,
                isProfit: false
            };
        }
    }

    // Check NO position
    if (position.sharesNo > 0) {
        if (currentPriceNo > TAKE_PROFIT_PRICE) {
            return {
                shouldExit: true,
                reason: `💰 TAKE PROFIT: NO price ${(currentPriceNo * 100).toFixed(1)}% > ${TAKE_PROFIT_PRICE * 100}%`,
                isProfit: true
            };
        }
        if (currentPriceNo < STOP_LOSS_PRICE) {
            return {
                shouldExit: true,
                reason: `🛑 STOP LOSS: NO price ${(currentPriceNo * 100).toFixed(1)}% < ${STOP_LOSS_PRICE * 100}%`,
                isProfit: false
            };
        }
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
    reason: string = 'full_exit' // New parameter
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
        strategyDetail: reason, // Use the passed reason
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
            sizeUsdc: sizeUsdc.toFixed(2)
        }
    });

    return order;
}

export default { shouldExit, generateExitOrder };
