import { useState } from 'react';
import { ActiveTrade, ClosedTrade } from '../hooks/useApi';
import './MarketTradesPanel.css';

interface MarketTradesPanelProps {
    activeTrades: ActiveTrade[];
    closedTrades: ClosedTrade[];
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

function formatHoldTime(minutes: number | null): string {
    if (!minutes) return '-';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export default function MarketTradesPanel({ activeTrades, closedTrades }: MarketTradesPanelProps) {
    const [activeTab, setActiveTab] = useState<'active' | 'closed'>('active');

    return (
        <div className="market-trades-panel">
            <div className="panel-header">
                <h2>📊 Market Trades</h2>
                <div className="tab-buttons">
                    <button
                        className={`tab-btn ${activeTab === 'active' ? 'active' : ''}`}
                        onClick={() => setActiveTab('active')}
                    >
                        Active ({activeTrades.length})
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'closed' ? 'active' : ''}`}
                        onClick={() => setActiveTab('closed')}
                    >
                        Closed ({closedTrades.length})
                    </button>
                </div>
            </div>

            {activeTab === 'active' && (
                <div className="trades-table">
                    <div className="table-header">
                        <span className="col-market">Market</span>
                        <span className="col-side">Side</span>
                        <span className="col-entry">Entry</span>
                        <span className="col-invested">Invested</span>
                        <span className="col-current">Current</span>
                        <span className="col-pnl">Unrealized P&L</span>
                    </div>
                    <div className="table-body">
                        {activeTrades.length === 0 ? (
                            <div className="empty-state">No active trades</div>
                        ) : (
                            activeTrades.map(trade => (
                                <div key={trade.id} className="trade-row">
                                    <div className="col-market" title={trade.marketQuestion}>
                                        {trade.marketQuestion?.substring(0, 40) || trade.marketId.substring(0, 12)}...
                                    </div>
                                    <div className="col-side">
                                        <span className={`side-badge ${trade.side.toLowerCase()}`}>
                                            {trade.side}
                                        </span>
                                    </div>
                                    <div className="col-entry">
                                        {(trade.entryPrice * 100).toFixed(1)}¢
                                    </div>
                                    <div className="col-invested">
                                        {formatCurrency(trade.entryAmount)}
                                    </div>
                                    <div className="col-current">
                                        {trade.currentPrice ? `${(trade.currentPrice * 100).toFixed(1)}¢` : '-'}
                                    </div>
                                    <div className={`col-pnl ${trade.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                                        {formatCurrency(trade.unrealizedPnl)}
                                        <span className="pnl-pct">
                                            ({trade.unrealizedPct >= 0 ? '+' : ''}{trade.unrealizedPct.toFixed(1)}%)
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'closed' && (
                <div className="trades-table">
                    <div className="table-header">
                        <span className="col-market">Market</span>
                        <span className="col-side">Side</span>
                        <span className="col-entry">Entry → Exit</span>
                        <span className="col-invested">Invested</span>
                        <span className="col-hold">Hold Time</span>
                        <span className="col-pnl">Realized P&L</span>
                    </div>
                    <div className="table-body">
                        {closedTrades.length === 0 ? (
                            <div className="empty-state">No closed trades yet</div>
                        ) : (
                            closedTrades.map(trade => (
                                <div key={trade.id} className={`trade-row ${trade.isWin ? 'winner' : 'loser'}`}>
                                    <div className="col-market" title={trade.marketQuestion}>
                                        <span className="result-icon">{trade.isWin ? '🏆' : '💀'}</span>
                                        {trade.marketQuestion?.substring(0, 35) || trade.marketId.substring(0, 12)}...
                                    </div>
                                    <div className="col-side">
                                        <span className={`side-badge ${trade.side.toLowerCase()}`}>
                                            {trade.side}
                                        </span>
                                    </div>
                                    <div className="col-entry">
                                        {(trade.entryPrice * 100).toFixed(1)}¢ → {trade.exitPrice ? `${(trade.exitPrice * 100).toFixed(1)}¢` : '-'}
                                        {trade.exitReason && <div className="exit-reason-small">{trade.exitReason.replace('STOP LOSS:', '🛑').replace('TAKE PROFIT:', '💰')}</div>}
                                    </div>
                                    <div className="col-invested">
                                        {formatCurrency(trade.entryAmount)}
                                    </div>
                                    <div className="col-hold">
                                        {formatHoldTime(trade.holdTime)}
                                    </div>
                                    <div className={`col-pnl ${trade.profitLoss >= 0 ? 'positive' : 'negative'}`}>
                                        {trade.profitLoss >= 0 ? '+' : ''}{formatCurrency(trade.profitLoss)}
                                        <span className="pnl-pct">
                                            ({trade.profitLossPct >= 0 ? '+' : ''}{trade.profitLossPct.toFixed(1)}%)
                                        </span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
