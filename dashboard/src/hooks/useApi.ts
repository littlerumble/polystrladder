// Use relative URL so it works in both dev (with proxy) and prod (same origin)
const API_BASE = '/api'

export interface TrackedMarket {
    id: string
    conditionId: string
    slug: string
    title: string
    tokenId: string
    outcome: string
    outcomeIndex: number
    whalePrice: number
    whaleSize: number
    whaleSide: string
    whaleTimestamp: string
    currentPrice: number | null
    lastPriceUpdate: string | null
    endDate: string | null
    isActive: boolean
    isClosed: boolean
    copyEligible: boolean
    copyReason: string | null
    createdAt: string
    paperTrades?: PaperTrade[]
}

export interface PaperTrade {
    id: string
    marketId: string
    entryPrice: number
    entryTime: string
    shares: number
    costBasis: number
    ladderLevel: number
    currentPrice: number
    unrealizedPnl: number
    unrealizedPct: number
    highWaterMark: number | null
    trailingActive: boolean
    exitPrice: number | null
    exitTime: string | null
    exitReason: string | null
    realizedPnl: number | null
    realizedPct: number | null
    holdTimeMinutes: number | null
    status: 'OPEN' | 'CLOSED'
    market?: TrackedMarket
}

export interface Stats {
    openTrades: number
    closedTrades: number
    totalOpenExposure: number
    unrealizedPnl: number
    realizedPnl: number
    totalPnl: number
    wins: number
    losses: number
    winRate: number
}

export async function fetchMarkets(): Promise<TrackedMarket[]> {
    const res = await fetch(`${API_BASE}/markets`)
    if (!res.ok) throw new Error('Failed to fetch markets')
    return res.json()
}

export async function fetchTrades(status?: 'OPEN' | 'CLOSED'): Promise<PaperTrade[]> {
    const url = status ? `${API_BASE}/trades?status=${status}` : `${API_BASE}/trades`
    const res = await fetch(url)
    if (!res.ok) throw new Error('Failed to fetch trades')
    return res.json()
}

export async function fetchStats(): Promise<Stats> {
    const res = await fetch(`${API_BASE}/stats`)
    if (!res.ok) throw new Error('Failed to fetch stats')
    return res.json()
}
