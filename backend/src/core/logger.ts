/**
 * Logger utility with structured output for debugging and analysis.
 */

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}

interface LogEntry {
    timestamp: string;
    level: string;
    component: string;
    message: string;
    data?: Record<string, unknown>;
}

class Logger {
    private level: LogLevel;
    private component: string;

    constructor(component: string, level: LogLevel = LogLevel.INFO) {
        this.component = component;
        this.level = level;
    }

    private formatEntry(level: string, message: string, data?: Record<string, unknown>): LogEntry {
        return {
            timestamp: new Date().toISOString(),
            level,
            component: this.component,
            message,
            data
        };
    }

    private log(level: LogLevel, levelStr: string, message: string, data?: Record<string, unknown>): void {
        if (level < this.level) return;

        const entry = this.formatEntry(levelStr, message, data);
        const output = data
            ? `[${entry.timestamp}] [${entry.level}] [${entry.component}] ${entry.message} ${JSON.stringify(data)}`
            : `[${entry.timestamp}] [${entry.level}] [${entry.component}] ${entry.message}`;

        switch (level) {
            case LogLevel.ERROR:
                console.error(output);
                break;
            case LogLevel.WARN:
                console.warn(output);
                break;
            default:
                console.log(output);
        }
    }

    debug(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.DEBUG, 'DEBUG', message, data);
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.INFO, 'INFO', message, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.WARN, 'WARN', message, data);
    }

    error(message: string, data?: Record<string, unknown>): void {
        this.log(LogLevel.ERROR, 'ERROR', message, data);
    }

    // Strategic logging for trade analysis
    trade(action: string, data: {
        marketId: string;
        side: string;
        price: number;
        size: number;
        strategy: string;
        regime?: string;
        ladderLevel?: number;
    }): void {
        this.info(`TRADE: ${action}`, data as Record<string, unknown>);
    }

    strategy(event: string, data: {
        marketId: string;
        regime: string;
        strategy: string;
        priceYes: number;
        priceNo: number;
        details?: Record<string, unknown>;
    }): void {
        this.info(`STRATEGY: ${event}`, data as Record<string, unknown>);
    }
}

/**
 * Create a logger for a specific component.
 */
export function createLogger(component: string, level?: LogLevel): Logger {
    return new Logger(component, level);
}

// Default loggers for main components
export const systemLogger = createLogger('System');
export const marketLogger = createLogger('Market');
export const strategyLogger = createLogger('Strategy');
export const executionLogger = createLogger('Execution');
export const riskLogger = createLogger('Risk');
export const wsLogger = createLogger('WebSocket');

export default Logger;
