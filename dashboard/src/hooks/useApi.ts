import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';

// Types
export interface Market {
    id: string;
    question: string;
    category: string;
    endDate: string;
    gameStartTime?: string; // When the match/event actually starts
    volume24h: number;
    liquidity: number;
}

export interface MarketState {
    marketId: string;
    regime: string;
    market?: Market;
    ladderFilled: string;
    tailActive: boolean;
}

export interface Position {
    marketId: string;
    sharesYes: number;
    sharesNo: number;
    avgEntryYes: number | null;
    avgEntryNo: number | null;
    costBasisYes: number;
    costBasisNo: number;
    unrealizedPnl: number;
    realizedPnl: number;
    market?: Market;
    currentPriceYes?: number;
    currentPriceNo?: number;
}

export interface Trade {
    id: number;
    marketId: string;
    side: string;
    action?: string; // BUY or SELL
    price: number;
    size: number;
    shares: number;
    strategy: string;
    strategyDetail: string;
    timestamp: string;
    market?: Market;
}

export interface PnlSnapshot {
    id: number;
    totalValue: number;
    cashBalance: number;
    positionsValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
    timestamp: string;
}

export interface StrategyEvent {
    id: number;
    marketId: string;
    regime: string;
    strategy: string;
    action: string;
    priceYes: number;
    priceNo: number;
    details: string;
    isCopyTrade?: boolean;  // True if triggered by copy trade signal
    timestamp: string;
    market?: Market;
}

export interface Portfolio {
    bankroll: number;
    cashBalance: number;
    tradeableCash: number;      // NEW: Actual cash available for trading
    lockedProfits: number;       // NEW: Protected profit bucket (not for reinvestment)
    positionsValue: number;
    totalValue: number;
    unrealizedPnl: number;
    realizedPnl: number;
    positionCount: number;
    closedCount?: number;        // NEW: From MarketTrade
    winCount?: number;           // NEW: From MarketTrade
    lossCount?: number;          // NEW: From MarketTrade
    winRate?: number;            // NEW: From MarketTrade
    allocation: {                // NEW: Capital allocation percentages
        tradeableCashPct: number;
        positionsPct: number;
        lockedProfitsPct: number;
    };
}

// NEW: Active trade from MarketTrade table
export interface ActiveTrade {
    id: number;
    marketId: string;
    side: string;
    status: string;
    entryPrice: number;
    entryShares: number;
    entryAmount: number;
    entryTime: string;
    currentShares: number;
    currentPrice: number | null;
    unrealizedPnl: number;
    unrealizedPct: number;
    isCopyTrade?: boolean;  // True if triggered by copy trade signal
    marketQuestion?: string;
    market?: Market;
}

// NEW: Closed trade from MarketTrade table
export interface ClosedTrade {
    id: number;
    marketId: string;
    side: string;
    entryPrice: number;
    entryAmount: number;
    entryTime: string;
    exitPrice: number | null;
    exitAmount: number | null;
    exitTime: string | null;
    profitLoss: number;
    profitLossPct: number;
    isWin: boolean;
    holdTime: number | null;  // In minutes
    isCopyTrade?: boolean;  // True if triggered by copy trade signal
    marketQuestion?: string;
    exitReason?: string;
}

// NEW: Trade summary stats
export interface TradeSummary {
    activeCount: number;
    totalInvested: number;
    closedCount: number;
    winCount: number;
    lossCount: number;
    winRate: number;
    totalRealized: number;
    avgWin: number;
    avgLoss: number;
    totalTurnover: number;
    returnOnInvestment: number;
}

export interface Config {
    mode: string;
    bankroll: number;
    ladderLevels: number[];
    allowedCategories: string[];
}

// Markets being watched from tracked traders
export interface TrackedMarket {
    id: number;
    conditionId: string;
    marketId?: string;
    title: string;
    outcome: string;
    traderName: string;
    traderWallet: string;
    trackedPrice: number;
    currentPrice?: number;
    status: 'WATCHING' | 'IN_RANGE' | 'EXECUTED' | 'EXPIRED';
    signalTime: string;
    enteredRangeAt?: string;
    executedAt?: string;
}

