import { ProposedOrder, Side, StrategyType, MarketState, Position } from '../core/types.js';
import { configService } from '../config/configService.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Exit Strategy - Profit-taking with Moon Bag and Thesis-based Stop Loss
 * 
 * PROFIT TAKING (75/25 Moon Bag Strategy):
 * - At 15% profit: Sell 75% of position (lock in gains)
 * - Keep 25% as "moon bag" (free upside)
 * - Moon bag rules:
 *   - If price goes UP from activation: Hold until resolution
 *   - If price goes DOWN at all: Sell immediately
 * 
 * THESIS-BASED STOP LOSS:
 * - Only triggers if consensus is broken for 10+ minutes
 * - Exits ENTIRE position (including moon bag if active)
 */

export interface ExitCheckResult {
    shouldExit: boolean;
    profitPct: number;
    reason: string;
    isProfit: boolean;
    exitPct: number;  // 0.75 for partial, 1.0 for full
    isMoonBagExit: boolean;
}

/**
 * Check if consensus has broken (price below first ladder level).
 */
export function checkConsensusBreak(
    state: MarketState,
    currentPriceYes: number
): { isBreaking: boolean; updatedState: MarketState } {
    const ladderLevels: number[] = configService.get('ladderLevels') || [0.65, 0.75, 0.85, 0.92, 0.95];
    const firstLadderLevel = ladderLevels[0] || 0.65;
    const consensusBreakMinutes = Number(configService.get('consensusBreakMinutes')) || 10;
    const breakDurationMs = consensusBreakMinutes * 60 * 1000;

    // Only check if we have a position (ladder filled)
    if (state.ladderFilled.length === 0) {
        return { isBreaking: false, updatedState: state };
    }

    const now = new Date();
    let updatedState = { ...state };

    if (currentPriceYes < firstLadderLevel) {
        if (!state.consensusBreakStartTime) {
            updatedState.consensusBreakStartTime = now;
            updatedState.consensusBreakConfirmed = false;
            logger.info('⚠️ Consensus break started - monitoring', {
                marketId: state.marketId,
                currentPrice: currentPriceYes.toFixed(3),
                firstLadder: firstLadderLevel,
                monitoringFor: `${consensusBreakMinutes} minutes`
            });
        } else {
            const breakDuration = now.getTime() - state.consensusBreakStartTime.getTime();
            if (breakDuration >= breakDurationMs) {
                updatedState.consensusBreakConfirmed = true;
                logger.info('🛑 Consensus break CONFIRMED - thesis invalidated', {
                    marketId: state.marketId,
                    currentPrice: currentPriceYes.toFixed(3),
                    brokenFor: `${Math.round(breakDuration / 60000)} minutes`
                });
            }
        }
        return { isBreaking: true, updatedState };
    } else {
        if (state.consensusBreakStartTime) {
            logger.info('✅ Price recovered - consensus intact', {
                marketId: state.marketId,
                currentPrice: currentPriceYes.toFixed(3)
            });
        }
        updatedState.consensusBreakStartTime = undefined;
        updatedState.consensusBreakConfirmed = false;
        return { isBreaking: false, updatedState };
    }
}

/**
 * Check if moon bag should be exited (price dropped from activation).
 */
export function checkMoonBagExit(
    state: MarketState,
    currentPriceYes: number
): { shouldExit: boolean; reason: string } {
    if (!state.moonBagActive || !state.moonBagPriceAtActivation) {
        return { shouldExit: false, reason: '' };
    }

    // If price dropped AT ALL from moon bag activation, exit
    if (currentPriceYes < state.moonBagPriceAtActivation) {
        return {
            shouldExit: true,
            reason: `Moon bag price dropped: ${currentPriceYes.toFixed(3)} < ${state.moonBagPriceAtActivation.toFixed(3)} (activation price)`
        };
    }

    return { shouldExit: false, reason: '' };
}

/**
 * Check if a position should be exited.
 */
