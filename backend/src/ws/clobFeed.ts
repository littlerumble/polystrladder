import WebSocket from 'ws';
import { PrismaClient } from '@prisma/client';
import { PriceUpdate } from '../core/types.js';
import { configService } from '../config/configService.js';
import { wsLogger as logger } from '../core/logger.js';
import eventBus from '../core/eventBus.js';

const CLOB_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';

interface ClobBookMessage {
    event_type: 'book';
    asset_id: string;
    market: string;
    timestamp: number;
    bids: Array<{ price: string; size: string }>;
    asks: Array<{ price: string; size: string }>;
}

interface ClobPriceChangeMessage {
    event_type: 'price_change';
    asset_id: string;
    market: string;
    price: string;
    timestamp: number;
}

interface ClobLastTradePriceMessage {
    event_type: 'last_trade_price';
    asset_id: string;
    market: string;
    price: string;
    timestamp: number;
}

type ClobMessage = ClobBookMessage | ClobPriceChangeMessage | ClobLastTradePriceMessage;

/**
 * CLOB WebSocket Feed - Subscribes to real-time price updates from Polymarket.
 */
export class ClobFeed {
    private prisma: PrismaClient;
    private ws: WebSocket | null = null;
    private subscribedTokens: Map<string, string> = new Map(); // tokenId -> marketId
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 10;
    private isShuttingDown = false;
    private pingInterval: NodeJS.Timeout | null = null;

    constructor(prisma: PrismaClient) {
        this.prisma = prisma;
    }

    /**
     * Connect to CLOB WebSocket.
     */
    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            logger.info('Connecting to CLOB WebSocket...');

            this.ws = new WebSocket(CLOB_WS_URL);

            this.ws.on('open', () => {
                logger.info('CLOB WebSocket connected');
                this.reconnectAttempts = 0;
                eventBus.emit('ws:connected');

                // Start ping interval to keep connection alive
                this.startPingInterval();

                // Resubscribe to all tokens
                this.resubscribeAll();

                resolve();
            });

            this.ws.on('message', (data: WebSocket.Data) => {
                try {
                    this.handleMessage(data.toString());
                } catch (error) {
                    logger.error('Error handling WS message', { error: String(error) });
                }
            });

            this.ws.on('close', () => {
                logger.warn('CLOB WebSocket closed');
                this.stopPingInterval();
                eventBus.emit('ws:disconnected');

                if (!this.isShuttingDown) {
                    this.scheduleReconnect();
                }
            });

