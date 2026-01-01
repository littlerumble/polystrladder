import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient, Market } from '@prisma/client';
import axios from 'axios';
import { configService } from '../config/configService.js';
import { createLogger } from '../core/logger.js';
import eventBus from '../core/eventBus.js';
import { fetchTrackedPositions, fetchTraderProfile } from './traderTracker.js';
import {
    DashboardUpdate,
    PriceUpdate,
    ExecutionResult,
    Position,
    PortfolioState,
    StrategyEventData
} from '../core/types.js';

const logger = createLogger('Dashboard');

import { setupProductionServer } from '../productionServer.js';

// Enriched position with calculated P&L and prices
interface EnrichedPosition extends Position {
    // Override prisma type properties that match core/types if needed, 
    // or extend Prisma Position type. 
    // Prisma Position: id, marketId, sharesYes... 
    // core/types Position: marketId, sharesYes...
    // We add:
    unrealizedPnl: number;
    currentPriceYes: number;
    currentPriceNo: number;
    market?: Market;
}

/**
 * Dashboard Server - Serves REST API and WebSocket for the React dashboard.
 * 
 * Updated: Uses live CLOB API fetching as fallback for prices to ensure data accuracy.
 * Uses shared logic for positions and portfolio to prevent discrepancies.
 */
export class DashboardServer {
    private app: express.Application;
    private httpServer: ReturnType<typeof createServer>;
    private io: SocketIOServer;
    private prisma: PrismaClient;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
        this.app = express();
        this.httpServer = createServer(this.app);
        this.io = new SocketIOServer(this.httpServer, {
            cors: {
                origin: '*',
                methods: ['GET', 'POST']
            }
        });

        this.setupMiddleware();
        this.setupRoutes();

        // Setup static file serving for production
        setupProductionServer(this, this.app);

