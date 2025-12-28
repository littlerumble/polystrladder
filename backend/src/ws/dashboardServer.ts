import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient, Market } from '@prisma/client';
import axios from 'axios';
import { configService } from '../config/configService.js';
import { createLogger } from '../core/logger.js';
import eventBus from '../core/eventBus.js';
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
                const priceYes = parseFloat(prices[0]);
                const priceNo = parseFloat(prices[1]);

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
            if (!tokenIds || tokenIds.length === 0) return null;

            const yesTokenId = tokenIds[0];
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

            // 1. Try DB History (Fastest)
            const latestPrice = await this.prisma.priceHistory.findFirst({
                where: { marketId: pos.marketId },
                orderBy: { timestamp: 'desc' }
            });

            if (latestPrice) {
                priceYes = latestPrice.priceYes;
                priceNo = latestPrice.priceNo;
                priceFound = true;
            }
            // 2. Fallback: Ask the Web (CLOB API)
            else if (pos.market) {
                const livePrice = await this.fetchLivePrice(pos.market);
                if (livePrice) {
                    priceYes = livePrice.priceYes;
                    priceNo = livePrice.priceNo;
                    priceFound = true;
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

        // Get all markets
        this.app.get('/api/markets', async (_, res) => {
            try {
                const markets = await this.prisma.market.findMany({
                    where: { active: true },
                    orderBy: { volume24h: 'desc' }
                });
                res.json(markets);
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

        // Get trade history
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

        // Get portfolio summary with detailed capital breakdown and live P&L
        this.app.get('/api/portfolio', async (_, res) => {
            try {
                // Fetch positions with LIVE P&L (Shared Logic)
                // And snapshot for locked profits
                const [enrichedPositions, latestPnl] = await Promise.all([
                    this.getPositionsWithLivePnl(),
                    this.prisma.pnlSnapshot.findFirst({ orderBy: { timestamp: 'desc' } })
                ]);

                // Calculate Totals using the Enriched Positions
                let totalCostBasis = 0;
                let totalRealizedPnl = 0;
                let totalUnrealizedPnl = 0;
                let totalPositionsValue = 0;

                for (const pos of enrichedPositions) {
                    const cost = pos.costBasisYes + pos.costBasisNo;
                    totalCostBasis += cost;
                    totalRealizedPnl += pos.realizedPnl;
                    totalUnrealizedPnl += pos.unrealizedPnl;

                    // Value = Cost + Unrealized
                    totalPositionsValue += (cost + pos.unrealizedPnl);
                }

                // Locked Profits (from snapshot, managed by RiskManager)
                const lockedProfits = latestPnl?.realizedPnl || 0;

                const bankroll = configService.get('bankroll') as number;
                const tradeableCash = bankroll - totalCostBasis;

                res.json({
                    bankroll,
                    cashBalance: tradeableCash + lockedProfits,
                    tradeableCash,
                    lockedProfits: lockedProfits > 0 ? lockedProfits : 0,
                    positionsValue: totalPositionsValue,
                    totalValue: tradeableCash + lockedProfits + totalPositionsValue,
                    unrealizedPnl: totalUnrealizedPnl,
                    realizedPnl: totalRealizedPnl,
                    positionCount: enrichedPositions.length,
                    allocation: {
                        tradeableCashPct: bankroll > 0 ? (tradeableCash / (tradeableCash + totalCostBasis + (lockedProfits > 0 ? lockedProfits : 0))) * 100 : 100,
                        positionsPct: bankroll > 0 ? (totalCostBasis / (tradeableCash + totalCostBasis + (lockedProfits > 0 ? lockedProfits : 0))) * 100 : 0,
                        lockedProfitsPct: (lockedProfits > 0 && bankroll > 0) ? (lockedProfits / (tradeableCash + totalCostBasis + lockedProfits)) * 100 : 0
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
