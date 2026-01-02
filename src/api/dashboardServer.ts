/**
 * Dashboard API Server
 * 
 * Express server providing REST endpoints for the dashboard.
 * In production, also serves static dashboard files.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { PrismaClient } from '@prisma/client';

export function startDashboardServer(prisma: PrismaClient, port: number): void {
    const app = express();

    app.use(cors());
    app.use(express.json());

    // Serve static dashboard files in production
    const dashboardPath = path.join(__dirname, '../../dashboard/dist');
    app.use(express.static(dashboardPath));

    // Health check
    app.get('/api/health', function (_req, res) {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    // Get all tracked markets
    app.get('/api/markets', async function (_req, res) {
        try {
            const markets = await prisma.trackedMarket.findMany({
                orderBy: { createdAt: 'desc' },
            });
            res.json(markets);
        } catch (error: unknown) {
            const err = error as Error;
            console.error('[API] /markets error:', err.message);
            res.status(500).json({ error: 'Failed to fetch markets', details: err.message });
        }
    });

    // Get paper trades
    app.get('/api/trades', async function (req, res) {
        try {
            const status = req.query.status as string | undefined;

            const trades = await prisma.paperTrade.findMany({
                where: status ? { status } : undefined,
                orderBy: { createdAt: 'desc' },
                include: { market: true },
            });
            res.json(trades);
        } catch (error: unknown) {
            const err = error as Error;
            console.error('[API] /trades error:', err.message);
            res.status(500).json({ error: 'Failed to fetch trades', details: err.message });
        }
    });

    // Get stats summary
    app.get('/api/stats', async function (_req, res) {
        try {
            const openTrades = await prisma.paperTrade.findMany({
                where: { status: 'OPEN' },
            });

            const closedTrades = await prisma.paperTrade.findMany({
                where: { status: 'CLOSED' },
            });

            const totalOpenExposure = openTrades.reduce((sum, t) => sum + t.costBasis, 0);
            const unrealizedPnl = openTrades.reduce((sum, t) => sum + t.unrealizedPnl, 0);
            const realizedPnl = closedTrades.reduce((sum, t) => sum + (t.realizedPnl || 0), 0);

            const wins = closedTrades.filter(t => (t.realizedPnl || 0) > 0).length;
            const losses = closedTrades.filter(t => (t.realizedPnl || 0) <= 0).length;
            const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

            res.json({
                openTrades: openTrades.length,
                closedTrades: closedTrades.length,
                totalOpenExposure,
                unrealizedPnl,
                realizedPnl,
                totalPnl: unrealizedPnl + realizedPnl,
                wins,
                losses,
                winRate,
            });
        } catch (error: unknown) {
            const err = error as Error;
            console.error('[API] /stats error:', err.message);
            res.status(500).json({ error: 'Failed to fetch stats', details: err.message });
        }
    });

    // Get whale trade log
    app.get('/api/whale-trades', async function (req, res) {
        try {
            const limit = parseInt(req.query.limit as string) || 50;

            const trades = await prisma.whaleTradeLog.findMany({
                orderBy: { timestamp: 'desc' },
                take: limit,
            });
            res.json(trades);
        } catch (error: unknown) {
            const err = error as Error;
            console.error('[API] /whale-trades error:', err.message);
            res.status(500).json({ error: 'Failed to fetch whale trades', details: err.message });
        }
    });

    // Fallback: serve dashboard for all other routes (SPA routing)
    app.get('*', function (_req, res) {
        res.sendFile(path.join(dashboardPath, 'index.html'));
    });

    app.listen(port, function () {
        console.log(`✅ Dashboard API running at http://localhost:${port}`);
    });
}
