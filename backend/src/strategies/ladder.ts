import { ProposedOrder, Side, StrategyType, MarketState } from '../core/types.js';
import { configService } from '../config/configService.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Ladder Compression Strategy - Confidence-Tiered Entries
 * 
 * Philosophy:
 * - Minimal exposure early (when consensus is weak)
 * - Real size only after 60%+ (consensus forming)
 * - Heavy size after 75%+ (strong consensus)
 * 
 * Ladder Levels (configurable):
 * - Level 1: 60% → Small position (10% of max exposure)
 * - Level 2: 65% → Small position (15% of max exposure)
 * - Level 3: 70% → Medium position (25% of max exposure)
 * - Level 4: 75% → Large position (25% of max exposure)
 * - Level 5: 80% → Large position (25% of max exposure)
 * 
 * Total: 100% of max exposure spread across levels
 * 
 * Why it works:
 * - No exposure in uncertain markets (55% and below)
 * - Exposure grows ONLY as consensus grows
 * - Heaviest size when confidence is highest
 * - Average entry reflects conviction, not timing
 */

// Confidence weights for each ladder level (must sum to 1.0)
// Lower levels = less capital, higher levels = more capital
const CONFIDENCE_WEIGHTS = [0.10, 0.15, 0.25, 0.25, 0.25];

export function generateLadderOrders(
    state: MarketState,
    tokenIdYes: string,
    tokenIdNo?: string
): ProposedOrder[] {
    const config = configService.getAll();
    const orders: ProposedOrder[] = [];

    const ladderLevels: number[] = config.ladderLevels;
    const maxExposure = config.bankroll * config.maxMarketExposurePct;
    const priceYes = state.lastPriceYes;
    const priceNo = state.lastPriceNo;
    const maxBuyPrice = config.maxBuyPrice || 0.92;
    const firstLadder = ladderLevels[0] || 0.60;

    // Determine which side to trade:
    // - If YES >= 60%: buy YES
    // - Else if NO >= 60%: buy NO
    // - Else: wait (neither side has conviction)
    let tradeSide: 'YES' | 'NO' | null = null;
    let tradePrice: number;
    let tokenId: string;

    if (priceYes >= firstLadder && priceYes <= maxBuyPrice) {
        tradeSide = 'YES';
        tradePrice = priceYes;
        tokenId = tokenIdYes;
    } else if (priceNo >= firstLadder && priceNo <= maxBuyPrice && tokenIdNo) {
        tradeSide = 'NO';
        tradePrice = priceNo;
        tokenId = tokenIdNo;
    } else {
        // Neither side has conviction - wait
        logger.debug('Neither side meets ladder criteria', {
            marketId: state.marketId,
            priceYes,
            priceNo,
            firstLadder,
            maxBuyPrice
        });
        return orders;
    }

    // Don't buy if price is already too high (no upside left)
    if (tradePrice > maxBuyPrice) {
        logger.debug('Price too high for ladder entry', {
            marketId: state.marketId,
            side: tradeSide,
            price: tradePrice,
            maxBuyPrice
        });
        return orders;
    }

    // Track which levels are already filled
    const filledLevels = new Set(state.ladderFilled);

    for (let i = 0; i < ladderLevels.length; i++) {
        const ladderLevel = ladderLevels[i];

        // Skip if already filled
        if (filledLevels.has(ladderLevel)) {
            continue;
        }

        // Check if price has reached this ladder level (and is still below max)
        if (tradePrice >= ladderLevel && tradePrice <= maxBuyPrice) {
            // Use confidence-weighted sizing
            // Higher levels get more capital
            const weight = CONFIDENCE_WEIGHTS[i] ?? (1 / ladderLevels.length);
            const sizeUsdc = maxExposure * weight;
            const shares = sizeUsdc / tradePrice;

            const order: ProposedOrder = {
                marketId: state.marketId,
                tokenId: tokenId,
                side: tradeSide === 'YES' ? Side.YES : Side.NO,
                price: tradePrice,
                sizeUsdc,
                shares,
                strategy: StrategyType.LADDER_COMPRESSION,
                strategyDetail: `ladder_${ladderLevel}_${tradeSide}_weight_${(weight * 100).toFixed(0)}pct`,
                confidence: calculateLadderConfidence(ladderLevel, tradePrice)
            };

            orders.push(order);

            logger.strategy('LADDER_TRIGGER', {
                marketId: state.marketId,
                regime: state.regime,
                strategy: 'LADDER_COMPRESSION',
                priceYes,
                priceNo,
                details: {
                    side: tradeSide,
                    ladderLevel,
                    sizeUsdc,
                    shares,
                    weight: `${(weight * 100).toFixed(0)}%`,
                    tier: i + 1
                }
            });
        }
    }

    return orders;
}

/**
 * Calculate confidence multiplier for ladder orders.
 * Higher ladder levels = higher confidence in outcome.
 */
function calculateLadderConfidence(ladderLevel: number, currentPrice: number): number {
    // Base confidence from ladder level (higher level = more confident)
    const baseConfidence = ladderLevel;

    // Bonus if price is significantly above ladder level
    const priceBonus = Math.min((currentPrice - ladderLevel) * 2, 0.1);

    return Math.min(baseConfidence + priceBonus, 1.0);
}

/**
 * Get the next unfilled ladder level for a market.
 */
