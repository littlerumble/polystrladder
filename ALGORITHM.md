# Polymarket Trading Bot - Complete Pseudo Code

## 1. STARTUP
```
1. Connect to database
2. Initialize RiskManager (load positions, cash balance)
3. Load persisted MarketStates from DB
4. Fetch top 500 markets from Gamma API (Sports category, >$1000 volume)
5. Initialize MarketState for each market
6. Start price polling (every 60 seconds from Gamma API)
7. Start P&L snapshots (every 60 seconds)
8. Start resolution checks (settle closed markets)
```

## 2. MAIN LOOP (on each price update)
```python
handlePriceUpdate(marketId, priceYes, priceNo):
    # Skip garbage 0.5/0.5 prices
    if priceYes == 0.5 AND priceNo == 0.5:
        fetch real price from Gamma API
    
    # Prevent concurrent processing
    if marketId in processingLocks:
        return
    
    lock(marketId)
    
    # Update state
    state = updateMarketState(marketId, priceYes, priceNo)
    
    # Classify regime
    regime = classifyRegime(timeToResolution, priceYes, priceHistory)
    
    # Select strategy
    strategy = selectStrategy(regime)
    
    # Generate orders based on strategy
    orders = []
    if strategy == LADDER_COMPRESSION:
        orders = generateLadderOrders(state)
    
    # Check for DCA opportunity
    if hasPosition(marketId):
        orders += generateDCAOrders(state, position)
    
    # Check for EXIT (CRITICAL - takes priority)
    if hasPosition(marketId) AND NOT blacklisted(marketId):
        exitCheck = shouldExit(position, priceYes, priceNo)
        if exitCheck.shouldExit:
            orders = [generateExitOrder(position)]  # ONLY exit, no entries
            blacklist(marketId)  # NEVER re-enter
    
    # Risk check and execute
    for order in orders:
        if riskManager.approve(order):
            execute(order)
            updateState(order)
    
    unlock(marketId)
```

## 3. REGIME CLASSIFIER
```python
classifyRegime(timeToResolution, priceYes, priceHistory):
    # LATE_COMPRESSED: Near resolution + high confidence
    if timeToResolution < 6 hours AND priceYes > 0.85:
        return LATE_COMPRESSED
    
    # HIGH_VOLATILITY: Price swinging too much
    if stddev(priceHistory[-15min]) > 0.05:
        return HIGH_VOLATILITY
    
    # EARLY_UNCERTAIN: 50/50 territory
    if 0.45 <= priceYes <= 0.55:
        return EARLY_UNCERTAIN
    
    # Default: Consensus forming
    return MID_CONSENSUS
```

## 4. STRATEGY SELECTOR
```python
selectStrategy(regime):
    if regime == LATE_COMPRESSED:  return LADDER_COMPRESSION
    if regime == MID_CONSENSUS:    return LADDER_COMPRESSION
    if regime == HIGH_VOLATILITY:  return NONE  # Wait
    if regime == EARLY_UNCERTAIN:  return NONE  # Wait
```

## 5. LADDER ENTRY STRATEGY
```python
generateLadderOrders(state):
    ladderLevels = [0.65, 0.70, 0.80, 0.90, 0.95]
    weights =      [10%,  15%,  25%,  25%,  25%]  # Capital allocation
    maxBuyPrice = 0.90
    
    # Determine trade side
    if priceYes >= 0.65 AND priceYes <= 0.90:
        tradeSide = YES
    elif priceNo >= 0.65 AND priceNo <= 0.90:
        tradeSide = NO
    else:
        return []  # No conviction
    
    # CRITICAL: Prevent side flipping
    if lockedTradeSide AND lockedTradeSide != tradeSide:
        return []  # Market locked to other side
    
    orders = []
    for i, level in enumerate(ladderLevels):
        if level in filledLevels:
            continue  # Already bought at this level
        
        if price >= level AND price <= maxBuyPrice:
            sizeUsdc = maxExposure * weights[i]
            orders.append(BUY(tradeSide, sizeUsdc, price))
    
    return orders
```

## 6. EXIT STRATEGY (SIMPLE)
```python
shouldExit(position, priceYes, priceNo):
    TAKE_PROFIT = 0.90
    STOP_LOSS = 0.65
    
    if position.sharesYes > 0:
        if priceYes > TAKE_PROFIT:
            return {shouldExit: true, reason: "TAKE PROFIT", isProfit: true}
        if priceYes < STOP_LOSS:
            return {shouldExit: true, reason: "STOP LOSS", isProfit: false}
    
    if position.sharesNo > 0:
        if priceNo > TAKE_PROFIT:
            return {shouldExit: true, reason: "TAKE PROFIT", isProfit: true}
        if priceNo < STOP_LOSS:
            return {shouldExit: true, reason: "STOP LOSS", isProfit: false}
    
    return {shouldExit: false}  # Hold

# On exit: SELL 100%, blacklist market (never re-enter)
```

## 7. RISK MANAGER
```python
checkOrder(order):
    # Exit orders always pass
    if order.isExit:
        return APPROVED
    
    # Check position limit (max 50 positions)
    if positionCount >= 50 AND NOT hasPosition(order.marketId):
        return REJECTED("Max positions reached")
    
    # Check market exposure (max 5% of bankroll per market)
    marketExposure = getExposure(order.marketId) + order.sizeUsdc
    if marketExposure > bankroll * 0.05:
        return REJECTED("Max market exposure")
    
    # Check single order size (max 1.25% per order)
    if order.sizeUsdc > bankroll * 0.0125:
        adjustedSize = bankroll * 0.0125
        return APPROVED(adjustedSize)
    
    # Check cash available
    if order.sizeUsdc > cashBalance:
        return REJECTED("Insufficient cash")
    
    return APPROVED
```

## 8. STATE VARIABLES (per market)
```
MarketState:
    marketId           # Unique identifier
    regime             # EARLY_UNCERTAIN | MID_CONSENSUS | LATE_COMPRESSED | HIGH_VOLATILITY
    lastPriceYes       # Current YES price
    lastPriceNo        # Current NO price
    priceHistory       # Rolling 15-min price window
    ladderFilled       # [0.65, 0.70, ...] levels already bought
    activeTradeSide    # YES or NO
    lockedTradeSide    # YES or NO (PERMANENT - never flip)
    exposureYes        # $ invested in YES
    exposureNo         # $ invested in NO
    tailActive         # Has tail insurance position
```

## 9. CAPITAL ALLOCATION
```
Total Bankroll: $5000
Max per market: 5% = $250
Max single order: 1.25% = $62.50
Max positions: 50

Per-market ladder allocation (of $250 max):
  L1 (60%): 10% = $25
  L2 (70%): 15% = $37.50
  L3 (80%): 25% = $62.50
  L4 (90%): 25% = $62.50
  L5 (95%): 25% = $62.50
```
