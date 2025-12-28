// ==========================================
// Core Domain Types for Polymarket Bot
// ==========================================

/**
 * Market regime classification based on price behavior and time to resolution.
 * Determines which trading strategy to apply.
 */
export enum MarketRegime {
    /** Price between 0.45-0.55, high uncertainty */
    EARLY_UNCERTAIN = 'EARLY_UNCERTAIN',
    /** Stable price movement, default state */
    MID_CONSENSUS = 'MID_CONSENSUS',
    /** Less than 6h to resolution, price > 0.85 */
    LATE_COMPRESSED = 'LATE_COMPRESSED',
    /** High price volatility (stddev > threshold) */
    HIGH_VOLATILITY = 'HIGH_VOLATILITY'
}

/**
 * Trading strategy types.
 */
export enum StrategyType {
    /** Scaled entries as certainty grows via price laddering */
    LADDER_COMPRESSION = 'LADDER_COMPRESSION',
    /** Both-side positioning in volatile markets */
    VOLATILITY_ABSORPTION = 'VOLATILITY_ABSORPTION',
    /** Cheap convexity bets on unlikely outcomes */
    TAIL_INSURANCE = 'TAIL_INSURANCE',
    /** Exit position to take profit */
    PROFIT_TAKING = 'PROFIT_TAKING',
    /** No action taken */
    NONE = 'NONE'
}

/**
 * Order side.
 */
export enum Side {
    YES = 'YES',
    NO = 'NO'
}

/**
 * Order status.
 */
export enum OrderStatus {
    PENDING = 'PENDING',
    FILLED = 'FILLED',
    PARTIAL = 'PARTIAL',
    REJECTED = 'REJECTED',
    CANCELLED = 'CANCELLED'
}

/**
 * Normalized market data from Polymarket.
 */
export interface MarketData {
    marketId: string;
    question: string;
    description?: string;
    category: string;
    subcategory?: string;
    endDate: Date;
    volume24h: number;
    liquidity: number;
    outcomes: string[];
    clobTokenIds: string[];
    active: boolean;
    closed: boolean;
}

/**
 * Real-time price update from WebSocket.
 */
export interface PriceUpdate {
    marketId: string;
    tokenId: string;
    priceYes: number;
    priceNo: number;
    bestBidYes?: number;
    bestAskYes?: number;
    bestBidNo?: number;
    bestAskNo?: number;
    timestamp: Date;
}

/**
 * Stateful tracking for each market the bot is monitoring.
 */
export interface MarketState {
    marketId: string;
    regime: MarketRegime;
    lastPriceYes: number;
    lastPriceNo: number;
    priceHistory: { price: number; timestamp: Date }[];
    ladderFilled: number[];
    exposureYes: number;
    exposureNo: number;
    tailActive: boolean;
    lastUpdated: Date;
}

/**
 * Proposed order from a strategy (before risk checks).
 */
export interface ProposedOrder {
    marketId: string;
    tokenId: string;
    side: Side;
    price: number;
    sizeUsdc: number;
    shares: number;
    strategy: StrategyType;
    strategyDetail?: string;
    confidence: number;
    isExit?: boolean;  // True for profit-taking exit orders
}

/**
 * Order to be executed.
 */
export interface Order {
    id?: string;
    marketId: string;
    tokenId: string;
    side: Side;
    price: number;
    sizeUsdc: number;
    shares: number;
    strategy: StrategyType;
    strategyDetail?: string;
    timestamp: Date;
}

/**
 * Result of order execution.
 */
export interface ExecutionResult {
    success: boolean;
    order: Order;
    status: OrderStatus;
    filledShares: number;
    filledPrice: number;
    filledUsdc: number;
    slippage?: number;
    error?: string;
    timestamp: Date;
}

/**
 * Position in a market.
 */
export interface Position {
    marketId: string;
    sharesYes: number;
    sharesNo: number;
    avgEntryYes?: number;
    avgEntryNo?: number;
    costBasisYes: number;
    costBasisNo: number;
    unrealizedPnl: number;
    realizedPnl: number;
}

/**
 * Portfolio state.
 */
export interface PortfolioState {
    cashBalance: number;
    positions: Map<string, Position>;
    totalValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
}

/**
 * Risk check result.
 */
export interface RiskCheckResult {
    approved: boolean;
    originalOrder: ProposedOrder;
    adjustedOrder?: ProposedOrder;
    rejectionReason?: string;
    warnings?: string[];
}

/**
 * Dashboard update message.
 */
export interface DashboardUpdate {
    type: 'MARKET_UPDATE' | 'TRADE' | 'POSITION' | 'PNL' | 'STRATEGY_EVENT' | 'ERROR';
    data: unknown;
    timestamp: Date;
}

/**
 * Strategy event for logging.
 */
export interface StrategyEventData {
    marketId: string;
    regime: MarketRegime;
    strategy: StrategyType;
    action: string;
    priceYes: number;
    priceNo: number;
    details?: Record<string, unknown>;
}
