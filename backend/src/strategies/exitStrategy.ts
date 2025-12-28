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
    takeProfitPct: 0.20,        // Take profit at 20% gain
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
    // Only consider positions with YES shares (our primary side)
    if (position.sharesYes <= 0 || !position.avgEntryYes) {
        return { shouldExit: false, profitPct: 0, reason: 'No YES position' };
    }

    const costBasis = position.costBasisYes;
    const currentValue = position.sharesYes * currentPriceYes;
    const unrealizedProfit = currentValue - costBasis;
    const profitPct = costBasis > 0 ? unrealizedProfit / costBasis : 0;

    if (profitPct >= config.takeProfitPct) {
        return {
            shouldExit: true,
            profitPct,
            reason: `Profit target reached: ${(profitPct * 100).toFixed(1)}% >= ${(config.takeProfitPct * 100).toFixed(1)}%`
        };
    }

    return {
        shouldExit: false,
        profitPct,
        reason: `Profit ${(profitPct * 100).toFixed(1)}% below target ${(config.takeProfitPct * 100).toFixed(1)}%`
    };
}

/**
 * Generate an exit order to take profit.
 */
export function generateExitOrder(
    state: MarketState,
    position: Position,
    tokenIdYes: string
): ProposedOrder | null {
    if (position.sharesYes <= 0) {
        return null;
    }

    const sharesToSell = position.sharesYes;
    const sizeUsdc = sharesToSell * state.lastPriceYes;

    const order: ProposedOrder = {
        marketId: state.marketId,
        tokenId: tokenIdYes,
        side: Side.YES,
        price: state.lastPriceYes,
        sizeUsdc,
        shares: sharesToSell,
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
            sharesToSell,
            sizeUsdc,
            avgEntry: position.avgEntryYes,
            currentPrice: state.lastPriceYes
        }
    });

    return order;
}

export default { shouldTakeProfit, generateExitOrder };
