#!/usr/bin/env python3
"""
TEST: Discover what fields indicate a game is LIVE vs pre-game.

We need to:
1. Check Gamma API for live game indicators
2. Check CLOB API for game start time
3. Compare whale trades to find patterns
"""

import requests
import json
from datetime import datetime, timezone

GAMMA_API = "https://gamma-api.polymarket.com"
CLOB_API = "https://clob.polymarket.com"
DATA_API = "https://data-api.polymarket.com"
WHALE_ADDRESS = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea"


def test_gamma_market_fields():
    """Check Gamma API for fields that indicate live status."""
    print("=" * 80)
    print("TEST 1: Gamma API - Market Fields for Live Detection")
    print("=" * 80)
    
    # Get some sports markets
    resp = requests.get(f"{GAMMA_API}/markets", params={
        "active": True,
        "closed": False,
        "limit": 5,
    })
    
    if resp.status_code != 200:
        print(f"Error: {resp.status_code}")
        return
    
    markets = resp.json()
    
    # Look for time-related fields
    time_fields = ['endDate', 'startDate', 'gameStartTime', 'startTime', 'liveStartTime']
    
    for market in markets:
        print(f"\nMarket: {market.get('question', 'N/A')[:50]}...")
        print(f"  Slug: {market.get('slug')}")
        
        for field in time_fields:
            if field in market:
                print(f"  {field}: {market.get(field)}")
        
        # Check for any field containing 'live' or 'start'
        for key, value in market.items():
            key_lower = key.lower()
            if 'live' in key_lower or 'start' in key_lower or 'time' in key_lower:
                if key not in time_fields:
                    print(f"  {key}: {value}")


def test_clob_market_fields():
    """Check CLOB API for game start time."""
    print("\n" + "=" * 80)
    print("TEST 2: CLOB API - Market Fields for Live Detection")
    print("=" * 80)
    
    # Get a whale trade to get a condition ID
    resp = requests.get(f"{DATA_API}/trades", params={
        "user": WHALE_ADDRESS,
        "limit": 3,
    })
    
    if resp.status_code != 200:
        return
    
    trades = resp.json()
    
    for trade in trades:
        condition_id = trade.get('conditionId')
        title = trade.get('title', 'N/A')
        
        print(f"\nTrade: {title[:50]}...")
        print(f"  Condition ID: {condition_id}")
        
        # Fetch CLOB market
        clob_resp = requests.get(f"{CLOB_API}/markets/{condition_id}")
        
        if clob_resp.status_code == 200:
            market = clob_resp.json()
            
            # Print all time-related fields
            time_fields = ['end_date_iso', 'game_start_time', 'seconds_delay', 'accepting_orders']
            for field in time_fields:
                if field in market:
                    print(f"  {field}: {market.get(field)}")
            
            # Check game_start_time vs now
            game_start = market.get('game_start_time')
            if game_start:
                try:
                    start_dt = datetime.fromisoformat(game_start.replace('Z', '+00:00'))
                    now = datetime.now(timezone.utc)
                    
                    if start_dt > now:
                        diff = (start_dt - now).total_seconds() / 60
                        print(f"  STATUS: PRE-GAME (starts in {diff:.0f} minutes)")
                    else:
                        diff = (now - start_dt).total_seconds() / 60
                        print(f"  STATUS: LIVE (started {diff:.0f} minutes ago)")
                except Exception as e:
                    print(f"  Parse error: {e}")
        else:
            print(f"  CLOB fetch failed: {clob_resp.status_code}")


def test_event_slug_pattern():
    """Check if event slug contains date pattern we can use."""
    print("\n" + "=" * 80)
    print("TEST 3: Event Slug Date Patterns")
    print("=" * 80)
    
    resp = requests.get(f"{DATA_API}/trades", params={
        "user": WHALE_ADDRESS,
        "limit": 10,
    })
    
    if resp.status_code != 200:
        return
    
    trades = resp.json()
    
    for trade in trades:
        slug = trade.get('slug', '')
        event_slug = trade.get('eventSlug', '')
        title = trade.get('title', 'N/A')
        
        print(f"\n{title[:40]}...")
        print(f"  slug: {slug}")
        print(f"  eventSlug: {event_slug}")
        
        # Check for date in slug (e.g., 2026-01-02)
        import re
        date_match = re.search(r'(\d{4}-\d{2}-\d{2})', event_slug)
        if date_match:
            print(f"  Extracted date: {date_match.group(1)}")


def summarize_findings():
    """Summarize what we found."""
    print("\n" + "=" * 80)
    print("SUMMARY: How to Detect Live Games")
    print("=" * 80)
    
    print("""
    KEY FIELDS FOUND:
    
    1. CLOB API has 'game_start_time' (ISO timestamp)
       - Compare to current time
       - If game_start_time < now → LIVE
       - If game_start_time > now → PRE-GAME
       
    2. Event slug contains game date (e.g., 'sea-cag-mil-2026-01-02')
       - Can extract date from slug
       
    3. 'seconds_delay' in CLOB indicates live betting delay
       - Usually 3 seconds for live sports
       
    RECOMMENDED APPROACH:
    - Fetch CLOB market by condition_id
    - Check game_start_time:
        - If past: game is LIVE ✅
        - If future: game is PRE-GAME (skip)
    - Also check if market is still accepting_orders
    """)


if __name__ == "__main__":
    print("\n🔍 LIVE GAME DETECTION TEST\n")
    print(f"Current time: {datetime.now(timezone.utc).isoformat()}\n")
    
    test_gamma_market_fields()
    test_clob_market_fields()
    test_event_slug_pattern()
    summarize_findings()
