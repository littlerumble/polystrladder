import { ProposedOrder, Side, StrategyType, MarketState, Position } from '../core/types.js';
import { configService } from '../config/configService.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Exit Strategy - Profit-taking and position management
 * 
 * Logic:
 * 1. Check if position has unrealized profit >= takeProfitPct (default 20%)
 * 2. If profitable, generate a SELL order to close the position
 * 3. Only exits on YES side (since we primarily buy YES)
 * 
 * Why it works:
 * - Locks in gains before resolution
 * - Frees up capital for new opportunities
 * - Reduces risk of price reversal
 */

export interface ExitConfig {
    takeProfitPct: number;      // e.g., 0.20 = 20% profit
    minHoldTimeMs: number;      // Minimum time to hold before exit
}

const DEFAULT_EXIT_CONFIG: ExitConfig = {
    takeProfitPct: 0.10,        // Take profit at 10% gain
    minHoldTimeMs: 5 * 60 * 1000  // Hold for at least 5 minutes
};

/**
 * Check if a position should be exited for profit.
 */
export function shouldTakeProfit(
    position: Position,
    currentPriceYes: number,
    currentPriceNo: number,
    config: ExitConfig = DEFAULT_EXIT_CONFIG
): { shouldExit: boolean; profitPct: number; reason: string } {
    // Check YES position
    if (position.sharesYes > 0 && position.avgEntryYes) {
        const costBasis = position.costBasisYes;
        const currentValue = position.sharesYes * currentPriceYes;
        const unrealizedProfit = currentValue - costBasis;
        const profitPct = costBasis > 0 ? unrealizedProfit / costBasis : 0;

        if (profitPct >= config.takeProfitPct) {
            return {
                shouldExit: true,
                profitPct,
                reason: `YES Profit target reached: ${(profitPct * 100).toFixed(1)}% >= ${(config.takeProfitPct * 100).toFixed(1)}%`
            };
        }
    }

    // Check NO position
    if (position.sharesNo > 0 && position.avgEntryNo) {
        const costBasis = position.costBasisNo;
        const currentValue = position.sharesNo * currentPriceNo;
        const unrealizedProfit = currentValue - costBasis;
        const profitPct = costBasis > 0 ? unrealizedProfit / costBasis : 0;

        if (profitPct >= config.takeProfitPct) {
            return {
                shouldExit: true,
                profitPct,
                reason: `NO Profit target reached: ${(profitPct * 100).toFixed(1)}% >= ${(config.takeProfitPct * 100).toFixed(1)}%`
            };
        }
    }

    return { shouldExit: false, profitPct: 0, reason: 'No profit target reached' };
}

/**
 * Generate an exit order to take profit.
 */
export function generateExitOrder(
    state: MarketState,
    position: Position,
    tokenIdYes: string,
    tokenIdNo: string
): ProposedOrder | null {
    let side: Side;
    let tokenId: string;
    let price: number;
    let shares: number;

    // Determine which side to sell based on position
    // Prioritize the one with profit if both exist (simplified for now to just pick the largest position or check profit again)
    // For now, we'll check which one triggered the signal effectively by checking shares
    if (position.sharesYes > 0) {
        side = Side.YES;
        tokenId = tokenIdYes;
        price = state.lastPriceYes;
        shares = position.sharesYes;
    } else if (position.sharesNo > 0) {
        side = Side.NO;
        tokenId = tokenIdNo;
        price = state.lastPriceNo;
        shares = position.sharesNo;
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
        strategyDetail: 'take_profit_exit',
        confidence: 1.0,
        isExit: true  // Mark as exit order
    };

    logger.strategy('PROFIT_TAKING', {
        marketId: state.marketId,
        regime: state.regime,
        strategy: 'PROFIT_TAKING',
        priceYes: state.lastPriceYes,
        priceNo: state.lastPriceNo,
        details: {
            side,
            sharesToSell: shares,
            sizeUsdc,
            currentPrice: price
        }
    });

    return order;
}

export default { shouldTakeProfit, generateExitOrder };
