import { Portfolio } from '../hooks/useApi';
import './PortfolioCard.css';

interface PortfolioCardProps {
    portfolio: Portfolio | null;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

function formatPercent(value: number, base: number): string {
    if (base === 0) return '0.00%';
    const pct = (value / base) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

export default function PortfolioCard({ portfolio }: PortfolioCardProps) {
    if (!portfolio) return null;

    const totalPnl = portfolio.unrealizedPnl + portfolio.realizedPnl;
    const pnlPositive = totalPnl >= 0;

    return (
        <>
            <div className="stat-card total-value">
                <div className="stat-label">Total Value</div>
                <div className="stat-value">{formatCurrency(portfolio.totalValue)}</div>
                <div className={`stat-change ${pnlPositive ? 'positive' : 'negative'}`}>
                    {formatPercent(totalPnl, portfolio.bankroll)}
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-label">Cash Balance</div>
                <div className="stat-value">{formatCurrency(portfolio.cashBalance)}</div>
                <div className="stat-sublabel">Available to trade</div>
            </div>

            <div className="stat-card">
                <div className="stat-label">Positions Value</div>
                <div className="stat-value">{formatCurrency(portfolio.positionsValue)}</div>
                <div className="stat-sublabel">{portfolio.positionCount} active positions</div>
            </div>

            <div className={`stat-card ${portfolio.unrealizedPnl >= 0 ? 'profit' : 'loss'}`}>
                <div className="stat-label">Unrealized P&L</div>
                <div className={`stat-value ${portfolio.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {portfolio.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(portfolio.unrealizedPnl)}
                </div>
                <div className="stat-sublabel">Open positions</div>
            </div>

            <div className={`stat-card ${portfolio.realizedPnl >= 0 ? 'profit' : 'loss'}`}>
                <div className="stat-label">Realized P&L</div>
                <div className={`stat-value ${portfolio.realizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {portfolio.realizedPnl >= 0 ? '+' : ''}{formatCurrency(portfolio.realizedPnl)}
                </div>
                <div className="stat-sublabel">Closed positions</div>
            </div>
        </>
    );
}
