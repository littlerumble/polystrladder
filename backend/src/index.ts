import { PrismaClient } from '@prisma/client';
import axios from 'axios';
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
import { generateLadderOrders, markLadderFilled, generateDCAOrders } from './strategies/ladder.js';
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
    private processingLocks: Set<string> = new Set(); // Prevent concurrent processing per market
    private pnlInterval: NodeJS.Timeout | null = null;
    private resolutionCheckInterval: NodeJS.Timeout | null = null;
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
                    await this.initializeMarketState(market.marketId);
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
            this.startResolutionChecks();
            this.startGammaPricePolling(); // CRITICAL: Use Gamma prices, not garbage CLOB prices

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
                    await this.initializeMarketState(market.marketId);

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

        // CRITICAL: Prevent concurrent processing of the same market
        // This fixes race condition where multiple price updates trigger duplicate trades
        if (this.processingLocks.has(update.marketId)) {
            logger.debug('Skipping price update - market is being processed', { marketId: update.marketId });
            return;
        }
        this.processingLocks.add(update.marketId);

        try {
            // 1. Update market state with new price
            let updatedState = this.updateMarketState(state, update);

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
                proposedOrders = generateLadderOrders(updatedState, tokenIdYes, tokenIdNo);
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

            // 5.5 Check for DCA opportunity (buy dips pre-game only)
            // Works for BOTH YES and NO positions
            const existingPosition = this.riskManager.getPosition(update.marketId);
            if (existingPosition && (existingPosition.sharesYes > 0 || existingPosition.sharesNo > 0)) {
                const dcaOrders = generateDCAOrders(
                    updatedState,
                    {
                        sharesYes: existingPosition.sharesYes,
                        avgEntryYes: existingPosition.avgEntryYes || 0,
                        sharesNo: existingPosition.sharesNo,
                        avgEntryNo: existingPosition.avgEntryNo || 0,
                        dcaBuys: 0  // TODO: Track DCA count in position if needed
                    },
                    tokenIdYes,
                    tokenIdNo,
                    market?.endDate  // Use endDate as game start
                );
                proposedOrders.push(...dcaOrders);
            }

            // 6. Check for Pre-game Stop Loss FIRST (exit at 60%, 10 min cooldown)
            // We do this BEFORE regular strategy execution to prioritize exits
            const position = this.riskManager.getPosition(update.marketId);
            if (position) {
                // Determine which side we hold
                const positionSide = position.sharesYes > 0 ? 'YES' as const :
                    position.sharesNo > 0 ? 'NO' as const : null;

                // Check pre-game stop loss (exit if < 60% before match)
                const preGameCheck = exitStrategy.checkPreGameStopLoss(
                    updatedState,
                    update.priceYes,
                    update.priceNo,
                    positionSide,
                    market?.endDate  // Use endDate as game start time
                );
                updatedState = preGameCheck.updatedState;

                if (preGameCheck.shouldExit && tokenIdYes && tokenIdNo) {
                    const exitOrder = exitStrategy.generateExitOrder(
                        updatedState,
                        position,
                        tokenIdYes,
                        tokenIdNo,
                        1.0  // Full exit for pre-game stop loss
                    );
                    if (exitOrder) {
                        logger.info('🛑 PRE-GAME STOP LOSS EXIT', {
                            marketId: update.marketId,
                            side: positionSide,
                            reason: preGameCheck.reason
                        });
                        proposedOrders = [exitOrder];
                        // Persist updated state with cooldown
                        await this.persistMarketState(updatedState);
                        this.marketStates.set(update.marketId, updatedState);
                    }
                }

                // First, check and track consensus break state
                const consensusCheck = exitStrategy.checkConsensusBreak(updatedState, update.priceYes);
                updatedState = consensusCheck.updatedState;

                // Check if we should exit (profit, moon bag exit, or thesis stop)
                const exitCheck = exitStrategy.shouldTakeProfit(
                    position,
                    update.priceYes,
                    update.priceNo,
                    updatedState.consensusBreakConfirmed,
                    updatedState.moonBagActive,
                    updatedState.moonBagPriceAtActivation,
                    market?.endDate  // Use endDate instead of gameStartTime
                );

                if (exitCheck.shouldExit && tokenIdYes && tokenIdNo) {
                    const exitOrder = exitStrategy.generateExitOrder(
                        updatedState,
                        position,
                        tokenIdYes,
                        tokenIdNo,
                        exitCheck.exitPct  // 0.75 for partial, 1.0 for full
                    );

                    if (exitOrder) {
                        if (exitCheck.isMoonBagExit) {
                            logger.info('🌙 MOON BAG EXIT - Price dropped, selling remaining', {
                                marketId: update.marketId,
                                reason: exitCheck.reason
                            });
                        } else if (exitCheck.isProfit && exitCheck.exitPct < 1.0) {
                            logger.info('💰 TAKING 75% PROFIT - Creating moon bag', {
                                marketId: update.marketId,
                                profitPct: (exitCheck.profitPct * 100).toFixed(1) + '%',
                                reason: exitCheck.reason
                            });
                            // Activate moon bag after this order executes
                            updatedState.moonBagActive = true;
                            updatedState.moonBagPriceAtActivation = update.priceYes;
                        } else if (exitCheck.isProfit) {
                            logger.info('💰 TAKING FULL PROFIT', {
                                marketId: update.marketId,
                                profitPct: (exitCheck.profitPct * 100).toFixed(1) + '%'
                            });
                        } else {
                            logger.info('🛑 THESIS STOP - Consensus broken', {
                                marketId: update.marketId,
                                pnlPct: (exitCheck.profitPct * 100).toFixed(1) + '%',
                                reason: exitCheck.reason
                            });
                        }

                        // IMPORTANT: When exiting, only include the exit order
                        proposedOrders = [exitOrder];
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
                        const newState = markLadderFilled(updatedState, level);
                        this.marketStates.set(update.marketId, newState);
                        // CRITICAL: Persist to DB so ladder level stays filled on restart
                        await this.persistMarketState(newState);
                        updatedState = newState;
                    } else if (order.strategy === StrategyType.TAIL_INSURANCE) {
                        const newState = markTailActive(updatedState);
                        this.marketStates.set(update.marketId, newState);
                        await this.persistMarketState(newState);
                        updatedState = newState;
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
        } finally {
            // ALWAYS release the lock, even on error
            this.processingLocks.delete(update.marketId);
        }
    }

    /**
     * Initialize a new market state.
     * 
     * CRITICAL: Fetches live price from Gamma API to avoid defaulting to 0.5
     */
    private async initializeMarketState(marketId: string): Promise<void> {
        // Try to get live price from Gamma API
        let priceYes = 0.5;
        let priceNo = 0.5;

        try {
            const response = await axios.get(
                `https://gamma-api.polymarket.com/markets/${marketId}`,
                { timeout: 5000 }
            );
            const marketData = response.data;

            if (marketData.outcomePrices) {
                const prices = JSON.parse(marketData.outcomePrices);
                const fetchedPriceYes = parseFloat(prices[0]);
                const fetchedPriceNo = parseFloat(prices[1]);

                if (!isNaN(fetchedPriceYes) && !isNaN(fetchedPriceNo)) {
                    priceYes = fetchedPriceYes;
                    priceNo = fetchedPriceNo;
                }
            }
        } catch (error) {
            // Use default 0.5, WebSocket will update it
        }

        // Classify regime based on live price (not default to MID_CONSENSUS)
        // If price is above 0.55, it should be MID_CONSENSUS (not EARLY_UNCERTAIN)
        let initialRegime: MarketRegime;
        if (priceYes >= 0.45 && priceYes <= 0.55) {
            initialRegime = MarketRegime.EARLY_UNCERTAIN;
        } else {
            initialRegime = MarketRegime.MID_CONSENSUS;
        }

        const state: MarketState = {
            marketId,
            regime: initialRegime,
            lastPriceYes: priceYes,
            lastPriceNo: priceNo,
            priceHistory: [],
            ladderFilled: [],
            exposureYes: 0,
            exposureNo: 0,
            tailActive: false,
            lastUpdated: new Date(),
            consensusBreakConfirmed: false,
            moonBagActive: false
        };
        this.marketStates.set(marketId, state);

        // Persist immediately so dashboard reflects correct regime
        await this.persistMarketState(state);
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
     * 
     * CRITICAL: Fetches live prices from Gamma API to avoid defaulting to 0.5
     */
    private async loadMarketStates(): Promise<void> {
        const states = await this.prisma.marketState.findMany({
            include: { market: true }
        });

        for (const dbState of states) {
            // Try to get live price from Gamma API
            let priceYes = 0.5;
            let priceNo = 0.5;

            if (dbState.market) {
                try {
                    const response = await axios.get(
                        `https://gamma-api.polymarket.com/markets/${dbState.marketId}`,
                        { timeout: 5000 }
                    );
                    const marketData = response.data;

                    if (marketData.outcomePrices) {
                        const prices = JSON.parse(marketData.outcomePrices);
                        const fetchedPriceYes = parseFloat(prices[0]);
                        const fetchedPriceNo = parseFloat(prices[1]);

                        if (!isNaN(fetchedPriceYes) && !isNaN(fetchedPriceNo)) {
                            priceYes = fetchedPriceYes;
                            priceNo = fetchedPriceNo;
                            logger.debug(`Loaded live price for ${dbState.marketId}: ${(priceYes * 100).toFixed(1)}¢`);
                        }
                    }
                } catch (error) {
                    logger.debug(`Failed to fetch live price for ${dbState.marketId} on startup`);
                }
            }

            // CRITICAL FIX: Recalculate regime from live price, NOT the stale DB value!
            // Giants at 92.5% was showing EARLY_UNCERTAIN because DB had old regime.
            let calculatedRegime: MarketRegime;
            if (priceYes >= 0.45 && priceYes <= 0.55) {
                calculatedRegime = MarketRegime.EARLY_UNCERTAIN;
            } else if (priceYes >= 0.85) {
                calculatedRegime = MarketRegime.LATE_COMPRESSED;
            } else {
                calculatedRegime = MarketRegime.MID_CONSENSUS;
            }

            // Log if regime changed from DB
            if (calculatedRegime !== dbState.regime) {
                logger.info(`Regime recalculated for ${dbState.marketId}: ${dbState.regime} -> ${calculatedRegime} (price: ${(priceYes * 100).toFixed(1)}%)`);
            }

            const state: MarketState = {
                marketId: dbState.marketId,
                regime: calculatedRegime,  // Use recalculated, not DB value
                lastPriceYes: priceYes,
                lastPriceNo: priceNo,
                priceHistory: [],
                ladderFilled: JSON.parse(dbState.ladderFilled),
                exposureYes: 0,
                exposureNo: 0,
                tailActive: dbState.tailActive,
                lastUpdated: dbState.lastProcessed,
                consensusBreakConfirmed: false,
                moonBagActive: false
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

            // Persist the corrected regime to DB
            await this.persistMarketState(state);
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
                stopLossTriggeredAt: state.stopLossTriggeredAt || null,
                cooldownUntil: state.cooldownUntil || null,
                lastProcessed
            },
            create: {
                marketId: state.marketId,
                regime: state.regime,
                ladderFilled: JSON.stringify(state.ladderFilled),
                tailActive: state.tailActive,
                stopLossTriggeredAt: state.stopLossTriggeredAt || null,
                cooldownUntil: state.cooldownUntil || null,
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
     * Start periodic market resolution checks.
     * Checks Gamma API for markets that have been resolved/closed.
     */
    private startResolutionChecks(): void {
        // Check every 2 minutes for market resolutions
        const interval = 120000;

        this.resolutionCheckInterval = setInterval(async () => {
            try {
                await this.checkMarketResolutions();
            } catch (error) {
                logger.error('Failed to check market resolutions', { error: String(error) });
            }
        }, interval);

        logger.info('Started market resolution checks every 2 minutes');
    }

    /**
     * Start periodic Gamma API price polling.
     * CRITICAL: CLOB WebSocket sends garbage prices (0.50) from bad bid/ask spreads.
     * We need to poll Gamma API every 30s to get accurate prices for trading decisions.
     */
    private gammaPriceInterval: NodeJS.Timeout | null = null;

    private startGammaPricePolling(): void {
        const pollInterval = 2000; // 2 seconds for accurate trading

        this.gammaPriceInterval = setInterval(async () => {
            try {
                await this.pollGammaPrices();
            } catch (error) {
                logger.error('Failed to poll Gamma prices', { error: String(error) });
            }
        }, pollInterval);

        // Run immediately on startup
        this.pollGammaPrices().catch(err => {
            logger.error('Initial Gamma price poll failed', { error: String(err) });
        });

        logger.info('Started Gamma price polling every 2s (replaces garbage CLOB prices)');
    }

    /**
     * Poll Gamma API for accurate prices and update market states.
     */
    private async pollGammaPrices(): Promise<void> {
        const marketIds = Array.from(this.marketStates.keys());

        for (const marketId of marketIds) {
            try {
                const response = await axios.get(
                    `https://gamma-api.polymarket.com/markets/${marketId}`,
                    { timeout: 5000 }
                );

                const marketData = response.data;
                if (!marketData.outcomePrices) continue;

                const prices = JSON.parse(marketData.outcomePrices);
                const priceYes = parseFloat(prices[0]);
                const priceNo = parseFloat(prices[1]);

                if (isNaN(priceYes) || isNaN(priceNo)) continue;

                // Update the in-memory market state with accurate Gamma prices
                const state = this.marketStates.get(marketId);
                if (state) {
                    const tokenIds = this.marketTokens.get(marketId) || [];

                    // Create a synthetic price update with Gamma data
                    const update: PriceUpdate = {
                        marketId,
                        tokenId: tokenIds[0] || marketId,
                        priceYes,
                        priceNo,
                        timestamp: new Date()
                    };

                    // Process through the regular trading loop
                    await this.handlePriceUpdate(update);
                }
            } catch (error) {
                // Silently skip failed fetches - market might be resolved or API error
            }
        }
    }

    /**
     * Check if any markets with positions have been resolved.
     * If a market is closed, settle the position based on the resolution.
     */
    private async checkMarketResolutions(): Promise<void> {
        const positions = await this.prisma.position.findMany({
            include: { market: true }
        });

        for (const position of positions) {
            if (!position.market) continue;

            try {
                const response = await axios.get(
                    `https://gamma-api.polymarket.com/markets/${position.marketId}`,
                    { timeout: 5000 }
                );
                const marketData = response.data;

                // Check if market is closed/resolved
                if (marketData.closed) {
                    logger.info('🏁 MARKET RESOLVED', {
                        marketId: position.marketId,
                        question: position.market.question?.substring(0, 50),
                        closed: marketData.closed
                    });

                    // Get the resolution price from outcomePrices
                    let resolutionPriceYes = 0.5;
                    let resolutionPriceNo = 0.5;

                    if (marketData.outcomePrices) {
                        const prices = JSON.parse(marketData.outcomePrices);
                        resolutionPriceYes = parseFloat(prices[0]);
                        resolutionPriceNo = parseFloat(prices[1]);
                    }

                    // Determine if we won or lost
                    const hasYesPosition = position.sharesYes > 0;
                    const hasNoPosition = position.sharesNo > 0;

                    let finalValue = 0;
                    let won = false;

                    if (hasYesPosition) {
                        // YES wins if resolution price is 1.0 (or close to it)
                        if (resolutionPriceYes >= 0.95) {
                            finalValue = position.sharesYes * 1.0; // Each share worth $1
                            won = true;
                            logger.info('🎉 RESOLUTION WIN (YES)', {
                                marketId: position.marketId,
                                shares: position.sharesYes,
                                finalValue,
                                costBasis: position.costBasisYes,
                                profit: finalValue - position.costBasisYes
                            });
                        } else if (resolutionPriceYes <= 0.05) {
                            finalValue = 0; // Each share worth $0
                            logger.info('💀 RESOLUTION LOSS (YES)', {
                                marketId: position.marketId,
                                shares: position.sharesYes,
                                costBasis: position.costBasisYes,
                                loss: -position.costBasisYes
                            });
                        }
                    }

                    if (hasNoPosition) {
                        if (resolutionPriceNo >= 0.95) {
                            finalValue = position.sharesNo * 1.0;
                            won = true;
                            logger.info('🎉 RESOLUTION WIN (NO)', {
                                marketId: position.marketId,
                                shares: position.sharesNo,
                                finalValue,
                                costBasis: position.costBasisNo,
                                profit: finalValue - position.costBasisNo
                            });
                        } else if (resolutionPriceNo <= 0.05) {
                            finalValue = 0;
                            logger.info('💀 RESOLUTION LOSS (NO)', {
                                marketId: position.marketId,
                                shares: position.sharesNo,
                                costBasis: position.costBasisNo,
                                loss: -position.costBasisNo
                            });
                        }
                    }

                    // Update position with realized P&L
                    const costBasis = position.costBasisYes + position.costBasisNo;
                    const profit = finalValue - costBasis;

                    await this.prisma.position.update({
                        where: { marketId: position.marketId },
                        data: {
                            sharesYes: 0,
                            sharesNo: 0,
                            costBasisYes: 0,
                            costBasisNo: 0,
                            unrealizedPnl: 0,
                            realizedPnl: { increment: profit }
                        }
                    });

                    // Mark market as closed in DB
                    await this.prisma.market.update({
                        where: { id: position.marketId },
                        data: { closed: true, active: false }
                    });

                    // Log strategy event
                    await this.prisma.strategyEvent.create({
                        data: {
                            marketId: position.marketId,
                            regime: 'RESOLVED',
                            strategy: 'MARKET_RESOLUTION',
                            action: won ? 'RESOLUTION_WIN' : 'RESOLUTION_LOSS',
                            priceYes: resolutionPriceYes,
                            priceNo: resolutionPriceNo,
                            details: JSON.stringify({
                                finalValue,
                                costBasis,
                                profit,
                                won
                            })
                        }
                    });

                    // Clean up from tracking
                    this.marketStates.delete(position.marketId);
                    this.marketTokens.delete(position.marketId);
                }
            } catch (error) {
                // Skip this market on API error
                logger.debug(`Failed to check resolution for ${position.marketId}: ${error}`);
            }
        }
    }


    /**
     * Take a P&L snapshot.
     * 
     * CRITICAL: Uses Gamma API for accurate prices. In-memory prices may be stale or default to 0.5.
     */
    private async takePnlSnapshot(): Promise<void> {
        const positions = await this.prisma.position.findMany({
            include: { market: true }
        });

        // Build current prices map - PRIORITIZE live Gamma API prices
        const currentPrices = new Map<string, { yes: number; no: number }>();

        // Fetch live prices from Gamma API for each position
        await Promise.all(positions.map(async (position) => {
            // Try Gamma API first
            try {
                const response = await axios.get(
                    `https://gamma-api.polymarket.com/markets/${position.marketId}`,
                    { timeout: 5000 }
                );
                const marketData = response.data;

                if (marketData.outcomePrices) {
                    const prices = JSON.parse(marketData.outcomePrices);
                    const priceYes = parseFloat(prices[0]);
                    const priceNo = parseFloat(prices[1]);

                    if (!isNaN(priceYes) && !isNaN(priceNo) && priceYes > 0 && priceYes < 1) {
                        currentPrices.set(position.marketId, { yes: priceYes, no: priceNo });

                        // Also update in-memory state for consistency
                        const state = this.marketStates.get(position.marketId);
                        if (state) {
                            state.lastPriceYes = priceYes;
                            state.lastPriceNo = priceNo;
                        }
                        return;
                    }
                }
            } catch (error) {
                // Fall through to in-memory prices
            }

            // Fallback to in-memory state, but validate it's not the default 0.5
            const state = this.marketStates.get(position.marketId);
            if (state && !(state.lastPriceYes === 0.5 && state.lastPriceNo === 0.5)) {
                currentPrices.set(position.marketId, {
                    yes: state.lastPriceYes,
                    no: state.lastPriceNo
                });
            }
        }));

        // Calculate values
        let positionsValue = 0;
        let unrealizedPnl = 0;
        let realizedPnl = 0;
        const cashBalance = this.riskManager.getCashBalance();

        const positionUpdates = [];

        for (const position of positions) {
            const prices = currentPrices.get(position.marketId);
            if (prices) {
                const yesValue = position.sharesYes * prices.yes;
                const noValue = position.sharesNo * prices.no;
                positionsValue += yesValue + noValue;

                const costBasis = position.costBasisYes + position.costBasisNo;
                // Calculate P&L for this specific position
                const positionPnl = (yesValue + noValue) - costBasis;
                unrealizedPnl += positionPnl;

                // Queue update for this position
                positionUpdates.push(
                    this.prisma.position.update({
                        where: { marketId: position.marketId },
                        data: { unrealizedPnl: positionPnl }
                    })
                );

                // Also save price to history for dashboard consistency
                positionUpdates.push(
                    this.prisma.priceHistory.create({
                        data: {
                            marketId: position.marketId,
                            priceYes: prices.yes,
                            priceNo: prices.no,
                            bestBidYes: prices.yes,
                            bestAskYes: prices.yes,
                            bestBidNo: prices.no,
                            bestAskNo: prices.no,
                            timestamp: new Date()
                        }
                    }).catch(() => { }) // Ignore errors
                );
            }
            realizedPnl += position.realizedPnl;
        }

        // Execute all position updates
        if (positionUpdates.length > 0) {
            await Promise.all(positionUpdates);
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
        if (this.resolutionCheckInterval) {
            clearInterval(this.resolutionCheckInterval);
        }
        if (this.gammaPriceInterval) {
            clearInterval(this.gammaPriceInterval);
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
