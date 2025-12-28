import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { DashboardServer } from './ws/dashboardServer.js';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Production server wrapper that serves static files
 */
export function setupProductionServer(dashboardServer: DashboardServer, app: express.Application) {
    if (process.env.NODE_ENV === 'production') {
        const dashboardPath = path.join(__dirname, '../../dashboard/dist');
        
        // Serve static files
        app.use(express.static(dashboardPath));
        
        // Catch-all route for SPA
        app.get('*', (req, res, next) => {
            // Skip API routes
            if (req.path.startsWith('/api/')) {
                return next();
            }
            res.sendFile(path.join(dashboardPath, 'index.html'));
        });
    }
}
