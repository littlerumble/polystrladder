import { Market, MarketState } from '../hooks/useApi';
import './MarketScanner.css';

interface MarketScannerProps {
    markets: Market[];
    marketStates: MarketState[];
}

function getRegimeColor(regime: string): string {
    switch (regime) {
        case 'LATE_COMPRESSED': return 'var(--accent-green)';
        case 'HIGH_VOLATILITY': return 'var(--accent-orange)';
        case 'EARLY_UNCERTAIN': return 'var(--accent-purple)';
        case 'MID_CONSENSUS': return 'var(--accent-blue)';
        default: return 'var(--text-muted)';
    }
}

function getRegimeLabel(regime: string): string {
    switch (regime) {
        case 'LATE_COMPRESSED': return 'Late';
        case 'HIGH_VOLATILITY': return 'Volatile';
        case 'EARLY_UNCERTAIN': return 'Early';
        case 'MID_CONSENSUS': return 'Consensus';
        default: return regime;
    }
}

function formatTimeRemaining(endDate: string): string {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff < 0) return 'Ended';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }

    return `${hours}h ${minutes}m`;
}

export default function MarketScanner({ markets, marketStates }: MarketScannerProps) {
    const stateMap = new Map(marketStates.map(s => [s.marketId, s]));

    if (markets.length === 0) {
        return (
            <div className="empty-state">
                <p>No markets loaded yet. Waiting for market data...</p>
            </div>
        );
    }

    return (
        <div className="market-scanner">
            <div className="scanner-header">
                <span className="col-market">Market</span>
                <span className="col-regime">Regime</span>
                <span className="col-time">Time Left</span>
                <span className="col-volume">24h Volume</span>
                <span className="col-status">Status</span>
            </div>
            <div className="scanner-body">
                {markets.map(market => {
                    const state = stateMap.get(market.id);
                    const filledCount = state ? JSON.parse(state.ladderFilled || '[]').length : 0;

                    return (
                        <div key={market.id} className="scanner-row">
                            <div className="col-market">
                                <span className="market-question" title={market.question}>
                                    {market.question.length > 60
                                        ? market.question.substring(0, 60) + '...'
                                        : market.question}
                                </span>
                                <span className="market-category">{market.category}</span>
                            </div>
                            <div className="col-regime">
                                <span
                                    className="regime-badge"
                                    style={{
                                        background: `${getRegimeColor(state?.regime || '')}20`,
                                        color: getRegimeColor(state?.regime || ''),
                                        borderColor: `${getRegimeColor(state?.regime || '')}40`
                                    }}
                                >
                                    {getRegimeLabel(state?.regime || 'Unknown')}
                                </span>
                            </div>
                            <div className="col-time">
                                {formatTimeRemaining(market.endDate)}
                            </div>
                            <div className="col-volume">
                                ${(market.volume24h / 1000).toFixed(1)}k
                            </div>
                            <div className="col-status">
                                {filledCount > 0 && (
                                    <span className="status-badge active">
                                        L{filledCount}
                                    </span>
                                )}
                                {state?.tailActive && (
                                    <span className="status-badge tail">
                                        Tail
                                    </span>
                                )}
                                {!filledCount && !state?.tailActive && (
                                    <span className="status-badge watching">
                                        Watching
                                    </span>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
