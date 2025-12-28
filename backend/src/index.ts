import { PrismaClient } from '@prisma/client';
import { configService } from './config/configService.js';
import { systemLogger as logger } from './core/logger.js';
import eventBus from './core/eventBus.js';
import {
    MarketState,
    MarketRegime,
    StrategyType,
    PriceUpdate,
    ProposedOrder,
    Order,
    Side,
    MarketData
} from './core/types.js';

// Components
import { MarketLoader } from './markets/marketLoader.js';
import { classifyRegime, isSignificantTransition } from './markets/regimeClassifier.js';
import { ClobFeed } from './ws/clobFeed.js';
import { DashboardServer } from './ws/dashboardServer.js';
import { selectStrategy, shouldConsiderTailInsurance } from './strategies/strategySelector.js';
import exitStrategy from './strategies/exitStrategy.js';
import { generateLadderOrders, markLadderFilled } from './strategies/ladder.js';
import { generateVolatilityOrders } from './strategies/volatility.js';
import { generateTailInsuranceOrder, markTailActive } from './strategies/tail.js';
import { RiskManager } from './risk/riskManager.js';
import { PaperExecutor } from './execution/paperExecutor.js';
import { Executor } from './execution/executor.js';

/**
 * Main Bot Orchestrator - Event-driven trading loop.
 */
class TradingBot {
    private prisma: PrismaClient;
    private marketLoader: MarketLoader;
    private clobFeed: ClobFeed;
    private dashboardServer: DashboardServer;
    private riskManager: RiskManager;
    private executor: Executor;

    // State
    private marketStates: Map<string, MarketState> = new Map();
    private tokenToMarket: Map<string, string> = new Map();
    private marketTokens: Map<string, string[]> = new Map(); // marketId -> [yesTokenId, noTokenId]
    private pnlInterval: NodeJS.Timeout | null = null;
    private isRunning = false;

    constructor() {
        this.prisma = new PrismaClient();
        this.marketLoader = new MarketLoader(this.prisma);
        this.clobFeed = new ClobFeed(this.prisma);
        this.dashboardServer = new DashboardServer(this.prisma);
        this.riskManager = new RiskManager(this.prisma);

        // Initialize executor based on mode
        const mode = configService.get('mode');
        if (mode === 'PAPER') {
            this.executor = new PaperExecutor(this.prisma);
        } else {
            // TODO: Implement RealExecutor when ready for live trading
            this.executor = new PaperExecutor(this.prisma);
            logger.warn('LIVE mode not implemented, using PAPER executor');
        }
    }

    /**
     * Initialize and start the bot.
     */
    async start(): Promise<void> {
        logger.info('Starting Polymarket Trading Bot...', {
            mode: configService.get('mode'),
            bankroll: configService.get('bankroll')
        });

        try {
            // Connect to database
            await this.prisma.$connect();
            logger.info('Database connected');

            // Initialize risk manager
            await this.riskManager.initialize();

            // Load persisted market states
            await this.loadMarketStates();

            // Start dashboard server
            this.dashboardServer.start();

            // Load and filter markets
            const markets = await this.marketLoader.loadAndPersistMarkets();
            logger.info(`Loaded ${markets.length} eligible markets`);

            // Build token mappings
            for (const market of markets) {
                this.marketTokens.set(market.marketId, market.clobTokenIds);
                for (const tokenId of market.clobTokenIds) {
                    this.tokenToMarket.set(tokenId, market.marketId);
                }

                // Initialize market state if not exists
                if (!this.marketStates.has(market.marketId)) {
                    this.initializeMarketState(market.marketId);
                }
            }

            // Setup event handlers
            this.setupEventHandlers();

            // Connect to CLOB WebSocket
            await this.clobFeed.connect();

            // Subscribe to market price feeds
            this.clobFeed.subscribeToMarkets(
                markets.map(m => ({
                    marketId: m.marketId,
                    clobTokenIds: m.clobTokenIds
                }))
            );

            // Start periodic tasks
            this.marketLoader.startPeriodicRefresh();
            this.startPnlSnapshots();

            this.isRunning = true;
            eventBus.emit('system:ready');
            logger.info('Bot is running');

        } catch (error) {
            logger.error('Failed to start bot', { error: String(error) });
            await this.stop();
            throw error;
        }
    }

