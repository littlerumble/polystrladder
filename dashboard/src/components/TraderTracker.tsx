import { useState, useEffect, useMemo } from 'react';
import './TraderTracker.css';

// Wallets to track with display names
const TRACKED_TRADERS = [
    { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', displayName: 'RN1' },
    { wallet: '0xc65ca4755436f82d8eb461e65781584b8cadea39', displayName: 'LOOKINGBACK' },
    { wallet: '0x5350afcd8bd8ceffdf4da32420d6d31be0822fda', displayName: 'simonbanza' },
    { wallet: '0x5388bc8cb72eb19a3bec0e8f3db6a77f7cd54d5a', displayName: 'TeemuTeemuTeemu' },
    { wallet: '0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee', displayName: 'kch123' },
    { wallet: '0x0d3b10b8eac8b089c6e4a695e65d8e044167c46b', displayName: 'bossoskil' }
];
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface TradeActivity {
    timestamp: number;
    title: string;
    slug: string;
    icon: string;
    outcome: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    usdcSize: number;
    traderName: string;
    traderWallet: string;
}

interface MarketAnalysis {
    slug: string;
    title: string;
    icon: string;
    outcome: string;  // The side they're trading (Yes/No, Leeds/Liverpool, etc.)
    traderName: string;
    trades: TradeActivity[];
    strategy: string;
    strategyDetails: string;
    buyCount: number;
    sellCount: number;
    avgBuyPrice: number;
    avgSellPrice: number;
    totalBought: number;
    totalSold: number;
    netPosition: number;
    firstTradeTime: number;
    lastTradeTime: number;
    pnlPercent: number | null;
    status: 'OPEN' | 'CLOSED' | 'PARTIAL';
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
}

function formatTimeDetailed(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleString();
}

// Analyze trading pattern and infer strategy
function analyzeStrategy(trades: TradeActivity[]): { strategy: string; details: string } {
    const buys = trades.filter(t => t.side === 'BUY');
    const sells = trades.filter(t => t.side === 'SELL');

    if (trades.length === 0) return { strategy: 'UNKNOWN', details: 'No trades' };

    // Sort by time
    buys.sort((a, b) => a.timestamp - b.timestamp);
    sells.sort((a, b) => a.timestamp - b.timestamp);

    const buyPrices = buys.map(b => b.price);
    const sellPrices = sells.map(s => s.price);

    // Detect patterns
    if (buys.length >= 3 && sells.length === 0) {
        // Multiple buys, no sells - check if laddering
        const priceSpread = Math.max(...buyPrices) - Math.min(...buyPrices);
        if (priceSpread >= 0.03) {
            return {
                strategy: 'LADDER',
                details: `${buys.length} entries at ${(Math.min(...buyPrices) * 100).toFixed(0)}¢ to ${(Math.max(...buyPrices) * 100).toFixed(0)}¢`
            };
        }
        return {
            strategy: 'DCA',
            details: `${buys.length} buys, averaging in at ~${(buyPrices.reduce((a, b) => a + b, 0) / buyPrices.length * 100).toFixed(1)}¢`
        };
    }

    if (buys.length >= 2 && sells.length >= 1) {
        // Check for scaling out
        const avgBuy = buyPrices.reduce((a, b) => a + b, 0) / buyPrices.length;
        const avgSell = sellPrices.reduce((a, b) => a + b, 0) / sellPrices.length;

        if (avgSell > avgBuy) {
            if (sells.length >= 2) {
                return {
                    strategy: 'SCALE OUT',
                    details: `Bought avg ${(avgBuy * 100).toFixed(1)}¢, selling at ${(avgSell * 100).toFixed(1)}¢`
                };
            }
            return {
                strategy: 'TAKE PROFIT',
                details: `Entry avg ${(avgBuy * 100).toFixed(1)}¢, exited at ${(avgSell * 100).toFixed(1)}¢`
            };
        } else {
            return {
                strategy: 'STOP LOSS',
                details: `Entry avg ${(avgBuy * 100).toFixed(1)}¢, stopped out at ${(avgSell * 100).toFixed(1)}¢`
            };
        }
    }

    if (buys.length === 1 && sells.length === 0) {
        return {
            strategy: 'SINGLE ENTRY',
            details: `Bought at ${(buys[0].price * 100).toFixed(1)}¢`
        };
    }

    if (buys.length === 1 && sells.length === 1) {
        const timeDiff = sells[0].timestamp - buys[0].timestamp;
        const profitPct = ((sells[0].price - buys[0].price) / buys[0].price * 100);

        if (timeDiff < 3600) { // Less than 1 hour
            return {
                strategy: 'SCALP',
                details: `Quick trade: ${(buys[0].price * 100).toFixed(1)}¢ → ${(sells[0].price * 100).toFixed(1)}¢ (${profitPct > 0 ? '+' : ''}${profitPct.toFixed(1)}%)`
            };
        }
        return {
            strategy: 'SWING',
            details: `Entry ${(buys[0].price * 100).toFixed(1)}¢ → Exit ${(sells[0].price * 100).toFixed(1)}¢`
        };
    }

    if (sells.length > 0 && buys.length === 0) {
        return {
            strategy: 'SHORT/SELL',
            details: `Selling ${sells.length} times`
        };
    }

    return {
        strategy: 'MIXED',
        details: `${buys.length} buys, ${sells.length} sells`
    };
}

// Group trades by market AND outcome (so both sides show separately)
function groupTradesByMarket(trades: TradeActivity[]): MarketAnalysis[] {
    const grouped = new Map<string, TradeActivity[]>();

    trades.forEach(trade => {
        // Group by trader + market + outcome (so Leeds and Liverpool show as separate rows)
        const key = `${trade.traderName}:${trade.slug}:${trade.outcome}`;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key)!.push(trade);
    });

    const analyses: MarketAnalysis[] = [];

    grouped.forEach((marketTrades) => {
        // Sort trades by timestamp (newest first for display, oldest first for analysis)
        const sortedTrades = [...marketTrades].sort((a, b) => b.timestamp - a.timestamp);
        const chronological = [...marketTrades].sort((a, b) => a.timestamp - b.timestamp);

        const buys = chronological.filter(t => t.side === 'BUY');
        const sells = chronological.filter(t => t.side === 'SELL');

        const totalBought = buys.reduce((sum, t) => sum + t.size, 0);
        const totalSold = sells.reduce((sum, t) => sum + t.size, 0);
        const avgBuyPrice = buys.length > 0
            ? buys.reduce((sum, t) => sum + t.price * t.size, 0) / totalBought
            : 0;
        const avgSellPrice = sells.length > 0
            ? sells.reduce((sum, t) => sum + t.price * t.size, 0) / totalSold
            : 0;

        const netPosition = totalBought - totalSold;
        const status = netPosition > 0.5 ? 'OPEN' : (totalSold > 0 ? 'CLOSED' : 'PARTIAL');

        const { strategy, details } = analyzeStrategy(chronological);

        // Calculate P&L if closed
        let pnlPercent: number | null = null;
        if (status === 'CLOSED' && avgBuyPrice > 0) {
            pnlPercent = ((avgSellPrice - avgBuyPrice) / avgBuyPrice) * 100;
        }

        analyses.push({
            slug: marketTrades[0].slug,
            title: marketTrades[0].title,
            icon: marketTrades[0].icon,
            outcome: marketTrades[0].outcome,  // Which side they bought
            traderName: marketTrades[0].traderName,
            trades: sortedTrades,
            strategy,
            strategyDetails: details,
            buyCount: buys.length,
            sellCount: sells.length,
            avgBuyPrice,
            avgSellPrice,
            totalBought,
            totalSold,
            netPosition,
            firstTradeTime: chronological[0]?.timestamp || 0,
            lastTradeTime: sortedTrades[0]?.timestamp || 0,
            pnlPercent,
            status
        });
    });

    // Sort by last trade time
    analyses.sort((a, b) => b.lastTradeTime - a.lastTradeTime);

    return analyses;
}

