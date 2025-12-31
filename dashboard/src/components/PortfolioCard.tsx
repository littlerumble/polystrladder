import { useState } from 'react';
import { Portfolio, Position, ClosedTrade, ActiveTrade } from '../hooks/useApi';
import './PortfolioCard.css';

interface PortfolioCardProps {
    portfolio: Portfolio | null;
    positions?: Position[];
    activeTrades?: ActiveTrade[]; // NEW: Used for Unrealized P&L agg
    closedTrades?: ClosedTrade[]; // NEW: Used for Realized P&L agg
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

export default function PortfolioCard(props: PortfolioCardProps) {
    const { portfolio, activeTrades = [], closedTrades = [] } = props;
    const [showUnrealizedTooltip, setShowUnrealizedTooltip] = useState(false);
    const [showRealizedTooltip, setShowRealizedTooltip] = useState(false);

    if (!portfolio) return null;

    // Use pre-computed values from backend (source of truth: MarketTrade table)
    // Unrealized PnL = aggregated from OPEN trades in MarketTrade
    // Realized PnL = aggregated from CLOSED trades in MarketTrade
    const unrealizedPnl = portfolio.unrealizedPnl;
    const realizedPnl = portfolio.realizedPnl;

    const totalPnl = unrealizedPnl + realizedPnl;
    const pnlPositive = totalPnl >= 0;

    // Use new fields with fallbacks for backward compatibility
    const tradeableCash = portfolio.tradeableCash ?? portfolio.cashBalance;
    const lockedProfits = portfolio.lockedProfits ?? 0;
    // const allocation = portfolio.allocation... (unused here)

    // Get P&L breakdowns
    // For Unrealized: Use activeTrades
    const gainers = activeTrades.filter(t => t.unrealizedPnl > 0).sort((a, b) => b.unrealizedPnl - a.unrealizedPnl);
    const losers = activeTrades.filter(t => t.unrealizedPnl < 0).sort((a, b) => a.unrealizedPnl - b.unrealizedPnl);

    // For Realized: Use closedTrades
    const realizedProfits = closedTrades.filter(t => t.profitLoss > 0).sort((a, b) => b.profitLoss - a.profitLoss);
    const realizedLosses = closedTrades.filter(t => t.profitLoss < 0).sort((a, b) => a.profitLoss - b.profitLoss);

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
                className={`stat-card hoverable ${unrealizedPnl >= 0 ? 'profit' : 'loss'}`}
                onMouseEnter={() => setShowUnrealizedTooltip(true)}
                onMouseLeave={() => setShowUnrealizedTooltip(false)}
            >
                <div className="stat-label">📈 Unrealized P&L</div>
                <div className={`stat-value ${unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {unrealizedPnl >= 0 ? '+' : ''}{formatCurrency(unrealizedPnl)}
                </div>
                <div className="stat-sublabel">
                    <span className="mini-stat positive">↑{gainers.length} Up</span>
                    <span className="mini-stat negative">↓{losers.length} Down</span>
                </div>

                {/* Tooltip showing breakdown */}
                {showUnrealizedTooltip && (activeTrades.length > 0) && (
                    <div className="pnl-tooltip">
                        <div className="tooltip-header">Unrealized P&L Breakdown</div>

                        {gainers.length > 0 && (
                            <div className="tooltip-section gainers">
                                <div className="section-title">📈 Gainers</div>
                                {gainers.slice(0, 5).map((g, i) => (
                                    <div key={i} className="tooltip-row">
                                        <span className="tooltip-name">
                                            {g.marketQuestion?.substring(0, 35) || g.marketId.substring(0, 12)}...
                                        </span>
                                        <span className="tooltip-value positive">
                                            +{formatCurrency(g.unrealizedPnl)} ({g.unrealizedPct.toFixed(1)}%)
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
                                        <span className="tooltip-name">
                                            {l.marketQuestion?.substring(0, 35) || l.marketId.substring(0, 12)}...
                                        </span>
                                        <span className="tooltip-value negative">
                                            {formatCurrency(l.unrealizedPnl)} ({l.unrealizedPct.toFixed(1)}%)
                                        </span>
                                    </div>
                                ))}
                                {losers.length > 5 && (
                                    <div className="tooltip-more">+{losers.length - 5} more</div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Realized P&L - With hover breakdown */}
            <div
                className={`stat-card hoverable ${realizedPnl >= 0 ? 'profit' : 'loss'}`}
                onMouseEnter={() => setShowRealizedTooltip(true)}
                onMouseLeave={() => setShowRealizedTooltip(false)}
            >
                <div className="stat-label">✅ Realized P&L</div>
                <div className={`stat-value ${realizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {realizedPnl >= 0 ? '+' : ''}{formatCurrency(realizedPnl)}
                </div>
                <div className="stat-sublabel">
                    <span className="mini-stat positive">↑{realizedProfits.length} Winners</span>
                    <span className="mini-stat negative">↓{realizedLosses.length} Losers</span>
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
                                        <span className="tooltip-name">
                                            {p.marketQuestion?.substring(0, 35) || p.marketId.substring(0, 12)}...
                                        </span>
                                        <span className="tooltip-value positive">
                                            +{formatCurrency(p.profitLoss)}
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
                                        <span className="tooltip-name">
                                            {l.marketQuestion?.substring(0, 35) || l.marketId.substring(0, 12)}...
                                        </span>
                                        <span className="tooltip-value negative">
                                            {formatCurrency(l.profitLoss)}
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
        </>
    );
}
