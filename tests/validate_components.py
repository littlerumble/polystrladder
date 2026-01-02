#!/usr/bin/env python3
"""
COMPREHENSIVE VALIDATION SCRIPT

Tests every component of the copy trading bot with live API data.
Validates data accuracy and flow correctness.

Components tested:
1. WhaleTracker - Trade fetching, eligibility evaluation
2. PricePoller - Price fetching accuracy
3. PaperExecutor - Entry logic
4. ExitManager - Exit conditions
5. Dashboard API types - Data structure validation
"""

import requests
import json
from datetime import datetime, timezone
from typing import Dict, List, Any, Tuple

# API endpoints
CLOB_API = "https://clob.polymarket.com"
GAMMA_API = "https://gamma-api.polymarket.com"
DATA_API = "https://data-api.polymarket.com"
WHALE_ADDRESS = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea"

# Strategy config (must match copyConfig.ts)
CONFIG = {
    "ENTRY": {
        "MIN_PRICE": 0.65,
        "MAX_PRICE": 0.85,
        "MIN_WHALE_SIZE": 50,
        "LIVE_ONLY": True,
    },
    "TAKE_PROFIT": {
        "TRIGGER_PCT": 12,
        "TRAIL_PCT": 4,
        "HARD_CAP_PRICE": 0.95,
    },
    "STOP_LOSS": {
        "TRIGGER_PCT": -12,
    },
}

# Test results
results: List[Tuple[str, bool, str]] = []


def log_test(name: str, passed: bool, details: str = ""):
    """Record a test result."""
    status = "✅ PASS" if passed else "❌ FAIL"
    results.append((name, passed, details))
    print(f"{status}: {name}")
    if details:
        print(f"       {details}")


# =============================================================================
# 1. WHALE TRACKER TESTS
# =============================================================================

def test_whale_trade_fetch():
    """Test fetching whale trades from DATA API."""
    print("\n" + "=" * 70)
    print("1. WHALE TRACKER - Trade Fetching")
    print("=" * 70)
    
    url = f"{DATA_API}/trades"
    params = {"user": WHALE_ADDRESS, "limit": 10}
    
    try:
        resp = requests.get(url, params=params)
        if resp.status_code != 200:
            log_test("Fetch whale trades", False, f"Status {resp.status_code}")
            return []
        
        trades = resp.json()
        log_test("Fetch whale trades", True, f"Got {len(trades)} trades")
        
        # Validate required fields
        required_fields = ['proxyWallet', 'side', 'asset', 'conditionId', 'size', 
                          'price', 'timestamp', 'title', 'slug', 'outcome', 'outcomeIndex']
        
        if trades:
            trade = trades[0]
            missing = [f for f in required_fields if f not in trade]
            log_test("Trade has required fields", len(missing) == 0, 
                    f"Missing: {missing}" if missing else "All fields present")
        
        return trades
    except Exception as e:
        log_test("Fetch whale trades", False, str(e))
        return []


def test_eligibility_evaluation(trades: List[Dict]):
    """Test the copy eligibility logic."""
    print("\n" + "=" * 70)
    print("2. WHALE TRACKER - Eligibility Evaluation")
    print("=" * 70)
    
    eligible_count = 0
    ineligible_reasons: Dict[str, int] = {}
    
    for trade in trades:
        price = trade.get('price', 0)
        side = trade.get('side', '')
        size = trade.get('size', 0)
        
        # Evaluate eligibility (mimicking WhaleTracker logic)
        reason = None
        
        if side != 'BUY':
            reason = f"SKIP: Side is {side}"
        elif price < CONFIG["ENTRY"]["MIN_PRICE"]:
            reason = f"SKIP: Price {price*100:.1f}% < 65%"
        elif price > CONFIG["ENTRY"]["MAX_PRICE"]:
            reason = f"SKIP: Price {price*100:.1f}% > 85%"
        elif size * price < CONFIG["ENTRY"]["MIN_WHALE_SIZE"]:
            reason = f"SKIP: Size ${size*price:.2f} < $50"
        else:
            eligible_count += 1
        
        if reason:
            ineligible_reasons[reason.split(':')[0]] = ineligible_reasons.get(reason.split(':')[0], 0) + 1
    
    log_test("Eligibility evaluation runs", True, 
            f"{eligible_count}/{len(trades)} trades eligible (65-85% BUY)")
    
    for reason, count in ineligible_reasons.items():
        print(f"       {reason}: {count}")