type ViewMode = 'activity' | 'analysis';

export default function TraderTracker() {
    const [activities, setActivities] = useState<TradeActivity[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [ourMarkets, setOurMarkets] = useState<Set<string>>(new Set());

    // View mode
    const [viewMode, setViewMode] = useState<ViewMode>('analysis');

    // Filters
    const [filterTrader, setFilterTrader] = useState<string>('all');

    // Modal
    const [selectedMarket, setSelectedMarket] = useState<MarketAnalysis | null>(null);

    const fetchData = async () => {
        try {
            // Fetch tracked trader activity
            const results = await Promise.all(
                TRACKED_TRADERS.map(async (trader) => {
                    const res = await fetch(`${API_BASE}/api/tracked-activity/${trader.wallet}?limit=100`);
                    if (!res.ok) return [];
                    const data = await res.json();
                    return (data.trades || []).map((t: any) => ({
                        ...t,
                        traderName: trader.displayName,
                        traderWallet: trader.wallet
                    }));
                })
            );

            // Fetch our active positions
            try {
                const posRes = await fetch(`${API_BASE}/api/market-trades`);
                if (posRes.ok) {
                    const posData = await posRes.json();
                    const openMarkets = new Set<string>(
                        posData
                            .filter((t: any) => t.status === 'OPEN')
                            .map((t: any) => t.marketId)
                    );
                    setOurMarkets(openMarkets);
                }
            } catch {
                // Ignore errors fetching our positions
            }

            const combined = results.flat();
            setActivities(combined);
            setLastUpdate(new Date());
            setError(null);
        } catch (err) {
            setError('Failed to load trader activity');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    // Group and analyze trades
    const marketAnalyses = useMemo(() => {
        let filtered = activities;
        if (filterTrader !== 'all') {
            filtered = activities.filter(a => a.traderName === filterTrader);
        }
        return groupTradesByMarket(filtered);
    }, [activities, filterTrader]);

    // Filter activities for activity view
    const filteredActivities = useMemo(() => {
        let result = [...activities];
        if (filterTrader !== 'all') {
            result = result.filter(a => a.traderName === filterTrader);
        }
        return result.sort((a, b) => b.timestamp - a.timestamp);
    }, [activities, filterTrader]);

    if (loading) {
        return (
            <div className="trader-tracker">
                <div className="tracker-controls">
                    <h3>📡 Tracked Traders</h3>
                </div>
                <div className="loading">Loading trader activity...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="trader-tracker">
                <div className="tracker-controls">
                    <h3>📡 Tracked Traders</h3>
                </div>
                <div className="error">{error}</div>
            </div>
        );
    }

    return (
        <div className="trader-tracker">
            {/* Controls */}
            <div className="tracker-controls">
                <div className="controls-left">
                    <h3>📡 Tracked Traders</h3>
                    <div className="view-toggle">
                        <button
                            className={viewMode === 'analysis' ? 'active' : ''}
                            onClick={() => setViewMode('analysis')}
                        >
                            📊 Strategy Analysis
                        </button>
                        <button
                            className={viewMode === 'activity' ? 'active' : ''}
                            onClick={() => setViewMode('activity')}
                        >
                            📋 Activity Feed
                        </button>
                    </div>
                </div>
                <div className="controls-right">
                    <select
                        value={filterTrader}
                        onChange={(e) => setFilterTrader(e.target.value)}
                        className="filter-select"
                    >
                        <option value="all">All Traders</option>
                        {TRACKED_TRADERS.map(t => (
                            <option key={t.wallet} value={t.displayName}>{t.displayName}</option>
                        ))}
                    </select>
                    {lastUpdate && (
                        <span className="last-update">Updated {lastUpdate.toLocaleTimeString()}</span>
                    )}
                </div>
            </div>

            {/* Analysis View */}
            {viewMode === 'analysis' && (
                <div className="analysis-feed">
                    <div className="analysis-header">
                        <span className="col-bought"></span>
                        <span className="col-time">Last Trade</span>
                        <span className="col-trader">Trader</span>
                        <span className="col-market">Market</span>
                        <span className="col-strategy">Strategy</span>
                        <span className="col-stats">Trades</span>
                        <span className="col-status">Status</span>
                    </div>
                    <div className="analysis-body">
                        {marketAnalyses.length === 0 ? (
                            <div className="empty-state">No trading activity found</div>
                        ) : (
                            marketAnalyses.map((analysis, idx) => (
                                <div
                                    key={idx}
                                    className={`analysis-row clickable ${ourMarkets.has(analysis.slug) ? 'we-bought' : ''}`}
                                    onClick={() => setSelectedMarket(analysis)}
                                >
                                    <div className="col-bought">
                                        {ourMarkets.has(analysis.slug) && <span className="bought-icon" title="We bought this">✓</span>}
                                    </div>
                                    <div className="col-time" title={formatTimeDetailed(analysis.lastTradeTime)}>
                                        {formatTime(analysis.lastTradeTime)}
                                    </div>
                                    <div className="col-trader">
                                        <span className="trader-badge">{analysis.traderName}</span>
                                    </div>
                                    <div className="col-market">
                                        {analysis.icon && <img src={analysis.icon} alt="" className="market-icon" />}
                                        <span className="market-title" title={analysis.title}>
                                            {analysis.title.length > 35 ? analysis.title.substring(0, 35) + '...' : analysis.title}
                                        </span>
                                        <span className={`outcome-tag ${analysis.outcome.toLowerCase()}`}>
                                            {analysis.outcome}
                                        </span>
                                    </div>
                                    <div className="col-strategy">
                                        <span className={`strategy-badge ${analysis.strategy.toLowerCase().replace(' ', '-')}`}>
                                            {analysis.strategy}
                                        </span>
                                        <span className="strategy-details">{analysis.strategyDetails}</span>
                                    </div>
                                    <div className="col-stats">
                                        <span className="stat buy">{analysis.buyCount}B</span>
                                        <span className="stat sell">{analysis.sellCount}S</span>
                                    </div>
                                    <div className="col-status">
                                        <span className={`status-badge ${analysis.status.toLowerCase()}`}>
                                            {analysis.status}
                                        </span>
                                        {analysis.pnlPercent !== null && (
                                            <span className={`pnl ${analysis.pnlPercent >= 0 ? 'positive' : 'negative'}`}>
                                                {analysis.pnlPercent >= 0 ? '+' : ''}{analysis.pnlPercent.toFixed(1)}%
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Activity View */}
            {viewMode === 'activity' && (
                <div className="activity-feed">
                    <div className="feed-header">
                        <span className="col-time">Time</span>
                        <span className="col-trader">Trader</span>
                        <span className="col-action">Action</span>
                        <span className="col-market">Market</span>
                        <span className="col-price">Price</span>
                        <span className="col-amount">Amount</span>
                    </div>
                    <div className="feed-body">
                        {filteredActivities.length === 0 ? (
                            <div className="empty-state">No trading activity found</div>
                        ) : (
                            filteredActivities.map((activity, idx) => (
                                <div key={idx} className="feed-row">
                                    <div className="col-time" title={formatTimeDetailed(activity.timestamp)}>
                                        {formatTime(activity.timestamp)}
                                    </div>
                                    <div className="col-trader">
                                        <span className="trader-badge">{activity.traderName}</span>
                                    </div>
                                    <div className="col-action">
                                        <span className={`action-badge ${activity.side.toLowerCase()}`}>
                                            {activity.side}
                                        </span>
                                        <span className={`outcome-badge ${activity.outcome.toLowerCase()}`}>
                                            {activity.outcome}
                                        </span>
                                    </div>
                                    <div className="col-market">
                                        {activity.icon && <img src={activity.icon} alt="" className="market-icon" />}
                                        <span className="market-title" title={activity.title}>
                                            {activity.title.length > 45 ? activity.title.substring(0, 45) + '...' : activity.title}
                                        </span>
                                    </div>
                                    <div className="col-price">
                                        {(activity.price * 100).toFixed(1)}¢
                                    </div>
                                    <div className="col-amount">
                                        <span className="shares">{activity.size.toFixed(1)} shares</span>
                                        <span className="usdc">{formatCurrency(activity.usdcSize)}</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}

            {/* Trade Detail Modal */}
            {selectedMarket && (
                <div className="modal-overlay" onClick={() => setSelectedMarket(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title">
                                {selectedMarket.icon && <img src={selectedMarket.icon} alt="" className="market-icon-lg" />}
                                <div>
                                    <h3>{selectedMarket.title}</h3>
                                    <span className="modal-trader">{selectedMarket.traderName}</span>
                                </div>
                            </div>
                            <button className="modal-close" onClick={() => setSelectedMarket(null)}>×</button>
                        </div>

                        <div className="modal-summary">
                            <div className="summary-item">
                                <span className="label">Strategy</span>
                                <span className={`strategy-badge ${selectedMarket.strategy.toLowerCase().replace(' ', '-')}`}>
                                    {selectedMarket.strategy}
                                </span>
                            </div>
                            <div className="summary-item">
                                <span className="label">Avg Buy</span>
                                <span className="value">{(selectedMarket.avgBuyPrice * 100).toFixed(2)}¢</span>
                            </div>
                            {selectedMarket.avgSellPrice > 0 && (
                                <div className="summary-item">
                                    <span className="label">Avg Sell</span>
                                    <span className="value">{(selectedMarket.avgSellPrice * 100).toFixed(2)}¢</span>
                                </div>
                            )}
                            <div className="summary-item">
                                <span className="label">Net Position</span>
                                <span className="value">{selectedMarket.netPosition.toFixed(1)} shares</span>
                            </div>
                            {selectedMarket.pnlPercent !== null && (
                                <div className="summary-item">
                                    <span className="label">P&L</span>
                                    <span className={`value ${selectedMarket.pnlPercent >= 0 ? 'positive' : 'negative'}`}>
                                        {selectedMarket.pnlPercent >= 0 ? '+' : ''}{selectedMarket.pnlPercent.toFixed(2)}%
                                    </span>
                                </div>
                            )}
                        </div>

                        <div className="modal-trades">
                            <h4>Trade History ({selectedMarket.trades.length} trades)</h4>
                            <div className="trades-list">
                                {selectedMarket.trades.map((trade, idx) => (
                                    <div key={idx} className="trade-item">
                                        <span className="trade-time">{formatTimeDetailed(trade.timestamp)}</span>
                                        <span className={`trade-action ${trade.side.toLowerCase()}`}>
                                            {trade.side} {trade.outcome}
                                        </span>
                                        <span className="trade-price">{(trade.price * 100).toFixed(2)}¢</span>
                                        <span className="trade-size">{trade.size.toFixed(2)} ({formatCurrency(trade.usdcSize)})</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
