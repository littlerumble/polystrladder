import { PrismaClient } from '@prisma/client';
import { Executor, createExecutionResult } from './executor.js';
import { Order, ExecutionResult, OrderStatus } from '../core/types.js';
import { executionLogger as logger } from '../core/logger.js';
import eventBus from '../core/eventBus.js';

/**
 * Paper Executor - Simulates order execution without real API calls.
 * 
 * Features:
 * - Simulates fills at top-of-book with configurable slippage
 * - Updates positions and P&L
 * - Logs all executions to database
 * - No external API calls
 */
export class PaperExecutor implements Executor {
    private prisma: PrismaClient;
    private slippageBps: number; // Basis points of slippage to simulate

    constructor(prisma: PrismaClient, slippageBps: number = 10) {
        this.prisma = prisma;
        this.slippageBps = slippageBps;
    }

    getMode(): 'PAPER' | 'LIVE' {
        return 'PAPER';
    }

    isReady(): boolean {
        return true;
    }

    async execute(order: Order): Promise<ExecutionResult> {
        logger.info('Executing paper order', {
            marketId: order.marketId,
            side: order.side,
            price: order.price,
            sizeUsdc: order.sizeUsdc,
            shares: order.shares,
            strategy: order.strategy
        });

        try {
            // Simulate execution delay
            await this.simulateDelay();

            // Simulate slippage
            // For BUYS: You pay MORE (Price * 1.001)
            // For SELLS: You receive LESS (Price * 0.999)
            const slippageMultiplier = order.isExit
                ? 1 - (this.slippageBps / 10000)
                : 1 + (this.slippageBps / 10000);

            const filledPrice = order.price * slippageMultiplier;

            // Simulate partial fills (90% chance of full fill)
            const fillRatio = Math.random() > 0.1 ? 1.0 : 0.8 + Math.random() * 0.2;
            const filledShares = order.shares * fillRatio;
            const filledUsdc = filledShares * filledPrice;

            // Persist trade
            await this.prisma.trade.create({
                data: {
                    marketId: order.marketId,
                    side: order.side,
                    price: filledPrice,
                    size: filledUsdc,
                    shares: filledShares,
                    strategy: order.strategy,
                    strategyDetail: order.strategyDetail,
                    status: fillRatio === 1.0 ? 'FILLED' : 'PARTIAL',
                    timestamp: new Date()
                }
            });

            // Update position
            await this.updatePosition(order.marketId, order.side, filledShares, filledUsdc, filledPrice, order.isExit);

            const result = createExecutionResult(
                order,
                true,
                fillRatio === 1.0 ? OrderStatus.FILLED : OrderStatus.PARTIAL,
                filledShares,
                filledPrice
            );

            // Emit execution event
            eventBus.emit('execution:result', result);

            logger.trade('FILLED', {
                marketId: order.marketId,
                side: order.side,
                price: filledPrice,
                size: filledUsdc,
                strategy: order.strategy,
                ladderLevel: order.strategyDetail?.includes('ladder')
                    ? parseFloat(order.strategyDetail.split('_')[1])
                    : undefined
            });

            return result;

        } catch (error) {
            logger.error('Paper execution failed', { error: String(error) });

            return createExecutionResult(
                order,
                false,
                OrderStatus.REJECTED,
                0,
                order.price,
                String(error)
            );
        }
    }

    /**
     * Simulate network/execution delay.
     */
    private async simulateDelay(): Promise<void> {
        const delay = 50 + Math.random() * 100; // 50-150ms
        return new Promise(resolve => setTimeout(resolve, delay));
    }

    /**
     * Update or create position after fill.
     */
    private async updatePosition(
        marketId: string,
        side: string,
        shares: number,
        usdc: number,
        price: number,
        isExit?: boolean
    ): Promise<void> {
        const existing = await this.prisma.position.findUnique({
            where: { marketId }
        });

        if (existing) {
            if (isExit) {
                // Handle SELL / EXIT
                if (side === 'YES') {
                    // Prevent negative shares
                    const sharesToRemove = Math.min(shares, existing.sharesYes);
                    const pctSold = sharesToRemove / existing.sharesYes || 1;
                    const costBasisRemoved = existing.costBasisYes * pctSold;

                    const newSharesYes = existing.sharesYes - sharesToRemove;
                    const newCostBasisYes = existing.costBasisYes - costBasisRemoved;
                    const realizedProfit = usdc - costBasisRemoved;

                    await this.prisma.position.update({
                        where: { marketId },
                        data: {
                            sharesYes: newSharesYes,
                            costBasisYes: newCostBasisYes,
                            realizedPnl: { increment: realizedProfit }
                        }
                    });
                } else {
                    const sharesToRemove = Math.min(shares, existing.sharesNo);
                    const pctSold = sharesToRemove / existing.sharesNo || 1;
                    const costBasisRemoved = existing.costBasisNo * pctSold;

                    const newSharesNo = existing.sharesNo - sharesToRemove;
                    const newCostBasisNo = existing.costBasisNo - costBasisRemoved;
                    const realizedProfit = usdc - costBasisRemoved;

                    await this.prisma.position.update({
                        where: { marketId },
                        data: {
                            sharesNo: newSharesNo,
                            costBasisNo: newCostBasisNo,
                            realizedPnl: { increment: realizedProfit }
                        }
                    });
                }
            } else {
                // Handle BUY (existing logic)
                if (side === 'YES') {
                    const newSharesYes = existing.sharesYes + shares;
                    const newCostBasisYes = existing.costBasisYes + usdc;
                    const newAvgEntryYes = newCostBasisYes / newSharesYes;

                    await this.prisma.position.update({
                        where: { marketId },
                        data: {
                            sharesYes: newSharesYes,
                            costBasisYes: newCostBasisYes,
                            avgEntryYes: newAvgEntryYes
                        }
                    });
                } else {
                    const newSharesNo = existing.sharesNo + shares;
                    const newCostBasisNo = existing.costBasisNo + usdc;
                    const newAvgEntryNo = newCostBasisNo / newSharesNo;

                    await this.prisma.position.update({
                        where: { marketId },
                        data: {
                            sharesNo: newSharesNo,
                            costBasisNo: newCostBasisNo,
                            avgEntryNo: newAvgEntryNo
                        }
                    });
                }
            }
        } else {
            try {
                await this.prisma.position.create({
                    data: {
                        marketId,
                        sharesYes: side === 'YES' ? shares : 0,
                        sharesNo: side === 'NO' ? shares : 0,
                        avgEntryYes: side === 'YES' ? price : null,
                        avgEntryNo: side === 'NO' ? price : null,
                        costBasisYes: side === 'YES' ? usdc : 0,
                        costBasisNo: side === 'NO' ? usdc : 0
                    }
                });
            } catch (error: any) {
                // Handle race condition where position was created between findUnique and create
                if (error.code === 'P2002') {
                    return this.updatePosition(marketId, side, shares, usdc, price, isExit);
                }
                throw error;
            }
        }

        // Emit position update
        const position = await this.prisma.position.findUnique({
            where: { marketId }
        });

        if (position) {
            eventBus.emit('position:update', {
                marketId,
                sharesYes: position.sharesYes,
                sharesNo: position.sharesNo,
                avgEntryYes: position.avgEntryYes ?? undefined,
                avgEntryNo: position.avgEntryNo ?? undefined,
                costBasisYes: position.costBasisYes,
                costBasisNo: position.costBasisNo,
                unrealizedPnl: position.unrealizedPnl,
                realizedPnl: position.realizedPnl
            });
        }
    }
}

export default PaperExecutor;