interface DashboardUpdate {
    type: string;
    data: unknown;
    timestamp: string;
}

// API Functions
async function fetchJson<T>(endpoint: string): Promise<T> {
    const response = await fetch(`${API_URL}${endpoint}`);
    if (!response.ok) throw new Error(`API error: ${response.status}`);
    return response.json();
}

export function useApi() {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [connected, setConnected] = useState(false);

    // Data state
    const [markets, setMarkets] = useState<Market[]>([]);
    const [marketStates, setMarketStates] = useState<MarketState[]>([]);
    const [positions, setPositions] = useState<Position[]>([]);  // Keep for backward compat
    const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);  // NEW: From MarketTrade
    const [closedTrades, setClosedTrades] = useState<ClosedTrade[]>([]);  // NEW: From MarketTrade
    const [tradeSummary, setTradeSummary] = useState<TradeSummary | null>(null);  // NEW
    const [trades, setTrades] = useState<Trade[]>([]);
    const [pnlHistory, setPnlHistory] = useState<PnlSnapshot[]>([]);
    const [strategyEvents, setStrategyEvents] = useState<StrategyEvent[]>([]);
    const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
    const [config, setConfig] = useState<Config | null>(null);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            const [
                marketsData,
                statesData,
                positionsData,
                activeTradesData,
                closedTradesData,
                tradeSummaryData,
                tradesData,
                pnlData,
                eventsData,
                portfolioData,
                configData
            ] = await Promise.all([
                fetchJson<Market[]>('/api/markets'),
                fetchJson<MarketState[]>('/api/market-states'),
                fetchJson<Position[]>('/api/positions'),  // Keep for backward compat
                fetchJson<ActiveTrade[]>('/api/trades/active'),  // NEW
                fetchJson<ClosedTrade[]>('/api/trades/closed'),  // NEW
                fetchJson<TradeSummary>('/api/trades/summary'),  // NEW
                fetchJson<Trade[]>('/api/trades?limit=50'),
                fetchJson<PnlSnapshot[]>('/api/pnl?limit=500'),
                fetchJson<StrategyEvent[]>('/api/strategy-events?limit=50'),
                fetchJson<Portfolio>('/api/portfolio'),
                fetchJson<Config>('/api/config')
            ]);

            setMarkets(marketsData);
            setMarketStates(statesData);
            setPositions(positionsData);
            setActiveTrades(activeTradesData);
            setClosedTrades(closedTradesData);
            setTradeSummary(tradeSummaryData);
            setTrades(tradesData);
            setPnlHistory(pnlData);
            setStrategyEvents(eventsData);
            setPortfolio(portfolioData);
            setConfig(configData);
            setError(null);
        } catch (err) {
            setError(String(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadData();

        // Setup WebSocket connection
        const socket: Socket = io(API_URL);

        socket.on('connect', () => {
            setConnected(true);
            console.log('WebSocket connected');
        });

        socket.on('disconnect', () => {
            setConnected(false);
            console.log('WebSocket disconnected');
        });

        socket.on('update', (update: DashboardUpdate) => {
            console.log('Update received:', update.type);

            switch (update.type) {
                case 'TRADE':
                    loadData(); // Refresh all data on trade
                    break;
                case 'POSITION':
                    loadData();
                    break;
                case 'PNL':
                    fetchJson<Portfolio>('/api/portfolio').then(setPortfolio);
                    fetchJson<PnlSnapshot[]>('/api/pnl?limit=500').then(setPnlHistory);
                    break;
                case 'STRATEGY_EVENT':
                    fetchJson<StrategyEvent[]>('/api/strategy-events?limit=50').then(setStrategyEvents);
                    break;
            }
        });

        // Periodic refresh
        const interval = setInterval(loadData, 30000);

        return () => {
            socket.disconnect();
            clearInterval(interval);
        };
    }, [loadData]);

    return {
        loading,
        error,
        connected,
        markets,
        marketStates,
        positions,
        activeTrades,    // NEW: From MarketTrade
        closedTrades,    // NEW: From MarketTrade
        tradeSummary,    // NEW: From MarketTrade
        trades,
        pnlHistory,
        strategyEvents,
        portfolio,
        config,
        refresh: loadData
    };
}
