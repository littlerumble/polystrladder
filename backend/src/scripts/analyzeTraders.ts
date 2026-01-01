
import axios from 'axios';

const DATA_API_BASE = 'https://data-api.polymarket.com';

const TRADERS = [
    // 30-Day Leaders
    { name: "bossoskil", address: "0x0d3b10b8eac8b089c6e4a695e65d8e044167c46b" },
    { name: "beachboy4", address: "0xc2e7800b5af46e6093872b177b7a5e7f0563be51" },
    { name: "kch123", address: "0x6a72f61820b26b1fe4d956e17b6dc2a1ea3033ee" },
    { name: "eschaworld", address: "0x7b6c6d1279098054b0c630a4b871002a7cd46305" }, // eschaworldchampion2026
    { name: "SeriouslySirius", address: "0x16b29c50f2439faf627209b2ac0c7bbddaa8a881" },
    { name: "RN1", address: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea" }, // Known active
    // All-time for check
    { name: "Theo4", address: "0x56687bf447db6ffa42ffe2204a05edaa20f55839" }
];

async function fetchActivity(address: string) {
    try {
        const response = await axios.get(`${DATA_API_BASE}/activity`, {
            params: {
                user: address,
                limit: 50
            },
            timeout: 10000
        });
        return response.data;
    } catch (error) {
        console.error(`Error fetching ${address}:`, (error as any).message);
        return [];
    }
}

async function analyze() {
    console.log("Analyzing Top Traders for Ladder Strategy Suitability...");
    console.log("Criteria: Active (>0 trades last 7d) AND High Conviction Buys (Avg Buy Price > 0.60)");
    console.log("-".repeat(80));
    console.log(
        "Trader".padEnd(15) +
        "Status".padEnd(10) +
        "Trades(7d)".padEnd(12) +
        "Buy%".padEnd(8) +
        "AvgBuy$".padEnd(10) +
        "LadderFit%".padEnd(12) +
        "LastActive"
    );
    console.log("-".repeat(80));

    const now = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = now - (7 * 24 * 60 * 60);

    for (const trader of TRADERS) {
        const activities = await fetchActivity(trader.address);
        const trades = activities.filter((a: any) => a.type === 'TRADE');

        const recentTrades = trades.filter((t: any) => t.timestamp > sevenDaysAgo);
        const buyTrades = recentTrades.filter((t: any) => t.side === 'BUY');

        const lastActiveTs = trades.length > 0 ? trades[0].timestamp : 0;
        const lastActiveDate = lastActiveTs > 0 ? new Date(lastActiveTs * 1000).toISOString().split('T')[0] : 'N/A';

        let status = 'INACTIVE';
        if (recentTrades.length > 0) status = 'ACTIVE';

        let avgBuyPrice = 0;
        let ladderFitPct = 0;
        let buyPct = 0;

        if (recentTrades.length > 0) {
            buyPct = (buyTrades.length / recentTrades.length) * 100;
        }

        if (buyTrades.length > 0) {
            const totalBuyPrice = buyTrades.reduce((sum: number, t: any) => sum + (t.price || 0), 0);
            avgBuyPrice = totalBuyPrice / buyTrades.length;

            // Ladder Fit: Buys where price >= 0.60
            const ladderBuys = buyTrades.filter((t: any) => t.price >= 0.60);
            ladderFitPct = (ladderBuys.length / buyTrades.length) * 100;
        }

        // Colorize or star good candidates
        let prefix = "  ";
        if (status === 'ACTIVE' && avgBuyPrice > 0.55 && ladderFitPct > 40) {
            prefix = "⭐ ";
        } else if (status === 'ACTIVE') {
            prefix = "  ";
        }

        console.log(
            prefix +
            trader.name.slice(0, 13).padEnd(13) +
            status.padEnd(10) +
            recentTrades.length.toString().padEnd(12) +
            buyPct.toFixed(0).padEnd(8) +
            avgBuyPrice.toFixed(2).padEnd(10) +
            ladderFitPct.toFixed(0).padEnd(12) +
            lastActiveDate
        );
    }
}

analyze();
