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
    private tokenSides: Map<string, 'YES' | 'NO'> = new Map(); // tokenId -> side
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
        let rawPrice: number;
        if (bestBid !== undefined && bestAsk !== undefined) {
            rawPrice = (bestBid + bestAsk) / 2;
        } else if (bestBid !== undefined) {
            rawPrice = bestBid;
        } else if (bestAsk !== undefined) {
            rawPrice = bestAsk;
        } else {
            return; // No price info
        }

        const side = this.tokenSides.get(msg.asset_id);
        if (!side) {
            // logger.debug('Skipping update for unknown token side', { tokenId: msg.asset_id, marketId });
            return;
        }
        const priceYes = side === 'YES' ? rawPrice : (1 - rawPrice);

        // precise logic:
        // If Side = YES: BidYes = rawBid, AskYes = rawAsk
        // If Side = NO:  BidYes = 1 - AskNo (rawAsk), AskYes = 1 - BidNo (rawBid)
        let bestBidYes: number | undefined;
        let bestAskYes: number | undefined;

        if (side === 'YES') {
            bestBidYes = bestBid;
            bestAskYes = bestAsk;
        } else {
            // Side is NO
            if (bestAsk !== undefined) bestBidYes = 1 - bestAsk; // Implied Bid
            if (bestBid !== undefined) bestAskYes = 1 - bestBid; // Implied Ask
        }

        const update: PriceUpdate = {
            marketId,
            tokenId: msg.asset_id,
            priceYes,
            priceNo: 1 - priceYes,
            bestBidYes,
            bestAskYes,
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
        const rawPrice = parseFloat(msg.price);
        const side = this.tokenSides.get(msg.asset_id);
        if (!side) {
            logger.debug('Skipping price message for unknown token side', { tokenId: msg.asset_id, marketId });
            return;
        }

        const priceYes = side === 'YES' ? rawPrice : (1 - rawPrice);

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
    subscribeToMarkets(markets: Array<{ marketId: string; clobTokenIds: string[]; outcomes: string[] }>): void {
        const allTokenIds: string[] = [];

        for (const market of markets) {
            // CRITICAL: Use outcomes field to determine which token is YES vs NO
            // clobTokenIds order matches outcomes order (just like outcomePrices)
            // outcomes could be ["Yes", "No"] or ["No", "Yes"]

            if (market.clobTokenIds.length >= 2 && market.outcomes.length >= 2) {
                const yesIndex = market.outcomes.findIndex(o => o.toLowerCase() === 'yes');
                const noIndex = market.outcomes.findIndex(o => o.toLowerCase() === 'no');

                if (yesIndex !== -1 && noIndex !== -1) {
                    const yesTokenId = market.clobTokenIds[yesIndex];
                    const noTokenId = market.clobTokenIds[noIndex];

                    this.subscribedTokens.set(yesTokenId, market.marketId);
                    this.tokenSides.set(yesTokenId, 'YES');
                    allTokenIds.push(yesTokenId);

                    this.subscribedTokens.set(noTokenId, market.marketId);
                    this.tokenSides.set(noTokenId, 'NO');
                    allTokenIds.push(noTokenId);
                } else {
                    // Non-standard outcomes - fallback to first=YES (log warning)
                    logger.warn(`Non-standard outcomes for ${market.marketId}: ${JSON.stringify(market.outcomes)}`);
                    this.subscribedTokens.set(market.clobTokenIds[0], market.marketId);
                    this.tokenSides.set(market.clobTokenIds[0], 'YES');
                    allTokenIds.push(market.clobTokenIds[0]);
                    if (market.clobTokenIds[1]) {
                        this.subscribedTokens.set(market.clobTokenIds[1], market.marketId);
                        this.tokenSides.set(market.clobTokenIds[1], 'NO');
                        allTokenIds.push(market.clobTokenIds[1]);
                    }
                }
            } else {
                // Fallback for single token or missing outcomes
                for (const tokenId of market.clobTokenIds) {
                    this.subscribedTokens.set(tokenId, market.marketId);
                    this.tokenSides.set(tokenId, 'YES');
                    allTokenIds.push(tokenId);
                }
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
