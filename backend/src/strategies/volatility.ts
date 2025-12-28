import { ProposedOrder, Side, StrategyType, MarketState } from '../core/types.js';
import { configService } from '../config/configService.js';
import { strategyLogger as logger } from '../core/logger.js';

/**
 * Volatility Absorption Strategy
 * 
 * Logic:
 * 1. When price oscillates around 0.5: propose small buys on both sides
 * 2. If one side weakens repeatedly: increase exposure incrementally (inventory tilt)
 * 3. Never flip positions completely
 * 
 * This is inventory tilt, not flipping. Profits from mean reversion and resolution.
 */
export function generateVolatilityOrders(
    state: MarketState,
    tokenIdYes: string,
    tokenIdNo: string
): ProposedOrder[] {
    const config = configService.getAll();
    const orders: ProposedOrder[] = [];

    const priceYes = state.lastPriceYes;
    const priceNo = state.lastPriceNo;

    // Base size for volatility trades (smaller than ladder)
    const baseSize = (config.bankroll * config.maxMarketExposurePct) / 4;

    // Check if in volatility absorption zone (around 0.5)
    if (priceYes >= config.volatilityAbsorptionPriceMin &&
        priceYes <= config.volatilityAbsorptionPriceMax) {

        // In the sweet spot - consider both sides
        // Buy whichever side is cheaper
        if (priceYes <= 0.5) {
            // YES side is cheaper, buy YES
            orders.push(createVolatilityOrder(
                state.marketId,
                tokenIdYes,
                Side.YES,
                priceYes,
                baseSize,
                'both_sides_yes_cheaper'
            ));
        } else {
            // NO side is cheaper, buy NO
            orders.push(createVolatilityOrder(
                state.marketId,
                tokenIdNo,
                Side.NO,
                priceNo,
                baseSize,
                'both_sides_no_cheaper'
            ));
        }

        logger.strategy('VOLATILITY_BOTH_SIDES', {
            marketId: state.marketId,
            regime: state.regime,
            strategy: 'VOLATILITY_ABSORPTION',
            priceYes,
            priceNo,
            details: { zone: 'absorption', baseSize }
        });
    } else {
        // Outside absorption zone - check for inventory tilt opportunity
        const inventoryImbalance = state.exposureYes - state.exposureNo;

        if (Math.abs(inventoryImbalance) > baseSize * 2) {
            // Significant imbalance - tilt towards underweighted side
            if (inventoryImbalance > 0 && priceNo < 0.4) {
                // Heavy on YES, NO is cheap - buy some NO
                orders.push(createVolatilityOrder(
                    state.marketId,
                    tokenIdNo,
                    Side.NO,
                    priceNo,
                    baseSize * 0.5,
                    'inventory_tilt_no'
                ));
            } else if (inventoryImbalance < 0 && priceYes < 0.4) {
                // Heavy on NO, YES is cheap - buy some YES
                orders.push(createVolatilityOrder(
                    state.marketId,
                    tokenIdYes,
                    Side.YES,
                    priceYes,
                    baseSize * 0.5,
                    'inventory_tilt_yes'
                ));
            }
        }

        // If one side has moved significantly, consider adding to the weakened side
        if (priceYes < 0.35 && state.exposureYes === 0) {
            // YES has weakened significantly - contrarian buy
            orders.push(createVolatilityOrder(
                state.marketId,
                tokenIdYes,
                Side.YES,
                priceYes,
                baseSize * 0.75,
                'weakened_side_yes'
            ));

            logger.strategy('VOLATILITY_WEAK_SIDE', {
                marketId: state.marketId,
                regime: state.regime,
                strategy: 'VOLATILITY_ABSORPTION',
                priceYes,
                priceNo,
                details: { side: 'YES', reason: 'weakened' }
            });
        } else if (priceNo < 0.35 && state.exposureNo === 0) {
            // NO has weakened significantly - contrarian buy
            orders.push(createVolatilityOrder(
                state.marketId,
                tokenIdNo,
                Side.NO,
                priceNo,
                baseSize * 0.75,
                'weakened_side_no'
            ));

            logger.strategy('VOLATILITY_WEAK_SIDE', {
                marketId: state.marketId,
                regime: state.regime,
                strategy: 'VOLATILITY_ABSORPTION',
                priceYes,
                priceNo,
                details: { side: 'NO', reason: 'weakened' }
            });
        }
    }

    return orders;
}

/**
 * Create a volatility absorption order.
 */
function createVolatilityOrder(
    marketId: string,
    tokenId: string,
    side: Side,
    price: number,
    sizeUsdc: number,
    detail: string
): ProposedOrder {
    return {
        marketId,
        tokenId,
        side,
        price,
        sizeUsdc,
        shares: sizeUsdc / price,
        strategy: StrategyType.VOLATILITY_ABSORPTION,
        strategyDetail: detail,
        confidence: calculateVolatilityConfidence(price)
    };
}

/**
 * Calculate confidence for volatility orders.
 * Cheaper prices = higher confidence (better value).
 */
function calculateVolatilityConfidence(price: number): number {
    // Confidence inversely related to price
    // price 0.5 = confidence 0.5
    // price 0.3 = confidence 0.7
    // price 0.2 = confidence 0.8
    return Math.min(1 - price + 0.2, 0.9);
}

export default generateVolatilityOrders;
