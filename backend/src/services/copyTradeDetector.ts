/**
 * Copy Trade Detector
 * 
 * Polls tracked traders for BUY signals in our ladder bucket.
 * When detected, emits a signal to trigger our ladder strategy.
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { systemLogger as logger } from '../core/logger.js';
import { configService } from '../config/configService.js';
import eventBus from '../core/eventBus.js';

const DATA_API_BASE = 'https://data-api.polymarket.com';

// Tracked traders
const TRACKED_WALLETS = [
    { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', name: 'RN1' },
    { wallet: '0xc65ca4755436f82d8eb461e65781584b8cadea39', name: 'LOOKINGBACK' }
];

export interface CopySignal {
    traderName: string;
    traderWallet: string;
    conditionId: string;
    marketSlug: string;
    marketTitle: string;
    outcome: string;
    price: number;
    timestamp: number;
}

interface TradeActivity {
    timestamp: number;
    conditionId: string;
    title: string;
    slug: string;
    outcome: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
}

export class CopyTradeDetector {
    private prisma: PrismaClient;
    private pollInterval: NodeJS.Timeout | null = null;
    private lastSeenTimestamp: Map<string, number> = new Map();
    private enabled: boolean = true;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Start polling tracked traders for copy signals.
     */
    start(): void {
        if (!this.enabled) {
            return;
        }

        logger.info('Copy Trade Detector started');

        // Initial poll
        this.poll();

        // Poll every 10 seconds
        this.pollInterval = setInterval(() => this.poll(), 10000);
    }

    /**
     * Stop polling.
     */
    stop(): void {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        logger.info('Copy Trade Detector stopped');
    }

    /**
     * Poll all tracked traders for new trades.
     */
    private async poll(): Promise<void> {
        const ladderLevels = configService.get('ladderLevels') as number[] || [0.65, 0.70, 0.75, 0.80];
        const minPrice = Math.min(...ladderLevels);
        const maxPrice = configService.get('maxBuyPrice') as number || 0.84;

        for (const trader of TRACKED_WALLETS) {
            try {
                const trades = await this.fetchRecentTrades(trader.wallet);

                // Get last seen timestamp for this trader
                const lastSeen = this.lastSeenTimestamp.get(trader.wallet) || 0;

                // Find new BUY trades in our price bucket
                const newSignals = trades.filter(t =>
                    t.side === 'BUY' &&
                    t.timestamp > lastSeen &&
                    t.price >= minPrice &&
                    t.price <= maxPrice
                );

                // Update last seen timestamp
                if (trades.length > 0) {
                    const maxTs = Math.max(...trades.map(t => t.timestamp));
                    this.lastSeenTimestamp.set(trader.wallet, maxTs);
                }

                // Emit signals for new trades
                for (const trade of newSignals) {
                    const signal: CopySignal = {
                        traderName: trader.name,
                        traderWallet: trader.wallet,
                        conditionId: trade.conditionId,
                        marketSlug: trade.slug,
                        marketTitle: trade.title,
                        outcome: trade.outcome,
                        price: trade.price,
                        timestamp: trade.timestamp
                    };

                    logger.info('🔔 Copy signal detected', {
                        trader: trader.name,
                        market: trade.title.substring(0, 50),
                        outcome: trade.outcome,
                        price: `${(trade.price * 100).toFixed(1)}¢`
                    });

                    // Emit signal for main loop to pick up
                    eventBus.emit('copy:signal', signal);
                }

            } catch (error) {
                logger.error('Failed to poll trader', {
                    trader: trader.name,
                    error: String(error)
                });
            }
        }
    }

    /**
     * Fetch recent trades from Polymarket API.
     */
    private async fetchRecentTrades(wallet: string): Promise<TradeActivity[]> {
        // Fetch last 5 minutes of activity
        const fiveMinutesAgo = Math.floor(Date.now() / 1000) - (5 * 60);

        const response = await axios.get(`${DATA_API_BASE}/activity`, {
            params: {
                user: wallet,
                limit: 50,
                startTs: fiveMinutesAgo
            },
            timeout: 10000
        });

        return response.data
            .filter((t: any) => t.type === 'TRADE')
            .map((t: any) => ({
                timestamp: t.timestamp,
                conditionId: t.conditionId,
                title: t.title || 'Unknown Market',
                slug: t.slug || '',
                outcome: t.outcome || 'Unknown',
                side: t.side,
                price: t.price || 0,
                size: t.size || 0
            }));
    }
}

export default CopyTradeDetector;

