import { Position, MarketState } from '../hooks/useApi';
import './DecisionPanel.css';

interface DecisionPanelProps {
    positions: Position[];
    marketStates: MarketState[];
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

function formatPercent(value: number): string {
    return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function formatPriceDisplay(position: Position): JSX.Element {
    const parts = [];
    if (position.sharesYes > 0) {
        const entry = position.avgEntryYes || 0;
        // Fix: Use entry as fallback if current is undefined (explicit check for undefined/null)
        const current = (position.currentPriceYes !== undefined && position.currentPriceYes !== null)
            ? position.currentPriceYes
            : entry;

        parts.push(
            <span key="yes" className="price-detail">
                YES: {entry.toFixed(2)}¢ → {current.toFixed(2)}¢
            </span>
        );
    }
    if (position.sharesNo > 0) {
        const entry = position.avgEntryNo || 0;
        const current = (position.currentPriceNo !== undefined && position.currentPriceNo !== null)
            ? position.currentPriceNo
            : entry;

        parts.push(
            <span key="no" className="price-detail">
                NO: {entry.toFixed(2)}¢ → {current.toFixed(2)}¢
            </span>
        );
    }
    return <div className="price-comparison">{parts}</div>;
}

// Helper to get entry reason from ladder levels
function getEntryReason(state: MarketState): string {
    const ladderFilled = state.ladderFilled || '';
    const levels = typeof ladderFilled === 'string'
        ? ladderFilled.replace(/[\[\]]/g, '').split(',').filter(Boolean)
        : [];

    if (levels.length === 0) {
        // If we have a position but no ladder info, it might be another strategy or pre-existing
        return 'Active position (Monitoring)';
    }

    const lastLevel = levels[levels.length - 1];
    const levelPercent = (parseFloat(lastLevel) * 100).toFixed(0);

    // Determine confidence tier based on level
    let confidenceTier = 'STANDARD';
    const levelValue = parseFloat(lastLevel);
    if (levelValue >= 0.90) confidenceTier = 'HIGHEST';
    else if (levelValue >= 0.80) confidenceTier = 'HIGH';
    else if (levelValue >= 0.70) confidenceTier = 'MEDIUM';

    return `Ladder level ${levelPercent}¢ hit (Confidence: ${confidenceTier})`;
}

// Helper to determine position status
function getPositionStatus(position: Position, state?: MarketState): {
    status: 'ACTIVE' | 'MOON_BAG' | 'THESIS_WATCH' | 'PROFIT_TARGET';
    reason: string;
    progress?: number;
    nextAction?: string;
} {
    const costBasis = position.costBasisYes + position.costBasisNo;
    const profitPct = costBasis > 0 ? position.unrealizedPnl / costBasis : 0;

    // Check if this might be a moon bag (small position with profit)
    // We can't directly know, but if realizedPnl > 0 and position is small, it likely is
    if (position.realizedPnl > 0 && costBasis < 5) {
        return {
            status: 'MOON_BAG',
            reason: `Holding ${formatPercent(profitPct)} moon bag after taking profits`,
            nextAction: 'Will hold until resolution OR sell if price drops'
        };
    }

    // Check if approaching profit target (12%)
    const profitTarget = 0.12;
    if (profitPct >= profitTarget) {
        return {
            status: 'PROFIT_TARGET',
            reason: `Profit target reached: ${formatPercent(profitPct)}`,
            progress: 100,
            nextAction: 'Ready to sell 75%, keep 25% moon bag'
        };
    }

    if (profitPct >= profitTarget * 0.5) {
        const progressToTarget = (profitPct / profitTarget) * 100;
        const remaining = ((profitTarget - profitPct) * 100).toFixed(1);
        return {
            status: 'ACTIVE',
            reason: `On track: ${formatPercent(profitPct)} profit`,
            progress: progressToTarget,
            nextAction: `Will sell 75% at +12% (${remaining}% away)`
        };
    }

    // Check for potential thesis break (negative P&L)
    if (profitPct < -0.05) {
        return {
            status: 'THESIS_WATCH',
            reason: `Position underwater: ${formatPercent(profitPct)}`,
            nextAction: 'Monitoring for consensus break (will exit if break lasts 10+ min)'
        };
    }

    return {
        status: 'ACTIVE',
        reason: getEntryReason(state || {} as MarketState),
        progress: Math.max(0, (profitPct / profitTarget) * 100),
        nextAction: 'Monitoring for profit opportunities'
    };
}

function getStatusIcon(status: string): string {
    switch (status) {
        case 'MOON_BAG': return '🌙';
        case 'THESIS_WATCH': return '⚠️';
        case 'PROFIT_TARGET': return '🎯';
        default: return '🟢';
    }
}

function getStatusColor(status: string): string {
    switch (status) {
        case 'MOON_BAG': return 'var(--accent-purple)';
        case 'THESIS_WATCH': return 'var(--accent-orange)';
        case 'PROFIT_TARGET': return 'var(--accent-green)';
        default: return 'var(--accent-blue)';
    }
}

export default function DecisionPanel({ positions, marketStates }: DecisionPanelProps) {
    if (positions.length === 0) {
        return (
            <div className="decision-panel empty">
                <div className="panel-header">
                    <h3>📋 Active Decisions</h3>
                </div>
                <div className="empty-state">
                    <p>No active positions. Bot is scanning for opportunities...</p>
                </div>
            </div>
        );
    }

    // Match positions with their market states
    const positionsWithState = positions.map(position => {
        const state = marketStates.find(s => s.marketId === position.marketId);
        const status = getPositionStatus(position, state);
        return { position, state, status };
    });

    // Sort by game start time - upcoming games first, then by question
    positionsWithState.sort((a, b) => {
        const timeA = a.position.market?.gameStartTime ? new Date(a.position.market.gameStartTime).getTime() : Infinity;
        const timeB = b.position.market?.gameStartTime ? new Date(b.position.market.gameStartTime).getTime() : Infinity;

        // If both have game times, sort by soonest first
        if (timeA !== Infinity && timeB !== Infinity) {
            return timeA - timeB;
        }
        // Markets with game time come first
        if (timeA !== Infinity) return -1;
        if (timeB !== Infinity) return 1;
        // Otherwise sort by question alphabetically
        return (a.position.market?.question || '').localeCompare(b.position.market?.question || '');
    });

    return (
        <div className="decision-panel">
            <div className="panel-header">
                <h3>📋 Active Decisions</h3>
                <span className="position-count">{positions.length} positions</span>
            </div>

            <div className="decisions-list">
                {positionsWithState.map(({ position, status }) => {
                    const costBasis = position.costBasisYes + position.costBasisNo;
                    const profitPct = costBasis > 0 ? position.unrealizedPnl / costBasis : 0;
                    const marketName = position.market?.question?.substring(0, 40) || position.marketId.substring(0, 20);

                    return (
                        <div key={position.marketId} className={`decision-card status-${status.status.toLowerCase()}`}>
                            <div className="decision-header">
                                <span className="status-icon">{getStatusIcon(status.status)}</span>
                                <span className="market-name" title={position.market?.question}>
                                    {marketName}...
                                </span>
                                <span
                                    className="status-badge"
                                    style={{
                                        backgroundColor: `${getStatusColor(status.status)}20`,
                                        color: getStatusColor(status.status),
                                        borderColor: `${getStatusColor(status.status)}40`
                                    }}
                                >
                                    {status.status.replace('_', ' ')}
                                </span>
                            </div>

                            <div className="decision-details">
                                <div className="detail-row">
                                    <span className="detail-label">Entry Reason:</span>
                                    <span className="detail-value">{status.reason}</span>
                                </div>

                                <div className="detail-row">
                                    <span className="detail-label">Current P&L:</span>
                                    <span className={`detail-value pnl ${profitPct >= 0 ? 'positive' : 'negative'}`}>
                                        {formatCurrency(position.unrealizedPnl)} ({formatPercent(profitPct)})
                                    </span>
                                </div>

                                <div className="detail-row">
                                    <span className="detail-label">Prices:</span>
                                    {formatPriceDisplay(position)}
                                </div>

                                {position.market?.gameStartTime && (
                                    <div className="detail-row">
                                        <span className="detail-label">Game Starts:</span>
                                        <span className="detail-value game-time">
                                            {new Date(position.market.gameStartTime).toLocaleString(undefined, {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: 'numeric',
                                                minute: '2-digit'
                                            })}
                                        </span>
                                    </div>
                                )}

                                {status.progress !== undefined && (
                                    <div className="detail-row progress-row">
                                        <span className="detail-label">Profit Target:</span>
                                        <div className="progress-container">
                                            <div className="progress-bar">
                                                <div
                                                    className="progress-fill"
                                                    style={{
                                                        width: `${Math.min(100, status.progress)}%`,
                                                        backgroundColor: status.progress >= 100
                                                            ? 'var(--accent-green)'
                                                            : 'var(--accent-blue)'
                                                    }}
                                                ></div>
                                            </div>
                                            <span className="progress-text">{status.progress.toFixed(0)}%</span>
                                        </div>
                                    </div>
                                )}

                                {status.nextAction && (
                                    <div className="detail-row next-action">
                                        <span className="detail-label">Next Action:</span>
                                        <span className="detail-value">{status.nextAction}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