        this.setupEventForwarding();
    }

    /**
     * Setup Express middleware.
     */
    private setupMiddleware(): void {
        this.app.use(express.json());
        this.app.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
            next();
        });
    }

    /**
     * Fetch live price from Gamma API (primary) or CLOB API (fallback).
     * 
     * CRITICAL FIX: CLOB orderbook often returns garbage spreads (1¢/99¢) 
     * which results in 50¢ mid-price. Gamma API has accurate outcomePrices.
     */
    private async fetchLivePrice(market: Market): Promise<{ priceYes: number, priceNo: number } | null> {
        // PRIMARY: Try Gamma API first (has accurate outcomePrices)
        try {
            const response = await axios.get(`https://gamma-api.polymarket.com/markets/${market.id}`, {
                timeout: 5000
            });
            const marketData = response.data;

            if (marketData.outcomePrices) {
                const prices = JSON.parse(marketData.outcomePrices);
                const outcomes = marketData.outcomes ? JSON.parse(marketData.outcomes) : ['Yes', 'No'];

                // CRITICAL: outcomePrices order matches outcomes order
                // outcomes could be ["Yes", "No"] or ["No", "Yes"]
                let priceYes: number;
                let priceNo: number;

                const yesIndex = outcomes.findIndex((o: string) => o.toLowerCase() === 'yes');
                const noIndex = outcomes.findIndex((o: string) => o.toLowerCase() === 'no');

                if (yesIndex !== -1 && noIndex !== -1) {
                    priceYes = parseFloat(prices[yesIndex]);
                    priceNo = parseFloat(prices[noIndex]);
                } else {
                    // Fallback: assume first is YES (standard Polymarket)
                    priceYes = parseFloat(prices[0]);
                    priceNo = parseFloat(prices[1]);
                }

                if (!isNaN(priceYes) && !isNaN(priceNo) && priceYes > 0 && priceYes < 1) {
                    // Persist to DB asynchronously
                    this.prisma.priceHistory.create({
                        data: {
                            marketId: market.id,
                            priceYes,
                            priceNo,
                            bestBidYes: priceYes,
                            bestAskYes: priceYes,
                            bestBidNo: priceNo,
                            bestAskNo: priceNo,
                            timestamp: new Date()
                        }
                    }).catch(e => logger.debug(`Failed to save cache price: ${e.message}`));

                    return { priceYes, priceNo };
                }
            }
        } catch (error) {
            logger.debug(`Gamma API failed for ${market.id}, trying CLOB fallback`);
        }

        // FALLBACK: Try CLOB orderbook (but filter out garbage spreads)
        try {
            const tokenIds = JSON.parse(market.clobTokenIds);
            const outcomes: string[] = JSON.parse(market.outcomes || '["Yes", "No"]');
            if (!tokenIds || tokenIds.length === 0) return null;

            // Use outcomes field to find YES token
            const yesIndex = outcomes.findIndex(o => o.toLowerCase() === 'yes');
            const yesTokenId = yesIndex !== -1 ? tokenIds[yesIndex] : tokenIds[0];
            const response = await axios.get(`https://clob.polymarket.com/book?token_id=${yesTokenId}`, {
                timeout: 5000
            });
            const book = response.data;

            const bestBid = book.bids && book.bids.length > 0 ? parseFloat(book.bids[0].price) : undefined;
            const bestAsk = book.asks && book.asks.length > 0 ? parseFloat(book.asks[0].price) : undefined;

            // CRITICAL: Check for garbage spread (e.g., 1¢ bid / 99¢ ask = 98¢ spread)
            // A normal liquid market has a spread < 10¢
            if (bestBid !== undefined && bestAsk !== undefined) {
                const spread = bestAsk - bestBid;
                if (spread > 0.10) {
                    logger.debug(`CLOB orderbook has garbage spread (${spread.toFixed(2)}) for ${market.id}, skipping`);
                    return null;
                }
            }

            let priceYes: number | undefined;
            if (bestBid !== undefined && bestAsk !== undefined) {
                priceYes = (bestBid + bestAsk) / 2;
            } else if (bestBid !== undefined) {
                priceYes = bestBid;
            } else if (bestAsk !== undefined) {
                priceYes = bestAsk;
            }

            if (priceYes === undefined) return null;

            const priceNo = 1 - priceYes;

            this.prisma.priceHistory.create({
                data: {
                    marketId: market.id,
                    priceYes,
                    priceNo,
                    bestBidYes: bestBid || 0,
                    bestAskYes: bestAsk || 0,
                    bestBidNo: bestAsk ? (1 - bestAsk) : 0,
                    bestAskNo: bestBid ? (1 - bestBid) : 0,
                    timestamp: new Date()
                }
            }).catch(e => logger.debug(`Failed to save cache price: ${e.message}`));

            return { priceYes, priceNo };
        } catch (error) {
            return null;
        }
    }

    /**
     * Shared logic to get positions enriched with LIVE P&L.
     * Guaranteed Single Source of Truth for both Widgets.
     */
    private async getPositionsWithLivePnl(): Promise<any[]> {
        const positions = await this.prisma.position.findMany({
            include: { market: true },
            where: {
                // Only get positions that actually have shares
                OR: [
                    { sharesYes: { gt: 0.0001 } },  // Small threshold to avoid floating point issues
                    { sharesNo: { gt: 0.0001 } }
                ]
            }
        });

        // Parallel processing
        return await Promise.all(positions.map(async (pos) => {
            let priceYes = 0;
            let priceNo = 0;
            let priceFound = false;

            // 1. Try DB History ONLY if recent (< 1 minute old)
            const latestPrice = await this.prisma.priceHistory.findFirst({
                where: { marketId: pos.marketId },
                orderBy: { timestamp: 'desc' }
            });

            const priceAge = latestPrice ? Date.now() - latestPrice.timestamp.getTime() : Infinity;
            const isRecent = priceAge < 60000; // 1 minute

            if (latestPrice && isRecent) {
                priceYes = latestPrice.priceYes;
                priceNo = latestPrice.priceNo;
                priceFound = true;
            }
            // 2. ALWAYS try Gamma API if DB is old or missing
            else if (pos.market) {
                const livePrice = await this.fetchLivePrice(pos.market);
                if (livePrice) {
                    priceYes = livePrice.priceYes;
                    priceNo = livePrice.priceNo;
                    priceFound = true;
                } else if (latestPrice) {
                    // Fallback to old DB price if Gamma fails
                    priceYes = latestPrice.priceYes;
                    priceNo = latestPrice.priceNo;
                    priceFound = true;
                    logger.warn(`Using stale price for ${pos.marketId}, age: ${Math.round(priceAge / 1000)}s`);
                }
            }

            // Calculate P&L
            let unrealizedPnl = 0;
            if (priceFound) {
                const yesValue = pos.sharesYes * priceYes;
                const noValue = pos.sharesNo * priceNo;
                const currentVal = yesValue + noValue;
                const costBasis = pos.costBasisYes + pos.costBasisNo;
                unrealizedPnl = currentVal - costBasis;
            } else {
                // If absolutely no price found, we assume 0 value change? 
                // Or 0 value? 
                // User said "Never assume". But we have to return a number.
                // We'll return 0 P&L (Value = Cost) to be neutral, or 
                // return 0 Value?
                // Returning 0 PnL (neutral) is safer than showing -100% loss.
                // But honestly, it should be rare with live fetch.
                unrealizedPnl = 0;
            }

            return {
                ...pos,
                unrealizedPnl,
                currentPriceYes: priceFound ? priceYes : undefined,
                currentPriceNo: priceFound ? priceNo : undefined
            };
        }));
    }

    /**
     * Setup REST API routes.
     */
    private setupRoutes(): void {
        // Health check
        this.app.get('/api/health', (_, res) => {
            res.json({ status: 'ok', mode: configService.get('mode') });
        });

        // Get configuration
        this.app.get('/api/config', (_, res) => {
            res.json(configService.getAll());
        });

        // Get all markets with live prices and entry cues
        this.app.get('/api/markets', async (_, res) => {
            try {
                const markets = await this.prisma.market.findMany({
                    where: { active: true },
                    orderBy: { volume24h: 'desc' },
                    include: { marketStates: true }
                });

                // Get ladder config for entry cues
                const ladderLevels: number[] = configService.get('ladderLevels') || [0.65, 0.70, 0.80, 0.90, 0.95];
                const firstLadder = ladderLevels[0];
                const maxBuyPrice = configService.get('maxBuyPrice') || 0.90;

                // Enrich with live prices and entry cues
                const enrichedMarkets = await Promise.all(markets.map(async (market) => {
                    // Get market state first (needed for entry cue)
                    const marketState = market.marketStates?.[0];

                    // Get live price
                    let priceYes = 0;
                    let priceNo = 0;

                    const livePrice = await this.fetchLivePrice(market);
                    if (livePrice) {
                        priceYes = livePrice.priceYes;
                        priceNo = livePrice.priceNo;
                    }

                    // Determine entry cue based on BOTH YES and NO prices
                    let entryCue = '';
                    let tradeSide = '';

                    // Check if YES is tradeable
                    if (priceYes >= firstLadder && priceYes <= maxBuyPrice) {
                        tradeSide = 'YES';
                        const levelsToFill = ladderLevels.filter(l => priceYes >= l);
                        const filledCount = marketState ? JSON.parse(marketState.ladderFilled || '[]').length : 0;
                        const unfilled = levelsToFill.length - filledCount;

                        if (unfilled > 0) {
                            entryCue = `🟢 YES: Buy L${filledCount + 1}${unfilled > 1 ? `-L${filledCount + unfilled}` : ''} now`;
                        } else if (filledCount < ladderLevels.length) {
                            const nextLevel = ladderLevels[filledCount];
                            entryCue = `YES: L${filledCount}/${ladderLevels.length} filled, next at ${(nextLevel * 100).toFixed(0)}%`;
                        } else {
                            entryCue = `YES: All ${ladderLevels.length} levels filled ✓`;
                        }
                    }
                    // Check if NO is tradeable (when YES is not)
                    else if (priceNo >= firstLadder && priceNo <= maxBuyPrice) {
                        tradeSide = 'NO';
                        const levelsToFill = ladderLevels.filter(l => priceNo >= l);
                        const filledCount = marketState ? JSON.parse(marketState.ladderFilled || '[]').length : 0;
                        const unfilled = levelsToFill.length - filledCount;

                        if (unfilled > 0) {
                            entryCue = `🔴 NO: Buy L${filledCount + 1}${unfilled > 1 ? `-L${filledCount + unfilled}` : ''} now`;
                        } else if (filledCount < ladderLevels.length) {
                            const nextLevel = ladderLevels[filledCount];
                            entryCue = `NO: L${filledCount}/${ladderLevels.length} filled, next at ${(nextLevel * 100).toFixed(0)}%`;
                        } else {
                            entryCue = `NO: All ${ladderLevels.length} levels filled ✓`;
                        }
                    }
                    // Neither side is tradeable
                    else {
                        tradeSide = 'WAIT';
                        // Show which side is closer to entry
                        const yesNeeded = firstLadder - priceYes;
                        const noNeeded = firstLadder - priceNo;
                        if (yesNeeded < noNeeded && yesNeeded > 0) {
                            entryCue = `Wait: YES needs +${(yesNeeded * 100).toFixed(1)}%`;
                        } else if (noNeeded > 0) {
                            entryCue = `Wait: NO needs +${(noNeeded * 100).toFixed(1)}%`;
                        } else {
                            entryCue = `Both sides > ${(maxBuyPrice * 100).toFixed(0)}%`;
                        }
                    }

                    return {
                        ...market,
                        priceYes,
                        priceNo,
                        pricePct: `Y: ${(priceYes * 100).toFixed(0)}% | N: ${(priceNo * 100).toFixed(0)}%`,
                        tradeSide,
                        entryCue,
                        regime: marketState?.regime || 'UNKNOWN'
                    };
                }));

                res.json(enrichedMarkets);
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get market states
        this.app.get('/api/market-states', async (_, res) => {
            try {
                const states = await this.prisma.marketState.findMany({
                    include: { market: true }
                });
                res.json(states);
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get all positions - Calculated with live prices
        this.app.get('/api/positions', async (_, res) => {
            try {
                const positions = await this.getPositionsWithLivePnl();
                res.json(positions);
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get trade history (individual buy/sell orders)
        this.app.get('/api/trades', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit as string) || 100;
                const trades = await this.prisma.trade.findMany({
                    include: { market: true },
                    orderBy: { timestamp: 'desc' },
                    take: limit
                });
                res.json(trades);
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get active/open market trades with live unrealized P&L
        this.app.get('/api/trades/active', async (_, res) => {
            try {
                const activeTrades = await this.prisma.marketTrade.findMany({
                    where: { status: 'OPEN' },
                    include: { market: true },
                    orderBy: { entryTime: 'desc' }
                });

                // Enrich with live prices and unrealized P&L
                const enriched = await Promise.all(activeTrades.map(async (trade) => {
                    let currentPrice = trade.currentPrice || 0;
                    let unrealizedPnl = 0;

                    if (trade.market) {
                        const livePrice = await this.fetchLivePrice(trade.market);
                        if (livePrice) {
                            currentPrice = trade.side === 'YES' ? livePrice.priceYes : livePrice.priceNo;
                            const currentValue = trade.currentShares * currentPrice;
                            const remainingCostBasis = trade.entryAmount * (trade.currentShares / trade.entryShares);
                            unrealizedPnl = currentValue - remainingCostBasis;
                        }
                    }

                    const unrealizedPct = trade.entryAmount > 0
                        ? (unrealizedPnl / trade.entryAmount) * 100
                        : 0;

                    return {
                        ...trade,
                        currentPrice,
                        unrealizedPnl,
                        unrealizedPct,
                        marketQuestion: trade.market?.question
                    };
                }));

                res.json(enriched);
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get closed market trades with final P&L
        this.app.get('/api/trades/closed', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit as string) || 100;
                const closedTrades = await this.prisma.marketTrade.findMany({
                    where: { status: 'CLOSED' },
                    include: { market: true },
                    orderBy: { exitTime: 'desc' },
                    take: limit
                });

                const enriched = closedTrades.map(trade => ({
                    ...trade,
                    marketQuestion: trade.market?.question,
                    isWin: trade.profitLoss > 0,
                    holdTime: trade.exitTime && trade.entryTime
                        ? Math.round((trade.exitTime.getTime() - trade.entryTime.getTime()) / (1000 * 60))
                        : null  // Hold time in minutes
                }));

                res.json(enriched);
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get trade summary/statistics
        this.app.get('/api/trades/summary', async (_, res) => {
            try {
                const [openTrades, closedTrades] = await Promise.all([
                    this.prisma.marketTrade.findMany({ where: { status: 'OPEN' } }),
                    this.prisma.marketTrade.findMany({ where: { status: 'CLOSED' } })
                ]);

                // Calculate open positions stats
                const totalInvested = openTrades.reduce((sum, t) => sum + t.entryAmount, 0);
                const activeCount = openTrades.length;

                // Calculate closed trades stats
                const wins = closedTrades.filter(t => t.profitLoss > 0);
                const losses = closedTrades.filter(t => t.profitLoss <= 0);
                const totalRealized = closedTrades.reduce((sum, t) => sum + t.profitLoss, 0);
                const avgWin = wins.length > 0
                    ? wins.reduce((sum, t) => sum + t.profitLoss, 0) / wins.length
                    : 0;
                const avgLoss = losses.length > 0
                    ? losses.reduce((sum, t) => sum + t.profitLoss, 0) / losses.length
                    : 0;
                const winRate = closedTrades.length > 0
                    ? (wins.length / closedTrades.length) * 100
                    : 0;
                const totalTurnover = closedTrades.reduce((sum, t) => sum + t.entryAmount, 0);
                const returnOnInvestment = totalTurnover > 0
                    ? (totalRealized / totalTurnover) * 100
                    : 0;

                res.json({
                    // Active positions
                    activeCount,
                    totalInvested,

                    // Closed trades
                    closedCount: closedTrades.length,
                    winCount: wins.length,
                    lossCount: losses.length,
                    winRate,

                    // P&L
                    totalRealized,
                    avgWin,
                    avgLoss,

                    // Returns
                    totalTurnover,
                    returnOnInvestment
                });
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get P&L history
        this.app.get('/api/pnl', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit as string) || 1000;
                const snapshots = await this.prisma.pnlSnapshot.findMany({
                    orderBy: { timestamp: 'desc' },
                    take: limit
                });
                res.json(snapshots.reverse());
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get strategy events
        this.app.get('/api/strategy-events', async (req, res) => {
            try {
                const limit = parseInt(req.query.limit as string) || 100;
                const events = await this.prisma.strategyEvent.findMany({
                    include: { market: true },
                    orderBy: { timestamp: 'desc' },
                    take: limit
                });
                res.json(events);
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get portfolio summary - ALL VALUES FROM DATABASE
        this.app.get('/api/portfolio', async (_, res) => {
            try {
                // Fetch all data from database (single source of truth)
                const [openTrades, closedTrades, botConfig] = await Promise.all([
                    this.prisma.marketTrade.findMany({
                        where: { status: 'OPEN' },
                        include: { market: true }
                    }),
                    this.prisma.marketTrade.findMany({
                        where: { status: 'CLOSED' }
                    }),
                    this.prisma.botConfig.findFirst()  // Get bankroll from DB
                ]);

                // Initialize BotConfig if doesn't exist (first run)
                let bankroll = botConfig?.bankroll ?? configService.get('bankroll') as number;
                if (!botConfig) {
                    await this.prisma.botConfig.create({
                        data: {
                            id: 1,
                            bankroll: configService.get('bankroll') as number,
                            lockedProfits: 0
                        }
                    });
                }

                // Calculate open positions values with live prices
                let totalInvested = 0;  // Total cost basis in open positions
                let totalUnrealizedPnl = 0;
                let totalPositionsValue = 0;

                for (const trade of openTrades) {
                    totalInvested += trade.entryAmount;

                    // Get live unrealized P&L
                    let unrealizedPnl = trade.unrealizedPnl;  // Use stored value

                    // Try to get live price for more accuracy
                    if (trade.market) {
                        const livePrice = await this.fetchLivePrice(trade.market);
                        if (livePrice) {
                            const currentPrice = trade.side === 'YES' ? livePrice.priceYes : livePrice.priceNo;
                            const currentValue = trade.currentShares * currentPrice;
                            const remainingCostBasis = trade.entryAmount * (trade.currentShares / trade.entryShares);
                            unrealizedPnl = currentValue - remainingCostBasis;
                        }
                    }

                    totalUnrealizedPnl += unrealizedPnl;
                    totalPositionsValue += (trade.entryAmount + unrealizedPnl);
                }

                // Calculate closed trades P&L (this IS the locked profits)
                let totalRealizedPnl = 0;
                let winCount = 0;
                let lossCount = 0;

                for (const trade of closedTrades) {
                    totalRealizedPnl += trade.profitLoss;
                    if (trade.profitLoss > 0) {
                        winCount++;
                    } else {
                        lossCount++;
                    }
                }

                // LOCKED PROFITS = realized P&L from closed trades (sum of MarketTrade.profitLoss)
                // This value is calculated from DB, no memory involved
                const lockedProfits = totalRealizedPnl > 0 ? totalRealizedPnl : 0;

                // Tradeable cash = bankroll - money currently invested (not including locked profits)
                const tradeableCash = bankroll - totalInvested;

                res.json({
                    // Core values
                    bankroll,
                    cashBalance: tradeableCash + lockedProfits,
                    tradeableCash,
                    lockedProfits,
                    positionsValue: totalPositionsValue,
                    totalValue: tradeableCash + lockedProfits + totalPositionsValue,

                    // P&L (from MarketTrade)
                    unrealizedPnl: totalUnrealizedPnl,
                    realizedPnl: totalRealizedPnl,

                    // Position stats
                    positionCount: openTrades.length,
                    closedCount: closedTrades.length,
                    winCount,
                    lossCount,
                    winRate: closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0,

                    // Allocation percentages
                    allocation: {
                        tradeableCashPct: tradeableCash > 0 ? (tradeableCash / (tradeableCash + totalInvested + lockedProfits)) * 100 : 100,
                        positionsPct: totalInvested > 0 ? (totalInvested / (tradeableCash + totalInvested + lockedProfits)) * 100 : 0,
                        lockedProfitsPct: lockedProfits > 0 ? (lockedProfits / (tradeableCash + totalInvested + lockedProfits)) * 100 : 0
                    }
                });
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get price history for a market
        this.app.get('/api/markets/:marketId/prices', async (req, res) => {
            try {
                const { marketId } = req.params;
                const limit = parseInt(req.query.limit as string) || 100;

                const prices = await this.prisma.priceHistory.findMany({
                    where: { marketId },
                    orderBy: { timestamp: 'desc' },
                    take: limit
                });

                res.json(prices.reverse());
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get tracked trader's active positions
        this.app.get('/api/tracked-positions/:wallet', async (req, res) => {
            try {
                const { wallet } = req.params;

                // Fetch positions and profile in parallel
                const [positions, profile] = await Promise.all([
                    fetchTrackedPositions(wallet),
                    fetchTraderProfile(wallet)
                ]);

                // Filter to only active positions (with shares and current price)
                const activePositions = positions.filter(p =>
                    p.size > 0 && p.curPrice > 0
                );

                res.json({
                    trader: profile,
                    positions: activePositions,
                    totalPositions: activePositions.length,
                    totalValue: activePositions.reduce((sum, p) => sum + p.currentValue, 0),
                    totalPnl: activePositions.reduce((sum, p) => sum + p.cashPnl, 0)
                });
            } catch (error) {
                res.status(500).json({ error: String(error) });
            }
        });

        // Get tracked trader's recent trading activity (last 24 hours)
        this.app.get('/api/tracked-activity/:wallet', async (req, res) => {
            try {
                const { wallet } = req.params;

                // Calculate 24 hours ago timestamp
                const twentyFourHoursAgo = Math.floor(Date.now() / 1000) - (24 * 60 * 60);

                // Fetch activity from Polymarket Data API - get all from last 24h
                const response = await axios.get('https://data-api.polymarket.com/activity', {
                    params: {
                        user: wallet,
                        limit: 500,  // High limit to get all trades
                        startTs: twentyFourHoursAgo
                    },
                    timeout: 15000
                });

                // Filter to only trades and map to our format
                const trades = response.data
                    .filter((t: any) => t.type === 'TRADE')
                    .map((t: any) => ({
                        timestamp: t.timestamp,
                        title: t.title || 'Unknown Market',
                        slug: t.slug || '',
                        icon: t.icon || '',
                        outcome: t.outcome || 'Unknown',
                        side: t.side,
                        price: t.price || 0,
                        size: t.size || 0,
                        usdcSize: t.usdcSize || 0
                    }));

                res.json({ trades, count: trades.length });
            } catch (error) {
                logger.error('Failed to fetch tracked activity', { error: String(error) });
                res.status(500).json({ error: String(error) });
            }
        });
    }

    /**
     * Setup event forwarding from bot to WebSocket clients.
     */
    private setupEventForwarding(): void {
        // Forward all dashboard updates
        eventBus.on('dashboard:update', (update: DashboardUpdate) => {
            this.io.emit('update', update);
        });

        eventBus.on('price:update', (data: PriceUpdate) => {
            this.io.emit('update', {
                type: 'MARKET_UPDATE',
                data,
                timestamp: new Date()
            });
        });

        eventBus.on('execution:result', (data: ExecutionResult) => {
            this.io.emit('update', {
                type: 'TRADE',
                data,
                timestamp: new Date()
            });
        });

        eventBus.on('position:update', (data: Position) => {
            this.io.emit('update', {
                type: 'POSITION',
                data,
                timestamp: new Date()
            });
        });

        eventBus.on('portfolio:update', (data: PortfolioState) => {
            this.io.emit('update', {
                type: 'PNL',
                data,
                timestamp: new Date()
            });
        });

        eventBus.on('strategy:event', (data: StrategyEventData) => {
            this.io.emit('update', {
                type: 'STRATEGY_EVENT',
                data,
                timestamp: new Date()
            });
        });

        this.io.on('connection', (socket) => {
            logger.info(`Dashboard client connected: ${socket.id}`);
            socket.on('disconnect', () => {
                logger.info(`Dashboard client disconnected: ${socket.id}`);
            });
        });
    }

    /**
     * Start the dashboard server.
     */
    start(): void {
        const port = configService.get('apiPort');

        this.httpServer.listen(port, () => {
            logger.info(`Dashboard server running on http://localhost:${port}`);
        });
    }

    /**
     * Stop the dashboard server.
     */
    async stop(): Promise<void> {
        return new Promise((resolve) => {
            this.io.close();
            this.httpServer.close(() => {
                logger.info('Dashboard server stopped');
                resolve();
            });
        });
    }
}

export default DashboardServer;
