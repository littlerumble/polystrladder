#!/usr/bin/env python3
"""
TEST SCRIPT V2: Validate Token ID to Outcome Mapping

Fixed: Use slug-based lookup since condition_id returns wrong markets.
The whale trade API gives us the slug, which we can use to fetch the correct market.
"""

import requests
import json
from typing import Optional, Tuple

GAMMA_API = "https://gamma-api.polymarket.com"
CLOB_API = "https://clob.polymarket.com"
DATA_API = "https://data-api.polymarket.com"
WHALE_ADDRESS = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea"


def get_market_by_slug(slug: str) -> Optional[dict]:
    """Fetch market data from Gamma API by slug."""
    resp = requests.get(f"{GAMMA_API}/markets", params={"slug": slug})
    if resp.status_code == 200:
        markets = resp.json()
        return markets[0] if markets else None
    return None


def get_clob_market(condition_id: str) -> Optional[dict]:
    """Fetch market data from CLOB API by condition_id."""
    resp = requests.get(f"{CLOB_API}/markets/{condition_id}")
    if resp.status_code == 200:
        return resp.json()
    return None


def get_token_price(token_id: str) -> Optional[float]:
    """Get midpoint price for a token from CLOB."""
    resp = requests.get(f"{CLOB_API}/midpoint", params={"token_id": token_id})
    if resp.status_code == 200:
        data = resp.json()
        return float(data.get('mid', 0))
    return None


def map_token_to_outcome_gamma(market: dict, token_id: str) -> Tuple[str, int]:
    """Map token to outcome using Gamma market data."""
    outcomes = json.loads(market.get('outcomes', '[]'))
    token_ids = json.loads(market.get('clobTokenIds', '[]'))
    
    if token_id in token_ids:
        idx = token_ids.index(token_id)
        return outcomes[idx], idx
    
    return "UNKNOWN", -1


def map_token_to_outcome_clob(market: dict, token_id: str) -> Tuple[str, int]:
    """Map token to outcome using CLOB market data."""
    tokens = market.get('tokens', [])
    
    for i, token in enumerate(tokens):
        if token.get('token_id') == token_id:
            return token.get('outcome', 'UNKNOWN'), i
    
    return "UNKNOWN", -1


def test_mapping_with_slug():
    """Test token mapping using slug-based market lookup."""
    print("=" * 80)
    print("TEST 1: Token Mapping via Slug (Gamma API)")
    print("=" * 80)
    
    resp = requests.get(f"{DATA_API}/trades", params={"user": WHALE_ADDRESS, "limit": 5})
    if resp.status_code != 200:
        print(f"❌ Failed to get trades: {resp.status_code}")
        return False
    
    trades = resp.json()
    print(f"Testing {len(trades)} recent whale trades...\n")
    
    all_passed = True
    
    for i, trade in enumerate(trades, 1):
        slug = trade.get('slug')
        token_id = trade.get('asset')
        expected_outcome = trade.get('outcome')
        expected_index = trade.get('outcomeIndex')
        
        print(f"--- Trade {i} ---")
        print(f"Title: {trade.get('title', 'N/A')[:50]}...")
        print(f"Slug: {slug}")
        print(f"Expected: '{expected_outcome}' (index: {expected_index})")
        
        market = get_market_by_slug(slug)
        if not market:
            print(f"⚠️  Could not fetch market for slug {slug}")
            continue
        
        outcomes = json.loads(market.get('outcomes', '[]'))
        token_ids = json.loads(market.get('clobTokenIds', '[]'))
        
        print(f"Market outcomes: {outcomes}")
        
        mapped_outcome, mapped_index = map_token_to_outcome_gamma(market, token_id)
        
        if mapped_outcome == expected_outcome and mapped_index == expected_index:
            print(f"✅ PASS: '{mapped_outcome}' (index {mapped_index})")
        else:
            print(f"❌ FAIL: Got '{mapped_outcome}' (idx {mapped_index})")
            all_passed = False
        print()
    
    return all_passed


def test_mapping_with_clob():
    """Test token mapping using CLOB market endpoint."""
    print("=" * 80)
    print("TEST 2: Token Mapping via CLOB Market Endpoint")
    print("=" * 80)
    
    resp = requests.get(f"{DATA_API}/trades", params={"user": WHALE_ADDRESS, "limit": 5})
    if resp.status_code != 200:
        return False
    
    trades = resp.json()
    all_passed = True
    
    for i, trade in enumerate(trades, 1):
        condition_id = trade.get('conditionId')
        token_id = trade.get('asset')
        expected_outcome = trade.get('outcome')
        expected_index = trade.get('outcomeIndex')
        
        print(f"--- Trade {i} ---")
        print(f"Title: {trade.get('title', 'N/A')[:50]}...")
        
        market = get_clob_market(condition_id)
        if not market:
            print(f"⚠️  Could not fetch CLOB market")
            continue
        
        tokens = market.get('tokens', [])
        print(f"CLOB tokens: {[(t['outcome'], t['token_id'][:20]+'...') for t in tokens]}")
        
        mapped_outcome, mapped_index = map_token_to_outcome_clob(market, token_id)
        
        if mapped_outcome == expected_outcome:
            print(f"✅ PASS: '{mapped_outcome}'")
        else:
            print(f"❌ FAIL: Got '{mapped_outcome}', expected '{expected_outcome}'")
            all_passed = False
        print()
    
    return all_passed


def test_whale_trade_fields():
    """Document all fields available in whale trade API."""
    print("=" * 80)
    print("TEST 3: Whale Trade API Field Inventory")
    print("=" * 80)
    
    resp = requests.get(f"{DATA_API}/trades", params={"user": WHALE_ADDRESS, "limit": 1})
    if resp.status_code != 200:
        return False
    
    trades = resp.json()
    if not trades:
        return False
    
    trade = trades[0]
    print("\n📋 ALL FIELDS IN WHALE TRADE:")
    for key in sorted(trade.keys()):
        value = trade[key]
        vtype = type(value).__name__
        vstr = str(value)[:60] + "..." if len(str(value)) > 60 else value
        print(f"  {key}: ({vtype}) = {vstr}")
    
    print("\n✅ Fields we can use directly from trade API:")
    print("  - asset: token ID (for price lookup)")
    print("  - outcome: the outcome name")
    print("  - outcomeIndex: the outcome index")
    print("  - slug: for fetching full market data")
    print("  - conditionId: for CLOB market lookup")
    print("  - side, price, size, timestamp: trade details")
    
    return True


if __name__ == "__main__":
    print("\n🧪 TOKEN ID MAPPING VALIDATION SUITE V2\n")
    
    tests = [
        ("Mapping via Slug (Gamma)", test_mapping_with_slug),
        ("Mapping via CLOB Market", test_mapping_with_clob),
        ("Trade API Field Inventory", test_whale_trade_fields),
    ]
    
    results = []
    for name, test_fn in tests:
        try:
            passed = test_fn()
            results.append((name, passed))
        except Exception as e:
            print(f"❌ {name} crashed: {e}")
            import traceback
            traceback.print_exc()
            results.append((name, False))
    
    print("\n" + "=" * 80)
    print("SUMMARY")
    print("=" * 80)
    for name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {status}: {name}")
    
    print("\n📌 KEY INSIGHT:")
    print("  The whale trade API already gives us 'outcome' and 'outcomeIndex'!")
    print("  We DON'T need to map token IDs ourselves - just use the trade data.")
