import { StrategyEvent } from '../hooks/useApi';
import './StrategyEvents.css';

interface StrategyEventsProps {
    events: StrategyEvent[];
}

function formatTime(timestamp: string): string {
    return new Date(timestamp).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });
}

// Parse the details JSON and generate human-readable reasoning
function parseReason(strategy: string, details: string): { reason: string; icon: string } {
    try {
        const parsed = JSON.parse(details);

        switch (strategy) {
            case 'LADDER_COMPRESSION': {
                const level = parsed.strategyDetail?.replace('ladder_', '') || '?';
                const size = parsed.size?.toFixed(2) || '?';
                return {
                    reason: `Bought at L${(parseFloat(level) * 100).toFixed(0)} level ($${size})`,
                    icon: '📈'
                };
            }

            case 'PROFIT_TAKING': {
                const side = parsed.side || 'YES';
                return {
                    reason: `Full exit - Position closed (${side}) 💰`,
                    icon: '💰'
                };
            }

            case 'VOLATILITY_ABSORPTION': {
                const side = parsed.side || '?';
                const size = parsed.size?.toFixed(2) || '?';
                return {
                    reason: `${side} volatility capture ($${size})`,
                    icon: '🌊'
                };
            }

            case 'TAIL_INSURANCE': {
                const shares = parsed.shares?.toFixed(2) || '?';
                const convexity = parsed.convexity ? `${parsed.convexity.toFixed(0)}x` : '?';
                return {
                    reason: `NO hedge bought (${shares} shares, ${convexity} convexity)`,
                    icon: '🛡️'
                };
            }

            default:
                return {
                    reason: details.substring(0, 50) || 'Strategy executed',
                    icon: '📋'
                };
        }
    } catch {
        return {
            reason: strategy.replace('_', ' ').toLowerCase(),
            icon: '📋'
        };
    }
}

// Get strategy-specific color
function getStrategyColor(strategy: string): string {
    switch (strategy) {
        case 'LADDER_COMPRESSION': return 'var(--accent-green)';
        case 'PROFIT_TAKING': return 'var(--accent-purple)';
        case 'VOLATILITY_ABSORPTION': return 'var(--accent-orange)';
        case 'TAIL_INSURANCE': return 'var(--accent-cyan)';
        default: return 'var(--text-muted)';
    }
}

export default function StrategyEvents({ events }: StrategyEventsProps) {
    if (events.length === 0) {
        return (
            <div className="empty-state">
                <p>No strategy events yet. Waiting for market opportunities...</p>
            </div>
        );
    }

    return (
        <div className="strategy-events">
            <div className="events-header">
                <span className="col-time">Time</span>
                <span className="col-market">Market</span>
                <span className="col-regime">Regime</span>
                <span className="col-strategy">Strategy</span>
                <span className="col-reason">Reasoning</span>
                <span className="col-prices">Prices</span>
            </div>
            <div className="events-body">
                {events.map(event => {
                    const { reason, icon } = parseReason(event.strategy, event.details);

                    return (
                        <div key={event.id} className="event-row">
                            <div className="col-time">
                                {formatTime(event.timestamp)}
                            </div>
                            <div className="col-market">
                                <span className="market-question" title={event.market?.question}>
                                    {event.market?.question?.substring(0, 30) || event.marketId.substring(0, 12)}...
                                </span>
                            </div>
                            <div className="col-regime">
                                <span className="regime-tag">{event.regime.replace('_', ' ')}</span>
                            </div>
                            <div className="col-strategy">
                                <span
                                    className="strategy-tag"
                                    style={{
                                        backgroundColor: `${getStrategyColor(event.strategy)}20`,
                                        color: getStrategyColor(event.strategy),
                                        borderColor: `${getStrategyColor(event.strategy)}40`
                                    }}
                                >
                                    {event.strategy.replace('_', ' ')}
                                </span>
                            </div>
                            <div className="col-reason">
                                <span className="reason-icon">{icon}</span>
                                <span className="reason-text">{reason}</span>
                            </div>
                            <div className="col-prices">
                                <span className="price-yes">Y: {(event.priceYes * 100).toFixed(1)}¢</span>
                                <span className="price-no">N: {(event.priceNo * 100).toFixed(1)}¢</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