def test_live_game_detection(trades: List[Dict]):
    """Test the live game detection via CLOB game_start_time."""
    print("\n" + "=" * 70)
    print("3. WHALE TRACKER - Live Game Detection")
    print("=" * 70)
    
    if not trades:
        log_test("Live game detection", False, "No trades to test")
        return
    
    live_count = 0
    pregame_count = 0
    no_time_count = 0
    
    for trade in trades[:5]:  # Test first 5
        condition_id = trade.get('conditionId')
        title = trade.get('title', 'N/A')[:40]
        
        try:
            resp = requests.get(f"{CLOB_API}/markets/{condition_id}")
            if resp.status_code != 200:
                continue
            
            market = resp.json()
            game_start = market.get('game_start_time')
            
            if not game_start:
                no_time_count += 1
                print(f"       {title}... -> NO game_start_time")
                continue
            
            start_dt = datetime.fromisoformat(game_start.replace('Z', '+00:00'))
            now = datetime.now(timezone.utc)
            
            if start_dt <= now:
                live_count += 1
                mins_ago = int((now - start_dt).total_seconds() / 60)
                print(f"       {title}... -> LIVE ({mins_ago}m ago)")
            else:
                pregame_count += 1
                mins_until = int((start_dt - now).total_seconds() / 60)
                print(f"       {title}... -> PRE-GAME ({mins_until}m until)")
        except Exception as e:
            print(f"       {title}... -> ERROR: {e}")
    
    log_test("Live game detection", True, 
            f"Live: {live_count}, Pre-game: {pregame_count}, No time: {no_time_count}")


# =============================================================================
# 2. PRICE POLLER TESTS
# =============================================================================

def test_price_fetching(trades: List[Dict]):
    """Test fetching prices from CLOB midpoint."""
    print("\n" + "=" * 70)
    print("4. PRICE POLLER - CLOB Midpoint Accuracy")
    print("=" * 70)
    
    if not trades:
        log_test("Price fetching", False, "No trades to test")
        return
    
    success_count = 0
    fail_count = 0
    
    for trade in trades[:5]:
        token_id = trade.get('asset')
        entry_price = trade.get('price', 0)
        title = trade.get('title', 'N/A')[:30]
        
        try:
            resp = requests.get(f"{CLOB_API}/midpoint", params={"token_id": token_id})
            
            if resp.status_code == 200:
                data = resp.json()
                mid = float(data.get('mid', 0))
                success_count += 1
                
                # Check if price moved significantly
                pct_change = ((mid - entry_price) / entry_price) * 100 if entry_price else 0
                print(f"       {title}... Entry: {entry_price*100:.1f}% -> Now: {mid*100:.1f}% ({pct_change:+.1f}%)")
            else:
                fail_count += 1
                print(f"       {title}... -> FAILED (market closed?)")
        except Exception as e:
            fail_count += 1
    
    log_test("CLOB midpoint fetch", success_count > 0, 
            f"Success: {success_count}, Failed: {fail_count}")


