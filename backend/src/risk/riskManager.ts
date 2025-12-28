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
 */
export class RiskManager {
    private prisma: PrismaClient;
    private cashBalance: number;
    private positions: Map<string, Position> = new Map();
    private recentOrders: Map<string, Date[]> = new Map(); // marketId -> order timestamps

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

        // Calculate remaining cash from trades
        const trades = await this.prisma.trade.findMany({
            where: { status: 'FILLED' }
        });

        let totalSpent = 0;
        for (const trade of trades) {
            totalSpent += trade.size;
        }

        this.cashBalance = config.bankroll - totalSpent;

        logger.info('Risk manager initialized', {
            bankroll: config.bankroll,
            cashBalance: this.cashBalance,
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

        // 1. Check cash balance
        if (order.sizeUsdc > this.cashBalance) {
            return {
                approved: false,
                originalOrder: order,
                rejectionReason: `Insufficient cash: need $${order.sizeUsdc.toFixed(2)}, have $${this.cashBalance.toFixed(2)}`
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
     */
    recordExecution(order: ProposedOrder, filledUsdc: number, filledShares: number): void {
        // Deduct from cash
        this.cashBalance -= filledUsdc;

        // Update position
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

        this.positions.set(order.marketId, position);

        // Record order timestamp for frequency limiting
        const timestamps = this.recentOrders.get(order.marketId) || [];
        timestamps.push(new Date());
        this.recentOrders.set(order.marketId, timestamps);

        logger.info('Execution recorded', {
            marketId: order.marketId,
            side: order.side,
            filledUsdc,
            filledShares,
            cashRemaining: this.cashBalance
        });
    }

    /**
     * Get current cash balance.
     */
    getCashBalance(): number {
        return this.cashBalance;
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
     * Get total portfolio value.
     */
    getTotalValue(currentPrices: Map<string, { yes: number; no: number }>): number {
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

        return this.cashBalance + positionsValue;
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
