import { XAxis, YAxis, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { PnlSnapshot } from '../hooks/useApi';
import './PnLChart.css';

interface PnLChartProps {
    data: PnlSnapshot[];
}

export default function PnLChart({ data }: PnLChartProps) {
    if (data.length === 0) {
        return (
            <div className="chart-empty">
                <p>No P&L data yet. Waiting for trades...</p>
            </div>
        );
    }

    const chartData = data.map(d => ({
        time: new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        totalValue: d.totalValue,
        unrealizedPnl: d.unrealizedPnl,
        realizedPnl: d.realizedPnl
    }));

    const minValue = Math.min(...data.map(d => d.totalValue)) * 0.995;
    const maxValue = Math.max(...data.map(d => d.totalValue)) * 1.005;

    const latestPnl = data[data.length - 1]?.unrealizedPnl || 0;
    const isPositive = latestPnl >= 0;

    return (
        <div className="pnl-chart">
            <div className="chart-header">
                <h3>Portfolio Value</h3>
                <span className={`chart-trend ${isPositive ? 'positive' : 'negative'}`}>
                    {isPositive ? '↑' : '↓'} {latestPnl >= 0 ? '+' : ''}{latestPnl.toFixed(2)}
                </span>
            </div>
            <div className="chart-container">
                <ResponsiveContainer width="100%" height={200}>
                    <AreaChart data={chartData}>
                        <defs>
                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#00d4ff" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#00d4ff" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <XAxis
                            dataKey="time"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            domain={[minValue, maxValue]}
                            axisLine={false}
                            tickLine={false}
                            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                            tickFormatter={(v) => `$${v.toFixed(0)}`}
                            width={60}
                        />
                        <Tooltip
                            contentStyle={{
                                background: 'rgba(18, 18, 26, 0.95)',
                                border: '1px solid rgba(255,255,255,0.1)',
                                borderRadius: '8px',
                                boxShadow: '0 8px 32px rgba(0,0,0,0.5)'
                            }}
                            labelStyle={{ color: 'rgba(255,255,255,0.7)' }}
                            formatter={(value: number) => [`$${value.toFixed(2)}`, 'Total Value']}
                        />
                        <Area
                            type="monotone"
                            dataKey="totalValue"
                            stroke="#00d4ff"
                            strokeWidth={2}
                            fill="url(#colorValue)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
