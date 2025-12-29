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
 * Now checks the correct price based on which side we hold.
 */
export function checkConsensusBreak(
    state: MarketState,
    currentPriceYes: number,
    currentPriceNo: number,
    positionSide: 'YES' | 'NO' | null
): { isBreaking: boolean; updatedState: MarketState } {
    const ladderLevels: number[] = configService.get('ladderLevels') || [0.65, 0.75, 0.85, 0.92, 0.95];
    const firstLadderLevel = ladderLevels[0] || 0.65;
    const consensusBreakMinutes = Number(configService.get('consensusBreakMinutes')) || 10;
    const breakDurationMs = consensusBreakMinutes * 60 * 1000;

    // Only check if we have a position (ladder filled)
    if (state.ladderFilled.length === 0 || !positionSide) {
        return { isBreaking: false, updatedState: state };
    }

    // CRITICAL: Check the correct price based on which side we hold
    const priceToCheck = positionSide === 'YES' ? currentPriceYes : currentPriceNo;

    const now = new Date();
    let updatedState = { ...state };

    if (priceToCheck < firstLadderLevel) {
        if (!state.consensusBreakStartTime) {
            updatedState.consensusBreakStartTime = now;
            updatedState.consensusBreakConfirmed = false;
            logger.info('⚠️ Consensus break started - monitoring', {
                marketId: state.marketId,
                side: positionSide,
                currentPrice: priceToCheck.toFixed(3),
                firstLadder: firstLadderLevel,
                monitoringFor: `${consensusBreakMinutes} minutes`
            });
        } else {
            const breakDuration = now.getTime() - state.consensusBreakStartTime.getTime();
            if (breakDuration >= breakDurationMs) {
                updatedState.consensusBreakConfirmed = true;
                logger.info('🛑 Consensus break CONFIRMED - thesis invalidated', {
                    marketId: state.marketId,
                    side: positionSide,
                    currentPrice: priceToCheck.toFixed(3),
                    brokenFor: `${Math.round(breakDuration / 60000)} minutes`
                });
            }
        }
        return { isBreaking: true, updatedState };
    } else {
        if (state.consensusBreakStartTime) {
            logger.info('✅ Price recovered - consensus intact', {
                marketId: state.marketId,
                side: positionSide,
                currentPrice: priceToCheck.toFixed(3)
            });
        }
        updatedState.consensusBreakStartTime = undefined;
        updatedState.consensusBreakConfirmed = false;
        return { isBreaking: false, updatedState };
    }
}

/**
 * Check if moon bag should be exited (price dropped below 65%).
 * Now checks the correct price based on which side we hold.
 */
// NOTE: checkMoonBagExit function removed - moon bags no longer used

/**
 * Pre-game stop loss check.
 * - If price drops below 60% (first ladder): EXIT immediately
 * - After exit: 10 minute cooldown before re-entry is allowed
 * - Re-entry only allowed at 70%+ (L2)
 * - Works for BOTH YES and NO positions
 */
