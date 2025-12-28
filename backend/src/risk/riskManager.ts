import { PrismaClient } from '@prisma/client';
import { ProposedOrder, RiskCheckResult, Position } from '../core/types.js';
import { configService } from '../config/configService.js';
import { riskLogger as logger } from '../core/logger.js';

/**
 * Risk Manager - Enforces risk limits on all proposed orders.
 * 
 * Responsibilities:
 * 1. Enforce max exposure per market (2% of bankroll)
 * 2. Enforce max single order size (0.25% of bankroll)
 * 3. Reject excessive order frequency
 * 4. Ensure bankroll consistency
 * 5. Protect realized profits in separate bucket (capital preservation)
 */
export class RiskManager {
    private prisma: PrismaClient;
    private cashBalance: number;                              // Tradeable cash (original bankroll minus active positions)
    private realizedProfitsBucket: number = 0;                // Protected profits - NOT available for trading
    private positions: Map<string, Position> = new Map();
    private recentOrders: Map<string, Date[]> = new Map();    // marketId -> order timestamps

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.cashBalance = configService.get('bankroll');
    }

    /**
     * Initialize risk manager with current positions.
     */
    async initialize(): Promise<void> {
        const config = configService.getAll();

        // Load existing positions
        const dbPositions = await this.prisma.position.findMany();
        for (const pos of dbPositions) {
            this.positions.set(pos.marketId, {
                marketId: pos.marketId,
                sharesYes: pos.sharesYes,
                sharesNo: pos.sharesNo,
                avgEntryYes: pos.avgEntryYes ?? undefined,
                avgEntryNo: pos.avgEntryNo ?? undefined,
                costBasisYes: pos.costBasisYes,
                costBasisNo: pos.costBasisNo,
                unrealizedPnl: pos.unrealizedPnl,
                realizedPnl: pos.realizedPnl
            });
        }

        // Calculate balances from trade history
        const trades = await this.prisma.trade.findMany({
            where: { status: 'FILLED' }
        });

        let totalSpent = 0;         // Money spent on buys
        let totalCostBasisReturned = 0;  // Original cost basis returned on sells
        let totalProfitsRealized = 0;    // Profits from sells (goes to protected bucket)

        for (const trade of trades) {
            if (trade.strategy === 'PROFIT_TAKING') {
                // This is a sell - we need to figure out cost basis vs profit
                // The trade.size is the total proceeds from the sale
                // We need the position's cost basis at the time of sale
                // For simplicity, we'll recalculate from positions table
                totalCostBasisReturned += trade.size;  // This will be adjusted below
            } else {
                totalSpent += trade.size;
            }
        }

        // Recalculate profits from positions table (more accurate)
        const allPositions = await this.prisma.position.findMany();
        for (const pos of allPositions) {
            totalProfitsRealized += pos.realizedPnl;
        }

        // Cash balance = bankroll - spent + cost basis returned (NOT profits)
        // But since we can't perfectly separate from historical data, 
        // we'll use a simpler approach: profits are tracked going forward
        this.cashBalance = config.bankroll - totalSpent + totalCostBasisReturned - totalProfitsRealized;
        this.realizedProfitsBucket = totalProfitsRealized > 0 ? totalProfitsRealized : 0;

        logger.info('Risk manager initialized', {
            bankroll: config.bankroll,
            cashBalance: this.cashBalance,
            realizedProfitsBucket: this.realizedProfitsBucket,
            positionCount: this.positions.size,
            totalSpent
        });
    }

    /**
     * Check if a proposed order passes all risk checks.
     */
    checkOrder(order: ProposedOrder): RiskCheckResult {
        const config = configService.getAll();
        const warnings: string[] = [];

        // Exit orders always pass (we want to be able to exit)
        if (order.isExit) {
            return {
                approved: true,
                originalOrder: order,
                warnings: ['Exit order - bypassing risk checks']
            };
        }

        // 0. Check position limit for NEW markets
        const existingPosition = this.positions.get(order.marketId);
        const maxPositions = config.maxActivePositions || 6;
        if (!existingPosition && this.positions.size >= maxPositions) {
            return {
                approved: false,
                originalOrder: order,
                rejectionReason: `Max positions reached: ${this.positions.size}/${maxPositions} - not entering new market`
            };
        }

        // 1. Check cash balance (only tradeable cash, not profits bucket)
        if (order.sizeUsdc > this.cashBalance) {
            return {
                approved: false,
                originalOrder: order,
                rejectionReason: `Insufficient cash: need $${order.sizeUsdc.toFixed(2)}, have $${this.cashBalance.toFixed(2)} (profits bucket: $${this.realizedProfitsBucket.toFixed(2)} protected)`
            };
        }

        // 2. Check single order size limit
        const maxSingleOrder = config.bankroll * config.maxSingleOrderPct;
        if (order.sizeUsdc > maxSingleOrder) {
            // Adjust size rather than reject
            const adjustedOrder = {
                ...order,
                sizeUsdc: maxSingleOrder,
                shares: maxSingleOrder / order.price
            };

            warnings.push(`Order size reduced from $${order.sizeUsdc.toFixed(2)} to $${maxSingleOrder.toFixed(2)}`);

            return {
                approved: true,
                originalOrder: order,
                adjustedOrder,
                warnings
            };
        }

        // 3. Check market exposure limit
        const position = this.positions.get(order.marketId);
        const currentExposure = position
            ? (position.costBasisYes + position.costBasisNo)
            : 0;
        const maxMarketExposure = config.bankroll * config.maxMarketExposurePct;

        if (currentExposure + order.sizeUsdc > maxMarketExposure) {
            const remainingRoom = maxMarketExposure - currentExposure;

            if (remainingRoom <= 0) {
                return {
                    approved: false,
                    originalOrder: order,
                    rejectionReason: `Max market exposure reached: $${currentExposure.toFixed(2)}/${maxMarketExposure.toFixed(2)}`
                };
            }

            // Adjust to remaining room
            const adjustedOrder = {
                ...order,
                sizeUsdc: remainingRoom,
                shares: remainingRoom / order.price
            };

            warnings.push(`Order size reduced to $${remainingRoom.toFixed(2)} due to market exposure limit`);

            return {
                approved: true,
                originalOrder: order,
                adjustedOrder,
                warnings
            };
        }

        // 4. Check order frequency (anti-spam)
        const recentForMarket = this.recentOrders.get(order.marketId) || [];
        const oneMinuteAgo = Date.now() - 60000;
        const recentCount = recentForMarket.filter(d => d.getTime() > oneMinuteAgo).length;

        if (recentCount >= 5) {
            return {
                approved: false,
                originalOrder: order,
                rejectionReason: `Too many orders for this market (${recentCount} in last minute)`
            };
        }

        return {
            approved: true,
            originalOrder: order,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * Update state after an order is executed.
     * CAPITAL PRESERVATION: Profits go to protected bucket, only cost basis returns to tradeable cash.
     */
    recordExecution(order: ProposedOrder, filledUsdc: number, filledShares: number): void {
        // Retrieve or initialize position
        let position = this.positions.get(order.marketId);
        if (!position) {
            position = {
                marketId: order.marketId,
                sharesYes: 0,
                sharesNo: 0,
                costBasisYes: 0,
                costBasisNo: 0,
                unrealizedPnl: 0,
                realizedPnl: 0
            };
        }

        if (order.isExit) {
            // Processing Sell/Exit - CAPITAL PRESERVATION LOGIC
            let costBasisRemoved: number;
            let profit: number;

            if (order.side === 'YES') {
                const pctSold = position.sharesYes > 0 ? filledShares / position.sharesYes : 1;
                costBasisRemoved = position.costBasisYes * pctSold;
                profit = filledUsdc - costBasisRemoved;

                position.sharesYes -= filledShares;
                position.costBasisYes -= costBasisRemoved;
                position.realizedPnl += profit;
            } else {
                const pctSold = position.sharesNo > 0 ? filledShares / position.sharesNo : 1;
                costBasisRemoved = position.costBasisNo * pctSold;
                profit = filledUsdc - costBasisRemoved;

                position.sharesNo -= filledShares;
                position.costBasisNo -= costBasisRemoved;
                position.realizedPnl += profit;
            }

            // CAPITAL PRESERVATION:
            // - Cost basis returns to tradeable cash (so you can reinvest principal)
            // - Profit goes to protected bucket (locked away, not tradeable)
            this.cashBalance += costBasisRemoved;

            if (profit > 0) {
                this.realizedProfitsBucket += profit;
                logger.info('💰 Profit locked in protected bucket', {
                    marketId: order.marketId,
                    profit: profit.toFixed(2),
                    totalProtectedProfits: this.realizedProfitsBucket.toFixed(2)
                });
            } else {
                // Loss - this reduces our tradeable cash (cost basis returned is less than what we put in)
                // Actually the loss is already accounted for since we only return costBasisRemoved
                // which is based on original cost, not current value
                logger.info('📉 Loss realized', {
                    marketId: order.marketId,
                    loss: profit.toFixed(2),
                    cashBalance: this.cashBalance.toFixed(2)
                });
            }

        } else {
            // Processing Buy
            this.cashBalance -= filledUsdc;

            if (order.side === 'YES') {
                const newTotalShares = position.sharesYes + filledShares;
                const newCostBasis = position.costBasisYes + filledUsdc;
                position.sharesYes = newTotalShares;
                position.costBasisYes = newCostBasis;
                position.avgEntryYes = newCostBasis / newTotalShares;
            } else {
                const newTotalShares = position.sharesNo + filledShares;
                const newCostBasis = position.costBasisNo + filledUsdc;
                position.sharesNo = newTotalShares;
                position.costBasisNo = newCostBasis;
                position.avgEntryNo = newCostBasis / newTotalShares;
            }
        }

        if (position.sharesYes <= 0.0001 && position.sharesNo <= 0.0001) {
            this.positions.delete(order.marketId);
            logger.info('Position closed and removed from tracking', {
                marketId: order.marketId,
                realizedPnl: position.realizedPnl,
                protectedProfits: this.realizedProfitsBucket.toFixed(2)
            });
        } else {
            this.positions.set(order.marketId, position);
        }

        // Record order timestamp for frequency limiting
        const timestamps = this.recentOrders.get(order.marketId) || [];
        timestamps.push(new Date());
        this.recentOrders.set(order.marketId, timestamps);

        logger.info('Execution recorded', {
            marketId: order.marketId,
            side: order.side,
            filledUsdc,
            filledShares,
            cashRemaining: this.cashBalance,
            protectedProfits: this.realizedProfitsBucket
        });
    }

    /**
     * Get current tradeable cash balance (excludes protected profits).
     */
    getCashBalance(): number {
        return this.cashBalance;
    }

    /**
     * Get protected profits bucket (not available for trading).
     */
    getProtectedProfits(): number {
        return this.realizedProfitsBucket;
    }

    /**
     * Get total account value (tradeable + protected + positions).
     */
    getTotalAccountValue(currentPrices: Map<string, { yes: number; no: number }>): number {
        const positionsValue = this.getPositionsValue(currentPrices);
        return this.cashBalance + this.realizedProfitsBucket + positionsValue;
    }

    /**
     * Get position for a market.
     */
    getPosition(marketId: string): Position | undefined {
        return this.positions.get(marketId);
    }

    /**
     * Get all positions.
     */
    getAllPositions(): Map<string, Position> {
        return new Map(this.positions);
    }

    /**
     * Check if we can enter a new market.
     */
    canEnterNewMarket(): boolean {
        const maxPositions = configService.get('maxActivePositions') || 6;
        return this.positions.size < maxPositions;
    }

    /**
     * Get active position count.
     */
    getPositionCount(): number {
        return this.positions.size;
    }

    /**
     * Get positions value at current prices.
     */
    private getPositionsValue(currentPrices: Map<string, { yes: number; no: number }>): number {
        let positionsValue = 0;

        for (const [marketId, position] of this.positions) {
            const prices = currentPrices.get(marketId);
            if (prices) {
                positionsValue += position.sharesYes * prices.yes;
                positionsValue += position.sharesNo * prices.no;
            } else {
                // Use cost basis as fallback
                positionsValue += position.costBasisYes + position.costBasisNo;
            }
        }

        return positionsValue;
    }

    /**
     * Get total portfolio value (for dashboard).
     */
    getTotalValue(currentPrices: Map<string, { yes: number; no: number }>): number {
        const positionsValue = this.getPositionsValue(currentPrices);
        // Include protected profits in total value for display
        return this.cashBalance + this.realizedProfitsBucket + positionsValue;
    }

    /**
     * Calculate unrealized P&L.
     */
    calculateUnrealizedPnl(currentPrices: Map<string, { yes: number; no: number }>): number {
        let totalPnl = 0;

        for (const [marketId, position] of this.positions) {
            const prices = currentPrices.get(marketId);
            if (prices) {
                const yesValue = position.sharesYes * prices.yes;
                const noValue = position.sharesNo * prices.no;
                const pnl = (yesValue + noValue) - (position.costBasisYes + position.costBasisNo);
                totalPnl += pnl;
            }
        }

        return totalPnl;
    }
}

export default RiskManager;