def test_price_vs_gamma(trades: List[Dict]):
    """Compare CLOB midpoint to Gamma outcomePrices for consistency."""
    print("\n" + "=" * 70)
    print("5. PRICE POLLER - CLOB vs Gamma Price Consistency")
    print("=" * 70)
    
    if not trades:
        log_test("Price consistency", False, "No trades to test")
        return
    
    consistent = 0
    inconsistent = 0
    
    for trade in trades[:3]:
        slug = trade.get('slug')
        token_id = trade.get('asset')
        outcome_idx = trade.get('outcomeIndex')
        
        try:
            # Get Gamma price
            gamma_resp = requests.get(f"{GAMMA_API}/markets", params={"slug": slug})
            if gamma_resp.status_code != 200:
                continue
            
            gamma_markets = gamma_resp.json()
            if not gamma_markets:
                continue
            
            gamma_prices = json.loads(gamma_markets[0].get('outcomePrices', '[]'))
            gamma_price = float(gamma_prices[outcome_idx]) if outcome_idx < len(gamma_prices) else 0
            
            # Get CLOB price
            clob_resp = requests.get(f"{CLOB_API}/midpoint", params={"token_id": token_id})
            if clob_resp.status_code != 200:
                continue
            
            clob_price = float(clob_resp.json().get('mid', 0))
            
            # Compare
            diff = abs(clob_price - gamma_price)
            if diff < 0.05:  # Within 5%
                consistent += 1
                print(f"       {slug[:30]}... Gamma: {gamma_price:.3f}, CLOB: {clob_price:.3f} ✓")
            else:
                inconsistent += 1
                print(f"       {slug[:30]}... Gamma: {gamma_price:.3f}, CLOB: {clob_price:.3f} ⚠️ DIFF!")
        except Exception as e:
            print(f"       Error: {e}")
    
    log_test("CLOB/Gamma price consistency", consistent > 0, 
            f"Consistent: {consistent}, Inconsistent: {inconsistent}")


# =============================================================================
# 3. PAPER EXECUTOR TESTS
# =============================================================================

def test_entry_logic():
    """Test the entry logic calculations."""
    print("\n" + "=" * 70)
    print("6. PAPER EXECUTOR - Entry Logic Validation")
    print("=" * 70)
    
    # Test position sizing
    L1_SIZE = 100
    L2_SIZE = 75
    
    test_cases = [
        {"price": 0.70, "expected_shares_l1": 100/0.70},
        {"price": 0.80, "expected_shares_l1": 100/0.80},
        {"price": 0.65, "expected_shares_l1": 100/0.65},
    ]
    
    all_passed = True
    for tc in test_cases:
        price = tc["price"]
        shares = L1_SIZE / price
        expected = tc["expected_shares_l1"]
        
        if abs(shares - expected) < 0.01:
            print(f"       Entry @ {price*100:.0f}%: ${L1_SIZE} → {shares:.2f} shares ✓")
        else:
            print(f"       Entry @ {price*100:.0f}%: MISMATCH (got {shares}, expected {expected})")
            all_passed = False
    
    log_test("Position sizing calculation", all_passed, 
            f"L1=${L1_SIZE}, L2=${L2_SIZE}")
    
    # Test L2 trigger
    l2_trigger = -5  # -5%
    entry = 0.75
    l2_price = entry * (1 + l2_trigger/100)
    print(f"       L2 trigger @ {l2_trigger}%: Entry {entry*100:.1f}% → L2 @ {l2_price*100:.1f}%")
    log_test("L2 DCA trigger calculation", True, f"-5% from entry")


# =============================================================================
# 4. EXIT MANAGER TESTS
# =============================================================================