export function checkPreGameStopLoss(
    state: MarketState,
    currentPriceYes: number,
    currentPriceNo: number,
    positionSide: 'YES' | 'NO' | null,
    gameStartTime?: Date
): { shouldExit: boolean; updatedState: MarketState; reason: string } {
    const ladderLevels: number[] = configService.get('ladderLevels') || [0.60, 0.70, 0.80, 0.90, 0.95];
    const firstLadder = ladderLevels[0] || 0.60;
    const secondLadder = ladderLevels[1] || 0.70;
    const COOLDOWN_MINUTES = 10;

    let updatedState = { ...state };
    const now = new Date();

    // Only apply pre-game (before match starts)
    const isPreGame = !gameStartTime || now < gameStartTime;
    if (!isPreGame) {
        return { shouldExit: false, updatedState, reason: 'Game is live - using regular stop loss' };
    }

    // Need a position to check
    if (!positionSide) {
        return { shouldExit: false, updatedState, reason: '' };
    }

    // Check if in cooldown
    if (state.cooldownUntil && now < state.cooldownUntil) {
        const priceToCheck = positionSide === 'YES' ? currentPriceYes : currentPriceNo;
        if (priceToCheck >= secondLadder) {
            logger.info('📈 Cooldown: Price recovered to L2 (' + (priceToCheck * 100).toFixed(1) + '%), re-entry will be allowed after cooldown expires');
        }
        return {
            shouldExit: false,
            updatedState,
            reason: `In cooldown until ${state.cooldownUntil.toISOString().slice(11, 19)} - no trading`
        };
    }

    // Check if price is below first ladder (60%) for OUR position side
    const priceToCheck = positionSide === 'YES' ? currentPriceYes : currentPriceNo;
    if (priceToCheck < firstLadder) {
        // STOP LOSS TRIGGERED
        updatedState.stopLossTriggeredAt = now;
        updatedState.cooldownUntil = new Date(now.getTime() + COOLDOWN_MINUTES * 60 * 1000);

        // Clear ladder filled so we can re-enter at L2 after cooldown
        updatedState.ladderFilled = [];

        logger.info('🛑 PRE-GAME STOP LOSS triggered', {
            marketId: state.marketId,
            side: positionSide,
            price: (priceToCheck * 100).toFixed(1) + '%',
            firstLadder: (firstLadder * 100).toFixed(0) + '%',
            cooldownUntil: updatedState.cooldownUntil.toISOString()
        });

        return {
            shouldExit: true,
            updatedState,
            reason: `PRE-GAME STOP (${positionSide}): Price ${(priceToCheck * 100).toFixed(1)}% < ${(firstLadder * 100).toFixed(0)}% (first ladder). Cooldown for ${COOLDOWN_MINUTES} min.`
        };
    }

    return { shouldExit: false, updatedState, reason: '' };
}

/**
 * Check if a position should be exited.
 * Exit conditions:
 * 1. Price >= 0.90 (resolution imminent)
 * 2. Profit >= 14% (profit target)
 * 3. Consensus break confirmed (thesis stop)
 */
