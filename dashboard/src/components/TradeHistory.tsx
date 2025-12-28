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
        default: return strategy;
    }
}

function getStrategyColor(strategy: string): string {
    switch (strategy) {
        case 'LADDER_COMPRESSION': return 'var(--accent-green)';
        case 'VOLATILITY_ABSORPTION': return 'var(--accent-orange)';
        case 'TAIL_INSURANCE': return 'var(--accent-purple)';
        default: return 'var(--text-muted)';
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
            </div>
            <div className="trades-body">
                {trades.map(trade => (
                    <div key={trade.id} className="trade-row">
                        <div className="col-time">
                            {formatTime(trade.timestamp)}
                        </div>
                        <div className="col-market">
                            <span className="market-question" title={trade.market?.question}>
                                {trade.market?.question?.substring(0, 40) || trade.marketId.substring(0, 15)}...
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
                            <span className="shares-detail">({trade.shares.toFixed(2)} shares)</span>
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
                            {trade.strategyDetail && (
                                <span className="strategy-detail">
                                    {trade.strategyDetail.replace('ladder_', 'L').replace('_', ' ')}
                                </span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