    /**
     * Setup event handlers for the trading loop.
     */
    private setupEventHandlers(): void {
        // Handle price updates - this is the main trading loop trigger
        eventBus.on('price:update', async (update: PriceUpdate) => {
            try {
                await this.handlePriceUpdate(update);
            } catch (error) {
                logger.error('Error handling price update', {
                    error: String(error),
                    marketId: update.marketId
                });
            }
        });

        // Handle new markets from periodic refresh
        eventBus.on('market:filtered', async (markets: MarketData[]) => {
            for (const market of markets) {
                if (!this.marketTokens.has(market.marketId)) {
                    this.marketTokens.set(market.marketId, market.clobTokenIds);
                    for (const tokenId of market.clobTokenIds) {
                        this.tokenToMarket.set(tokenId, market.marketId);
                    }
                    this.initializeMarketState(market.marketId);

                    // Subscribe to new market
                    this.clobFeed.subscribe(market.marketId, market.clobTokenIds);
                }
            }
        });

        // Handle WebSocket reconnection
        eventBus.on('ws:connected', () => {
            logger.info('WebSocket reconnected, resubscribing...');
        });
    }

    /**
     * Main trading loop - triggered on every price update.
     */
    private async handlePriceUpdate(update: PriceUpdate): Promise<void> {
        const state = this.marketStates.get(update.marketId);
        if (!state) return;

        // 1. Update market state with new price
        const updatedState = this.updateMarketState(state, update);

        // 2. Classify regime
        const market = await this.prisma.market.findUnique({
            where: { id: update.marketId }
        });
        if (!market) return;

        const timeToResolution = market.endDate.getTime() - Date.now();
        const priceHistory = updatedState.priceHistory.map(p => ({
            price: p.price,
            timestamp: p.timestamp
        }));

        const newRegime = classifyRegime(
            timeToResolution,
            update.priceYes,
            priceHistory
        );

        // Check for regime transition
        if (isSignificantTransition(updatedState.regime, newRegime)) {
            logger.info('Regime transition', {
                marketId: update.marketId,
                from: updatedState.regime,
                to: newRegime
            });
            eventBus.emit('state:regime_change', update.marketId, updatedState.regime, newRegime);
        }

        updatedState.regime = newRegime;

        // 3. Select strategy
        const strategy = selectStrategy(newRegime);

        // 4. Generate proposed orders
        const tokenIds = this.marketTokens.get(update.marketId) || [];
        const tokenIdYes = tokenIds[0];
        const tokenIdNo = tokenIds[1];

        let proposedOrders: ProposedOrder[] = [];

        if (strategy === StrategyType.LADDER_COMPRESSION && tokenIdYes) {
            proposedOrders = generateLadderOrders(updatedState, tokenIdYes);
        } else if (strategy === StrategyType.VOLATILITY_ABSORPTION && tokenIdYes && tokenIdNo) {
            proposedOrders = generateVolatilityOrders(updatedState, tokenIdYes, tokenIdNo);
        }

        // 5. Check for tail insurance opportunity
        if (shouldConsiderTailInsurance(
            newRegime,
            update.priceNo,
            updatedState.exposureYes,
            configService.get('tailPriceThreshold'),
            configService.get('bankroll') * 0.01
        ) && tokenIdNo) {
            const tailOrder = generateTailInsuranceOrder(updatedState, tokenIdNo, update.priceNo);
            if (tailOrder) {
                proposedOrders.push(tailOrder);
            }
        }

        // 6. Check for Profit Taking
        // We do this BEFORE regular strategy execution to prioritize locking in gains
        const position = this.riskManager.getPosition(update.marketId);
        if (position) {
            const profitCheck = exitStrategy.shouldTakeProfit(
                position,
                update.priceYes,
                update.priceNo
            );

            if (profitCheck.shouldExit && tokenIdYes && tokenIdNo) {
                const exitOrder = exitStrategy.generateExitOrder(updatedState, position, tokenIdYes, tokenIdNo);
                if (exitOrder) {
                    logger.info('Taking profit', {
                        marketId: update.marketId,
                        profitPct: profitCheck.profitPct,
                        reason: profitCheck.reason
                    });
                    proposedOrders.push(exitOrder);
                }
            }
        }

        // 6. Apply risk checks and execute
        for (const proposed of proposedOrders) {
            const riskResult = this.riskManager.checkOrder(proposed);

            if (!riskResult.approved) {
                logger.debug('Order rejected by risk manager', {
                    marketId: proposed.marketId,
                    reason: riskResult.rejectionReason
                });
                continue;
            }

            const orderToExecute = riskResult.adjustedOrder || proposed;

            // Convert to Order
            const order: Order = {
                marketId: orderToExecute.marketId,
                tokenId: orderToExecute.tokenId,
                side: orderToExecute.side,
                price: orderToExecute.price,
                sizeUsdc: orderToExecute.sizeUsdc,
                shares: orderToExecute.shares,
                strategy: orderToExecute.strategy,
                strategyDetail: orderToExecute.strategyDetail,
                isExit: orderToExecute.isExit,
                timestamp: new Date()
            };

            // Execute
            const result = await this.executor.execute(order);

            if (result.success) {
                // Update risk manager
                this.riskManager.recordExecution(orderToExecute, result.filledUsdc, result.filledShares);

                // Update state based on strategy
                if (order.strategy === StrategyType.LADDER_COMPRESSION && order.strategyDetail) {
                    const level = parseFloat(order.strategyDetail.split('_')[1]);
                    this.marketStates.set(update.marketId, markLadderFilled(updatedState, level));
                } else if (order.strategy === StrategyType.TAIL_INSURANCE) {
                    this.marketStates.set(update.marketId, markTailActive(updatedState));
                }

                // Update exposure in state
                if (order.side === Side.YES) {
                    updatedState.exposureYes += result.filledUsdc;
                } else {
                    updatedState.exposureNo += result.filledUsdc;
                }

                // Log strategy event
                await this.prisma.strategyEvent.create({
                    data: {
                        marketId: order.marketId,
                        regime: newRegime,
                        strategy: order.strategy,
                        action: 'EXECUTED',
                        priceYes: update.priceYes,
                        priceNo: update.priceNo,
                        details: JSON.stringify({
                            side: order.side,
                            size: result.filledUsdc,
                            shares: result.filledShares,
                            strategyDetail: order.strategyDetail
                        })
                    }
                });
            }


            // If this was a full exit, clean up the market to free space
            // We check if position is now empty/closed in RiskManager (which we just updated above)
            // But RiskManager logic might be async or we just want to be sure here
            if (order.isExit && result.success) {
                const remainingPos = this.riskManager.getPosition(order.marketId);
                // If no remaining position (it was deleted or shares are 0), we unsubscribe
                if (!remainingPos || (remainingPos.sharesYes <= 0 && remainingPos.sharesNo <= 0)) {
                    logger.info('Profit taken and position closed. Unsubscribing to free up slot.', {
                        marketId: order.marketId
                    });

                    // Unsubscribe from WebSocket
                    const tokens = this.marketTokens.get(order.marketId) || [];
                    if (tokens.length > 0) {
                        this.clobFeed.unsubscribe(order.marketId, tokens);
                    }

                    // Clear from local state maps to stop processing
                    // We keep the marketState in DB/Map for history/reference but stop active tracking
                    // or maybe we should remove it from marketStates to save memory? 
                    // Let's remove it from active processing maps.
                    this.marketTokens.delete(order.marketId);
                    // Note: We don't delete from tokenToMarket immediately or strictly necessary 
                    // unless we want to absolutely prevent any stray messages. 
                    // But `marketTokens.delete` prevents `handlePriceUpdate` from finding tokens later if we used it.
                    // Actually `handlePriceUpdate` uses `marketStates`.
                    this.marketStates.delete(order.marketId);

                    // Also removing from tokenToMarket to be clean
                    for (const t of tokens) {
                        this.tokenToMarket.delete(t);
                    }
                }
            }
        }

        // 7. Save updated state
        this.marketStates.set(update.marketId, updatedState);
        await this.persistMarketState(updatedState);
    }

