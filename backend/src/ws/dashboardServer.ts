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
                        return { ...pos, unrealizedPnl };
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
                const [positions, latestPnl] = await Promise.all([
                    this.prisma.position.findMany(),
                    this.prisma.pnlSnapshot.findFirst({ orderBy: { timestamp: 'desc' } })
                ]);

                // Calculate total cost basis and LIVE unrealized P&L
                let totalCostBasis = 0;
                let totalUnrealizedPnl = 0;
                let totalPositionsValue = 0;

                // Fetch latest prices for all positions
                for (const pos of positions) {
                    totalCostBasis += (pos.costBasisYes + pos.costBasisNo);

                    const latestPrice = await this.prisma.priceHistory.findFirst({
                        where: { marketId: pos.marketId },
                        orderBy: { timestamp: 'desc' }
                    });

                    if (latestPrice) {
                        const yesValue = pos.sharesYes * latestPrice.priceYes;
                        const noValue = pos.sharesNo * latestPrice.priceNo;
                        const val = yesValue + noValue;
                        const cost = pos.costBasisYes + pos.costBasisNo;

                        totalPositionsValue += val;
                        totalUnrealizedPnl += (val - cost);
                    } else {
                        // Fallback to cost basis if no price
                        const cost = pos.costBasisYes + pos.costBasisNo;
                        totalPositionsValue += cost;
                    }
                }

                // Calculate realized profits from all positions (this is the locked bucket)
                const totalRealizedProfits = positions.reduce(
                    (sum, p) => sum + (p.realizedPnl > 0 ? p.realizedPnl : 0),
                    0
                );

                // Also check historical trades for closed positions' profits
                const closedTrades = await this.prisma.trade.findMany({
                    where: { strategy: 'PROFIT_TAKING', status: 'FILLED' }
                });

                // Get the locked profits from PnL snapshot
                const lockedProfits = latestPnl?.realizedPnl || 0;

                // Tradeable cash = bankroll - active positions cost basis
                // Note: Realized profits are SEPARATE and locked away
                const bankroll = configService.get('bankroll') as number;
                const tradeableCash = bankroll - totalCostBasis;

                res.json({
                    bankroll,
                    cashBalance: tradeableCash + lockedProfits, // Total liquid (for backward compat)
                    tradeableCash,  // NEW: What you can actually trade with
                    lockedProfits: lockedProfits > 0 ? lockedProfits : 0,  // NEW: Protected profits bucket
                    positionsValue: totalPositionsValue,
                    totalValue: tradeableCash + lockedProfits + totalPositionsValue,
                    unrealizedPnl: totalUnrealizedPnl,
                    realizedPnl: latestPnl?.realizedPnl || 0,
                    positionCount: positions.length,
                    // NEW: Capital allocation percentages
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
