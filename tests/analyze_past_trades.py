#!/usr/bin/env python3
"""
Script to analyze existing paper trades and identify issues

This helps understand how trades at wrong prices got created.
"""

import os
import mysql.connector
from dotenv import load_dotenv

load_dotenv()

# Parse DATABASE_URL
db_url = os.getenv('DATABASE_URL', '')
print(f"Connecting to database...")

# Create connection - parse the URL manually
# Format: mysql://user:pass@host:port/db
if 'mysql://' in db_url:
    clean_url = db_url.replace('mysql://', '')
    if '@' in clean_url:
        creds, rest = clean_url.split('@')
        user, password = creds.split(':')
        host_port, db = rest.split('/')
        if '?' in db:
            db = db.split('?')[0]
        if ':' in host_port:
            host, port = host_port.split(':')
            port = int(port)
        else:
            host = host_port
            port = 3306
        
        try:
            conn = mysql.connector.connect(
                host=host,
                port=port,
                user=user,
                password=password,
                database=db
            )
            cursor = conn.cursor(dictionary=True)
            
            print("\n" + "=" * 70)
            print("📊 ANALYZING PAPER TRADES")
            print("=" * 70)
            
            # Get all paper trades with their market info
            cursor.execute("""
                SELECT 
                    pt.id,
                    pt.entryPrice,
                    pt.exitPrice,
                    pt.status,
                    pt.exitReason,
                    pt.createdAt,
                    tm.title,
                    tm.outcome,
                    tm.whalePrice,
                    tm.copyEligible,
                    tm.copyReason,
                    tm.copierName
                FROM PaperTrade pt
                JOIN TrackedMarket tm ON pt.marketId = tm.id
                ORDER BY pt.createdAt DESC
                LIMIT 20
            """)
            
            trades = cursor.fetchall()
            
            issues = []
            
            for trade in trades:
                entry_pct = trade['entryPrice'] * 100 if trade['entryPrice'] else 0
                whale_pct = trade['whalePrice'] * 100 if trade['whalePrice'] else 0
                
                title = (trade['title'] or 'Unknown')[:40]
                outcome = trade['outcome'] or '?'
                status = trade['status']
                exit_reason = trade['exitReason'] or '-'
                copier = trade['copierName'] or 'Unknown'
                copy_eligible = trade['copyEligible']
                copy_reason = trade['copyReason'] or ''
                
                print(f"\n{title}...")
                print(f"  Trader: {copier}, Outcome: {outcome}")
                print(f"  Entry: {entry_pct:.1f}%, Whale Price: {whale_pct:.1f}%")
                print(f"  Status: {status}, Exit: {exit_reason}")
                print(f"  Eligible: {copy_eligible}, Reason: {copy_reason[:50]}...")
                
                # Check for issues
                if entry_pct < 65:
                    issues.append(f"❌ ENTRY BELOW 65%: {title} at {entry_pct:.1f}%")
                if entry_pct > 85:
                    issues.append(f"❌ ENTRY ABOVE 85%: {title} at {entry_pct:.1f}%")
                if not copy_eligible:
                    issues.append(f"⚠️ TRADE ON INELIGIBLE MARKET: {title}")
            
            print("\n" + "=" * 70)
            print("📋 ISSUES FOUND")
            print("=" * 70)
            
            if issues:
                for issue in issues:
                    print(f"  {issue}")
                
                print(f"\nTotal issues: {len(issues)}")
                print("\n🔍 ROOT CAUSE ANALYSIS:")
                print("  These trades likely occurred because PaperExecutor.executeL1Entry()")
                print("  was NOT checking MIN_PRICE before the fix was applied.")
                print("  Markets were tracked (with copyEligible=false), but still executed.")
            else:
                print("  ✅ No issues found with current trades!")
            
            cursor.close()
            conn.close()
            
        except Exception as e:
            print(f"Database error: {e}")
else:
    print("DATABASE_URL not found or not MySQL format")
    print("Skipping database analysis")
