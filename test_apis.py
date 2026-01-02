#!/usr/bin/env python3
"""
Test Polymarket APIs to discover available data fields before designing database schema.

APIs to test:
1. CLOB API - Trade history for whale address
2. CLOB API - Orderbook/price data
3. Gamma API - Market metadata
"""

import requests
import json
from datetime import datetime

WHALE_ADDRESS = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea"

# API Endpoints
CLOB_HOST = "https://clob.polymarket.com"
GAMMA_HOST = "https://gamma-api.polymarket.com"

def test_clob_trades():
    """Test CLOB API to get whale's trades"""
    print("=" * 80)
    print("1. TESTING CLOB TRADES API")
    print("=" * 80)
    
    url = f"{CLOB_HOST}/trades"
    params = {
        "maker_address": WHALE_ADDRESS,
        "limit": 5
    }
    
    print(f"URL: {url}")
    print(f"Params: {params}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"Response type: {type(data)}")
            if isinstance(data, list) and len(data) > 0:
                print(f"Number of trades: {len(data)}")
                print("\n📊 SAMPLE TRADE FIELDS:")
                print(json.dumps(data[0], indent=2))
            elif isinstance(data, dict):
                print("\n📊 RESPONSE STRUCTURE:")
                print(json.dumps(data, indent=2)[:2000])
        else:
            print(f"Error: {resp.text[:500]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_clob_orderbook():
    """Test CLOB orderbook API for price data"""
    print("\n" + "=" * 80)
    print("2. TESTING CLOB ORDERBOOK API")
    print("=" * 80)
    
    # Use a sample token ID from the whale's trades
    sample_token_id = "21742633143463906290569050155826241533067272736897614950488156847949938836455"
    
    url = f"{CLOB_HOST}/book"
    params = {"token_id": sample_token_id}
    
    print(f"URL: {url}")
    print(f"Params: {params}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print("\n📊 ORDERBOOK FIELDS:")
            print(json.dumps(data, indent=2)[:2000])
        else:
            print(f"Error: {resp.text[:500]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_clob_price():
    """Test CLOB price API"""
    print("\n" + "=" * 80)
    print("3. TESTING CLOB PRICE API")
    print("=" * 80)
    
    sample_token_id = "21742633143463906290569050155826241533067272736897614950488156847949938836455"
    
    url = f"{CLOB_HOST}/price"
    params = {"token_id": sample_token_id, "side": "buy"}
    
    print(f"URL: {url}")
    print(f"Params: {params}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print("\n📊 PRICE RESPONSE:")
            print(json.dumps(data, indent=2))
        else:
            print(f"Error: {resp.text[:500]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_gamma_markets():
    """Test Gamma API for market metadata"""
    print("\n" + "=" * 80)
    print("4. TESTING GAMMA MARKETS API")
    print("=" * 80)
    
    url = f"{GAMMA_HOST}/markets"
    params = {"limit": 2, "active": True}
    
    print(f"URL: {url}")
    print(f"Params: {params}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                print(f"Number of markets: {len(data)}")
                print("\n📊 SAMPLE MARKET FIELDS:")
                print(json.dumps(data[0], indent=2)[:3000])
            else:
                print(json.dumps(data, indent=2)[:2000])
        else:
            print(f"Error: {resp.text[:500]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_gamma_single_market():
    """Test Gamma API for a single market by condition ID"""
    print("\n" + "=" * 80)
    print("5. TESTING GAMMA SINGLE MARKET API")
    print("=" * 80)
    
    # Sample condition ID
    sample_condition = "0x5e5e39d3a2e9a5b9f3b5e5e39d3a2e9a5b9f3b5e"
    
    url = f"{GAMMA_HOST}/markets"
    params = {"limit": 1}
    
    print(f"URL: {url}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                market = data[0]
                print("\n📊 ALL AVAILABLE MARKET FIELDS:")
                for key in sorted(market.keys()):
                    value = market[key]
                    value_preview = str(value)[:100] + "..." if len(str(value)) > 100 else value
                    print(f"  {key}: {value_preview}")
        else:
            print(f"Error: {resp.text[:500]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_activity_endpoint():
    """Test activity endpoint for user trades"""
    print("\n" + "=" * 80)
    print("6. TESTING ACTIVITY/HISTORY ENDPOINT")
    print("=" * 80)
    
    # Try different endpoints
    endpoints = [
        f"{CLOB_HOST}/activity?user={WHALE_ADDRESS}&limit=3",
        f"{CLOB_HOST}/trades?maker_address={WHALE_ADDRESS}&limit=3",
        f"{CLOB_HOST}/data/trades?maker={WHALE_ADDRESS}&limit=3",
    ]
    
    for url in endpoints:
        print(f"\nTrying: {url}")
        try:
            resp = requests.get(url)
            print(f"Status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                print(f"Response: {json.dumps(data, indent=2)[:1500]}")
                break
            else:
                print(f"Error: {resp.text[:200]}")
        except Exception as e:
            print(f"Exception: {e}")

def test_websocket_info():
    """Document WebSocket endpoint info"""
    print("\n" + "=" * 80)
    print("7. WEBSOCKET INFO (Documentation)")
    print("=" * 80)
    
    print("""
    CLOB WebSocket: wss://clob.polymarket.com/ws
    
    Subscribe message format:
    {
        "type": "subscribe",
        "channel": "market",
        "assets_ids": ["<token_id>"]
    }
    
    OR for user trades:
    {
        "type": "subscribe", 
        "channel": "user",
        "user": "<address>"
    }
    
    Expected events:
    - price_change
    - trade
    - order_placed
    - order_cancelled
    """)

if __name__ == "__main__":
    print(f"\n🔍 POLYMARKET API DISCOVERY SCRIPT")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Target Whale: {WHALE_ADDRESS}\n")
    
    test_clob_trades()
    test_clob_orderbook()
    test_clob_price()
    test_gamma_markets()
    test_gamma_single_market()
    test_activity_endpoint()
    test_websocket_info()
    
    print("\n" + "=" * 80)
    print("DISCOVERY COMPLETE")
    print("=" * 80)
