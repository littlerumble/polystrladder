import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { PrismaClient } from '@prisma/client';
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

/**
 * Dashboard Server - Serves REST API and WebSocket for the React dashboard.
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
                const positions = await this.prisma.position.findMany({
                    include: { market: true }
                });

                // Update positions with current P&L based on latest price history
                const updatedPositions = await Promise.all(positions.map(async (pos) => {
                    const latestPrice = await this.prisma.priceHistory.findFirst({
                        where: { marketId: pos.marketId },
                        orderBy: { timestamp: 'desc' }
                    });

                    if (latestPrice) {
                        const yesValue = pos.sharesYes * latestPrice.priceYes;
                        const noValue = pos.sharesNo * latestPrice.priceNo;
                        const costBasis = pos.costBasisYes + pos.costBasisNo;
                        const unrealizedPnl = (yesValue + noValue) - costBasis;
                        return {
                            ...pos,
                            unrealizedPnl,
                            currentPriceYes: latestPrice.priceYes,
                            currentPriceNo: latestPrice.priceNo
                        };
                    }
                    return pos;
                }));

                res.json(updatedPositions);
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
                // Fetch positions with market data to ensure we can look up prices
                const [positions, latestPnl] = await Promise.all([
                    this.prisma.position.findMany({ include: { market: true } }),
                    this.prisma.pnlSnapshot.findFirst({ orderBy: { timestamp: 'desc' } })
                ]);

                // 1. Calculate Synchronous Totals (Cost Basis, Realized P&L from Positions)
                let totalCostBasis = 0;
                let totalRealizedPnl = 0;

                for (const pos of positions) {
                    totalCostBasis += (pos.costBasisYes + pos.costBasisNo);
                    totalRealizedPnl += pos.realizedPnl;
                }

                // 2. Calculate Asynchronous Totals (Unrealized P&L using Live Prices)
                let totalUnrealizedPnl = 0;
                let totalPositionsValue = 0;

                // Use Promise.all to fetch prices in parallel - more robust than sequential loop
                const priceResults = await Promise.all(positions.map(async (pos) => {
                    const latestPrice = await this.prisma.priceHistory.findFirst({
                        where: { marketId: pos.marketId },
                        orderBy: { timestamp: 'desc' }
                    });

                    if (latestPrice) {
                        const yesValue = pos.sharesYes * latestPrice.priceYes;
                        const noValue = pos.sharesNo * latestPrice.priceNo;
                        const val = yesValue + noValue;
                        const cost = pos.costBasisYes + pos.costBasisNo;
                        return { val, pnl: val - cost };
                    }

                    // Fallback if price missing
                    const cost = pos.costBasisYes + pos.costBasisNo;
                    return { val: cost, pnl: 0 };
                }));

                // Sum up price results
                priceResults.forEach(r => {
                    totalPositionsValue += r.val;
                    totalUnrealizedPnl += r.pnl;
                });

                // 3. Prepare Response Data

                // "Locked Profits" bucket logic
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
                    // FIX: Return total realized P&L from positions so losses are shown
                    realizedPnl: totalRealizedPnl,
                    positionCount: positions.length,
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
        // Forward all dashboard updates to connected clients
        eventBus.on('dashboard:update', (update: DashboardUpdate) => {
            this.io.emit('update', update);
        });

        // Forward specific events as dashboard updates
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

        // Handle WebSocket connections
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