export function shouldTakeProfit(
    position: Position,
    currentPriceYes: number,
    currentPriceNo: number,
    consensusBreakConfirmed: boolean = false,
    gameStartTime?: Date
): ExitCheckResult {
    const takeProfitPct: number = Number(configService.get('takeProfitPct')) || 0.14;

    // Determine if match is live (game has started)
    const isLiveGame = gameStartTime && new Date() >= gameStartTime;

    // 1. RESOLUTION CHECK - Exit immediately if market is effectively resolved
    // LOWERED TO 0.90: Don't wait for 0.95, exit early to lock in gains
    // If we hold YES and price > 0.90 (Win) or < 0.10 (Loss)
    if (position.sharesYes > 0) {
        if (currentPriceYes >= 0.90) {
            logger.info('🎉 RESOLUTION EXIT TRIGGERED - YES at ' + (currentPriceYes * 100).toFixed(1) + '%');
            return {
                shouldExit: true,
                profitPct: 0, // Calculated later
                reason: `🎉 RESOLUTION WIN: Price ${currentPriceYes.toFixed(3)} >= 0.90. Selling to lock in gains!`,
                isProfit: true,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
        if (currentPriceYes <= 0.10) {
            logger.info('💀 RESOLUTION LOSS TRIGGERED - YES at ' + (currentPriceYes * 100).toFixed(1) + '%');
            return {
                shouldExit: true,
                profitPct: -1.0,
                reason: `💀 RESOLUTION LOSS: Price ${currentPriceYes.toFixed(3)} <= 0.10. Closing to limit damage.`,
                isProfit: false,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
    }
    // If we hold NO and price > 0.90 (Win) or < 0.10 (Loss)
    // Note: Polymarket prices are YES prices usually. 
    // currentPriceNo should be close to (1 - currentPriceYes).
    if (position.sharesNo > 0) {
        if (currentPriceNo >= 0.90) {
            logger.info('🎉 RESOLUTION EXIT TRIGGERED - NO at ' + (currentPriceNo * 100).toFixed(1) + '%');
            return {
                shouldExit: true,
                profitPct: 0,
                reason: `🎉 RESOLUTION WIN (NO): Price ${currentPriceNo.toFixed(3)} >= 0.90. Selling to lock in gains!`,
                isProfit: true,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
        if (currentPriceNo <= 0.10) {
            logger.info('💀 RESOLUTION LOSS TRIGGERED - NO at ' + (currentPriceNo * 100).toFixed(1) + '%');
            return {
                shouldExit: true,
                profitPct: -1.0,
                reason: `💀 RESOLUTION LOSS (NO): Price ${currentPriceNo.toFixed(3)} <= 0.10. Closing to limit damage.`,
                isProfit: false,
                exitPct: 1.0,
                isMoonBagExit: false
            };
        }
    }

    // NOTE: Moon bag logic removed - we always exit 100% to free slots for new trades

    // Check YES position for profit taking
    if (position.sharesYes > 0 && position.costBasisYes > 0) {
        const costBasis = position.costBasisYes;
        const currentValue = position.sharesYes * currentPriceYes;
        const unrealizedProfit = currentValue - costBasis;
        const profitPct = unrealizedProfit / costBasis;

        // Profit taking - SELL 100%, NO MOON BAGS
        // Always completely exit to free slot for new trades
        if (profitPct >= takeProfitPct) {
            logger.info('💰 PROFIT TARGET HIT - FULL EXIT', {
                profitPct: (profitPct * 100).toFixed(1) + '%',
                costBasis,
                currentValue
            });
            return {
                shouldExit: true,
                profitPct,
                reason: `💰 PROFIT TARGET: ${(profitPct * 100).toFixed(1)}% >= ${(takeProfitPct * 100).toFixed(1)}% - SELLING 100%`,
                isProfit: true,
                exitPct: 1.0,  // ALWAYS 100% - NO MOON BAGS
                isMoonBagExit: false
            };
        }

        // IMMEDIATE STOP LOSS - ONLY during live games (-15%)
        // Pre-game: Use 60% price anchor via checkPreGameStopLoss() instead
        // This prevents conflict: entry at 72%, -20% = 57.6% but thesis is 60%
        if (isLiveGame) {
            const stopLossPct = -0.15;
            if (profitPct <= stopLossPct) {
                return {
                    shouldExit: true,
                    profitPct,
                    reason: `🛑 LIVE GAME STOP LOSS: Down ${(profitPct * 100).toFixed(1)}% (threshold: -15%). Selling immediately.`,
                    isProfit: false,
                    exitPct: 1.0,  // Full exit
                    isMoonBagExit: false
                };
            }
        }

        // Thesis stop (10min consensus break) - still useful for sideways losses
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

    // Check NO position - same logic as YES
    if (position.sharesNo > 0 && position.costBasisNo > 0) {
        const costBasis = position.costBasisNo;
        const currentValue = position.sharesNo * currentPriceNo;
        const unrealizedProfit = currentValue - costBasis;
        const profitPct = unrealizedProfit / costBasis;

        // Profit taking - SELL 100%, NO MOON BAGS
        if (profitPct >= takeProfitPct) {
            logger.info('💰 PROFIT TARGET HIT (NO) - FULL EXIT', {
                profitPct: (profitPct * 100).toFixed(1) + '%',
                costBasis,
                currentValue
            });
            return {
                shouldExit: true,
                profitPct,
                reason: `💰 NO PROFIT TARGET: ${(profitPct * 100).toFixed(1)}% >= ${(takeProfitPct * 100).toFixed(0)}% - SELLING 100%`,
                isProfit: true,
                exitPct: 1.0,  // ALWAYS 100% - NO MOON BAGS
                isMoonBagExit: false
            };
        }

        // IMMEDIATE STOP LOSS - ONLY during live games (-15%)
        if (isLiveGame) {
            const stopLossPct = -0.15;
            if (profitPct <= stopLossPct) {
                return {
                    shouldExit: true,
                    profitPct,
                    reason: `🛑 LIVE STOP LOSS (NO): Down ${(profitPct * 100).toFixed(1)}% (threshold: -15%). Selling immediately.`,
                    isProfit: false,
                    exitPct: 1.0,
                    isMoonBagExit: false
                };
            }
        }

        // Thesis stop (consensus break)
        if (consensusBreakConfirmed) {
            return {
                shouldExit: true,
                profitPct,
                reason: `THESIS STOP (NO): Consensus broken. P&L: ${(profitPct * 100).toFixed(1)}%`,
                isProfit: false,
                exitPct: 1.0,
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
            sizeUsdc: sizeUsdc.toFixed(2)
        }
    });

    return order;
}

export default { shouldTakeProfit, generateExitOrder, checkConsensusBreak, checkPreGameStopLoss };
