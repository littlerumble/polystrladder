/**
 * Copy Trading Strategy Configuration
 * 
 * All strategy parameters in one place for easy tuning.
 */

export const COPY_CONFIG = {
    // Target whales to copy (Original, kch123, bossoskil)
    WHALE_ADDRESSES: [
        '0x2005d16a84ceefa912d4e380cd32e7ff827875ea',
        '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee',
        '0x0d3b10b8eac8b089c6e4a695e65d8e044167c46b',
    ],

    // Friendly names for display
    WHALE_NAMES: {
        '0x2005d16a84ceefa912d4e380cd32e7ff827875ea': 'Original Whale',
        '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee': 'kch123',
        '0x0d3b10b8eac8b089c6e4a695e65d8e044167c46b': 'bossoskil',
    } as Record<string, string>,

    // API endpoints
    API: {
        CLOB: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
        GAMMA: process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com',
        DATA: process.env.DATA_API_URL || 'https://data-api.polymarket.com',
    },

    // Entry rules
    ENTRY: {
        MIN_PRICE: 0.65,      // Only copy if whale buys at >= 65%
        MAX_PRICE: 0.85,      // Only copy if whale buys at <= 85%
        MIN_WHALE_SIZE: 50,   // Ignore tiny trades (conviction filter)
        ALLOWED_SIDES: ['BUY'] as const,  // Only copy buys
        LIVE_ONLY: true,      // Only trade live games (game_start_time < now)
    },

    // Outcome filter - which outcomes we're willing to copy
    // null = allow all, or specify ['No', 'Under'] etc.
    OUTCOME_FILTER: null as string[] | null,

    // Position sizing (paper trade amounts)
    POSITION: {
        L1_SIZE: 100,         // Initial entry: $100
        L2_SIZE: 75,          // DCA at -5%: $75
        L2_TRIGGER_PCT: -5,   // DCA trigger: -5% from entry
        MAX_PER_MARKET: 175,  // Max total per market: $175
    },

    // Take profit (trailing)
    TAKE_PROFIT: {
        TRIGGER_PCT: 12,      // Enable trailing when +12%
        TRAIL_PCT: 3,         // Normal trailing: exit when drops 3% from peak
        TRAIL_PCT_FAST: 2,    // Fast spike trailing: exit when drops 2% from peak
        FAST_SPIKE_PCT: 5,    // Detect "fast spike" if price rises 5%+ in short time
        HARD_CAP_PRICE: 0.95, // Always exit at 95% (too risky above)
        MIN_PROFIT_PCT: 6,    // Never sell unless at least 6% profit
    },

    // Stop loss
    STOP_LOSS: {
        TRIGGER_PCT: -20,     // Exit at -20%
    },

    // Other exit conditions
    EXIT: {
        TIME_REMAINING_MINUTES: 10,  // Exit if <10 min left in game
        STAGNATION_MINUTES: 30,      // Exit if price moves <2% in 30 min
        STAGNATION_THRESHOLD_PCT: 2,
    },

    // Risk limits
    RISK: {
        MAX_EXPOSURE: 1500,       // Max total $ in open positions
        MAX_CONCURRENT_MARKETS: 10,
        DAILY_LOSS_CAP: 300,      // Pause trading if down $300 today
    },

    // Polling intervals (milliseconds)
    POLLING: {
        WHALE_TRADES_MS: 1500,    // Check for new whale trades every 1.5s
        PRICE_UPDATE_MS: 1500,    // Update prices every 1.5s
        EXIT_CHECK_MS: 1500,      // Check exit conditions every 1.5s
    },

    // What to ignore
    IGNORE: {
        MAX_PRICE: 0.90,          // Skip trades above 90%
        MIN_PRICE: 0.10,          // Skip trades below 10% (lottery)
        // Markets to skip (empty = allow all)
        SLUG_PATTERNS: [],
    },
};

// Type exports for use in other files
export type CopyConfig = typeof COPY_CONFIG;
