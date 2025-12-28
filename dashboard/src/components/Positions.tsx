import { Position } from '../hooks/useApi';
import './Positions.css';

interface PositionsProps {
    positions: Position[];
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

// Determine position status based on P&L and realized profits
function getPositionStatus(position: Position): {
    status: 'ACTIVE' | 'MOON_BAG' | 'NEAR_TARGET' | 'UNDERWATER';
    label: string;
    color: string;
    icon: string;
} {
    const costBasis = position.costBasisYes + position.costBasisNo;
    const profitPct = costBasis > 0 ? position.unrealizedPnl / costBasis : 0;

    // Moon bag detection: has realized profits and small cost basis
    if (position.realizedPnl > 0 && costBasis < 5) {
        return {
            status: 'MOON_BAG',
            label: 'Moon Bag',
            color: 'var(--accent-purple)',
            icon: '🌙'
        };
    }

    // Near profit target (>10% profit, approaching 15%)
    if (profitPct >= 0.10) {
        return {
            status: 'NEAR_TARGET',
            label: 'Near Target',
            color: 'var(--accent-green)',
            icon: '🎯'
        };
    }

    // Underwater position (losing money)
    if (profitPct < -0.05) {
        return {
            status: 'UNDERWATER',
            label: 'Underwater',
            color: 'var(--accent-orange)',
            icon: '⚠️'
        };
    }

    // Normal active position
    return {
        status: 'ACTIVE',
        label: 'Active',
        color: 'var(--accent-blue)',
        icon: '🟢'
    };
}

// Calculate progress to profit target (15%)
function getProfitProgress(position: Position): number {
    const costBasis = position.costBasisYes + position.costBasisNo;
    const profitPct = costBasis > 0 ? position.unrealizedPnl / costBasis : 0;
    const targetPct = 0.15;
    return Math.min(100, Math.max(0, (profitPct / targetPct) * 100));
}

export default function Positions({ positions }: PositionsProps) {
    if (positions.length === 0) {
        return (
            <div className="empty-state">
                <p>No active positions. The bot is waiting for opportunities...</p>
            </div>
        );
    }

    return (
        <div className="positions">
            <div className="positions-header">
                <span className="col-status">Status</span>
                <span className="col-market">Market</span>
                <span className="col-side">Side</span>
                <span className="col-shares">Shares</span>
                <span className="col-entry">Avg Entry</span>
                <span className="col-cost">Cost Basis</span>
                <span className="col-pnl">P&L</span>
                <span className="col-progress">To Target</span>
            </div>
            <div className="positions-body">
                {positions.map(position => {
                    const hasYes = position.sharesYes > 0;
                    const hasNo = position.sharesNo > 0;
                    const totalCost = position.costBasisYes + position.costBasisNo;
                    const status = getPositionStatus(position);
                    const progress = getProfitProgress(position);
                    const profitPct = totalCost > 0 ? (position.unrealizedPnl / totalCost) * 100 : 0;

                    return (
                        <div key={position.marketId} className={`position-row status-${status.status.toLowerCase()}`}>
                            <div className="col-status">
                                <span
                                    className="status-badge"
                                    style={{
                                        backgroundColor: `${status.color}20`,
                                        color: status.color,
                                        borderColor: `${status.color}40`
                                    }}
                                >
                                    <span className="status-icon">{status.icon}</span>
                                    {status.label}
                                </span>
                            </div>
                            <div className="col-market">
                                <span className="market-id" title={position.marketId}>
                                    {position.market?.question || position.marketId.substring(0, 20) + '...'}
                                </span>
                            </div>
                            <div className="col-side">
                                {hasYes && <span className="side-badge yes">YES</span>}
                                {hasNo && <span className="side-badge no">NO</span>}
                            </div>
                            <div className="col-shares">
                                {hasYes && <span>{position.sharesYes.toFixed(2)}</span>}
                                {hasYes && hasNo && ' / '}
                                {hasNo && <span>{position.sharesNo.toFixed(2)}</span>}
                            </div>
                            <div className="col-entry">
                                {hasYes && position.avgEntryYes && (
                                    <span>{(position.avgEntryYes * 100).toFixed(1)}¢</span>
                                )}
                                {hasYes && hasNo && ' / '}
                                {hasNo && position.avgEntryNo && (
                                    <span>{(position.avgEntryNo * 100).toFixed(1)}¢</span>
                                )}
                            </div>
                            <div className="col-cost">
                                {formatCurrency(totalCost)}
                            </div>
                            <div className="col-pnl">
                                <span className={position.unrealizedPnl >= 0 ? 'positive' : 'negative'}>
                                    {position.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(position.unrealizedPnl)}
                                </span>
                                <span className={`pnl-pct ${position.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                                    ({profitPct >= 0 ? '+' : ''}{profitPct.toFixed(1)}%)
                                </span>
                            </div>
                            <div className="col-progress">
                                <div className="progress-container">
                                    <div className="progress-bar">
                                        <div
                                            className="progress-fill"
                                            style={{
                                                width: `${progress}%`,
                                                backgroundColor: progress >= 100
                                                    ? 'var(--accent-green)'
                                                    : progress > 66
                                                        ? 'var(--accent-cyan)'
                                                        : 'var(--accent-blue)'
                                            }}
                                        ></div>
                                    </div>
                                    <span className="progress-text">
                                        {progress >= 100 ? '✓ Ready' : `${progress.toFixed(0)}%`}
                                    </span>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="positions-footer">
                <div className="footer-stats">
                    <span className="footer-item">
                        <span className="footer-label">Positions:</span>
                        <span className="footer-value">{positions.length}</span>
                    </span>
                    <span className="footer-item">
                        <span className="footer-label">Total Cost:</span>
                        <span className="footer-value">{formatCurrency(positions.reduce((sum, p) =>
                            sum + p.costBasisYes + p.costBasisNo, 0
                        ))}</span>
                    </span>
                    <span className="footer-item">
                        <span className="footer-label">Total P&L:</span>
                        <span className={`footer-value ${positions.reduce((sum, p) => sum + p.unrealizedPnl, 0) >= 0 ? 'positive' : 'negative'
                            }`}>
                            {positions.reduce((sum, p) => sum + p.unrealizedPnl, 0) >= 0 ? '+' : ''}
                            {formatCurrency(positions.reduce((sum, p) => sum + p.unrealizedPnl, 0))}
                        </span>
                    </span>
                    <span className="footer-item">
                        <span className="footer-label">Realized:</span>
                        <span className={`footer-value ${positions.reduce((sum, p) => sum + p.realizedPnl, 0) >= 0 ? 'positive' : 'negative'
                            }`}>
                            {positions.reduce((sum, p) => sum + p.realizedPnl, 0) >= 0 ? '+' : ''}
                            {formatCurrency(positions.reduce((sum, p) => sum + p.realizedPnl, 0))}
                        </span>
                    </span>
                </div>
            </div>
        </div>
    );
}
