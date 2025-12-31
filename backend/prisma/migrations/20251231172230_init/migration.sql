-- CreateTable
CREATE TABLE "Market" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "question" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "subcategory" TEXT,
    "endDate" DATETIME NOT NULL,
    "gameStartTime" DATETIME,
    "volume24h" REAL NOT NULL DEFAULT 0,
    "liquidity" REAL NOT NULL DEFAULT 0,
    "outcomes" TEXT NOT NULL,
    "clobTokenIds" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketTrade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "entryPrice" REAL NOT NULL,
    "entryShares" REAL NOT NULL,
    "entryAmount" REAL NOT NULL,
    "entryTime" DATETIME NOT NULL,
    "exitPrice" REAL,
    "exitShares" REAL,
    "exitAmount" REAL,
    "exitTime" DATETIME,
    "profitLoss" REAL NOT NULL DEFAULT 0,
    "profitLossPct" REAL NOT NULL DEFAULT 0,
    "currentShares" REAL NOT NULL DEFAULT 0,
    "currentPrice" REAL,
    "unrealizedPnl" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketTrade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "price" REAL NOT NULL,
    "size" REAL NOT NULL,
    "shares" REAL NOT NULL,
    "strategy" TEXT NOT NULL,
    "strategyDetail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FILLED',
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Trade_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Position" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" TEXT NOT NULL,
    "sharesYes" REAL NOT NULL DEFAULT 0,
    "sharesNo" REAL NOT NULL DEFAULT 0,
    "avgEntryYes" REAL,
    "avgEntryNo" REAL,
    "costBasisYes" REAL NOT NULL DEFAULT 0,
    "costBasisNo" REAL NOT NULL DEFAULT 0,
    "unrealizedPnl" REAL NOT NULL DEFAULT 0,
    "realizedPnl" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Position_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PnlSnapshot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "totalValue" REAL NOT NULL,
    "cashBalance" REAL NOT NULL,
    "positionsValue" REAL NOT NULL,
    "unrealizedPnl" REAL NOT NULL,
    "realizedPnl" REAL NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "StrategyEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" TEXT NOT NULL,
    "regime" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "priceYes" REAL NOT NULL,
    "priceNo" REAL NOT NULL,
    "details" TEXT,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StrategyEvent_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceHistory" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" TEXT NOT NULL,
    "priceYes" REAL NOT NULL,
    "priceNo" REAL NOT NULL,
    "bestBidYes" REAL,
    "bestAskYes" REAL,
    "bestBidNo" REAL,
    "bestAskNo" REAL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceHistory_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MarketState" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "marketId" TEXT NOT NULL,
    "regime" TEXT NOT NULL DEFAULT 'MID_CONSENSUS',
    "ladderFilled" TEXT NOT NULL DEFAULT '[]',
    "activeTradeSide" TEXT,
    "lockedTradeSide" TEXT,
    "tailActive" BOOLEAN NOT NULL DEFAULT false,
    "stopLossTriggeredAt" DATETIME,
    "cooldownUntil" DATETIME,
    "lastProcessed" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MarketState_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MarketTrade_marketId_idx" ON "MarketTrade"("marketId");

-- CreateIndex
CREATE INDEX "MarketTrade_status_idx" ON "MarketTrade"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Position_marketId_key" ON "Position"("marketId");

-- CreateIndex
CREATE INDEX "PriceHistory_marketId_timestamp_idx" ON "PriceHistory"("marketId", "timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "MarketState_marketId_key" ON "MarketState"("marketId");
