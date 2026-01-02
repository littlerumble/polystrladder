/**
 * Type definitions for Polymarket API responses
 * Based on actual API testing - verified fields only
 */

// Whale trade from data-api.polymarket.com/trades
export interface WhaleTrade {
    proxyWallet: string;      // whale address
    side: 'BUY' | 'SELL';
    asset: string;            // token ID
    conditionId: string;
    size: number;             // number of shares
    price: number;            // 0.77 = 77%
    timestamp: number;        // unix timestamp
    title: string;            // market question
    slug: string;             // URL slug
    eventSlug: string;
    outcome: string;          // Yes, No, Over, Under, Team Name
    outcomeIndex: number;     // 0 or 1
    transactionHash: string;
    // Profile info (not always present)
    name?: string;
    pseudonym?: string;
}

// Market from gamma-api.polymarket.com/markets
export interface GammaMarket {
    id: string;
    conditionId: string;
    slug: string;
    question: string;
    description?: string;
    outcomes: string;         // JSON string: '["Yes", "No"]'
    outcomePrices: string;    // JSON string: '["0.65", "0.35"]'
    clobTokenIds: string;     // JSON string: '["token1", "token2"]'
    endDate: string;          // ISO date
    active: boolean;
    closed: boolean;
    volume?: string;
    liquidity?: string;
}

// Parsed Gamma market with arrays instead of JSON strings
export interface ParsedGammaMarket {
    id: string;
    conditionId: string;
    slug: string;
    question: string;
    outcomes: string[];
    outcomePrices: number[];
    clobTokenIds: string[];
    endDate: Date | null;
    active: boolean;
    closed: boolean;
}

// CLOB market from clob.polymarket.com/markets/{conditionId}
export interface ClobMarket {
    condition_id: string;
    question_id: string;
    question: string;
    description?: string;
    market_slug: string;
    active: boolean;
    closed: boolean;
    end_date_iso?: string;
    game_start_time?: string;
    tokens: ClobToken[];
}

export interface ClobToken {
    token_id: string;
    outcome: string;
    price: number;
    winner?: boolean;
}

// CLOB orderbook from clob.polymarket.com/book
export interface ClobOrderbook {
    market: string;           // condition ID
    asset_id: string;         // token ID
    timestamp: string;
    hash: string;
    bids: ClobOrder[];
    asks: ClobOrder[];
}

export interface ClobOrder {
    price: string;
    size: string;
}

// CLOB midpoint from clob.polymarket.com/midpoint
export interface ClobMidpoint {
    mid: string;              // "0.65"
}

// Internal types for our system
export interface CopySignal {
    type: 'ELIGIBLE' | 'INELIGIBLE';
    reason: string;
    trade: WhaleTrade;
    market?: ParsedGammaMarket;
}

export interface PriceUpdate {
    tokenId: string;
    conditionId: string;
    price: number;
    timestamp: Date;
}

export interface ExitSignal {
    type: 'TP_TRAIL' | 'STOP_LOSS' | 'WHALE_DUMP' | 'TIME_STOP' | 'STAGNATION' | 'HARD_CAP';
    reason: string;
    paperTradeId: string;
    exitPrice: number;
}
