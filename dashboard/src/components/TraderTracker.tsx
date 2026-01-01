import { useState, useEffect } from 'react';
import './TraderTracker.css';

// Wallets to track
const TRACKED_WALLETS = [
    '0x2005d16a84ceefa912d4e380cd32e7ff827875ea',
    '0xc65ca4755436f82d8eb461e65781584b8cadea39'
];
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

interface TrackedPosition {
    marketId: string;
    title: string;
    slug: string;
    icon: string;
    outcome: string;
    size: number;
    avgPrice: number;
    curPrice: number;
    initialValue: number;
    currentValue: number;
    cashPnl: number;
    percentPnl: number;
    endDate: string;
    traderName?: string;  // Added to identify which trader
}

interface TraderData {
    trader: {
        wallet: string;
        name: string;
        pseudonym: string;
        profileImage?: string;
    } | null;
    positions: TrackedPosition[];
    totalPositions: number;
    totalValue: number;
    totalPnl: number;
}

function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2
    }).format(value);
}

export default function TraderTracker() {
    const [allPositions, setAllPositions] = useState<TrackedPosition[]>([]);
    const [traders, setTraders] = useState<Map<string, string>>(new Map());  // wallet -> pseudonym
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [totalPnl, setTotalPnl] = useState(0);
    const [totalValue, setTotalValue] = useState(0);

    const fetchData = async () => {
        try {
            // Fetch all wallets in parallel
            const results = await Promise.all(
                TRACKED_WALLETS.map(wallet =>
                    fetch(`${API_BASE}/api/tracked-positions/${wallet}`)
                        .then(res => res.ok ? res.json() : null)
                        .catch(() => null)
                )
            );

            // Combine all positions, adding trader name to each
            const combined: TrackedPosition[] = [];
            const traderMap = new Map<string, string>();
            let pnlSum = 0;
            let valueSum = 0;

            results.forEach((data: TraderData | null, idx) => {
                if (data && data.positions) {
                    const traderName = data.trader?.pseudonym || `Trader ${idx + 1}`;
                    traderMap.set(TRACKED_WALLETS[idx], traderName);

                    data.positions.forEach(pos => {
                        combined.push({
                            ...pos,
                            traderName
                        });
                    });

                    pnlSum += data.totalPnl || 0;
                    valueSum += data.totalValue || 0;
                }
            });

            setAllPositions(combined);
            setTraders(traderMap);
            setTotalPnl(pnlSum);
            setTotalValue(valueSum);
            setLastUpdate(new Date());
            setError(null);
        } catch (err) {
            setError('Failed to load trader data');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // Poll every 30 seconds
        const interval = setInterval(fetchData, 30000);
        return () => clearInterval(interval);
    }, []);

    if (loading) {
        return (
            <div className="trader-tracker">
                <div className="tracker-header">
                    <h3>📡 Tracked Traders</h3>
                </div>
                <div className="loading">Loading...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="trader-tracker">
                <div className="tracker-header">
                    <h3>📡 Tracked Traders</h3>
                </div>
                <div className="error">{error}</div>
            </div>
        );
    }

    const traderNames = Array.from(traders.values()).join(', ');

    return (
        <div className="trader-tracker">
            <div className="tracker-header">
                <div className="header-left">
                    <h3>📡 Tracked Traders</h3>
                    <span className="trader-name">
                        {traderNames || 'No traders'}
                    </span>
                </div>
                <div className="header-right">
                    <span className="total-pnl" style={{ color: totalPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
                    </span>
                    {lastUpdate && (
                        <span className="last-update">
                            Updated {lastUpdate.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </div>

            {allPositions.length === 0 ? (
                <div className="empty-state">
                    <p>No active positions</p>
                </div>
            ) : (
                <div className="tracker-body">
                    <div className="tracker-table">
                        <div className="table-header">
                            <span className="col-trader">Trader</span>
                            <span className="col-market">Market</span>
                            <span className="col-side">Side</span>
                            <span className="col-size">Shares</span>
                            <span className="col-entry">Entry</span>
                            <span className="col-current">Current</span>
                            <span className="col-pnl">P&L</span>
                        </div>
                        {allPositions.map((pos, idx) => (
                            <div key={idx} className="table-row">
                                <div className="col-trader">
                                    <span className="trader-badge">{pos.traderName?.substring(0, 12)}</span>
                                </div>
                                <div className="col-market">
                                    <img src={pos.icon} alt="" className="market-icon" />
                                    <span className="market-title" title={pos.title}>
                                        {pos.title.length > 35 ? pos.title.substring(0, 35) + '...' : pos.title}
                                    </span>
                                </div>
                                <div className="col-side">
                                    <span className={`side-badge ${pos.outcome.toLowerCase()}`}>
                                        {pos.outcome}
                                    </span>
                                </div>
                                <div className="col-size">
                                    {pos.size.toFixed(1)}
                                </div>
                                <div className="col-entry">
                                    {(pos.avgPrice * 100).toFixed(1)}¢
                                </div>
                                <div className="col-current">
                                    {(pos.curPrice * 100).toFixed(1)}¢
                                </div>
                                <div className="col-pnl">
                                    <span className={pos.cashPnl >= 0 ? 'positive' : 'negative'}>
                                        {pos.cashPnl >= 0 ? '+' : ''}{formatCurrency(pos.cashPnl)}
                                    </span>
                                    <span className={`pnl-pct ${pos.percentPnl >= 0 ? 'positive' : 'negative'}`}>
                                        ({pos.percentPnl >= 0 ? '+' : ''}{pos.percentPnl.toFixed(1)}%)
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="tracker-footer">
                <span className="footer-item">
                    <span className="label">Traders:</span>
                    <span className="value">{traders.size}</span>
                </span>
                <span className="footer-item">
                    <span className="label">Positions:</span>
                    <span className="value">{allPositions.length}</span>
                </span>
                <span className="footer-item">
                    <span className="label">Value:</span>
                    <span className="value">{formatCurrency(totalValue)}</span>
                </span>
            </div>
        </div>
    );
}
