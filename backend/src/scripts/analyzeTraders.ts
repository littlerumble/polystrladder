
import axios from 'axios';

const DATA_API_BASE = 'https://data-api.polymarket.com';

const TRADERS = [
    { name: "Theo4", address: "0x56687bf447db6ffa42ffe2204a05edaa20f55839" },
    { name: "Fredi9999", address: "0x1f2dd6d473f3e824cd2f8a89d9c69fb96f6ad0cf" },
    { name: "Len9311238", address: "0x78b9ac44a6d7d7a076c14e0ad518b301b63c6b76" },
    { name: "zxgngl", address: "0xd235973291b2b75ff4070e9c0b01728c520b0f29" },
    { name: "RepTrump", address: "0x863134d00841b2e200492805a01e1e2f5defaa53" },
    { name: "PrincessCaro", address: "0x8119010a6e589062aa03583bb3f39ca632d9f887" },
    { name: "walletmobile", address: "0xe9ad918c7678cd38b12603a762e638a5d1ee7091" },
    { name: "BetTom42", address: "0x885783760858e1bd5dd09a3c3f916cfa251ac270" },
    { name: "mikatrade77", address: "0x23786fdad0073692157c6d7dc81f281843a35fcb" },
    { name: "alexmulti", address: "0xd0c042c08f755ff940249f62745e82d356345565" },
    { name: "RN1", address: "0x2005d16a84ceefa912d4e380cd32e7ff827875ea" } // Known active
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
        console.error(`Error fetching ${address}:`, error.message);
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
