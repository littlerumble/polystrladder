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
                <span className="col-market">Market</span>
                <span className="col-side">Side</span>
                <span className="col-shares">Shares</span>
                <span className="col-entry">Avg Entry</span>
                <span className="col-cost">Cost Basis</span>
                <span className="col-pnl">Unrealized P&L</span>
            </div>
            <div className="positions-body">
                {positions.map(position => {
                    const hasYes = position.sharesYes > 0;
                    const hasNo = position.sharesNo > 0;
                    const totalCost = position.costBasisYes + position.costBasisNo;

                    return (
                        <div key={position.marketId} className="position-row">
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
                            </div>
                        </div>
                    );
                })}
            </div>
            <div className="positions-footer">
                <span>Total Positions: {positions.length}</span>
                <span>
                    Total Cost: {formatCurrency(positions.reduce((sum, p) =>
                        sum + p.costBasisYes + p.costBasisNo, 0
                    ))}
                </span>
                <span className={
                    positions.reduce((sum, p) => sum + p.unrealizedPnl, 0) >= 0 ? 'positive' : 'negative'
                }>
                    Total P&L: {positions.reduce((sum, p) => sum + p.unrealizedPnl, 0) >= 0 ? '+' : ''}
                    {formatCurrency(positions.reduce((sum, p) => sum + p.unrealizedPnl, 0))}
                </span>
            </div>
        </div>
    );
}
