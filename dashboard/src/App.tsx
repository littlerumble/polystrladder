import { useState } from 'react'
import './App.css'
import { MarketsTab } from './components/MarketsTab'
import { TradesTab } from './components/TradesTab'
import { StatsBar } from './components/StatsBar'

function App() {
  const [activeTab, setActiveTab] = useState<'markets' | 'trades'>('trades')

  return (
    <div className="app">
      <header className="header">
        <h1>🦈 Sharkbot Copy Trader</h1>
        <p className="whale-address">Tracking: 0x2005...75ea</p>
      </header>

      <StatsBar />

      <nav className="tabs">
        <button
          className={`tab ${activeTab === 'markets' ? 'active' : ''}`}
          onClick={() => setActiveTab('markets')}
        >
          📊 Tracked Markets
        </button>
        <button
          className={`tab ${activeTab === 'trades' ? 'active' : ''}`}
          onClick={() => setActiveTab('trades')}
        >
          📈 Paper Trades
        </button>
      </nav>

      <main className="content">
        {activeTab === 'markets' && <MarketsTab />}
        {activeTab === 'trades' && <TradesTab />}
      </main>
    </div>
  )
}

export default App
