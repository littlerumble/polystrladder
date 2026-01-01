/**
 * Trader Tracker Service
 * 
 * Fetches and tracks another trader's Polymarket positions and activity.
 * Used to display a tracked trader's current markets, entries, and PnL.
 */

import axios from 'axios';
import { systemLogger as logger } from '../core/logger.js';

const DATA_API_BASE = 'https://data-api.polymarket.com';

export interface TrackedPosition {
    marketId: string;
    title: string;
    slug: string;
    icon: string;
    outcome: string;          // "Yes" or "No"
    size: number;             // Number of shares
    avgPrice: number;         // Entry price
    curPrice: number;         // Current price
    initialValue: number;     // Cost basis
    currentValue: number;     // Current value
    cashPnl: number;          // $ profit/loss
    percentPnl: number;       // % profit/loss
    endDate: string;          // Market end date
    eventSlug: string;
}

export interface TrackedTrade {
    timestamp: number;
    title: string;
    slug: string;
    outcome: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    usdcSize: number;
}

export interface TraderProfile {
    wallet: string;
    name: string;
    pseudonym: string;
    profileImage?: string;
}

/**
 * Fetch a trader's current positions from Polymarket Data API.
 */
export async function fetchTrackedPositions(walletAddress: string): Promise<TrackedPosition[]> {
    try {
        const response = await axios.get(`${DATA_API_BASE}/positions`, {
            params: { user: walletAddress },
            timeout: 10000
        });

        const positions = response.data as any[];

        // Filter to only active positions (curPrice > 0 and size > 0)
        const activePositions = positions.filter(p =>
            p.size > 0 && p.curPrice !== undefined
        );

        return activePositions.map(p => ({
            marketId: p.conditionId,
            title: p.title || 'Unknown Market',
            slug: p.slug || '',
            icon: p.icon || '',
            outcome: p.outcome || 'Unknown',
            size: p.size || 0,
            avgPrice: p.avgPrice || 0,
            curPrice: p.curPrice || 0,
            initialValue: p.initialValue || 0,
            currentValue: p.currentValue || 0,
            cashPnl: p.cashPnl || 0,
            percentPnl: p.percentPnl || 0,
            endDate: p.endDate || '',
            eventSlug: p.eventSlug || ''
        }));
    } catch (error) {
        logger.error('Failed to fetch tracked positions', {
            wallet: walletAddress,
            error: String(error)
        });
        return [];
    }
}

/**
 * Fetch a trader's recent activity (trades) from Polymarket Data API.
 */
export async function fetchTrackedActivity(
    walletAddress: string,
    limit: number = 50
): Promise<TrackedTrade[]> {
    try {
        const response = await axios.get(`${DATA_API_BASE}/activity`, {
            params: {
                user: walletAddress,
                limit,
                type: 'TRADE'
            },
            timeout: 10000
        });

        const trades = response.data as any[];

        return trades.map(t => ({
            timestamp: t.timestamp,
            title: t.title || 'Unknown Market',
            slug: t.slug || '',
            outcome: t.outcome || 'Unknown',
            side: t.side as 'BUY' | 'SELL',
            price: t.price || 0,
            size: t.size || 0,
            usdcSize: t.usdcSize || 0
        }));
    } catch (error) {
        logger.error('Failed to fetch tracked activity', {
            wallet: walletAddress,
            error: String(error)
        });
        return [];
    }
}

/**
 * Get trader profile info from their activity.
 */
export async function fetchTraderProfile(walletAddress: string): Promise<TraderProfile | null> {
    try {
        const response = await axios.get(`${DATA_API_BASE}/activity`, {
            params: {
                user: walletAddress,
                limit: 1
            },
            timeout: 10000
        });

        if (response.data.length > 0) {
            const trade = response.data[0];
            return {
                wallet: walletAddress,
                name: trade.name || 'Unknown',
                pseudonym: trade.pseudonym || 'Unknown Trader',
                profileImage: trade.profileImage
            };
        }
        return null;
    } catch (error) {
        logger.error('Failed to fetch trader profile', {
            wallet: walletAddress,
            error: String(error)
        });
        return null;
    }
}
