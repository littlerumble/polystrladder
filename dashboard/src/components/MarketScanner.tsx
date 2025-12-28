import { Market, MarketState } from '../hooks/useApi';
import './MarketScanner.css';

interface EnrichedMarket extends Market {
    priceYes?: number;
    priceNo?: number;
    pricePct?: string;
    entryCue?: string;
    regime?: string;
}

interface MarketScannerProps {
    markets: EnrichedMarket[];
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
        default: return regime || 'Unknown';
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
                <span className="col-price">YES Price</span>
                <span className="col-regime">Regime</span>
                <span className="col-entry">Entry Cue</span>
                <span className="col-time">Time Left</span>
                <span className="col-status">Status</span>
            </div>
            <div className="scanner-body">
                {markets.map(market => {
                    const state = stateMap.get(market.id);
                    const filledCount = state ? JSON.parse(state.ladderFilled || '[]').length : 0;
                    // Use new fields from enhanced API, fallback to old state
                    const regime = market.regime || state?.regime || 'Unknown';
                    const priceDisplay = market.pricePct || (market.priceYes ? `${(market.priceYes * 100).toFixed(1)}%` : '...');
                    const entryDisplay = market.entryCue || 'Loading...';

                    return (
                        <div key={market.id} className="scanner-row">
                            <div className="col-market">
                                <span className="market-question" title={market.question}>
                                    {market.question.length > 50
                                        ? market.question.substring(0, 50) + '...'
                                        : market.question}
                                </span>
                            </div>
                            <div className="col-price">
                                <span className="price-badge" style={{
                                    color: market.priceYes && market.priceYes >= 0.60
                                        ? 'var(--accent-green)'
                                        : 'var(--text-muted)'
                                }}>
                                    {priceDisplay}
                                </span>
                            </div>
                            <div className="col-regime">
                                <span
                                    className="regime-badge"
                                    style={{
                                        background: `${getRegimeColor(regime)}20`,
                                        color: getRegimeColor(regime),
                                        borderColor: `${getRegimeColor(regime)}40`
                                    }}
                                >
                                    {getRegimeLabel(regime)}
                                </span>
                            </div>
                            <div className="col-entry">
                                <span className="entry-cue" title={entryDisplay}>
                                    {entryDisplay.length > 30 ? entryDisplay.substring(0, 30) + '...' : entryDisplay}
                                </span>
                            </div>
                            <div className="col-time">
                                {formatTimeRemaining(market.endDate)}
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
