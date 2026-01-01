import { EventEmitter } from 'eventemitter3';
import {
    MarketData,
    PriceUpdate,
    MarketState,
    Order,
    ExecutionResult,
    StrategyEventData,
    DashboardUpdate,
    Position,
    PortfolioState
} from './types.js';

/**
 * Event types emitted by the bot.
 */
export interface BotEvents {
    // Market events
    'market:loaded': (markets: MarketData[]) => void;
    'market:filtered': (markets: MarketData[]) => void;
    'market:update': (market: MarketData) => void;

    // Price events
    'price:update': (update: PriceUpdate) => void;
    'price:batch': (updates: PriceUpdate[]) => void;

    // State events
    'state:update': (state: MarketState) => void;
    'state:regime_change': (marketId: string, oldRegime: string, newRegime: string) => void;

    // Strategy events
    'strategy:event': (event: StrategyEventData) => void;
    'strategy:order_proposed': (order: Order) => void;

    // Execution events
    'execution:order': (order: Order) => void;
    'execution:result': (result: ExecutionResult) => void;

    // Position events
    'position:update': (position: Position) => void;
    'portfolio:update': (portfolio: PortfolioState) => void;

    // System events
    'system:ready': () => void;
    'system:error': (error: Error) => void;
    'system:shutdown': () => void;

    // Dashboard events
    'dashboard:update': (update: DashboardUpdate) => void;

    // WebSocket events
    'ws:connected': () => void;
    'ws:disconnected': () => void;
    'ws:reconnecting': (attempt: number) => void;

    // Copy trading events
    'copy:signal': (signal: { traderName: string; conditionId: string; marketSlug: string; marketTitle: string; outcome: string; price: number }) => void;
}

/**
 * Type-safe event emitter for the bot.
 */
class TypedEventEmitter extends EventEmitter<BotEvents> { }

/**
 * Global event bus singleton.
 */
export const eventBus = new TypedEventEmitter();
export default eventBus;
