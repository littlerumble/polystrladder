import { useState, useEffect } from 'react';
import './TraderTracker.css';

// Hardcoded wallet to track
const TRACKED_WALLET = '0x2005d16a84ceefa912d4e380cd32e7ff827875ea';
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
    const [data, setData] = useState<TraderData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

    const fetchData = async () => {
        try {
            const response = await fetch(`${API_BASE}/api/tracked-positions/${TRACKED_WALLET}`);
            if (!response.ok) throw new Error('Failed to fetch');
            const result = await response.json();
            setData(result);
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
                    <h3>📡 Tracked Trader</h3>
                </div>
                <div className="loading">Loading...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="trader-tracker">
                <div className="tracker-header">
                    <h3>📡 Tracked Trader</h3>
                </div>
                <div className="error">{error}</div>
            </div>
        );
    }

    const positions = data?.positions || [];

    return (
        <div className="trader-tracker">
            <div className="tracker-header">
                <div className="header-left">
                    <h3>📡 Tracked Trader</h3>
                    {data?.trader && (
                        <span className="trader-name">
                            {data.trader.pseudonym}
                        </span>
                    )}
                </div>
                <div className="header-right">
                    <span className="total-pnl" style={{ color: (data?.totalPnl || 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {(data?.totalPnl || 0) >= 0 ? '+' : ''}{formatCurrency(data?.totalPnl || 0)}
                    </span>
                    {lastUpdate && (
                        <span className="last-update">
                            Updated {lastUpdate.toLocaleTimeString()}
                        </span>
                    )}
                </div>
            </div>

            {positions.length === 0 ? (
                <div className="empty-state">
                    <p>No active positions</p>
                </div>
            ) : (
                <div className="tracker-body">
                    <div className="tracker-table">
                        <div className="table-header">
                            <span className="col-market">Market</span>
                            <span className="col-side">Side</span>
                            <span className="col-size">Shares</span>
                            <span className="col-entry">Entry</span>
                            <span className="col-current">Current</span>
                            <span className="col-pnl">P&L</span>
                        </div>
                        {positions.map((pos, idx) => (
                            <div key={idx} className="table-row">
                                <div className="col-market">
                                    <img src={pos.icon} alt="" className="market-icon" />
                                    <span className="market-title" title={pos.title}>
                                        {pos.title.length > 40 ? pos.title.substring(0, 40) + '...' : pos.title}
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
                    <span className="label">Positions:</span>
                    <span className="value">{positions.length}</span>
                </span>
                <span className="footer-item">
                    <span className="label">Value:</span>
                    <span className="value">{formatCurrency(data?.totalValue || 0)}</span>
                </span>
            </div>
        </div>
    );
}
