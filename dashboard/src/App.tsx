import { useState } from 'react';
import { useApi } from './hooks/useApi';
import './App.css';

// Components
import Header from './components/Header';
import PortfolioCard from './components/PortfolioCard';
import MarketScanner from './components/MarketScanner';
import Positions from './components/Positions';
import TradeHistory from './components/TradeHistory';
import StrategyEvents from './components/StrategyEvents';
import DecisionPanel from './components/DecisionPanel';
import MarketTradesPanel from './components/MarketTradesPanel';
import TraderTracker from './components/TraderTracker';

type TabType = 'scanner' | 'positions' | 'trades' | 'm-trades' | 'strategy' | 'tracker';

function App() {
    const [activeTab, setActiveTab] = useState<TabType>('scanner');
    const api = useApi();

    if (api.loading && !api.portfolio) {
        return (
            <div className="loading-screen">
                <div className="loading-spinner"></div>
                <p>Connecting to bot...</p>
            </div>
        );
    }

    if (api.error && !api.portfolio) {
        return (
            <div className="error-screen">
                <h2>Connection Error</h2>
                <p>{api.error}</p>
                <button onClick={api.refresh}>Retry</button>
            </div>
        );
    }

    return (
        <div className="app">
            <Header
                connected={api.connected}
                mode={api.config?.mode || 'PAPER'}
            />

            <main className="main-content">
                {/* Portfolio Overview */}
                <section className="portfolio-section animate-slide-up">
                    <PortfolioCard
                        portfolio={api.portfolio}
                        positions={api.positions}
                        activeTrades={api.activeTrades}
                        closedTrades={api.closedTrades}
                    />
                </section>

                {/* Decision Panel */}
                <section className="decision-section animate-slide-up" style={{ animationDelay: '0.05s' }}>
                    <DecisionPanel
                        positions={api.positions}
                        marketStates={api.marketStates}
                    />
                </section>

                {/* Tab Navigation */}
                <nav className="tab-nav animate-slide-up" style={{ animationDelay: '0.2s' }}>
                    <button
                        className={`tab-btn ${activeTab === 'scanner' ? 'active' : ''}`}
                        onClick={() => setActiveTab('scanner')}
                    >
                        Market Scanner
                        <span className="badge">{api.marketStates.length}</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'positions' ? 'active' : ''}`}
                        onClick={() => setActiveTab('positions')}
                    >
                        Positions
                        <span className="badge">{api.positions.length}</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'm-trades' ? 'active' : ''}`}
                        onClick={() => setActiveTab('m-trades')}
                    >
                        Market Trades
                        <span className="badge">{api.activeTrades.length + api.closedTrades.length}</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'trades' ? 'active' : ''}`}
                        onClick={() => setActiveTab('trades')}
                    >
                        Order History
                        <span className="badge">{api.trades.length}</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'strategy' ? 'active' : ''}`}
                        onClick={() => setActiveTab('strategy')}
                    >
                        Strategy Events
                        <span className="badge">{api.strategyEvents.length}</span>
                    </button>
                    <button
                        className={`tab-btn ${activeTab === 'tracker' ? 'active' : ''}`}
                        onClick={() => setActiveTab('tracker')}
                    >
                        📡 Tracked Traders
                    </button>
                </nav>

                {/* Tab Content */}
                <section className="tab-content animate-fade-in">
                    {activeTab === 'scanner' && (
                        <MarketScanner
                            markets={api.markets}
                            marketStates={api.marketStates}
                        />
                    )}
                    {activeTab === 'positions' && (
                        <Positions positions={api.positions} />
                    )}
                    {activeTab === 'm-trades' && (
                        <MarketTradesPanel
                            activeTrades={api.activeTrades}
                            closedTrades={api.closedTrades}
                        />
                    )}
                    {activeTab === 'trades' && (
                        <TradeHistory trades={api.trades} />
                    )}
                    {activeTab === 'strategy' && (
                        <StrategyEvents events={api.strategyEvents} />
                    )}
                    {activeTab === 'tracker' && (
                        <TraderTracker />
                    )}
                </section>
            </main>
        </div>
    );
}

export default App;