    /**
     * Initialize a new market state.
     */
    private initializeMarketState(marketId: string): void {
        const state: MarketState = {
            marketId,
            regime: MarketRegime.MID_CONSENSUS,
            lastPriceYes: 0.5,
            lastPriceNo: 0.5,
            priceHistory: [],
            ladderFilled: [],
            exposureYes: 0,
            exposureNo: 0,
            tailActive: false,
            lastUpdated: new Date()
        };
        this.marketStates.set(marketId, state);
    }

    /**
     * Update market state with new price.
     */
    private updateMarketState(state: MarketState, update: PriceUpdate): MarketState {
        const config = configService.getAll();
        const windowMs = config.volatilityWindowMinutes * 60 * 1000;
        const now = Date.now();

        // Add to price history
        const newHistory = [
            ...state.priceHistory.filter(p => (now - p.timestamp.getTime()) < windowMs),
            { price: update.priceYes, timestamp: update.timestamp }
        ];

        return {
            ...state,
            lastPriceYes: update.priceYes,
            lastPriceNo: update.priceNo,
            priceHistory: newHistory,
            lastUpdated: update.timestamp
        };
    }

    /**
     * Load persisted market states from database.
     */
    private async loadMarketStates(): Promise<void> {
        const states = await this.prisma.marketState.findMany();

        for (const dbState of states) {
            const state: MarketState = {
                marketId: dbState.marketId,
                regime: dbState.regime as MarketRegime,
                lastPriceYes: 0.5,
                lastPriceNo: 0.5,
                priceHistory: [],
                ladderFilled: JSON.parse(dbState.ladderFilled),
                exposureYes: 0,
                exposureNo: 0,
                tailActive: dbState.tailActive,
                lastUpdated: dbState.lastProcessed
            };

            // Load exposure from positions
            const position = await this.prisma.position.findUnique({
                where: { marketId: dbState.marketId }
            });
            if (position) {
                state.exposureYes = position.costBasisYes;
                state.exposureNo = position.costBasisNo;
            }

            this.marketStates.set(dbState.marketId, state);
        }

        logger.info(`Loaded ${states.length} market states from database`);
    }

