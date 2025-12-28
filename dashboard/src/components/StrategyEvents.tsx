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

function getActionColor(action: string): string {
    if (action.includes('EXECUTED')) return 'var(--accent-green)';
    if (action.includes('TRIGGER')) return 'var(--accent-cyan)';
    if (action.includes('SKIP')) return 'var(--text-muted)';
    return 'var(--accent-blue)';
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
                <span className="col-action">Action</span>
                <span className="col-prices">Prices</span>
            </div>
            <div className="events-body">
                {events.map(event => {


                    return (
                        <div key={event.id} className="event-row">
                            <div className="col-time">
                                {formatTime(event.timestamp)}
                            </div>
                            <div className="col-market">
                                <span className="market-question" title={event.market?.question}>
                                    {event.market?.question?.substring(0, 35) || event.marketId.substring(0, 12)}...
                                </span>
                            </div>
                            <div className="col-regime">
                                <span className="regime-tag">{event.regime.replace('_', ' ')}</span>
                            </div>
                            <div className="col-strategy">
                                {event.strategy.replace('_', ' ')}
                            </div>
                            <div className="col-action">
                                <span
                                    className="action-badge"
                                    style={{ color: getActionColor(event.action) }}
                                >
                                    {event.action}
                                </span>
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
