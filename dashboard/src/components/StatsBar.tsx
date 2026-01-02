import { useState, useEffect } from 'react'
import { fetchStats, type Stats } from '../hooks/useApi'

// Default stats with zeros
const defaultStats: Stats = {
    openTrades: 0,
    closedTrades: 0,
    totalOpenExposure: 0,
    unrealizedPnl: 0,
    realizedPnl: 0,
    totalPnl: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
}

export function StatsBar() {
    const [stats, setStats] = useState<Stats>(defaultStats)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchStats()
                setStats(data)
            } catch (error) {
                // API not available - keep showing zeros
                console.error('Failed to load stats:', error)
                setStats(defaultStats)
            }
        }

        load()
        const interval = setInterval(load, 5000)
        return () => clearInterval(interval)
    }, [])

    const formatPnl = (value: number) => {
        const sign = value >= 0 ? '+' : ''
        return `${sign}$${value.toFixed(2)}`
    }

    return (
        <div className="stats-bar">
            <div className="stat-card">
                <div className="stat-label">Open Trades</div>
                <div className="stat-value">{stats.openTrades}</div>
            </div>

            <div className="stat-card">
                <div className="stat-label">Open Exposure</div>
                <div className="stat-value">${stats.totalOpenExposure.toFixed(0)}</div>
            </div>

            <div className="stat-card">
                <div className="stat-label">Unrealized P&L</div>
                <div className={`stat-value ${stats.unrealizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {formatPnl(stats.unrealizedPnl)}
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-label">Realized P&L</div>
                <div className={`stat-value ${stats.realizedPnl >= 0 ? 'positive' : 'negative'}`}>
                    {formatPnl(stats.realizedPnl)}
                </div>
            </div>

            <div className="stat-card">
                <div className="stat-label">Win Rate</div>
                <div className="stat-value">{stats.winRate.toFixed(1)}%</div>
            </div>

            <div className="stat-card">
                <div className="stat-label">W / L</div>
                <div className="stat-value">{stats.wins} / {stats.losses}</div>
            </div>
        </div>
    )
}
