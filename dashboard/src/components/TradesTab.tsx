import { useState, useEffect } from 'react'
import { fetchTrades, type PaperTrade } from '../hooks/useApi'

export function TradesTab() {
    const [trades, setTrades] = useState<PaperTrade[]>([])
    const [filter, setFilter] = useState<'OPEN' | 'CLOSED' | 'ALL'>('ALL')
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchTrades(filter === 'ALL' ? undefined : filter)
                setTrades(data)
            } catch (error) {
                console.error('Failed to load trades:', error)
            } finally {
                setLoading(false)
            }
        }

        load()
        const interval = setInterval(load, 3000)
        return () => clearInterval(interval)
    }, [filter])

    const openCount = trades.filter(t => t.status === 'OPEN').length
    const closedCount = trades.filter(t => t.status === 'CLOSED').length

    const formatPrice = (price: number) => `${(price * 100).toFixed(1)}¢`

    const formatPnl = (pnl: number, pct: number) => {
        const sign = pnl >= 0 ? '+' : ''
        return `${sign}$${pnl.toFixed(2)} (${sign}${pct.toFixed(1)}%)`
    }

    const formatHoldTime = (minutes: number | null) => {
        if (minutes === null) return '-'
        if (minutes < 60) return `${minutes}m`
        const hours = Math.floor(minutes / 60)
        const mins = minutes % 60
        return `${hours}h ${mins}m`
    }

    const calculateHoldTime = (entryTime: string) => {
        const entry = new Date(entryTime)
        const now = new Date()
        const minutes = Math.floor((now.getTime() - entry.getTime()) / 60000)
        return formatHoldTime(minutes)
    }

    if (loading) {
        return <div className="loading">Loading trades...</div>
    }

    return (
        <>
            <div className="tab-toggles">
                <button
                    className={`toggle-btn ${filter === 'ALL' ? 'active' : ''}`}
                    onClick={() => setFilter('ALL')}
                >
                    All ({trades.length})
                </button>
                <button
                    className={`toggle-btn ${filter === 'OPEN' ? 'active' : ''}`}
                    onClick={() => setFilter('OPEN')}
                >
                    Active ({openCount})
                </button>
                <button
                    className={`toggle-btn ${filter === 'CLOSED' ? 'active' : ''}`}
                    onClick={() => setFilter('CLOSED')}
                >
                    Closed ({closedCount})
                </button>
            </div>

            {trades.length === 0 ? (
                <div className="empty-state">No paper trades yet. Waiting for eligible signals...</div>
            ) : (
                <div className="table-container">
                    <table>
                        <thead>
                            <tr>
                                <th>Market</th>
                                <th>Trader</th>
                                <th>Side</th>
                                <th>Entry → Exit</th>
                                <th>Invested</th>
                                <th>Hold Time</th>
                                <th>{filter === 'CLOSED' ? 'Realized P&L' : 'Unrealized P&L'}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {trades.map(trade => (
                                <tr key={trade.id}>
                                    <td>
                                        <div className="market-title">
                                            {trade.ladderLevel > 1 && <span style={{ color: 'var(--accent-yellow)' }}>🔄 </span>}
                                            <span className="market-name" title={trade.market?.title}>
                                                {trade.market?.title.slice(0, 40) || 'Unknown'}
                                                {(trade.market?.title.length || 0) > 40 ? '...' : ''}
                                            </span>
                                        </div>
                                    </td>
                                    <td>
                                        <div className="trader-info">
                                            <span className="trader-name">{trade.market?.copierName || 'Unknown'}</span>
                                            {trade.market?.copierAddress && trade.market?.copierName !== trade.market?.copierAddress && (
                                                <span className="trader-addr" style={{ fontSize: '0.7em', color: 'var(--text-secondary)', display: 'block' }}>
                                                    {trade.market?.copierAddress.slice(0, 6)}...
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td>
                                        <span className="badge buy">{trade.market?.outcome || 'N/A'}</span>
                                    </td>
                                    <td>
                                        {formatPrice(trade.entryPrice)}
                                        <span className="price-arrow">→</span>
                                        {trade.status === 'CLOSED'
                                            ? formatPrice(trade.exitPrice!)
                                            : formatPrice(trade.currentPrice)
                                        }
                                        {trade.exitReason && (
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                                {trade.exitReason.replace('_', ' ')}
                                            </div>
                                        )}
                                    </td>
                                    <td>${trade.costBasis.toFixed(2)}</td>
                                    <td className="hold-time">
                                        {trade.status === 'CLOSED'
                                            ? formatHoldTime(trade.holdTimeMinutes)
                                            : calculateHoldTime(trade.entryTime)
                                        }
                                    </td>
                                    <td>
                                        {trade.status === 'CLOSED' ? (
                                            <span className={`pnl ${trade.realizedPnl! >= 0 ? 'positive' : 'negative'}`}>
                                                {formatPnl(trade.realizedPnl!, trade.realizedPct!)}
                                            </span>
                                        ) : (
                                            <span className={`pnl ${trade.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                                                {formatPnl(trade.unrealizedPnl, trade.unrealizedPct)}
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    )
}
