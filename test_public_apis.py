#!/usr/bin/env python3
"""
Test public data APIs for Polymarket that don't require authentication.
"""

import requests
import json
from datetime import datetime

WHALE_ADDRESS = "0x2005d16a84ceefa912d4e380cd32e7ff827875ea"

def test_strapi_activity():
    """Test the Strapi-based activity API (public)"""
    print("=" * 80)
    print("1. TESTING STRAPI ACTIVITY API (Public)")
    print("=" * 80)
    
    # This is the public activity API used by Polymarket frontend
    url = f"https://data-api.polymarket.com/activity"
    params = {
        "user": WHALE_ADDRESS,
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
                print(f"Number of activities: {len(data)}")
                print("\n📊 SAMPLE ACTIVITY FIELDS:")
                print(json.dumps(data[0], indent=2))
            else:
                print(json.dumps(data, indent=2)[:2000])
        else:
            print(f"Error: {resp.text[:500]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_profile_api():
    """Test profile/positions API"""
    print("\n" + "=" * 80)
    print("2. TESTING PROFILE/POSITIONS API")
    print("=" * 80)
    
    url = f"https://data-api.polymarket.com/positions"
    params = {"user": WHALE_ADDRESS}
    
    print(f"URL: {url}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                print(f"Number of positions: {len(data)}")
                print("\n📊 SAMPLE POSITION:")
                print(json.dumps(data[0], indent=2))
            else:
                print(f"Response: {data}")
        else:
            print(f"Error: {resp.text[:300]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_trades_api():
    """Test trades history API"""
    print("\n" + "=" * 80)
    print("3. TESTING TRADES HISTORY API")
    print("=" * 80)
    
    url = f"https://data-api.polymarket.com/trades"
    params = {"user": WHALE_ADDRESS, "limit": 5}
    
    print(f"URL: {url}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                print(f"Number of trades: {len(data)}")
                print("\n📊 SAMPLE TRADE FIELDS:")
                print(json.dumps(data[0], indent=2))
                print("\n📋 ALL FIELDS IN TRADE:")
                for key in sorted(data[0].keys()):
                    value = data[0][key]
                    print(f"  {key}: {type(value).__name__} = {str(value)[:80]}")
            else:
                print(f"Response: {data}")
        else:
            print(f"Error: {resp.text[:300]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_prices_api():
    """Test prices API for live markets"""
    print("\n" + "=" * 80)
    print("4. TESTING PRICES API (Live Markets)")
    print("=" * 80)
    
    url = f"https://gamma-api.polymarket.com/markets"
    params = {"active": True, "closed": False, "limit": 3}
    
    print(f"URL: {url}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list) and len(data) > 0:
                print(f"\n📊 LIVE MARKET PRICE DATA:")
                for market in data[:3]:
                    print(f"\n  Market: {market.get('question', 'N/A')[:60]}...")
                    print(f"  conditionId: {market.get('conditionId')}")
                    print(f"  clobTokenIds: {market.get('clobTokenIds')}")
                    print(f"  outcomes: {market.get('outcomes')}")
                    print(f"  outcomePrices: {market.get('outcomePrices')}")
                    print(f"  endDate: {market.get('endDate')}")
                    print(f"  active: {market.get('active')}, closed: {market.get('closed')}")
        else:
            print(f"Error: {resp.text[:300]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_clob_markets_public():
    """Test CLOB public markets endpoint"""
    print("\n" + "=" * 80)
    print("5. TESTING CLOB PUBLIC MARKETS")
    print("=" * 80)
    
    url = "https://clob.polymarket.com/markets"
    params = {"limit": 2}
    
    print(f"URL: {url}")
    
    try:
        resp = requests.get(url, params=params)
        print(f"Status: {resp.status_code}")
        
        if resp.status_code == 200:
            data = resp.json()
            print(f"Response type: {type(data)}")
            if isinstance(data, dict) and 'data' in data:
                markets = data.get('data', [])
                if markets:
                    print(f"\n📊 CLOB MARKET STRUCTURE:")
                    print(json.dumps(markets[0] if markets else data, indent=2)[:2000])
            else:
                print(json.dumps(data, indent=2)[:2000])
        else:
            print(f"Error: {resp.text[:300]}")
    except Exception as e:
        print(f"Exception: {e}")

def test_clob_midpoint():
    """Test getting midpoint price from CLOB"""
    print("\n" + "=" * 80)
    print("6. TESTING CLOB MIDPOINT/SPREAD")
    print("=" * 80)
    
    # First get a valid token ID from Gamma
    gamma_url = "https://gamma-api.polymarket.com/markets"
    params = {"active": True, "closed": False, "limit": 1}
    
    try:
        resp = requests.get(gamma_url, params=params)
        if resp.status_code == 200:
            markets = resp.json()
            if markets and len(markets) > 0:
                token_ids = json.loads(markets[0].get('clobTokenIds', '[]'))
                if token_ids:
                    token_id = token_ids[0]
                    print(f"Using token_id: {token_id}")
                    
                    # Try price endpoint
                    price_url = f"https://clob.polymarket.com/midpoint"
                    price_params = {"token_id": token_id}
                    
                    price_resp = requests.get(price_url, params=price_params)
                    print(f"\nMidpoint Status: {price_resp.status_code}")
                    if price_resp.status_code == 200:
                        print(f"Midpoint: {price_resp.json()}")
                    
                    # Try book endpoint
                    book_url = f"https://clob.polymarket.com/book"
                    book_resp = requests.get(book_url, params=price_params)
                    print(f"\nBook Status: {book_resp.status_code}")
                    if book_resp.status_code == 200:
                        book_data = book_resp.json()
                        print(f"Book: {json.dumps(book_data, indent=2)[:1000]}")
                    else:
                        print(f"Book Error: {book_resp.text[:200]}")
    except Exception as e:
        print(f"Exception: {e}")

if __name__ == "__main__":
    print(f"\n🔍 POLYMARKET PUBLIC API DISCOVERY")
    print(f"Timestamp: {datetime.now().isoformat()}")
    print(f"Target Whale: {WHALE_ADDRESS}\n")
    
    test_strapi_activity()
    test_profile_api()
    test_trades_api()
    test_prices_api()
    test_clob_markets_public()
    test_clob_midpoint()
    
    print("\n" + "=" * 80)
    print("DISCOVERY COMPLETE")
    print("=" * 80)
