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
            const level = strategyDetail.replace('ladder_', '');
            const levelPct = (parseFloat(level) * 100).toFixed(0);
            let confidence = 'STANDARD';
            const levelVal = parseFloat(level);
            if (levelVal >= 0.90) confidence = 'HIGHEST';
            else if (levelVal >= 0.80) confidence = 'HIGH';
            else if (levelVal >= 0.70) confidence = 'MEDIUM';
            return {
                reason: `Entry at L${levelPct} (${confidence} confidence)`,
                icon: '📈'
            };
        }

        case 'PROFIT_TAKING': {
            if (strategyDetail.includes('75pct') || strategyDetail.includes('partial')) {
                return {
                    reason: 'Sold 75% at profit - Moon bag kept',
                    icon: '🌙'
                };
            }
            if (strategyDetail.includes('moon')) {
                return {
                    reason: 'Moon bag exit - Price dropped',
                    icon: '🌙'
                };
            }
            if (strategyDetail.includes('thesis') || strategyDetail.includes('stop')) {
                return {
                    reason: 'Thesis stop - Consensus broken 10+ min',
                    icon: '🛑'
                };
            }
            return {
                reason: 'Full position exit',
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
                <span className="col-side">Side</span>
                <span className="col-price">Price</span>
                <span className="col-size">Size</span>
                <span className="col-strategy">Strategy</span>
                <span className="col-reason">Reason</span>
            </div>
            <div className="trades-body">
                {trades.map(trade => {
                    const { reason, icon } = getTradeReason(
                        trade.strategy,
                        trade.strategyDetail,
                        trade.side,
                        trade.price
                    );

                    return (
                        <div key={trade.id} className="trade-row">
                            <div className="col-time">
                                {formatTime(trade.timestamp)}
                            </div>
                            <div className="col-market">
                                <span className="market-question" title={trade.market?.question}>
                                    {trade.market?.question?.substring(0, 35) || trade.marketId.substring(0, 15)}...
                                </span>
                            </div>
                            <div className="col-side">
                                <span className={`side-badge ${trade.side.toLowerCase()}`}>
                                    {trade.side}
                                </span>
                            </div>
                            <div className="col-price">
                                {(trade.price * 100).toFixed(1)}¢
                            </div>
                            <div className="col-size">
                                {formatCurrency(trade.size)}
                                <span className="shares-detail">({trade.shares.toFixed(2)} sh)</span>
                            </div>
                            <div className="col-strategy">
                                <span
                                    className="strategy-badge"
                                    style={{
                                        background: `${getStrategyColor(trade.strategy)}20`,
                                        color: getStrategyColor(trade.strategy),
                                        borderColor: `${getStrategyColor(trade.strategy)}40`
                                    }}
                                >
                                    {getStrategyLabel(trade.strategy)}
                                </span>
                            </div>
                            <div className="col-reason">
                                <span className="reason-icon">{icon}</span>
                                <span className="reason-text" title={reason}>{reason}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
