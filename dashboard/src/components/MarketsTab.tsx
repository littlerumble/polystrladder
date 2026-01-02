import { useState, useEffect } from 'react'
import { fetchMarkets, type TrackedMarket } from '../hooks/useApi'

export function MarketsTab() {
    const [markets, setMarkets] = useState<TrackedMarket[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        const load = async () => {
            try {
                const data = await fetchMarkets()
                setMarkets(data)
            } catch (error) {
                console.error('Failed to load markets:', error)
            } finally {
                setLoading(false)
            }
        }

        load()
        const interval = setInterval(load, 5000)
        return () => clearInterval(interval)
    }, [])

    if (loading) {
        return <div className="loading">Loading markets...</div>
    }

    if (markets.length === 0) {
        return <div className="empty-state">No markets being tracked yet. Waiting for whale trades...</div>
    }

    const formatPrice = (price: number | null) => {
        if (price === null) return '-'
        return `${(price * 100).toFixed(1)}¢`
    }

    return (
        <div className="table-container">
            <table>
                <thead>
                    <tr>
                        <th>Market</th>
                        <th>Outcome</th>
                        <th>Whale Entry</th>
                        <th>Current Price</th>
                        <th>Status</th>
                        <th>Signal</th>
                    </tr>
                </thead>
                <tbody>
                    {markets.map(market => (
                        <tr key={market.id}>
                            <td>
                                <div className="market-title">
                                    <span className="market-name" title={market.title}>
                                        {market.title.slice(0, 50)}{market.title.length > 50 ? '...' : ''}
                                    </span>
                                </div>
                            </td>
                            <td>
                                <span className="badge buy">{market.outcome}</span>
                            </td>
                            <td>{formatPrice(market.whalePrice)}</td>
                            <td>
                                <span className={market.currentPrice && market.currentPrice > market.whalePrice ? 'pnl positive' : market.currentPrice && market.currentPrice < market.whalePrice ? 'pnl negative' : ''}>
                                    {formatPrice(market.currentPrice)}
                                </span>
                            </td>
                            <td>
                                <span className={`badge ${market.isActive && !market.isClosed ? 'open' : 'closed'}`}>
                                    {market.isActive && !market.isClosed ? 'Live' : 'Closed'}
                                </span>
                            </td>
                            <td>
                                <span className={`badge ${market.copyEligible ? 'eligible' : 'ineligible'}`}>
                                    {market.copyEligible ? '✅ Eligible' : '⏭️ Skip'}
                                </span>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                    {market.copyReason}
                                </div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
