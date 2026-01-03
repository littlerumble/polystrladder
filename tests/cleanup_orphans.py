#!/usr/bin/env python3
"""
Script to clean up orphaned PaperTrade records
"""

import os
import mysql.connector
from dotenv import load_dotenv

load_dotenv()

db_url = os.getenv('DATABASE_URL', '')
print("Connecting to database...")

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
            print("🔍 FINDING ORPHANED PAPER TRADES")
            print("=" * 70)
            
            # Find orphaned trades (market doesn't exist)
            cursor.execute("""
                SELECT pt.id, pt.entryPrice, pt.status, pt.marketId
                FROM PaperTrade pt
                LEFT JOIN TrackedMarket tm ON pt.marketId = tm.id
                WHERE tm.id IS NULL
            """)
            
            orphans = cursor.fetchall()
            
            if orphans:
                print(f"\nFound {len(orphans)} orphaned trades:")
                for orphan in orphans:
                    print(f"  - Trade {orphan['id'][:8]}... (marketId: {orphan['marketId'][:8]}...)")
                
                # Delete orphaned trades
                cursor.execute("""
                    DELETE pt FROM PaperTrade pt
                    LEFT JOIN TrackedMarket tm ON pt.marketId = tm.id
                    WHERE tm.id IS NULL
                """)
                conn.commit()
                print(f"\n✅ Deleted {cursor.rowcount} orphaned PaperTrade records")
            else:
                print("\n✅ No orphaned trades found!")
            
            # Also delete bad TrackedMarket records (those with very low prices that were errors)
            print("\n" + "=" * 70)
            print("🔍 FINDING BAD TRACKED MARKETS")
            print("=" * 70)
            
            cursor.execute("""
                SELECT id, title, outcome, whalePrice, currentPrice, copyReason
                FROM TrackedMarket
                WHERE whalePrice < 0.65 OR currentPrice < 0.01
            """)
            
            bad_markets = cursor.fetchall()
            
            if bad_markets:
                print(f"\nFound {len(bad_markets)} markets with suspicious data:")
                for market in bad_markets[:10]:
                    title = (market['title'] or 'Unknown')[:40]
                    whale_pct = (market['whalePrice'] or 0) * 100
                    current_pct = (market['currentPrice'] or 0) * 100
                    print(f"  - {title}... ({market['outcome']}) whale:{whale_pct:.1f}% current:{current_pct:.1f}%")
            
            cursor.close()
            conn.close()
            
            print("\n✅ Cleanup complete!")
            
        except Exception as e:
            print(f"Database error: {e}")
else:
    print("DATABASE_URL not found or not MySQL format")