            this.ws.on('error', (error) => {
                logger.error('CLOB WebSocket error', { error: String(error) });
                if (this.reconnectAttempts === 0) {
                    reject(error);
                }
            });
        });
    }

    /**
     * Handle incoming WebSocket message.
     */
    private handleMessage(data: string): void {
        try {
            const messages: ClobMessage[] = JSON.parse(data);

            if (!Array.isArray(messages)) {
                // Single message
                this.processMessage(messages as unknown as ClobMessage);
            } else {
                // Array of messages
                for (const msg of messages) {
                    this.processMessage(msg);
                }
            }
        } catch (error) {
            // Try parsing as single object
            try {
                const msg = JSON.parse(data) as ClobMessage;
                this.processMessage(msg);
            } catch {
                logger.debug('Could not parse WS message', { data: data.substring(0, 100) });
            }
        }
    }

    /**
     * Process a single CLOB message.
     */
    private processMessage(msg: ClobMessage): void {
        const marketId = this.subscribedTokens.get(msg.asset_id);
        if (!marketId) return; // Not a token we're tracking

        if (msg.event_type === 'book') {
            this.handleBookMessage(msg as ClobBookMessage, marketId);
        } else if (msg.event_type === 'price_change' || msg.event_type === 'last_trade_price') {
            this.handlePriceMessage(msg, marketId);
        }
    }

    /**
     * Handle orderbook snapshot/update.
     */
    private handleBookMessage(msg: ClobBookMessage, marketId: string): void {
        const bestBid = msg.bids.length > 0 ? parseFloat(msg.bids[0].price) : undefined;
        const bestAsk = msg.asks.length > 0 ? parseFloat(msg.asks[0].price) : undefined;

        // Calculate mid price
        let priceYes: number;
        if (bestBid !== undefined && bestAsk !== undefined) {
            priceYes = (bestBid + bestAsk) / 2;
        } else if (bestBid !== undefined) {
            priceYes = bestBid;
        } else if (bestAsk !== undefined) {
            priceYes = bestAsk;
        } else {
            return; // No price info
        }

        const update: PriceUpdate = {
            marketId,
            tokenId: msg.asset_id,
            priceYes,
            priceNo: 1 - priceYes,
            bestBidYes: bestBid,
            bestAskYes: bestAsk,
            timestamp: new Date(msg.timestamp)
        };

        this.emitPriceUpdate(update);
    }

    /**
     * Handle price change message.
     */
    private handlePriceMessage(
        msg: ClobPriceChangeMessage | ClobLastTradePriceMessage,
        marketId: string
    ): void {
        const priceYes = parseFloat(msg.price);

        const update: PriceUpdate = {
            marketId,
            tokenId: msg.asset_id,
            priceYes,
            priceNo: 1 - priceYes,
            timestamp: new Date(msg.timestamp)
        };

        this.emitPriceUpdate(update);
    }

    /**
     * Emit price update and persist to history.
     */
    private async emitPriceUpdate(update: PriceUpdate): Promise<void> {
        eventBus.emit('price:update', update);

        // Persist to price history (async, don't await)
        this.prisma.priceHistory.create({
            data: {
                marketId: update.marketId,
                priceYes: update.priceYes,
                priceNo: update.priceNo,
                bestBidYes: update.bestBidYes,
                bestAskYes: update.bestAskYes,
                bestBidNo: update.bestBidNo,
                bestAskNo: update.bestAskNo,
                timestamp: update.timestamp
            }
        }).catch(err => {
            logger.debug('Failed to persist price history', { error: String(err) });
        });
    }

    /**
     * Subscribe to a market's price updates.
     */
    subscribe(marketId: string, tokenIds: string[]): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            logger.warn('Cannot subscribe, WebSocket not connected');
            return;
        }

        for (const tokenId of tokenIds) {
            this.subscribedTokens.set(tokenId, marketId);
        }

        const subscribeMsg = {
            type: 'subscribe',
            assets_ids: tokenIds
        };

        this.ws.send(JSON.stringify(subscribeMsg));
        logger.debug(`Subscribed to market ${marketId}`, { tokenCount: tokenIds.length });
    }

    /**
     * Subscribe to multiple markets.
     */
    subscribeToMarkets(markets: Array<{ marketId: string; clobTokenIds: string[] }>): void {
        const allTokenIds: string[] = [];

        for (const market of markets) {
            for (const tokenId of market.clobTokenIds) {
                this.subscribedTokens.set(tokenId, market.marketId);
                allTokenIds.push(tokenId);
            }
        }

        if (allTokenIds.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
            const subscribeMsg = {
                type: 'subscribe',
                assets_ids: allTokenIds
            };

            this.ws.send(JSON.stringify(subscribeMsg));
            logger.info(`Subscribed to ${markets.length} markets (${allTokenIds.length} tokens)`);
        }
    }

    /**
     * Unsubscribe from a market.
     */
    unsubscribe(marketId: string, tokenIds: string[]): void {
        for (const tokenId of tokenIds) {
            this.subscribedTokens.delete(tokenId);
        }

        if (this.ws?.readyState === WebSocket.OPEN) {
            const unsubscribeMsg = {
                type: 'unsubscribe',
                assets_ids: tokenIds
            };

            this.ws.send(JSON.stringify(unsubscribeMsg));
        }
    }

    /**
     * Resubscribe to all tokens after reconnect.
     */
    private resubscribeAll(): void {
        const allTokenIds = Array.from(this.subscribedTokens.keys());

        if (allTokenIds.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
            const subscribeMsg = {
                type: 'subscribe',
                assets_ids: allTokenIds
            };

            this.ws.send(JSON.stringify(subscribeMsg));
            logger.info(`Resubscribed to ${allTokenIds.length} tokens after reconnect`);
        }
    }

    /**
     * Start ping interval to keep connection alive.
     */
    private startPingInterval(): void {
        this.pingInterval = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                this.ws.ping();
            }
        }, 30000);
    }

    /**
     * Stop ping interval.
     */
    private stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    /**
     * Schedule reconnection with exponential backoff.
     */
    private scheduleReconnect(): void {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnect attempts reached, giving up');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(
            configService.get('wsReconnectDelayMs') * Math.pow(2, this.reconnectAttempts - 1),
            60000
        );

        logger.info(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
        eventBus.emit('ws:reconnecting', this.reconnectAttempts);

        setTimeout(() => {
            this.connect().catch(err => {
                logger.error('Reconnect failed', { error: String(err) });
            });
        }, delay);
    }

    /**
     * Disconnect and cleanup.
     */
    disconnect(): void {
        this.isShuttingDown = true;
        this.stopPingInterval();

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        this.subscribedTokens.clear();
        logger.info('CLOB WebSocket disconnected');
    }

    /**
     * Check if connected.
     */
    isConnected(): boolean {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

export default ClobFeed;
