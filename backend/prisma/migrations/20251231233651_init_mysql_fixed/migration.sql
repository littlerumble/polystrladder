-- CreateTable
CREATE TABLE `Market` (
    `id` VARCHAR(191) NOT NULL,
    `question` TEXT NOT NULL,
    `description` TEXT NULL,
    `category` VARCHAR(191) NOT NULL,
    `subcategory` VARCHAR(191) NULL,
    `endDate` DATETIME(3) NOT NULL,
    `gameStartTime` DATETIME(3) NULL,
    `volume24h` DOUBLE NOT NULL DEFAULT 0,
    `liquidity` DOUBLE NOT NULL DEFAULT 0,
    `outcomes` TEXT NOT NULL,
    `clobTokenIds` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `closed` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketTrade` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `marketId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `entryPrice` DOUBLE NOT NULL,
    `entryShares` DOUBLE NOT NULL,
    `entryAmount` DOUBLE NOT NULL,
    `entryTime` DATETIME(3) NOT NULL,
    `exitPrice` DOUBLE NULL,
    `exitShares` DOUBLE NULL,
    `exitAmount` DOUBLE NULL,
    `exitTime` DATETIME(3) NULL,
    `exitReason` TEXT NULL,
    `profitLoss` DOUBLE NOT NULL DEFAULT 0,
    `profitLossPct` DOUBLE NOT NULL DEFAULT 0,
    `currentShares` DOUBLE NOT NULL DEFAULT 0,
    `currentPrice` DOUBLE NULL,
    `unrealizedPnl` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MarketTrade_marketId_idx`(`marketId`),
    INDEX `MarketTrade_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Trade` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `marketId` VARCHAR(191) NOT NULL,
    `side` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL DEFAULT 'BUY',
    `price` DOUBLE NOT NULL,
    `size` DOUBLE NOT NULL,
    `shares` DOUBLE NOT NULL,
    `strategy` VARCHAR(191) NOT NULL,
    `strategyDetail` TEXT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'FILLED',
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Position` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `marketId` VARCHAR(191) NOT NULL,
    `sharesYes` DOUBLE NOT NULL DEFAULT 0,
    `sharesNo` DOUBLE NOT NULL DEFAULT 0,
    `avgEntryYes` DOUBLE NULL,
    `avgEntryNo` DOUBLE NULL,
    `costBasisYes` DOUBLE NOT NULL DEFAULT 0,
    `costBasisNo` DOUBLE NOT NULL DEFAULT 0,
    `unrealizedPnl` DOUBLE NOT NULL DEFAULT 0,
    `realizedPnl` DOUBLE NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Position_marketId_key`(`marketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PnlSnapshot` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `totalValue` DOUBLE NOT NULL,
    `cashBalance` DOUBLE NOT NULL,
    `positionsValue` DOUBLE NOT NULL,
    `unrealizedPnl` DOUBLE NOT NULL,
    `realizedPnl` DOUBLE NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StrategyEvent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `marketId` VARCHAR(191) NOT NULL,
    `regime` VARCHAR(191) NOT NULL,
    `strategy` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `priceYes` DOUBLE NOT NULL,
    `priceNo` DOUBLE NOT NULL,
    `details` TEXT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PriceHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `marketId` VARCHAR(191) NOT NULL,
    `priceYes` DOUBLE NOT NULL,
    `priceNo` DOUBLE NOT NULL,
    `bestBidYes` DOUBLE NULL,
    `bestAskYes` DOUBLE NULL,
    `bestBidNo` DOUBLE NULL,
    `bestAskNo` DOUBLE NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PriceHistory_marketId_timestamp_idx`(`marketId`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MarketState` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `marketId` VARCHAR(191) NOT NULL,
    `regime` VARCHAR(191) NOT NULL DEFAULT 'MID_CONSENSUS',
    `ladderFilled` TEXT NULL,
    `ladderLevelTouched` TEXT NULL,
    `activeTradeSide` VARCHAR(191) NULL,
    `lockedTradeSide` VARCHAR(191) NULL,
    `tailActive` BOOLEAN NOT NULL DEFAULT false,
    `trailingStopActive` BOOLEAN NOT NULL DEFAULT false,
    `highWaterMark` DOUBLE NOT NULL DEFAULT 0,
    `stopLossTriggeredAt` DATETIME(3) NULL,
    `cooldownUntil` DATETIME(3) NULL,
    `lastProcessed` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MarketState_marketId_key`(`marketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BotConfig` (
    `id` INTEGER NOT NULL DEFAULT 1,
    `bankroll` DOUBLE NOT NULL DEFAULT 1000,
    `lockedProfits` DOUBLE NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MarketTrade` ADD CONSTRAINT `MarketTrade_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Trade` ADD CONSTRAINT `Trade_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Position` ADD CONSTRAINT `Position_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `StrategyEvent` ADD CONSTRAINT `StrategyEvent_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PriceHistory` ADD CONSTRAINT `PriceHistory_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MarketState` ADD CONSTRAINT `MarketState_marketId_fkey` FOREIGN KEY (`marketId`) REFERENCES `Market`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
