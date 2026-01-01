import { useState, useEffect, useMemo } from 'react';
import './TraderTracker.css';

// Wallets to track with display names
const TRACKED_TRADERS = [
    { wallet: '0x2005d16a84ceefa912d4e380cd32e7ff827875ea', displayName: 'RN1' },
    { wallet: '0xc65ca4755436f82d8eb461e65781584b8cadea39', displayName: 'LOOKINGBACK' }
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
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
}

type SortField = 'time' | 'trader' | 'price' | 'size';
type SortDir = 'asc' | 'desc';

export default function TraderTracker() {
    const [activities, setActivities] = useState<TradeActivity[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    // Filters and sorting
    const [filterTrader, setFilterTrader] = useState<string>('all');
    const [sortField, setSortField] = useState<SortField>('time');
    const [sortDir, setSortDir] = useState<SortDir>('desc');

    const fetchData = async () => {
        try {
            // Fetch activity for all traders in parallel
            const results = await Promise.all(
                TRACKED_TRADERS.map(async (trader) => {
                    const res = await fetch(`${API_BASE}/api/tracked-activity/${trader.wallet}?limit=50`);
                    if (!res.ok) return [];
                    const data = await res.json();
                    return (data.trades || []).map((t: any) => ({
                        ...t,
                        traderName: trader.displayName,
                        traderWallet: trader.wallet
                    }));
                })
            );

            // Combine all activities
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

    // Filter and sort
    const filteredActivities = useMemo(() => {
        let result = [...activities];

        // Filter by trader
        if (filterTrader !== 'all') {
            result = result.filter(a => a.traderName === filterTrader);
        }

        // Sort
        result.sort((a, b) => {
            let cmp = 0;
            switch (sortField) {
                case 'time':
                    cmp = a.timestamp - b.timestamp;
                    break;
                case 'trader':
                    cmp = a.traderName.localeCompare(b.traderName);
                    break;
                case 'price':
                    cmp = a.price - b.price;
                    break;
                case 'size':
                    cmp = a.usdcSize - b.usdcSize;
                    break;
            }
            return sortDir === 'desc' ? -cmp : cmp;
        });

        return result;
    }, [activities, filterTrader, sortField, sortDir]);

    const handleSort = (field: SortField) => {
        if (sortField === field) {
            setSortDir(sortDir === 'desc' ? 'asc' : 'desc');
        } else {
            setSortField(field);
            setSortDir('desc');
        }
    };

    if (loading) {
        return (
            <div className="trader-tracker">
                <div className="tracker-controls">
                    <h3>📡 Tracked Traders Activity</h3>
                </div>
                <div className="loading">Loading trader activity...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="trader-tracker">
                <div className="tracker-controls">
                    <h3>📡 Tracked Traders Activity</h3>
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
                    <h3>📡 Tracked Traders Activity</h3>
                    {lastUpdate && (
                        <span className="last-update">Updated {lastUpdate.toLocaleTimeString()}</span>
                    )}
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
                    <span className="activity-count">{filteredActivities.length} trades</span>
                </div>
            </div>

            {/* Activity Feed */}
            <div className="activity-feed">
                <div className="feed-header">
                    <span
                        className={`col-time sortable ${sortField === 'time' ? 'sorted' : ''}`}
                        onClick={() => handleSort('time')}
                    >
                        Time {sortField === 'time' && (sortDir === 'desc' ? '↓' : '↑')}
                    </span>
                    <span
                        className={`col-trader sortable ${sortField === 'trader' ? 'sorted' : ''}`}
                        onClick={() => handleSort('trader')}
                    >
                        Trader {sortField === 'trader' && (sortDir === 'desc' ? '↓' : '↑')}
                    </span>
                    <span className="col-action">Action</span>
                    <span className="col-market">Market</span>
                    <span
                        className={`col-price sortable ${sortField === 'price' ? 'sorted' : ''}`}
                        onClick={() => handleSort('price')}
                    >
                        Price {sortField === 'price' && (sortDir === 'desc' ? '↓' : '↑')}
                    </span>
                    <span
                        className={`col-amount sortable ${sortField === 'size' ? 'sorted' : ''}`}
                        onClick={() => handleSort('size')}
                    >
                        Amount {sortField === 'size' && (sortDir === 'desc' ? '↓' : '↑')}
                    </span>
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
        </div>
    );
}
