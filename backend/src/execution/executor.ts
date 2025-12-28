import { Order, ExecutionResult, OrderStatus } from '../core/types.js';

/**
 * Executor Interface - Abstract execution layer.
 * Allows switching between PAPER and LIVE modes.
 */
export interface Executor {
    /**
     * Execute an order.
     */
    execute(order: Order): Promise<ExecutionResult>;

    /**
     * Get the executor mode.
     */
    getMode(): 'PAPER' | 'LIVE';

    /**
     * Check if executor is ready.
     */
    isReady(): boolean;
}

/**
 * Base execution result builder.
 */
export function createExecutionResult(
    order: Order,
    success: boolean,
    status: OrderStatus,
    filledShares: number,
    filledPrice: number,
    error?: string
): ExecutionResult {
    return {
        success,
        order,
        status,
        filledShares,
        filledPrice,
        filledUsdc: filledShares * filledPrice,
        slippage: filledPrice !== order.price
            ? (filledPrice - order.price) / order.price
            : 0,
        error,
        timestamp: new Date()
    };
}