    /**
     * Persist market state to database.
     */
    private async persistMarketState(state: MarketState): Promise<void> {
        // Ensure valid date
        const lastProcessed = state.lastUpdated instanceof Date && !isNaN(state.lastUpdated.getTime())
            ? state.lastUpdated
            : new Date();

        await this.prisma.marketState.upsert({
            where: { marketId: state.marketId },
            update: {
                regime: state.regime,
                ladderFilled: JSON.stringify(state.ladderFilled),
                tailActive: state.tailActive,
                lastProcessed
            },
            create: {
                marketId: state.marketId,
                regime: state.regime,
                ladderFilled: JSON.stringify(state.ladderFilled),
                tailActive: state.tailActive,
                lastProcessed
            }
        });
    }

    /**
     * Start periodic P&L snapshots.
     */
    private startPnlSnapshots(): void {
        const interval = configService.get('pnlSnapshotIntervalMs');

        this.pnlInterval = setInterval(async () => {
            try {
                await this.takePnlSnapshot();
            } catch (error) {
                logger.error('Failed to take P&L snapshot', { error: String(error) });
            }
        }, interval);

        logger.info(`Started P&L snapshots every ${interval / 1000}s`);
    }

    /**
     * Take a P&L snapshot.
     */
    private async takePnlSnapshot(): Promise<void> {
        const positions = await this.prisma.position.findMany();

        // Build current prices map
        const currentPrices = new Map<string, { yes: number; no: number }>();
        for (const [marketId, state] of this.marketStates) {
            currentPrices.set(marketId, {
                yes: state.lastPriceYes,
                no: state.lastPriceNo
            });
        }

        // Calculate values
        let positionsValue = 0;
        let unrealizedPnl = 0;
        let realizedPnl = 0;
        const cashBalance = this.riskManager.getCashBalance();

        for (const position of positions) {
            const prices = currentPrices.get(position.marketId);
            if (prices) {
                const yesValue = position.sharesYes * prices.yes;
                const noValue = position.sharesNo * prices.no;
                positionsValue += yesValue + noValue;

                const costBasis = position.costBasisYes + position.costBasisNo;
                unrealizedPnl += (yesValue + noValue) - costBasis;
            }
            realizedPnl += position.realizedPnl;
        }

        const totalValue = cashBalance + positionsValue;

        await this.prisma.pnlSnapshot.create({
            data: {
                totalValue,
                cashBalance,
                positionsValue,
                unrealizedPnl,
                realizedPnl
            }
        });

        // Emit portfolio update
        eventBus.emit('portfolio:update', {
            cashBalance,
            positions: this.riskManager.getAllPositions(),
            totalValue,
            unrealizedPnl,
            realizedPnl
        });
    }

    /**
     * Stop the bot gracefully.
     */
    async stop(): Promise<void> {
        logger.info('Stopping bot...');
        this.isRunning = false;

        // Stop periodic tasks
        if (this.pnlInterval) {
            clearInterval(this.pnlInterval);
        }
        this.marketLoader.stopPeriodicRefresh();

        // Disconnect
        this.clobFeed.disconnect();
        await this.dashboardServer.stop();
        await this.prisma.$disconnect();

        eventBus.emit('system:shutdown');
        logger.info('Bot stopped');
    }
}

// Main entry point
const bot = new TradingBot();

// Handle shutdown signals
process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await bot.stop();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await bot.stop();
    process.exit(0);
});

// Start the bot
bot.start().catch((error) => {
    logger.error('Failed to start bot', { error: String(error) });
    process.exit(1);
});
