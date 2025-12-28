import { useState } from 'react';
import { Portfolio, Position } from '../hooks/useApi';
import './PortfolioCard.css';

interface PortfolioCardProps {
    portfolio: Portfolio | null;
    positions?: Position[];  // NEW: Pass positions for P&L breakdown
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

// Separate positions into gainers and losers
function categorizePositions(positions: Position[]): {
    gainers: Array<{ name: string; pnl: number; pct: number }>;
    losers: Array<{ name: string; pnl: number; pct: number }>;
} {
    const gainers: Array<{ name: string; pnl: number; pct: number }> = [];
    const losers: Array<{ name: string; pnl: number; pct: number }> = [];

    for (const pos of positions) {
        const costBasis = pos.costBasisYes + pos.costBasisNo;
        const pct = costBasis > 0 ? (pos.unrealizedPnl / costBasis) * 100 : 0;
        const name = pos.market?.question?.substring(0, 35) || pos.marketId.substring(0, 20);

        if (pos.unrealizedPnl >= 0) {
            gainers.push({ name, pnl: pos.unrealizedPnl, pct });
        } else {
            losers.push({ name, pnl: pos.unrealizedPnl, pct });
        }
    }

    // Sort by magnitude
    gainers.sort((a, b) => b.pnl - a.pnl);
    losers.sort((a, b) => a.pnl - b.pnl);

    return { gainers, losers };
}

// Get realized P&L contributors
function getRealizedBreakdown(positions: Position[]): {
    profits: Array<{ name: string; pnl: number }>;
    losses: Array<{ name: string; pnl: number }>;
} {
    const profits: Array<{ name: string; pnl: number }> = [];
    const losses: Array<{ name: string; pnl: number }> = [];

    for (const pos of positions) {
        if (pos.realizedPnl === 0) continue;
        const name = pos.market?.question?.substring(0, 35) || pos.marketId.substring(0, 20);

        if (pos.realizedPnl > 0) {
            profits.push({ name, pnl: pos.realizedPnl });
        } else {
            losses.push({ name, pnl: pos.realizedPnl });
        }
    }

    profits.sort((a, b) => b.pnl - a.pnl);
    losses.sort((a, b) => a.pnl - b.pnl);

    return { profits, losses };
}

export default function PortfolioCard({ portfolio, positions = [] }: PortfolioCardProps) {
    const [showUnrealizedTooltip, setShowUnrealizedTooltip] = useState(false);
    const [showRealizedTooltip, setShowRealizedTooltip] = useState(false);

    if (!portfolio) return null;

    const totalPnl = portfolio.unrealizedPnl + portfolio.realizedPnl;
    const pnlPositive = totalPnl >= 0;

    // Use new fields with fallbacks for backward compatibility
    const tradeableCash = portfolio.tradeableCash ?? portfolio.cashBalance;
    const lockedProfits = portfolio.lockedProfits ?? 0;
    const allocation = portfolio.allocation ?? {
        tradeableCashPct: 100,
        positionsPct: 0,
        lockedProfitsPct: 0
    };

    // Get P&L breakdowns
    const { gainers, losers } = categorizePositions(positions);
    const { profits: realizedProfits, losses: realizedLosses } = getRealizedBreakdown(positions);

    return (
        <>
            {/* Main Value Card */}
            <div className="stat-card total-value">
                <div className="stat-label">💰 Total Value</div>
                <div className="stat-value">{formatCurrency(portfolio.totalValue)}</div>
                <div className={`stat-change ${pnlPositive ? 'positive' : 'negative'}`}>
                    {formatPercent(totalPnl, portfolio.bankroll)}
                </div>
            </div>

            {/* Cash Reserve - Tradeable Cash */}
            <div className="stat-card cash-reserve">
                <div className="stat-label">💵 Cash Reserve</div>
                <div className="stat-value">{formatCurrency(tradeableCash)}</div>
                <div className="stat-sublabel available-tag">
                    <span className="pulse-dot"></span>
                    Available to trade
                </div>
            </div>

            {/* Locked Profits Bucket */}
            <div className="stat-card locked-profits">
                <div className="stat-label">
                    🔒 Locked Profits
                    <span className="info-tooltip" title="Protected profits from successful trades. This money is NOT reinvested to preserve capital gains.">ⓘ</span>
                </div>
                <div className={`stat-value ${lockedProfits > 0 ? 'positive' : ''}`}>
                    {lockedProfits > 0 ? '+' : ''}{formatCurrency(lockedProfits)}
                </div>
                <div className="stat-sublabel">Protected from reinvestment</div>
            </div>

            {/* Positions Value */}
            <div className="stat-card">
                <div className="stat-label">📊 Positions Value</div>
                <div className="stat-value">{formatCurrency(portfolio.positionsValue)}</div>
                <div className="stat-sublabel">{portfolio.positionCount} active positions</div>
            </div>

            {/* Unrealized P&L - With hover breakdown */}
            <div
                className={`stat-card hoverable ${portfolio.unrealizedPnl >= 0 ? 'profit' : 'loss'}`}
                onMouseEnter={() => setShowUnrealizedTooltip(true)}
                onMouseLeave={() => setShowUnrealizedTooltip(false)}
            >
                <div className="stat-label">📈 Unrealized P&L</div>
                <div className={`stat-value ${portfolio.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {portfolio.unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(portfolio.unrealizedPnl)}
                </div>
                <div className="stat-sublabel">
                    {gainers.length > 0 && <span className="mini-stat positive">↑{gainers.length} winning</span>}
                    {losers.length > 0 && <span className="mini-stat negative">↓{losers.length} losing</span>}
                </div>

                {/* Tooltip showing breakdown */}
                {showUnrealizedTooltip && (positions.length > 0) && (
                    <div className="pnl-tooltip">
                        <div className="tooltip-header">Unrealized P&L Breakdown</div>

                        {gainers.length > 0 && (
                            <div className="tooltip-section gainers">
                                <div className="section-title">📈 Gainers</div>
                                {gainers.slice(0, 5).map((g, i) => (
                                    <div key={i} className="tooltip-row">
                                        <span className="tooltip-name">{g.name}...</span>
                                        <span className="tooltip-value positive">
                                            +{formatCurrency(g.pnl)} ({g.pct.toFixed(1)}%)
                                        </span>
                                    </div>
                                ))}
                                {gainers.length > 5 && (
                                    <div className="tooltip-more">+{gainers.length - 5} more</div>
                                )}
                            </div>
                        )}

                        {losers.length > 0 && (
                            <div className="tooltip-section losers">
                                <div className="section-title">📉 Losers</div>
                                {losers.slice(0, 5).map((l, i) => (
                                    <div key={i} className="tooltip-row">
                                        <span className="tooltip-name">{l.name}...</span>
                                        <span className="tooltip-value negative">
                                            {formatCurrency(l.pnl)} ({l.pct.toFixed(1)}%)
                                        </span>
                                    </div>
                                ))}
                                {losers.length > 5 && (
                                    <div className="tooltip-more">+{losers.length - 5} more</div>
                                )}
                            </div>
                        )}

                        {positions.length === 0 && (
                            <div className="tooltip-empty">No positions</div>
                        )}
                    </div>
                )}
            </div>

            {/* Realized P&L - With hover breakdown */}
            <div
                className={`stat-card hoverable ${portfolio.realizedPnl >= 0 ? 'profit' : 'loss'}`}
                onMouseEnter={() => setShowRealizedTooltip(true)}
                onMouseLeave={() => setShowRealizedTooltip(false)}
            >
                <div className="stat-label">✅ Realized P&L</div>
                <div className={`stat-value ${portfolio.realizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {portfolio.realizedPnl >= 0 ? '+' : ''}{formatCurrency(portfolio.realizedPnl)}
                </div>
                <div className="stat-sublabel">
                    {realizedProfits.length > 0 && <span className="mini-stat positive">↑{realizedProfits.length} profits</span>}
                    {realizedLosses.length > 0 && <span className="mini-stat negative">↓{realizedLosses.length} losses</span>}
                </div>

                {/* Tooltip showing breakdown */}
                {showRealizedTooltip && (realizedProfits.length > 0 || realizedLosses.length > 0) && (
                    <div className="pnl-tooltip">
                        <div className="tooltip-header">Realized P&L Breakdown</div>

                        {realizedProfits.length > 0 && (
                            <div className="tooltip-section gainers">
                                <div className="section-title">💰 Profitable Trades</div>
                                {realizedProfits.slice(0, 5).map((p, i) => (
                                    <div key={i} className="tooltip-row">
                                        <span className="tooltip-name">{p.name}...</span>
                                        <span className="tooltip-value positive">
                                            +{formatCurrency(p.pnl)}
                                        </span>
                                    </div>
                                ))}
                                {realizedProfits.length > 5 && (
                                    <div className="tooltip-more">+{realizedProfits.length - 5} more</div>
                                )}
                            </div>
                        )}

                        {realizedLosses.length > 0 && (
                            <div className="tooltip-section losers">
                                <div className="section-title">📉 Losing Trades</div>
                                {realizedLosses.slice(0, 5).map((l, i) => (
                                    <div key={i} className="tooltip-row">
                                        <span className="tooltip-name">{l.name}...</span>
                                        <span className="tooltip-value negative">
                                            {formatCurrency(l.pnl)}
                                        </span>
                                    </div>
                                ))}
                                {realizedLosses.length > 5 && (
                                    <div className="tooltip-more">+{realizedLosses.length - 5} more</div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Capital Allocation Breakdown - Full Width */}
            <div className="stat-card capital-breakdown full-width">
                <div className="stat-label">📊 Capital Allocation</div>
                <div className="allocation-bar">
                    <div
                        className="allocation-segment cash"
                        style={{ width: `${allocation.tradeableCashPct}%` }}
                        title={`Cash Reserve: ${allocation.tradeableCashPct.toFixed(1)}%`}
                    ></div>
                    <div
                        className="allocation-segment positions"
                        style={{ width: `${allocation.positionsPct}%` }}
                        title={`Positions: ${allocation.positionsPct.toFixed(1)}%`}
                    ></div>
                    <div
                        className="allocation-segment locked"
                        style={{ width: `${allocation.lockedProfitsPct}%` }}
                        title={`Locked Profits: ${allocation.lockedProfitsPct.toFixed(1)}%`}
                    ></div>
                </div>
                <div className="allocation-legend">
                    <span className="legend-item">
                        <span className="legend-color cash"></span>
                        Cash ({allocation.tradeableCashPct.toFixed(0)}%)
                    </span>
                    <span className="legend-item">
                        <span className="legend-color positions"></span>
                        Positions ({allocation.positionsPct.toFixed(0)}%)
                    </span>
                    <span className="legend-item">
                        <span className="legend-color locked"></span>
                        Locked ({allocation.lockedProfitsPct.toFixed(0)}%)
                    </span>
                </div>
            </div>
        </>
    );
}