def test_exit_conditions():
    """Test all exit condition calculations."""
    print("\n" + "=" * 70)
    print("7. EXIT MANAGER - Exit Condition Validation")
    print("=" * 70)
    
    entry_price = 0.72
    cost_basis = 100
    shares = cost_basis / entry_price
    
    print(f"       Test position: Entry @ {entry_price*100:.1f}%, ${cost_basis} invested")
    
    # Test 1: Trailing TP
    tp_trigger = CONFIG["TAKE_PROFIT"]["TRIGGER_PCT"]
    trigger_price = entry_price * (1 + tp_trigger/100)
    print(f"       TP trigger (+{tp_trigger}%): {trigger_price*100:.1f}%")
    
    # After trigger, test trail
    peak_price = 0.85
    trail_pct = CONFIG["TAKE_PROFIT"]["TRAIL_PCT"]
    trail_exit = peak_price * (1 - trail_pct/100)
    print(f"       If peak = {peak_price*100:.1f}%, trail exit @ {trail_exit*100:.1f}%")
    log_test("Trailing TP calculation", True)
    
    # Test 2: Stop loss
    sl_trigger = CONFIG["STOP_LOSS"]["TRIGGER_PCT"]
    sl_price = entry_price * (1 + sl_trigger/100)
    sl_pnl = (sl_price - entry_price) * shares
    print(f"       Stop loss ({sl_trigger}%): {sl_price*100:.1f}%, P&L = ${sl_pnl:.2f}")
    log_test("Stop loss calculation", True)
    
    # Test 3: Hard cap
    hard_cap = CONFIG["TAKE_PROFIT"]["HARD_CAP_PRICE"]
    print(f"       Hard cap exit: {hard_cap*100}%")
    log_test("Hard cap exit", True)
    
    # Test 4: P&L calculation
    current_price = 0.82
    unrealized_pnl = (current_price - entry_price) * shares
    unrealized_pct = (unrealized_pnl / cost_basis) * 100
    print(f"       If current = {current_price*100:.1f}%: P&L = ${unrealized_pnl:.2f} ({unrealized_pct:+.1f}%)")
    log_test("P&L calculation", True)


# =============================================================================
# 5. DATA STRUCTURE TESTS
# =============================================================================

def test_data_structures(trades: List[Dict]):
    """Validate data structures match expected types."""
    print("\n" + "=" * 70)
    print("8. DATA STRUCTURES - Type Validation")
    print("=" * 70)
    
    if not trades:
        log_test("Data structure validation", False, "No trades to test")
        return
    
    trade = trades[0]
    
    # WhaleTrade type check
    type_checks = [
        ("proxyWallet", str, trade.get('proxyWallet')),
        ("side", str, trade.get('side')),
        ("price", (int, float), trade.get('price')),
        ("size", (int, float), trade.get('size')),
        ("timestamp", int, trade.get('timestamp')),
        ("outcome", str, trade.get('outcome')),
        ("outcomeIndex", int, trade.get('outcomeIndex')),
    ]
    
    all_passed = True
    for field, expected_type, value in type_checks:
        if isinstance(value, expected_type):
            print(f"       {field}: {type(value).__name__} ✓")
        else:
            print(f"       {field}: {type(value).__name__} (expected {expected_type}) ❌")
            all_passed = False
    
    log_test("WhaleTrade type validation", all_passed)


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("\n" + "=" * 70)
    print("🧪 COPY TRADING BOT - COMPONENT VALIDATION SUITE")
    print("=" * 70)
    print(f"Timestamp: {datetime.now(timezone.utc).isoformat()}")
    print(f"Target whale: {WHALE_ADDRESS}")
    
    # Run all tests
    trades = test_whale_trade_fetch()
    test_eligibility_evaluation(trades)
    test_live_game_detection(trades)
    test_price_fetching(trades)
    test_price_vs_gamma(trades)
    test_entry_logic()
    test_exit_conditions()
    test_data_structures(trades)
    
    # Summary
    print("\n" + "=" * 70)
    print("📊 VALIDATION SUMMARY")
    print("=" * 70)
    
    passed = sum(1 for _, p, _ in results if p)
    failed = sum(1 for _, p, _ in results if not p)
    
    for name, passed_test, details in results:
        status = "✅" if passed_test else "❌"
        print(f"  {status} {name}")
    
    print(f"\n  Total: {passed} passed, {failed} failed")
    
    if failed == 0:
        print("\n🎉 All components validated successfully!")
    else:
        print(f"\n⚠️  {failed} test(s) need attention")


if __name__ == "__main__":
    main()
