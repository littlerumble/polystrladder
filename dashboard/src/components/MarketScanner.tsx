import { useState, useEffect } from 'react';
import { TrackedMarket } from '../hooks/useApi';
import './MarketScanner.css';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function getStatusIcon(status: string): string {
    switch (status) {
        case 'IN_RANGE': return '🎯';
        case 'WATCHING': return '👁️';
        case 'EXECUTED': return '✅';
        default: return '⏸️';
    }
}

function formatTime(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

export default function MarketScanner() {
    const [trackedMarkets, setTrackedMarkets] = useState<TrackedMarket[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<'all' | 'watching' | 'in_range'>('all');

    useEffect(() => {
        const fetchTrackedMarkets = async () => {
            try {
                const res = await fetch(`${API_URL}/api/tracked-markets`);
                if (res.ok) {
                    const data = await res.json();
                    setTrackedMarkets(data);
                }
            } catch (error) {
                console.error('Failed to fetch tracked markets:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchTrackedMarkets();
        const interval = setInterval(fetchTrackedMarkets, 5000);  // Refresh every 5s
        return () => clearInterval(interval);
    }, []);

    const filteredMarkets = trackedMarkets.filter(m => {
        if (filter === 'all') return true;
        if (filter === 'watching') return m.status === 'WATCHING';
        if (filter === 'in_range') return m.status === 'IN_RANGE';
        return true;
    });

    if (loading) {
        return <div className="empty-state"><p>Loading tracked markets...</p></div>;
    }

    if (trackedMarkets.length === 0) {
        return (
            <div className="empty-state">
                <p>No tracked markets yet. Waiting for tracked traders to buy...</p>
            </div>
        );
    }

    return (
        <div className="market-scanner">
            <div className="filter-buttons">
                <button
                    className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
                    onClick={() => setFilter('all')}
                >
                    All ({trackedMarkets.length})
                </button>
                <button
                    className={`filter-btn ${filter === 'watching' ? 'active' : ''}`}
                    onClick={() => setFilter('watching')}
                >
                    👁️ Watching ({trackedMarkets.filter(m => m.status === 'WATCHING').length})
                </button>
                <button
                    className={`filter-btn ${filter === 'in_range' ? 'active' : ''}`}
                    onClick={() => setFilter('in_range')}
                >
                    🎯 In Range ({trackedMarkets.filter(m => m.status === 'IN_RANGE').length})
                </button>
            </div>

            <div className="scanner-header">
                <span className="col-status-icon"></span>
                <span className="col-market">Market</span>
                <span className="col-trader">Tracker</span>
                <span className="col-price">Entry</span>
                <span className="col-current">Current</span>
                <span className="col-time">Signal Time</span>
            </div>
            <div className="scanner-body">
                {filteredMarkets.map(market => {
                    const priceInRange = (market.currentPrice || 0) >= 0.65 && (market.currentPrice || 0) <= 0.90;

                    return (
                        <div key={market.id} className={`scanner-row ${market.status.toLowerCase()}`}>
                            <div className="col-status-icon">
                                {getStatusIcon(market.status)}
                            </div>
                            <div className="col-market">
                                <span className="market-question" title={market.title}>
                                    {market.title.length > 45
                                        ? market.title.substring(0, 45) + '...'
                                        : market.title}
                                </span>
                                <span className="outcome-tag">{market.outcome}</span>
                            </div>
                            <div className="col-trader">
                                <span className="trader-name">{market.traderName}</span>
                            </div>
                            <div className="col-price">
                                <span className="price-badge">
                                    {(market.trackedPrice * 100).toFixed(1)}¢
                                </span>
                            </div>
                            <div className="col-current">
                                <span
                                    className="price-badge"
                                    style={{ color: priceInRange ? 'var(--accent-green)' : 'var(--text-muted)' }}
                                >
                                    {market.currentPrice ? `${(market.currentPrice * 100).toFixed(1)}¢` : '-'}
                                </span>
                            </div>
                            <div className="col-time">
                                {formatTime(market.signalTime)}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
