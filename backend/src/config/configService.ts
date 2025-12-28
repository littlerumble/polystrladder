import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultConfig = JSON.parse(readFileSync(join(__dirname, 'default.json'), 'utf-8'));

export interface Config {
    mode: 'PAPER' | 'LIVE';
    bankroll: number;
    maxMarketExposurePct: number;
    maxSingleOrderPct: number;
    topNMarkets: number;
    maxActivePositions: number;
    takeProfitPct: number;
    minHoldTimeMinutes: number;
    allowedCategories: string[];
    excludedCategories: string[];
    sportsKeywords: string[];
    minVolume24h: number;
    minLiquidity: number;
    maxTimeToResolutionHours: number;
    ladderLevels: number[];
    maxBuyPrice: number;
    tailPriceThreshold: number;
    tailExposurePct: number;
    volatilityWindowMinutes: number;
    volatilityThreshold: number;
    lateResolutionHours: number;
    lateCompressedPriceThreshold: number;
    earlyUncertainPriceMin: number;
    earlyUncertainPriceMax: number;
    volatilityAbsorptionPriceMin: number;
    volatilityAbsorptionPriceMax: number;
    pnlSnapshotIntervalMs: number;
    marketRefreshIntervalMs: number;
    wsReconnectDelayMs: number;
    dashboardPort: number;
    apiPort: number;
}

class ConfigService {
    private static instance: ConfigService;
    private config: Config;

    private constructor() {
        // Load default config and merge with environment overrides
        this.config = { ...defaultConfig } as Config;
        this.applyEnvironmentOverrides();
    }

    public static getInstance(): ConfigService {
        if (!ConfigService.instance) {
            ConfigService.instance = new ConfigService();
        }
        return ConfigService.instance;
    }

    private applyEnvironmentOverrides(): void {
        // Override with environment variables if set
        if (process.env.BOT_MODE) {
            this.config.mode = process.env.BOT_MODE as 'PAPER' | 'LIVE';
        }
        if (process.env.BOT_BANKROLL) {
            this.config.bankroll = parseFloat(process.env.BOT_BANKROLL);
        }
        if (process.env.BOT_API_PORT) {
            this.config.apiPort = parseInt(process.env.BOT_API_PORT, 10);
        }
        if (process.env.BOT_DASHBOARD_PORT) {
            this.config.dashboardPort = parseInt(process.env.BOT_DASHBOARD_PORT, 10);
        }
        if (process.env.BOT_ALLOWED_CATEGORIES) {
            this.config.allowedCategories = process.env.BOT_ALLOWED_CATEGORIES.split(',');
        }
    }

    public get<K extends keyof Config>(key: K): Config[K] {
        return this.config[key];
    }

    public getAll(): Config {
        return { ...this.config };
    }

    public set<K extends keyof Config>(key: K, value: Config[K]): void {
        this.config[key] = value;
    }

    // Computed values
    public getMaxMarketExposure(): number {
        return this.config.bankroll * this.config.maxMarketExposurePct;
    }

    public getMaxSingleOrder(): number {
        return this.config.bankroll * this.config.maxSingleOrderPct;
    }

    public getLateResolutionMs(): number {
        return this.config.lateResolutionHours * 60 * 60 * 1000;
    }

    public getMaxTimeToResolutionMs(): number {
        return this.config.maxTimeToResolutionHours * 60 * 60 * 1000;
    }

    public getVolatilityWindowMs(): number {
        return this.config.volatilityWindowMinutes * 60 * 1000;
    }
}

// Export singleton instance
export const configService = ConfigService.getInstance();
export default configService;
