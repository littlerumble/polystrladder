import './Header.css';

interface HeaderProps {
    connected: boolean;
    mode: string;
}

export default function Header({ connected, mode }: HeaderProps) {
    return (
        <header className="header">
            <div className="header-content">
                <div className="logo-section">
                    <div className="logo">
                        <span className="logo-icon">🦈</span>
                        <span className="logo-text">SharkBot</span>
                    </div>
                    <span className={`mode-badge ${mode.toLowerCase()}`}>
                        {mode}
                    </span>
                </div>

                <div className="status-section">
                    <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
                        <span className="status-dot"></span>
                        <span className="status-text">
                            {connected ? 'Live' : 'Disconnected'}
                        </span>
                    </div>
                    <div className="timestamp">
                        {new Date().toLocaleTimeString()}
                    </div>
                </div>
            </div>
        </header>
    );
}