export function shouldTakeProfit(
    position: Position,
    currentPriceYes: number,
    currentPriceNo: number,
    consensusBreakConfirmed: boolean = false,
    moonBagActive: boolean = false,
    moonBagPriceAtActivation?: number
): ExitCheckResult {
    const takeProfitPct: number = Number(configService.get('takeProfitPct')) || 0.12;

    // 1. RESOLUTION CHECK - Exit immediately if market is effectively resolved
    // If we hold YES and price > 0.95 (Win) or < 0.05 (Loss)
    if (position.sharesYes > 0) {
        if (currentPriceYes >= 0.95) {
            return {
                shouldExit: true,
                profitPct: 0, // Calculated later
                reason: `🎉 RESOLUTION WIN: Price ${currentPriceYes.toFixed(3)} >= 0.95. Selling for ~$1.00`,
                isProfit: true,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
        if (currentPriceYes <= 0.05) {
            return {
                shouldExit: true,
                profitPct: -1.0,
                reason: `💀 RESOLUTION LOSS: Price ${currentPriceYes.toFixed(3)} <= 0.05. Closing position.`,
                isProfit: false,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
    }
    // If we hold NO and price > 0.95 (Win because NO wins if YES < 0.05) or < 0.05 (Loss)
    // Note: Polymarket prices are YES prices usually. 
    // currentPriceNo should be close to (1 - currentPriceYes).
    if (position.sharesNo > 0) {
        if (currentPriceNo >= 0.95) {
            return {
                shouldExit: true,
                profitPct: 0,
                reason: `🎉 RESOLUTION WIN (NO): Price ${currentPriceNo.toFixed(3)} >= 0.95. Selling for ~$1.00`,
                isProfit: true,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
        if (currentPriceNo <= 0.05) {
            return {
                shouldExit: true,
                profitPct: -1.0,
                reason: `💀 RESOLUTION LOSS (NO): Price ${currentPriceNo.toFixed(3)} <= 0.05. Closing position.`,
                isProfit: false,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
    }

    // Check for moon bag exit first (price dropped)
    if (moonBagActive && moonBagPriceAtActivation) {
        if (currentPriceYes < moonBagPriceAtActivation) {
            const costBasis = position.costBasisYes;
            const currentValue = position.sharesYes * currentPriceYes;
            const profitPct = costBasis > 0 ? (currentValue - costBasis) / costBasis : 0;

            return {
                shouldExit: true,
                profitPct,
                reason: `🌙 MOON BAG EXIT: Price dropped from ${moonBagPriceAtActivation.toFixed(3)} to ${currentPriceYes.toFixed(3)}`,
                isProfit: profitPct > 0,
                exitPct: 1.0,  // Full exit of remaining moon bag
                isMoonBagExit: true
            };
        }
        // Moon bag active and price is UP - hold until resolution
        return { shouldExit: false, profitPct: 0, reason: 'Moon bag holding - price up', isProfit: false, exitPct: 0, isMoonBagExit: false };
    }

    // Check YES position for initial profit taking
    if (position.sharesYes > 0 && position.costBasisYes > 0) {
        const costBasis = position.costBasisYes;
        const currentValue = position.sharesYes * currentPriceYes;
        const unrealizedProfit = currentValue - costBasis;
        const profitPct = unrealizedProfit / costBasis;

        // Profit taking - sell 75%, keep 25% moon bag
        if (profitPct >= takeProfitPct && !moonBagActive) {
            return {
                shouldExit: true,
                profitPct,
                reason: `Profit target reached: ${(profitPct * 100).toFixed(1)}% >= ${(takeProfitPct * 100).toFixed(1)}% - Selling 75%, keeping 25% moon bag`,
                isProfit: true,
                exitPct: 0.75,  // Partial exit
                isMoonBagExit: false
            };
        }

        // Thesis stop - full exit
        if (consensusBreakConfirmed) {
            return {
                shouldExit: true,
                profitPct,
                reason: `THESIS STOP: Consensus broken for 10+ minutes. P&L: ${(profitPct * 100).toFixed(1)}%`,
                isProfit: false,
                exitPct: 1.0,  // Full exit
                isMoonBagExit: false
            };
        }
    }

    // Check NO position
    if (position.sharesNo > 0 && position.costBasisNo > 0 && !moonBagActive) {
        const costBasis = position.costBasisNo;
        const currentValue = position.sharesNo * currentPriceNo;
        const unrealizedProfit = currentValue - costBasis;
        const profitPct = unrealizedProfit / costBasis;

        if (profitPct >= takeProfitPct) {
            return {
                shouldExit: true,
                profitPct,
                reason: `NO Profit target: ${(profitPct * 100).toFixed(1)}% - Selling 75%`,
                isProfit: true,
                exitPct: 0.75,
                isMoonBagExit: false
            };
        }
    }

    return { shouldExit: false, profitPct: 0, reason: 'No exit trigger', isProfit: false, exitPct: 0, isMoonBagExit: false };
}

/**
 * Generate an exit order.
 * exitPct: 0.75 for partial (moon bag creation), 1.0 for full exit
 */
export function generateExitOrder(
    state: MarketState,
    position: Position,
    tokenIdYes: string,
    tokenIdNo: string,
    exitPct: number = 1.0
): ProposedOrder | null {
    let side: Side;
    let tokenId: string;
    let price: number;
    let shares: number;

    if (position.sharesYes > 0) {
        side = Side.YES;
        tokenId = tokenIdYes;
        price = state.lastPriceYes;
        shares = position.sharesYes * exitPct;  // Partial or full
    } else if (position.sharesNo > 0) {
        side = Side.NO;
        tokenId = tokenIdNo;
        price = state.lastPriceNo;
        shares = position.sharesNo * exitPct;
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
        strategyDetail: exitPct < 1.0 ? 'partial_exit_75pct' : 'full_exit',
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
            side,
            exitPct: `${(exitPct * 100).toFixed(0)}%`,
            sharesToSell: shares.toFixed(4),
            sizeUsdc: sizeUsdc.toFixed(2),
            keepingMoonBag: exitPct < 1.0
        }
    });

    return order;
}

export default { shouldTakeProfit, generateExitOrder, checkConsensusBreak, checkMoonBagExit };
