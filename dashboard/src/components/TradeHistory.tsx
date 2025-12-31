import { Trade } from '../hooks/useApi';
import './TradeHistory.css';

interface TradeHistoryProps {
    trades: Trade[];
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getStrategyLabel(strategy: string): string {
    switch (strategy) {
        case 'LADDER_COMPRESSION': return 'Ladder';
        case 'VOLATILITY_ABSORPTION': return 'Volatility';
        case 'TAIL_INSURANCE': return 'Tail';
        case 'PROFIT_TAKING': return 'Profit';
        default: return strategy;
    }
}

function getStrategyColor(strategy: string): string {
    switch (strategy) {
        case 'LADDER_COMPRESSION': return 'var(--accent-green)';
        case 'VOLATILITY_ABSORPTION': return 'var(--accent-orange)';
        case 'TAIL_INSURANCE': return 'var(--accent-cyan)';
        case 'PROFIT_TAKING': return 'var(--accent-purple)';
        default: return 'var(--text-muted)';
    }
}

// Parse strategy detail to get human-readable reason
function getTradeReason(strategy: string, strategyDetail: string, side: string, price: number): { reason: string; icon: string } {
    switch (strategy) {
        case 'LADDER_COMPRESSION': {
            // Check if it's an exit via ladder logic (rare, but possible)
            if (strategyDetail && strategyDetail.toLowerCase().includes('exit')) {
                return {
                    reason: strategyDetail,
                    icon: '🪜'
                };
            }

            // Normal Entry logic
            let levelPct = (price * 100).toFixed(0);
            if (strategyDetail && strategyDetail.includes('ladder_')) {
                const level = strategyDetail.replace('ladder_', '');
                levelPct = (parseFloat(level) * 100).toFixed(0);
            }

            // Calculate confidence purely for display
            let confidence = 'STANDARD';
            const priceVal = price;
            if (priceVal >= 0.90) confidence = 'HIGHEST';
            else if (priceVal >= 0.80) confidence = 'HIGH';
            else if (priceVal >= 0.70) confidence = 'MEDIUM';

            return {
                reason: `Entry at L${levelPct} (${confidence} confidence)`,
                icon: '📈'
            };
        }

        case 'PROFIT_TAKING': {
            if (strategyDetail && (strategyDetail.includes('75pct') || strategyDetail.includes('partial'))) {
                return {
                    reason: 'Sold 75% at profit - Moon bag kept',
                    icon: '🌙'
                };
            }
            if (strategyDetail && strategyDetail.includes('moon')) {
                return {
                    reason: 'Moon bag exit - Price dropped',
                    icon: '🌙'
                };
            }
            if (strategyDetail && (strategyDetail.includes('thesis') || strategyDetail.includes('stop'))) {
                return {
                    reason: 'Thesis stop - Consensus broken 10+ min',
                    icon: '🛑'
                };
            }
            return {
                reason: strategyDetail || 'Full position exit',
                icon: '💰'
            };
        }

        case 'VOLATILITY_ABSORPTION': {
            return {
                reason: `${side} volatility capture at ${(price * 100).toFixed(0)}¢`,
                icon: '🌊'
            };
        }

        case 'TAIL_INSURANCE': {
            const convexity = price > 0 ? (1 / price).toFixed(0) : '?';
            return {
                reason: `Tail hedge at ${(price * 100).toFixed(1)}¢ (${convexity}x upside)`,
                icon: '🛡️'
            };
        }

        default:
            return {
                reason: strategyDetail || strategy,
                icon: '📋'
            };
    }
}

const ActionBadge = ({ action }: { action: string }) => {
    // Determine visual style
    // BUY -> Green (usually)
    // SELL -> Red (usually)

    // If action is missing (old data), assume BUY
    const safeAction = action || 'BUY';
    const isBuy = safeAction === 'BUY';

    return (
        <span className={`action-badge ${isBuy ? 'buy' : 'sell'}`}>
            {safeAction}
        </span>
    );
};

export default function TradeHistory({ trades }: TradeHistoryProps) {
    if (trades.length === 0) {
        return (
            <div className="empty-state">
                <p>No trades executed yet. The bot is analyzing markets...</p>
            </div>
        );
    }

    return (
        <div className="trade-history">
            <div className="trades-header">
                <span className="col-time">Time</span>
                <span className="col-market">Market</span>
                <span className="col-action">Action</span>
                <span className="col-side">Side</span>
                <span className="col-price">Price</span>
                <span className="col-size">Size</span>
                <span className="col-strategy">Strategy</span>
                <span className="col-reason">Reason</span>
            </div>
            <div className="trades-body">
                {trades.map(trade => {
                    // Logic to determine if row should look like a sell (red)
                    const isSell = trade.action === 'SELL' || (trade.strategy === 'PROFIT_TAKING' || trade.strategy === 'STOP_LOSS');

                    const { reason, icon } = getTradeReason(
                        trade.strategy,
                        trade.strategyDetail,
                        trade.side,
                        trade.price
                    );

                    // If it's explicitly a sell, use a sell-related icon if the default is just generic ladder
                    const displayIcon = (isSell && icon === '📈') ? '📉' : icon;

                    // If it's a sell, and reason says "Entry at...", fix it
                    let displayReason = reason;
                    if (isSell && (reason.startsWith('Entry at') || reason.includes('Entry at'))) {
                        displayReason = `Exit at ${(trade.price * 100).toFixed(1)}¢`;
                    }
                    // Handle "Sold 75%" case explicitly too if needed, but getTradeReason usually handles PROFIT_TAKING well.

                    return (
                        <div key={trade.id} className={`trade-row ${isSell ? 'sell-row' : ''}`}>
                            <div className="col-time">
                                {formatTime(trade.timestamp)}
                            </div>
                            <div className="col-market" title={trade.strategyDetail}>
                                {trade.market?.question?.substring(0, 40) || 'Unknown Market'}...
                            </div>
                            <div className="col-action">
                                <ActionBadge action={trade.action || (isSell ? 'SELL' : 'BUY')} />
                            </div>
                            <div className="col-side">
                                <span className={`side-badge ${trade.side.toLowerCase()}`}>
                                    {trade.side}
                                </span>
                            </div>
                            <div className="col-price">
                                <span>{(trade.price * 100).toFixed(1)}¢</span>
                            </div>
                            <div className="col-size">
                                <span className="usdc">{formatCurrency(trade.size)}</span>
                                <span className="shares">({trade.shares.toFixed(2)} sh)</span>
                            </div>
                            <div className="col-strategy">
                                <span
                                    className="strategy-badge"
                                    style={{
                                        color: getStrategyColor(trade.strategy),
                                        borderColor: getStrategyColor(trade.strategy)
                                    }}
                                >
                                    {getStrategyLabel(trade.strategy)}
                                </span>
                            </div>
                            <div className="col-reason">
                                <span className="reason-icon">{displayIcon}</span>
                                <span className="reason-text">{displayReason}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