export function getNextLadderLevel(state: MarketState): number | null {
    const config = configService.getAll();
    const filledLevels = new Set(state.ladderFilled);

    for (const level of config.ladderLevels) {
        if (!filledLevels.has(level)) {
            return level;
        }
    }

    return null; // All levels filled
}

/**
 * Check if all ladder levels are filled.
 */
export function isLadderComplete(state: MarketState): boolean {
    const config = configService.getAll();
    return state.ladderFilled.length >= config.ladderLevels.length;
}

/**
 * Mark a ladder level as filled.
 */
export function markLadderFilled(state: MarketState, level: number): MarketState {
    if (!state.ladderFilled.includes(level)) {
        return {
            ...state,
            ladderFilled: [...state.ladderFilled, level]
        };
    }
    return state;
}

/**
 * DCA (Dollar Cost Average) Strategy - Buy Dips Pre-Game Only
 * 
 * Philosophy:
 * - If we have a position and price dips 5%+ before game starts, buy more at lower price
 * - This lowers average entry price
 * - Only works BEFORE game starts (pre-game uncertainty, not live game volatility)
 * - Max 2 DCA buys per market to prevent over-concentration
 * - Works for BOTH YES and NO positions
 */
export function generateDCAOrders(
    state: MarketState,
    position: {
        sharesYes: number;
        avgEntryYes: number;
        sharesNo: number;
        avgEntryNo: number;
        dcaBuys?: number
    },
    tokenIdYes: string,
    tokenIdNo: string | undefined,
    gameStartTime: Date | null | undefined,
    maxDCABuys: number = 2
): ProposedOrder[] {
    const config = configService.getAll();
    const orders: ProposedOrder[] = [];

    // Determine which side we have a position on
    let tradeSide: 'YES' | 'NO' | null = null;
    let shares = 0;
    let avgEntry = 0;
    let currentPrice = 0;
    let tokenId = '';

    if (position.sharesYes > 0 && position.avgEntryYes > 0) {
        tradeSide = 'YES';
        shares = position.sharesYes;
        avgEntry = position.avgEntryYes;
        currentPrice = state.lastPriceYes;
        tokenId = tokenIdYes;
    } else if (position.sharesNo > 0 && position.avgEntryNo > 0 && tokenIdNo) {
        tradeSide = 'NO';
        shares = position.sharesNo;
        avgEntry = position.avgEntryNo;
        currentPrice = state.lastPriceNo;
        tokenId = tokenIdNo;
    }

    if (!tradeSide || shares <= 0) {
        return orders;
    }

    // Never DCA after game starts
    const now = new Date();
    if (gameStartTime && now >= gameStartTime) {
        logger.debug('DCA blocked - game already started', { marketId: state.marketId });
        return orders;
    }

    // Check DCA limit
    const dcaBuyCount = position.dcaBuys || 0;
    if (dcaBuyCount >= maxDCABuys) {
        logger.debug('DCA limit reached', { marketId: state.marketId, dcaBuys: dcaBuyCount });
        return orders;
    }

    // Don't DCA in EARLY_UNCERTAIN (thesis might be breaking)
    if (state.regime === 'EARLY_UNCERTAIN') {
        logger.debug('DCA blocked - EARLY_UNCERTAIN regime', { marketId: state.marketId });
        return orders;
    }

    // CRITICAL: Only DCA if price is ABOVE first ladder level (60%)
    const ladderConfig = configService.getAll();
    const firstLadderLevel = ladderConfig.ladderLevels[0] || 0.60;
    if (currentPrice < firstLadderLevel) {
        logger.debug('DCA blocked - price below first ladder (thesis breaking)', {
            marketId: state.marketId,
            side: tradeSide,
            currentPrice,
            firstLadderLevel
        });
        return orders;
    }

    const dipPct = (avgEntry - currentPrice) / avgEntry;

    // Only DCA if price dipped 5%+ from average entry
    const DIP_THRESHOLD = 0.05;
    if (dipPct < DIP_THRESHOLD) {
        return orders;
    }

    // DCA size: 15% of max exposure
    const DCA_WEIGHT = 0.15;
    const maxExposure = config.bankroll * config.maxMarketExposurePct;
    const sizeUsdc = maxExposure * DCA_WEIGHT;
    const dcaShares = sizeUsdc / currentPrice;

    const order: ProposedOrder = {
        marketId: state.marketId,
        tokenId: tokenId,
        side: tradeSide === 'YES' ? Side.YES : Side.NO,
        price: currentPrice,
        sizeUsdc,
        shares: dcaShares,
        strategy: StrategyType.LADDER_COMPRESSION,
        strategyDetail: `dca_${tradeSide}_buy_${(dipPct * 100).toFixed(1)}pct_dip`,
        confidence: 0.8,
        isDCA: true
    };

    orders.push(order);

    logger.strategy('DCA_TRIGGER', {
        marketId: state.marketId,
        regime: state.regime,
        strategy: 'DCA',
        priceYes: state.lastPriceYes,
        priceNo: state.lastPriceNo,
        details: {
            side: tradeSide,
            avgEntry,
            currentPrice,
            dipPct: `${(dipPct * 100).toFixed(1)}%`,
            sizeUsdc,
            dcaBuyNumber: dcaBuyCount + 1
        }
    });

    return orders;
}

export default generateLadderOrders;
