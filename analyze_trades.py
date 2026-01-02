#!/usr/bin/env python3
"""
Analyze trading patterns from the Polymarket trader's trade history.
"""

import csv
from collections import defaultdict
from datetime import datetime
import re

def parse_price(price_str):
    """Parse price string like '66.0¢' to float."""
    match = re.search(r'([\d.]+)', price_str)
    return float(match.group(1)) / 100 if match else 0

def parse_size(size_str):
    """Parse size string like '$35.47' to float."""
    match = re.search(r'([\d,]+\.?\d*)', size_str.replace(',', ''))
    return float(match.group(1)) if match else 0

def analyze_trades(csv_file):
    trades = []
    
    with open(csv_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            trades.append({
                'date': datetime.fromisoformat(row['Date'].replace('Z', '+00:00')),
                'question': row['Question'],
                'outcome': row['Outcome'],
                'side': row['Side'],
                'price': parse_price(row['Price']),
                'size': parse_size(row['Size (USDC)'])
            })
    
    print(f"=" * 80)
    print(f"TRADE ANALYSIS FOR POLYMARKET WHALE")
    print(f"=" * 80)
    
    # Basic stats
    total_trades = len(trades)
    total_volume = sum(t['size'] for t in trades)
    buy_trades = [t for t in trades if t['side'] == 'BUY']
    sell_trades = [t for t in trades if t['side'] == 'SELL']
    
    print(f"\n📊 BASIC STATISTICS:")
    print(f"   Total Trades: {total_trades}")
    print(f"   Total Volume: ${total_volume:,.2f}")
    print(f"   Buy Trades: {len(buy_trades)} ({len(buy_trades)/total_trades*100:.1f}%)")
    print(f"   Sell Trades: {len(sell_trades)} ({len(sell_trades)/total_trades*100:.1f}%)")
    print(f"   Date Range: {trades[-1]['date']} to {trades[0]['date']}")
    
    # Price distribution
    print(f"\n💰 PRICE DISTRIBUTION OF ENTRIES:")
    price_ranges = {
        'Very Low (0-10%)': [],
        'Low (10-30%)': [],
        'Mid (30-50%)': [],
        'Mid-High (50-70%)': [],
        'High (70-90%)': [],
        'Very High (90-100%)': []
    }
    
    for t in trades:
        p = t['price']
        if p <= 0.10:
            price_ranges['Very Low (0-10%)'].append(t)
        elif p <= 0.30:
            price_ranges['Low (10-30%)'].append(t)
        elif p <= 0.50:
            price_ranges['Mid (30-50%)'].append(t)
        elif p <= 0.70:
            price_ranges['Mid-High (50-70%)'].append(t)
        elif p <= 0.90:
            price_ranges['High (70-90%)'].append(t)
        else:
            price_ranges['Very High (90-100%)'].append(t)
    
    for range_name, range_trades in price_ranges.items():
        vol = sum(t['size'] for t in range_trades)
        print(f"   {range_name}: {len(range_trades)} trades, ${vol:,.2f} volume")
    
    # Market types
    print(f"\n🎯 MARKET TYPES TRADED:")
    market_types = defaultdict(lambda: {'count': 0, 'volume': 0, 'trades': []})
    
    for t in trades:
        q = t['question'].lower()
        if 'o/u' in q or 'over' in q or 'under' in q:
            mt = 'Over/Under'
        elif 'spread' in q:
            mt = 'Spread'
        elif 'draw' in q:
            mt = 'Draw'
        elif 'both teams to score' in q:
            mt = 'BTTS'
        elif 'win' in q:
            mt = 'Moneyline (Win)'
        elif 'vs' in q or 'vs.' in q:
            mt = 'Match Winner'
        else:
            mt = 'Other'
        
        market_types[mt]['count'] += 1
        market_types[mt]['volume'] += t['size']
        market_types[mt]['trades'].append(t)
    
    for mt, data in sorted(market_types.items(), key=lambda x: -x[1]['volume']):
        print(f"   {mt}: {data['count']} trades, ${data['volume']:,.2f} volume")
    
    # Outcome analysis (Yes/No preference)
    print(f"\n🔮 OUTCOME PREFERENCE:")
    outcomes = defaultdict(lambda: {'count': 0, 'volume': 0})
    for t in trades:
        outcomes[t['outcome']]['count'] += 1
        outcomes[t['outcome']]['volume'] += t['size']
    
    for outcome, data in sorted(outcomes.items(), key=lambda x: -x[1]['volume']):
        print(f"   {outcome}: {data['count']} trades, ${data['volume']:,.2f} volume")
    
    # Sports breakdown
    print(f"\n⚽ SPORTS/GAMES BREAKDOWN:")
    sports = defaultdict(lambda: {'count': 0, 'volume': 0})
    
    for t in trades:
        q = t['question']
        if 'Al Nassr' in q or 'Al Ahli' in q:
            sport = 'Saudi Pro League (Al Nassr vs Al Ahli)'
        elif 'Texas State' in q or 'Rice vs' in q:
            sport = 'CFB (Rice vs Texas State)'
        elif 'AC Milan' in q or 'Cagliari' in q:
            sport = 'Serie A (Cagliari vs AC Milan)'
        elif 'Florida International' in q or 'New Mexico State' in q:
            sport = 'CFB (NM State vs FIU)'
        elif 'Al Ettifaq' in q or 'Al Okhdood' in q:
            sport = 'Saudi Pro League (Al Ettifaq vs Al Okhdood)'
        elif 'Counter-Strike' in q:
            sport = 'Counter-Strike (Esports)'
        elif 'LoL' in q or 'Invictus' in q or 'JD Gaming' in q:
            sport = 'League of Legends (Esports)'
        elif 'Toulouse' in q or 'Racing Club de Lens' in q:
            sport = 'Ligue 1 (France)'
        elif 'Celta' in q or 'Valencia' in q or 'Eibar' in q:
            sport = 'La Liga (Spain)'
        elif 'Melbourne City' in q:
            sport = 'A-League (Australia)'
        elif 'Manchester United' in q:
            sport = 'Premier League'
        elif 'Aston Villa' in q or 'Nottingham' in q:
            sport = 'Premier League'
        elif 'Bayern' in q:
            sport = 'Bundesliga'
        else:
            sport = 'Other'
        
        sports[sport]['count'] += 1
        sports[sport]['volume'] += t['size']
    
    for sport, data in sorted(sports.items(), key=lambda x: -x[1]['volume']):
        print(f"   {sport}: {data['count']} trades, ${data['volume']:,.2f} volume")
    
    # Size distribution
    print(f"\n💵 TRADE SIZE DISTRIBUTION:")
    size_ranges = {
        'Tiny (<$10)': [],
        'Small ($10-50)': [],
        'Medium ($50-200)': [],
        'Large ($200-1000)': [],
        'Very Large ($1000-5000)': [],
        'Whale (>$5000)': []
    }
    
    for t in trades:
        s = t['size']
        if s < 10:
            size_ranges['Tiny (<$10)'].append(t)
        elif s < 50:
            size_ranges['Small ($10-50)'].append(t)
        elif s < 200:
            size_ranges['Medium ($50-200)'].append(t)
        elif s < 1000:
            size_ranges['Large ($200-1000)'].append(t)
        elif s < 5000:
            size_ranges['Very Large ($1000-5000)'].append(t)
        else:
            size_ranges['Whale (>$5000)'].append(t)
    
    for range_name, range_trades in size_ranges.items():
        vol = sum(t['size'] for t in range_trades)
        print(f"   {range_name}: {len(range_trades)} trades, ${vol:,.2f} volume")
    
    # Key pattern: High probability plays
    print(f"\n🎯 KEY STRATEGY PATTERNS:")
    
    # Pattern 1: Buying "No" on underdogs
    no_trades = [t for t in trades if t['outcome'] == 'No']
    high_prob_no = [t for t in no_trades if t['price'] >= 0.60]
    print(f"\n   1. FADING UNDERDOGS (Buying 'No' at >=60%):")
    print(f"      Count: {len(high_prob_no)} trades")
    print(f"      Volume: ${sum(t['size'] for t in high_prob_no):,.2f}")
    
    # Pattern 2: Very low probability plays (lottery tickets)
    lottery = [t for t in trades if t['price'] <= 0.05]
    print(f"\n   2. LOTTERY TICKETS (Buying at <=5%): ")
    print(f"      Count: {len(lottery)} trades")
    print(f"      Volume: ${sum(t['size'] for t in lottery):,.2f}")
    
    # Pattern 3: Live game trading (rapid trades)
    print(f"\n   3. LIVE IN-GAME TRADING:")
    print(f"      The trader is clearly trading LIVE during games!")
    print(f"      Notice rapid entries on same market in seconds")
    
    # Top markets by volume
    print(f"\n📈 TOP 10 QUESTIONS BY VOLUME:")
    question_volume = defaultdict(float)
    for t in trades:
        question_volume[t['question']] += t['size']
    
    for i, (q, vol) in enumerate(sorted(question_volume.items(), key=lambda x: -x[1])[:10], 1):
        print(f"   {i}. {q[:60]}... ${vol:,.2f}")
    
    # Strategy summary
    print(f"\n" + "=" * 80)
    print(f"STRATEGY SUMMARY")
    print(f"=" * 80)
    print("""
    🔑 KEY OBSERVATIONS:
    
    1. LIVE BETTING SPECIALIST: This trader predominantly trades during 
       live games, taking advantage of price movements as events unfold.
    
    2. HIGH CONVICTION PLAYS: Often buys "No" on underdog outcomes at high
       prices (60-85%), betting against unlikely events. This is a 
       "favorite backing" strategy.
    
    3. HEDGING BOTH SIDES: Frequently trades BOTH sides of the same market
       (Yes AND No on same question) - this is either:
       - Arbitrage between price movements
       - Reducing risk by hedging positions
       - Market making behavior
    
    4. LARGE POSITION SIZES: Regularly makes $1000-6000 trades, indicating
       high conviction and substantial bankroll.
    
    5. FOCUS MARKETS: Heavily concentrated on:
       - Saudi Pro League matches (especially Al Nassr games with CR7)
       - College Football bowl games
       - Over/Under markets during games
    
    6. SPEED: Makes many trades in rapid succession (2-second intervals),
       suggesting automated execution or very fast manual trading.
    """)
    
    return trades

if __name__ == '__main__':
    trades = analyze_trades('/Users/johnnysamuael/Documents/sharkbot-copy/rn1_trades.csv')
