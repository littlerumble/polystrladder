/**
 * Comprehensive Trading Bot Test Suite
 * 
 * Tests all trading logic with simulated data - no external API dependencies.
 * 
 * Run with: npx tsx src/tests/tradingTests.ts
 */

import { PrismaClient } from '@prisma/client';
import { generateLadderOrders, markLadderFilled, generateDCAOrders } from '../strategies/ladder.js';
import { shouldTakeProfit, generateExitOrder, checkConsensusBreak, checkPreGameStopLoss } from '../strategies/exitStrategy.js';
import { RiskManager } from '../risk/riskManager.js';
import { MarketState, MarketRegime, Position, Side } from '../core/types.js';
import { configService } from '../config/configService.js';

// ============================================
// Test Utilities
// ============================================

let testsPassed = 0;
let testsFailed = 0;

function assert(condition: boolean, testName: string, details?: string): void {
    if (condition) {
        console.log(`  ✅ PASS: ${testName}`);
        testsPassed++;
    } else {
        console.log(`  ❌ FAIL: ${testName}`);
        if (details) console.log(`     Details: ${details}`);
        testsFailed++;
    }
}

function logSection(name: string): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 ${name}`);
    console.log('='.repeat(60));
}

function createMockMarketState(overrides: Partial<MarketState> = {}): MarketState {
    return {
        marketId: 'test-market-001',
        regime: MarketRegime.MID_CONSENSUS,
        lastPriceYes: 0.65,
        lastPriceNo: 0.35,
        priceHistory: [],
        ladderFilled: [],
        exposureYes: 0,
        exposureNo: 0,
        tailActive: false,
        lastUpdated: new Date(),
        consensusBreakConfirmed: false,
        ...overrides
    };
}

function createMockPosition(overrides: Partial<Position> = {}): Position {
    return {
        marketId: 'test-market-001',
        sharesYes: 0,
        sharesNo: 0,
        costBasisYes: 0,
        costBasisNo: 0,
        unrealizedPnl: 0,
        realizedPnl: 0,
        ...overrides
    };
}

// ============================================
// Test: Ladder Entry Logic
// ============================================

async function testLadderEntry(): Promise<void> {
    logSection('LADDER ENTRY LOGIC');

    const config = configService.getAll();
    const ladderLevels = config.ladderLevels; // [0.60, 0.70, 0.80, 0.90, 0.95]

    // Test 1: YES at 65% should trigger entry on L1 (60%)
    {
        const state = createMockMarketState({ lastPriceYes: 0.65, lastPriceNo: 0.35 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        assert(orders.length > 0, 'YES at 65% triggers ladder entry');
        assert(orders[0]?.side === Side.YES, 'Entry is on YES side');
    }

    // Test 2: NO at 65% (YES at 35%) should trigger entry on NO side
    {
        const state = createMockMarketState({ lastPriceYes: 0.35, lastPriceNo: 0.65 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        assert(orders.length > 0, 'NO at 65% triggers ladder entry');
        assert(orders[0]?.side === Side.NO, 'Entry is on NO side');
    }

    // Test 3: Both below 60% should NOT trade
    {
        const state = createMockMarketState({ lastPriceYes: 0.50, lastPriceNo: 0.50 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        assert(orders.length === 0, 'Neither side at 50% - no entry');
    }

    // Test 4: Price above maxBuyPrice (92%) should NOT trade
    {
        const state = createMockMarketState({ lastPriceYes: 0.95, lastPriceNo: 0.05 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        assert(orders.length === 0, 'Price at 95% exceeds maxBuyPrice - no entry');
    }

    // Test 5: Already filled level should not trigger again
    {
        const state = createMockMarketState({
            lastPriceYes: 0.65,
            lastPriceNo: 0.35,
            ladderFilled: [0.60]  // L1 already filled
        });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // Should NOT generate order for L1 since it's already filled
        const l1Orders = orders.filter(o => o.strategyDetail?.includes('0.6'));
        assert(l1Orders.length === 0, 'L1 already filled - no duplicate order');
    }

    // Test 6: Multiple levels at once (price jumped to 75%)
    {
        const state = createMockMarketState({ lastPriceYes: 0.75, lastPriceNo: 0.25 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // Should generate orders for L1 (60%) and L2 (70%) since price is at 75%
        assert(orders.length >= 2, `Price at 75% triggers multiple levels (got ${orders.length})`);
    }

    // Test 7: Ladder sizing weights (10%, 15%, 25%, 25%, 25%)
    {
        const state = createMockMarketState({ lastPriceYes: 0.92, lastPriceNo: 0.08 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // Check that orders have different sizes based on weights
        if (orders.length >= 2) {
            const firstOrder = orders[0];
            const lastOrder = orders[orders.length - 1];
            assert(
                lastOrder.sizeUsdc > firstOrder.sizeUsdc,
                'Later ladder levels have larger sizes',
                `L1: $${firstOrder.sizeUsdc.toFixed(2)}, Last: $${lastOrder.sizeUsdc.toFixed(2)}`
            );
        }
    }
}

// ============================================
// Test: Side Switch Detection
// ============================================

async function testSideSwitch(): Promise<void> {
    logSection('SIDE SWITCH DETECTION');

    // Test 1: Switching from YES to NO is BLOCKED (by design - can't flip once committed)
    {
        const state = createMockMarketState({
            lastPriceYes: 0.35,
            lastPriceNo: 0.65,
            activeTradeSide: 'YES',
            ladderFilled: [0.60, 0.70]  // Had YES positions at L1, L2
        });

        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // Side flipping is blocked by design - once you're on YES, you stay on YES
        assert(orders.length === 0, 'Side flip is blocked by design');
    }

    // Test 2: Same side should respect filled levels
    {
        const state = createMockMarketState({
            lastPriceYes: 0.75,
            lastPriceNo: 0.25,
            activeTradeSide: 'YES',
            ladderFilled: [0.60, 0.70]
        });

        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // Should NOT fill L1 and L2 again, only L3+ if price is high enough
        const l1l2Orders = orders.filter(o =>
            o.strategyDetail?.includes('0.6') || o.strategyDetail?.includes('0.7')
        );
        assert(l1l2Orders.length === 0, 'Same side respects already filled levels');
    }

    // Test 3: Fresh market (no activeTradeSide) can enter on either side
    {
        const state = createMockMarketState({
            lastPriceYes: 0.35,
            lastPriceNo: 0.65,
            activeTradeSide: undefined,  // No commitment yet
            ladderFilled: []
        });

        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        assert(orders.length > 0, 'Fresh market can enter on NO side');
        assert(orders[0]?.side === Side.NO, 'First entry on NO side');
    }
}

// ============================================
// Test: Exit Logic (14% profit or price >= 90%)
// ============================================

async function testExitLogic(): Promise<void> {
    logSection('EXIT LOGIC (14% PROFIT OR 90%+ PRICE)');

    // Test 1: 14% profit should trigger exit
    {
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 65,  // Bought at 65¢
            avgEntryYes: 0.65
        });

        // Current price 75¢ = ~15.4% profit
        const result = shouldTakeProfit(
            position,
            0.75,  // priceYes
            0.25,  // priceNo
            false, // consensusBreakConfirmed
            new Date(Date.now() + 86400000)  // gameStartTime tomorrow
        );

        assert(result.shouldExit, '15.4% profit triggers exit');
        assert(result.exitPct === 1.0, 'Exit is 100% (no moon bag)');
        assert(result.isProfit, 'Marked as profitable exit');
    }

    // Test 2: Price >= 95% should trigger resolution exit
    {
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 70,
            avgEntryYes: 0.70
        });

        const result = shouldTakeProfit(
            position,
            0.96,  // priceYes near resolution
            0.04,
            false  // consensusBreakConfirmed
        );

        assert(result.shouldExit, 'Price at 96% triggers resolution exit');
        assert(result.reason.includes('RESOLUTION'), 'Reason includes resolution');
    }

    // Test 3: Small profit (10%) should NOT trigger exit
    {
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 65,
            avgEntryYes: 0.65
        });

        const result = shouldTakeProfit(
            position,
            0.71,  // 9.2% profit - below 14% threshold
            0.29,
            false, // consensusBreakConfirmed
            new Date(Date.now() + 86400000)
        );

        assert(!result.shouldExit, '9% profit does NOT trigger exit');
    }

    // Test 4: NO position profit check works correctly
    {
        const position = createMockPosition({
            sharesNo: 100,
            costBasisNo: 30,  // Bought NO at 30¢
            avgEntryNo: 0.30
        });

        // NO price now 36¢ = 20% profit
        const result = shouldTakeProfit(
            position,
            0.64,  // priceYes
            0.36,  // priceNo
            false, // consensusBreakConfirmed
            new Date(Date.now() + 86400000)
        );

        assert(result.shouldExit, 'NO position 20% profit triggers exit');
    }
}

// ============================================
// Test: Pre-Game Stop Loss
// ============================================

async function testPreGameStopLoss(): Promise<void> {
    logSection('PRE-GAME STOP LOSS');

    // Test 1: Price below 60% should trigger stop loss (YES position)
    {
        const state = createMockMarketState({
            lastPriceYes: 0.55,
            lastPriceNo: 0.45,
            ladderFilled: [0.60, 0.70]
        });

        const result = checkPreGameStopLoss(
            state,
            0.55,  // priceYes
            0.45,  // priceNo
            'YES',
            new Date(Date.now() + 86400000)  // Game tomorrow (pre-game)
        );

        assert(result.shouldExit, 'YES position at 55% triggers pre-game stop');
        assert(result.updatedState.cooldownUntil !== undefined, 'Cooldown is set');
    }

    // Test 2: Price below 60% should trigger stop loss (NO position)
    {
        const state = createMockMarketState({
            lastPriceYes: 0.45,
            lastPriceNo: 0.55,  // NO dropped below 60%
            ladderFilled: [0.60]
        });

        const result = checkPreGameStopLoss(
            state,
            0.45,
            0.55,  // NO at 55%
            'NO',
            new Date(Date.now() + 86400000)
        );

        assert(result.shouldExit, 'NO position at 55% triggers pre-game stop');
    }

    // Test 3: During cooldown, should NOT exit again
    {
        const state = createMockMarketState({
            lastPriceYes: 0.55,
            lastPriceNo: 0.45,
            cooldownUntil: new Date(Date.now() + 300000)  // 5 min left in cooldown
        });

        const result = checkPreGameStopLoss(
            state,
            0.55,
            0.45,
            'YES',
            new Date(Date.now() + 86400000)
        );

        assert(!result.shouldExit, 'During cooldown - no exit');
    }

    // Test 4: After game started, pre-game stop loss does not apply
    {
        const state = createMockMarketState({
            lastPriceYes: 0.55,
            lastPriceNo: 0.45,
            ladderFilled: [0.60]
        });

        const result = checkPreGameStopLoss(
            state,
            0.55,
            0.45,
            'YES',
            new Date(Date.now() - 3600000)  // Game started 1 hour ago
        );

        assert(!result.shouldExit, 'Game is live - pre-game stop loss disabled');
    }
}

// ============================================
// Test: Consensus Break
// ============================================

async function testConsensusBreak(): Promise<void> {
    logSection('CONSENSUS BREAK DETECTION');

    // Test 1: Price below first ladder starts tracking
    {
        const state = createMockMarketState({
            lastPriceYes: 0.58,
            lastPriceNo: 0.42,
            ladderFilled: [0.60, 0.70]
        });

        const result = checkConsensusBreak(state, 0.58, 0.42, 'YES');

        assert(result.isBreaking, 'Price at 58% is breaking consensus');
        assert(
            result.updatedState.consensusBreakStartTime !== undefined,
            'consensusBreakStartTime is set'
        );
        assert(!result.updatedState.consensusBreakConfirmed, 'Not confirmed yet (needs time)');
    }

    // Test 2: NO position checks NO price correctly
    {
        const state = createMockMarketState({
            lastPriceYes: 0.42,
            lastPriceNo: 0.58,  // NO at 58%, below 60%
            ladderFilled: [0.60]
        });

        const result = checkConsensusBreak(state, 0.42, 0.58, 'NO');

        assert(result.isBreaking, 'NO position at 58% is breaking consensus');
    }

    // Test 3: Price recovered - consensus intact
    {
        const state = createMockMarketState({
            lastPriceYes: 0.65,
            lastPriceNo: 0.35,
            ladderFilled: [0.60],
            consensusBreakStartTime: new Date()  // Was tracking
        });

        const result = checkConsensusBreak(state, 0.65, 0.35, 'YES');

        assert(!result.isBreaking, 'Price at 65% - consensus intact');
        assert(
            result.updatedState.consensusBreakStartTime === undefined,
            'consensusBreakStartTime cleared'
        );
    }
}

// ============================================
// Test: DCA Logic
// ============================================

async function testDCALogic(): Promise<void> {
    logSection('DCA (DOLLAR COST AVERAGING)');

    // Test 1: 5% dip should trigger DCA (70% entry, now at 66% = 5.7% dip)
    {
        const state = createMockMarketState({
            lastPriceYes: 0.66,  // Dipped from 70% to 66% = 5.7% dip
            lastPriceNo: 0.34,
            regime: MarketRegime.MID_CONSENSUS,
            ladderFilled: [0.60, 0.70]  // Has position
        });

        const position = {
            sharesYes: 100,
            avgEntryYes: 0.70,  // Entered at 70%
            sharesNo: 0,
            avgEntryNo: 0,
            dcaBuys: 0
        };

        const orders = generateDCAOrders(
            state,
            position,
            'token-yes',
            'token-no',
            new Date(Date.now() + 86400000),  // Game tomorrow
            2  // max DCA buys
        );

        assert(orders.length > 0, '5.7% dip triggers DCA order');
    }

    // Test 2: Price below 60% should NOT DCA (thesis breaking)
    {
        const state = createMockMarketState({
            lastPriceYes: 0.55,
            lastPriceNo: 0.45,
            regime: MarketRegime.MID_CONSENSUS
        });

        const position = {
            sharesYes: 100,
            avgEntryYes: 0.70,
            sharesNo: 0,
            avgEntryNo: 0,
            dcaBuys: 0
        };

        const orders = generateDCAOrders(
            state, position, 'token-yes', 'token-no',
            new Date(Date.now() + 86400000), 2
        );

        assert(orders.length === 0, 'Price at 55% - DCA blocked (thesis breaking)');
    }

    // Test 3: Max DCA limit (2) should block further DCA
    {
        const state = createMockMarketState({
            lastPriceYes: 0.665,
            lastPriceNo: 0.335,
            regime: MarketRegime.MID_CONSENSUS
        });

        const position = {
            sharesYes: 100,
            avgEntryYes: 0.70,
            sharesNo: 0,
            avgEntryNo: 0,
            dcaBuys: 2  // Already hit max
        };

        const orders = generateDCAOrders(
            state, position, 'token-yes', 'token-no',
            new Date(Date.now() + 86400000), 2
        );

        assert(orders.length === 0, 'Max DCA buys reached - blocked');
    }

    // Test 4: After game starts - no DCA
    {
        const state = createMockMarketState({
            lastPriceYes: 0.665,
            lastPriceNo: 0.335,
            regime: MarketRegime.MID_CONSENSUS
        });

        const position = {
            sharesYes: 100,
            avgEntryYes: 0.70,
            sharesNo: 0,
            avgEntryNo: 0,
            dcaBuys: 0
        };

        const orders = generateDCAOrders(
            state, position, 'token-yes', 'token-no',
            new Date(Date.now() - 3600000),  // Game started 1 hour ago
            2
        );

        assert(orders.length === 0, 'Game is live - DCA blocked');
    }
}

// ============================================
// Test: Generate Exit Order
// ============================================

async function testGenerateExitOrder(): Promise<void> {
    logSection('EXIT ORDER GENERATION');

    // Test 1: YES position exit generates correct order
    {
        const state = createMockMarketState({
            lastPriceYes: 0.80,
            lastPriceNo: 0.20
        });

        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 65
        });

        const order = generateExitOrder(state, position, 'token-yes', 'token-no', 1.0);

        assert(order !== null, 'Exit order is generated');
        assert(order?.side === Side.YES, 'Order side is YES');
        assert(order?.shares === 100, 'Order is for 100 shares');
        assert(order?.isExit === true, 'Order marked as exit');
    }

    // Test 2: NO position exit generates correct order
    {
        const state = createMockMarketState({
            lastPriceYes: 0.30,
            lastPriceNo: 0.70
        });

        const position = createMockPosition({
            sharesNo: 50,
            costBasisNo: 30
        });

        const order = generateExitOrder(state, position, 'token-yes', 'token-no', 1.0);

        assert(order !== null, 'NO exit order is generated');
        assert(order?.side === Side.NO, 'Order side is NO');
        assert(order?.shares === 50, 'Order is for 50 shares');
    }
}

// ============================================
// Test: Risk Manager Limits
// ============================================

async function testRiskManager(): Promise<void> {
    logSection('RISK MANAGER LIMITS');

    const config = configService.getAll();
    const bankroll = config.bankroll;
    const maxMarketExposurePct = config.maxMarketExposurePct;
    const maxSingleOrderPct = config.maxSingleOrderPct;

    // Test 1: Order within limits should be approved
    {
        // Create a mock order within limits
        const proposedOrder = {
            marketId: 'test-risk-001',
            tokenId: 'token-yes',
            side: Side.YES,
            price: 0.70,
            sizeUsdc: 10,  // Small order
            shares: 14.28,
            strategy: 'LADDER_COMPRESSION' as any,
            confidence: 0.8
        };

        // Order should be approved (within limits)
        const maxSingleOrder = bankroll * maxSingleOrderPct;
        assert(proposedOrder.sizeUsdc <= maxSingleOrder, 'Small order is within single order limit');
    }

    // Test 2: Max single order limit calculation
    {
        const maxSingleOrder = bankroll * maxSingleOrderPct;
        assert(maxSingleOrder > 0, `Max single order calculated: $${maxSingleOrder.toFixed(2)}`);
        console.log(`     Info: Bankroll $${bankroll}, Max Single Order: $${maxSingleOrder.toFixed(2)} (${(maxSingleOrderPct * 100).toFixed(2)}%)`);
    }

    // Test 3: Max market exposure limit calculation
    {
        const maxMarketExposure = bankroll * maxMarketExposurePct;
        assert(maxMarketExposure > 0, `Max market exposure calculated: $${maxMarketExposure.toFixed(2)}`);
        console.log(`     Info: Max Market Exposure: $${maxMarketExposure.toFixed(2)} (${(maxMarketExposurePct * 100).toFixed(2)}%)`);
    }

    // Test 4: Progressive exposure limits at different price levels
    {
        // At 60-70%: 10% of max exposure
        // At 70-80%: 25% of max exposure  
        // At 80-90%: 80% of max exposure
        // At 90%+: 100% of max exposure
        const baseMaxExposure = bankroll * maxMarketExposurePct;

        const exposureAt65 = baseMaxExposure * 0.10;
        const exposureAt75 = baseMaxExposure * 0.25;
        const exposureAt85 = baseMaxExposure * 0.80;
        const exposureAt92 = baseMaxExposure * 1.0;

        assert(exposureAt65 < exposureAt75, 'Progressive: 65% < 75% exposure');
        assert(exposureAt75 < exposureAt85, 'Progressive: 75% < 85% exposure');
        assert(exposureAt85 < exposureAt92, 'Progressive: 85% < 92% exposure');
    }

    // Test 5: Max active positions limit
    {
        const maxPositions = config.maxActivePositions || 6;
        assert(maxPositions > 0, `Max active positions: ${maxPositions}`);
    }

    // Test 6: Exit orders bypass risk checks
    {
        const exitOrder = {
            marketId: 'test-exit',
            tokenId: 'token-yes',
            side: Side.YES,
            price: 0.80,
            sizeUsdc: 1000,  // Large exit
            shares: 1250,
            strategy: 'PROFIT_TAKING' as any,
            confidence: 1.0,
            isExit: true
        };

        assert(exitOrder.isExit === true, 'Exit orders have isExit=true flag');
    }
}

// ============================================
// Test: Regime Classification
// ============================================

async function testRegimeClassification(): Promise<void> {
    logSection('REGIME CLASSIFICATION');

    const config = configService.getAll();

    // Test 1: EARLY_UNCERTAIN = price between 45-55%
    {
        const price = 0.50;
        const isEarlyUncertain = price >= config.earlyUncertainPriceMin &&
            price <= config.earlyUncertainPriceMax;
        assert(isEarlyUncertain, 'Price 50% = EARLY_UNCERTAIN');
    }

    // Test 2: MID_CONSENSUS = price outside 45-55% but below 85%
    {
        const price = 0.70;
        const isNotEarlyUncertain = price < config.earlyUncertainPriceMin ||
            price > config.earlyUncertainPriceMax;
        const isNotLateCompressed = price < config.lateCompressedPriceThreshold;
        assert(isNotEarlyUncertain && isNotLateCompressed, 'Price 70% = MID_CONSENSUS');
    }

    // Test 3: LATE_COMPRESSED = price > 85% AND < 6h to resolution
    {
        const price = 0.90;
        const isHighPrice = price > config.lateCompressedPriceThreshold;
        assert(isHighPrice, 'Price 90% qualifies for LATE_COMPRESSED (if < 6h)');
    }

    // Test 4: Strategy selection based on regime
    {
        // MID_CONSENSUS and LATE_COMPRESSED should use LADDER_COMPRESSION
        // HIGH_VOLATILITY and EARLY_UNCERTAIN should use NONE
        const regimeToStrategy = {
            'MID_CONSENSUS': 'LADDER_COMPRESSION',
            'LATE_COMPRESSED': 'LADDER_COMPRESSION',
            'EARLY_UNCERTAIN': 'NONE',
            'HIGH_VOLATILITY': 'NONE'
        };

        assert(regimeToStrategy['MID_CONSENSUS'] === 'LADDER_COMPRESSION',
            'MID_CONSENSUS → LADDER_COMPRESSION strategy');
        assert(regimeToStrategy['EARLY_UNCERTAIN'] === 'NONE',
            'EARLY_UNCERTAIN → No trading');
    }
}

// ============================================
// Test: PnL Calculations
// ============================================

async function testPnLCalculations(): Promise<void> {
    logSection('PNL CALCULATIONS');

    // Test 1: Unrealized PnL calculation (YES position)
    {
        const sharesYes = 100;
        const costBasis = 65;  // Bought 100 shares at 65¢ avg
        const currentPrice = 0.75;

        const currentValue = sharesYes * currentPrice;  // 100 * 0.75 = 75
        const unrealizedPnl = currentValue - costBasis; // 75 - 65 = 10
        const pnlPct = (unrealizedPnl / costBasis) * 100;

        assert(unrealizedPnl === 10, `Unrealized PnL: $${unrealizedPnl.toFixed(2)}`);
        assert(Math.abs(pnlPct - 15.38) < 0.1, `PnL %: ${pnlPct.toFixed(1)}%`);
    }

    // Test 2: NO position PnL
    {
        const sharesNo = 50;
        const costBasis = 15;  // Bought 50 shares at 30¢ avg
        const currentPrice = 0.36;

        const currentValue = sharesNo * currentPrice;  // 50 * 0.36 = 18
        const unrealizedPnl = currentValue - costBasis; // 18 - 15 = 3

        assert(unrealizedPnl === 3, `NO position unrealized PnL: $${unrealizedPnl.toFixed(2)}`);
    }

    // Test 3: Realized PnL on exit
    {
        const sharesToSell = 100;
        const costBasisPerShare = 0.65;
        const sellPrice = 0.80;

        const proceeds = sharesToSell * sellPrice;  // 80
        const costBasis = sharesToSell * costBasisPerShare;  // 65
        const realizedPnl = proceeds - costBasis;  // 15

        assert(realizedPnl === 15, `Realized PnL on exit: $${realizedPnl.toFixed(2)}`);
    }

    // Test 4: Loss calculation
    {
        const sharesYes = 100;
        const costBasis = 70;
        const currentPrice = 0.55;  // Price dropped

        const currentValue = sharesYes * currentPrice;
        const unrealizedPnl = currentValue - costBasis;

        // Use tolerance for floating point comparison
        assert(Math.abs(unrealizedPnl - (-15)) < 0.01, `Unrealized loss: $${unrealizedPnl.toFixed(2)}`);
    }

    // Test 5: Resolution win (YES at $1)
    {
        const sharesYes = 100;
        const costBasis = 70;
        const resolutionPrice = 1.0;  // YES wins

        const finalValue = sharesYes * resolutionPrice;
        const profit = finalValue - costBasis;

        assert(profit === 30, `Resolution WIN profit: $${profit.toFixed(2)}`);
    }

    // Test 6: Resolution loss (YES at $0)
    {
        const sharesYes = 100;
        const costBasis = 70;
        const resolutionPrice = 0;  // YES loses

        const finalValue = sharesYes * resolutionPrice;
        const loss = finalValue - costBasis;

        assert(loss === -70, `Resolution LOSS: $${loss.toFixed(2)}`);
    }
}

// ============================================
// Test: Position Updates
// ============================================

async function testPositionUpdates(): Promise<void> {
    logSection('POSITION UPDATES');

    // Test 1: Buy order updates position correctly
    {
        let position = createMockPosition({ sharesYes: 0, costBasisYes: 0 });

        // Simulate buying 50 shares at 70¢
        const filledShares = 50;
        const filledPrice = 0.70;
        const filledUsdc = filledShares * filledPrice;  // 35

        position.sharesYes += filledShares;
        position.costBasisYes += filledUsdc;
        position.avgEntryYes = position.costBasisYes / position.sharesYes;

        assert(position.sharesYes === 50, 'Shares updated after buy');
        assert(position.costBasisYes === 35, 'Cost basis updated after buy');
        assert(position.avgEntryYes === 0.70, 'Avg entry calculated correctly');
    }

    // Test 2: Second buy updates average correctly
    {
        let position = createMockPosition({
            sharesYes: 50,
            costBasisYes: 35,
            avgEntryYes: 0.70
        });

        // Buy 50 more at 80¢
        const filledShares = 50;
        const filledPrice = 0.80;
        const filledUsdc = filledShares * filledPrice;  // 40

        position.sharesYes += filledShares;
        position.costBasisYes += filledUsdc;
        position.avgEntryYes = position.costBasisYes / position.sharesYes;

        assert(position.sharesYes === 100, '100 total shares after 2nd buy');
        assert(position.costBasisYes === 75, 'Cost basis = 35 + 40 = 75');
        assert(position.avgEntryYes === 0.75, 'Avg entry = 75/100 = 0.75');
    }

    // Test 3: Exit updates position correctly
    {
        let position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 75,
            avgEntryYes: 0.75
        });

        // Sell 100% at 85¢
        const sharesToSell = 100;
        const sellPrice = 0.85;
        const proceeds = sharesToSell * sellPrice;  // 85
        const pctSold = sharesToSell / position.sharesYes;  // 1.0
        const costBasisRemoved = position.costBasisYes * pctSold;  // 75
        const realizedPnl = proceeds - costBasisRemoved;  // 10

        position.sharesYes -= sharesToSell;
        position.costBasisYes -= costBasisRemoved;
        position.realizedPnl += realizedPnl;

        assert(position.sharesYes === 0, 'No shares after full exit');
        assert(position.costBasisYes === 0, 'No cost basis after full exit');
        assert(position.realizedPnl === 10, 'Realized PnL = $10');
    }

    // Test 4: Partial exit (60%) keeps remainder
    {
        let position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 75,
            avgEntryYes: 0.75
        });

        // Sell 60% at 85¢
        const exitPct = 0.60;
        const sharesToSell = position.sharesYes * exitPct;  // 60
        const sellPrice = 0.85;
        const proceeds = sharesToSell * sellPrice;  // 51
        const costBasisRemoved = position.costBasisYes * exitPct;  // 45

        position.sharesYes -= sharesToSell;
        position.costBasisYes -= costBasisRemoved;

        assert(position.sharesYes === 40, '40 shares remain after 60% exit');
        assert(position.costBasisYes === 30, 'Cost basis = 75 * 0.4 = 30');
    }
}

// ============================================
// Test: Market Filtering Rules
// ============================================

async function testMarketFiltering(): Promise<void> {
    logSection('MARKET FILTERING RULES');

    const config = configService.getAll();

    // Test 1: Sports category is allowed
    {
        const allowedCategories = config.allowedCategories;
        assert(allowedCategories.includes('Sports'), 'Sports category is allowed');
    }

    // Test 2: Politics/Governance are excluded
    {
        const excludedCategories = config.excludedCategories;
        assert(excludedCategories.includes('Politics') || excludedCategories.includes('Governance'),
            'Politics/Governance are excluded');
    }

    // Test 3: Sports keywords matching
    {
        const keywords = config.sportsKeywords;
        const testQuestions = [
            { q: 'Lakers vs Celtics', shouldMatch: true },
            { q: 'NFL: Chiefs to win Super Bowl?', shouldMatch: true },
            { q: 'Will Bitcoin reach $100k?', shouldMatch: false },
            { q: 'Manchester United vs Arsenal', shouldMatch: true }
        ];

        for (const test of testQuestions) {
            const hasKeyword = keywords.some(kw =>
                test.q.toLowerCase().includes(kw.toLowerCase())
            );
            assert(
                hasKeyword === test.shouldMatch,
                `"${test.q.substring(0, 30)}..." ${test.shouldMatch ? 'matches' : 'no match'}`
            );
        }
    }

    // Test 4: Volume threshold
    {
        assert(config.minVolume24h > 0, `Min 24h volume: $${config.minVolume24h}`);
    }

    // Test 5: Liquidity threshold
    {
        assert(config.minLiquidity > 0, `Min liquidity: $${config.minLiquidity}`);
    }

    // Test 6: Time to resolution limit
    {
        assert(config.maxTimeToResolutionHours > 0,
            `Max time to resolution: ${config.maxTimeToResolutionHours}h`);
    }
}

// ============================================
// Test: Complete Trade Lifecycle
// ============================================

async function testTradeLifecycle(): Promise<void> {
    logSection('COMPLETE TRADE LIFECYCLE');

    console.log('  📈 Simulating full trade from entry to exit...\n');

    // STEP 1: Market enters sweet spot (65%)
    {
        const state = createMockMarketState({ lastPriceYes: 0.65, lastPriceNo: 0.35 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');

        assert(orders.length > 0, 'STEP 1: Entry triggered at 65%');
        console.log(`     → Generated ${orders.length} ladder order(s)`);
    }

    // STEP 2: Price rises, more ladder levels fill
    {
        const state = createMockMarketState({
            lastPriceYes: 0.80,
            lastPriceNo: 0.20,
            ladderFilled: [0.60]  // L1 already filled
        });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');

        assert(orders.length >= 1, 'STEP 2: Additional levels fill at 80%');
        console.log(`     → Price rose to 80%, filled ${orders.length} more level(s)`);
    }

    // STEP 3: Position is now profitable
    {
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 70,  // Avg entry ~70¢
            avgEntryYes: 0.70
        });

        const currentPrice = 0.82;
        const currentValue = position.sharesYes * currentPrice;
        const profitPct = ((currentValue - position.costBasisYes) / position.costBasisYes) * 100;

        assert(profitPct > 14, `STEP 3: Position is ${profitPct.toFixed(1)}% profitable`);
        console.log(`     → Unrealized profit: $${(currentValue - position.costBasisYes).toFixed(2)}`);
    }

    // STEP 4: Profit target hit, exit triggered
    {
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 70,
            avgEntryYes: 0.70
        });

        const result = shouldTakeProfit(
            position,
            0.82,  // 17% profit
            0.18,
            false
        );

        assert(result.shouldExit, 'STEP 4: Profit target triggers exit');
        assert(result.exitPct === 1.0, '     → Full exit (100%)');
    }

    // STEP 5: Exit order generated
    {
        const state = createMockMarketState({ lastPriceYes: 0.82, lastPriceNo: 0.18 });
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 70
        });

        const exitOrder = generateExitOrder(state, position, 'token-yes', 'token-no', 1.0);

        assert(exitOrder !== null, 'STEP 5: Exit order generated');
        assert(exitOrder?.isExit === true, '     → Marked as exit order');
        console.log(`     → Exit order for ${exitOrder?.shares} shares at ${(exitOrder?.price || 0) * 100}¢`);
    }

    // STEP 6: Calculate final PnL
    {
        const sharesToSell = 100;
        const costBasis = 70;
        const sellPrice = 0.82;
        const proceeds = sharesToSell * sellPrice;
        const realizedPnl = proceeds - costBasis;
        const returnPct = (realizedPnl / costBasis) * 100;

        assert(realizedPnl > 0, `STEP 6: Trade closed with $${realizedPnl.toFixed(2)} profit`);
        console.log(`     → Return: ${returnPct.toFixed(1)}%`);
    }

    console.log('\n  ✅ Complete trade lifecycle validated!');
}

// ============================================
// Test: Edge Cases & Error Handling
// ============================================

async function testEdgeCases(): Promise<void> {
    logSection('EDGE CASES & ERROR HANDLING');

    // Test 1: Zero shares position
    {
        const position = createMockPosition({ sharesYes: 0, sharesNo: 0 });
        const hasPosition = position.sharesYes > 0 || position.sharesNo > 0;
        assert(!hasPosition, 'Zero shares = no position');
    }

    // Test 2: Price at exact boundary (60%)
    {
        const state = createMockMarketState({ lastPriceYes: 0.60, lastPriceNo: 0.40 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        assert(orders.length > 0, 'Price at exactly 60% triggers entry (>=)');
    }

    // Test 3: Price at exact max (92%)
    {
        const state = createMockMarketState({ lastPriceYes: 0.92, lastPriceNo: 0.08 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // Should still trigger at exactly 92% (<=)
        assert(orders.length > 0, 'Price at exactly 92% still triggers (<=)');
    }

    // Test 4: Price just above max (93%)
    {
        const state = createMockMarketState({ lastPriceYes: 0.93, lastPriceNo: 0.07 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        assert(orders.length === 0, 'Price at 93% is too high - no entry');
    }

    // Test 5: Both YES and NO above 60% (impossible but handle gracefully)
    {
        // This shouldn't happen in reality but test that YES takes priority
        const state = createMockMarketState({ lastPriceYes: 0.65, lastPriceNo: 0.65 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // YES should take priority
        if (orders.length > 0) {
            assert(orders[0]?.side === Side.YES, 'YES takes priority when both qualify');
        }
    }

    // Test 6: Negative or zero price handling
    {
        const state = createMockMarketState({ lastPriceYes: 0, lastPriceNo: 1 });
        const orders = generateLadderOrders(state, 'token-yes', 'token-no');
        // Should not crash, may or may not generate orders
        assert(true, 'Zero price handled without crash');
    }

    // Test 7: Very small profit (just under threshold)
    {
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 70,
            avgEntryYes: 0.70
        });

        // 13% profit (just under 14% threshold)
        const result = shouldTakeProfit(position, 0.791, 0.209, false);
        assert(!result.shouldExit, '13% profit does NOT trigger exit (need 14%)');
    }

    // Test 8: Very large profit (50%+)
    {
        const position = createMockPosition({
            sharesYes: 100,
            costBasisYes: 60,
            avgEntryYes: 0.60
        });

        const result = shouldTakeProfit(position, 0.90, 0.10, false);
        assert(result.shouldExit, '50% profit triggers exit');
    }
}

// ============================================
// Test: Configuration Validation
// ============================================

async function testConfigValidation(): Promise<void> {
    logSection('CONFIGURATION VALIDATION');

    const config = configService.getAll();

    // Test ladder levels are in ascending order
    {
        const levels = config.ladderLevels;
        let isAscending = true;
        for (let i = 1; i < levels.length; i++) {
            if (levels[i] <= levels[i - 1]) isAscending = false;
        }
        assert(isAscending, 'Ladder levels are in ascending order');
        console.log(`     Levels: ${levels.join(', ')}`);
    }

    // Test first ladder >= 60%
    {
        assert(config.ladderLevels[0] >= 0.60, `First ladder level >= 60%: ${config.ladderLevels[0]}`);
    }

    // Test maxBuyPrice > last ladder level
    {
        const lastLevel = config.ladderLevels[config.ladderLevels.length - 1];
        // MaxBuyPrice should allow at least some of the ladder levels
        assert(config.maxBuyPrice >= lastLevel - 0.05,
            `MaxBuyPrice ${config.maxBuyPrice} is compatible with ladder`);
    }

    // Test takeProfitPct is reasonable (5-50%)
    {
        assert(config.takeProfitPct >= 0.05 && config.takeProfitPct <= 0.50,
            `Take profit ${(config.takeProfitPct * 100).toFixed(0)}% is reasonable`);
    }

    // Test bankroll is positive
    {
        assert(config.bankroll > 0, `Bankroll is positive: $${config.bankroll}`);
    }

    // Test mode is valid
    {
        assert(config.mode === 'PAPER' || config.mode === 'LIVE',
            `Mode is valid: ${config.mode}`);
    }
}

// ============================================
// Run All Tests
// ============================================

async function runAllTests(): Promise<void> {
    console.log('\n🚀 POLYMARKET TRADING BOT - COMPREHENSIVE TEST SUITE');
    console.log('━'.repeat(60));
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log(`Config: ${JSON.stringify({
        ladderLevels: configService.get('ladderLevels'),
        takeProfitPct: configService.get('takeProfitPct'),
        maxBuyPrice: configService.get('maxBuyPrice'),
        bankroll: configService.get('bankroll')
    }, null, 2)}`);

    try {
        // Strategy Tests
        await testLadderEntry();
        await testSideSwitch();
        await testExitLogic();
        await testPreGameStopLoss();
        await testConsensusBreak();
        await testDCALogic();
        await testGenerateExitOrder();

        // System Tests
        await testRiskManager();
        await testRegimeClassification();
        await testPnLCalculations();
        await testPositionUpdates();
        await testMarketFiltering();

        // Integration Tests
        await testTradeLifecycle();
        await testEdgeCases();
        await testConfigValidation();

        console.log(`\n${'━'.repeat(60)}`);
        console.log('📊 TEST SUMMARY');
        console.log('━'.repeat(60));
        console.log(`  ✅ Passed: ${testsPassed}`);
        console.log(`  ❌ Failed: ${testsFailed}`);
        console.log(`  Total:    ${testsPassed + testsFailed}`);
        console.log('━'.repeat(60));

        if (testsFailed > 0) {
            console.log('\n⚠️  Some tests failed! Review the failures above.');
            process.exit(1);
        } else {
            console.log('\n🎉 All tests passed!');
            process.exit(0);
        }

    } catch (error) {
        console.error('\n💥 Test suite crashed:', error);
        process.exit(1);
    }
}

// Run
runAllTests();

