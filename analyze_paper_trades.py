#!/usr/bin/env python3
"""
Analyze paper trades from the copy trading bot.
Parses raw trade data and provides insights on performance.
"""

import sys
from dataclasses import dataclass
from datetime import datetime
from typing import List

# Raw trade data (CSV format without headers)
TRADE_DATA = """
'09065512-9a1c-46ed-acb1-ed7672ec6cc9','366df1f3-6782-4b40-921a-dc14bdc98d56','0.675','2026-01-02 23:57:48.959','148.1481481481482','100','1','0.74','0','0','0.78','1','0.74','2026-01-03 00:00:50.305','TP_TRAIL','9.629629629629626','9.629629629629626','3','CLOSED','2026-01-02 23:57:48.959','2026-01-03 00:00:50.306'
'1310dbe8-e25e-4f4d-a214-e5b0905e4dbf','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.29','2026-01-03 05:30:44.511','344.8275862068966','100','1','0.255','0','0','0.295','0','0.255','2026-01-03 05:35:05.750','STOP_LOSS','-12.06896551724137','-12.06896551724137','4','CLOSED','2026-01-03 05:30:44.511','2026-01-03 05:35:05.751'
'1a944796-8076-42c2-9eae-7b32af59c91b','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.605','2026-01-03 04:38:04.421','165.2892561983471','100','1','0.685','0','0','0.765','1','0.685','2026-01-03 04:38:43.482','TP_TRAIL','13.22314049586778','13.22314049586778','0','CLOSED','2026-01-03 04:38:04.421','2026-01-03 04:38:43.483'
'1bf6a01b-6ce0-4604-a620-5fada1fb83fa','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.7','2026-01-03 05:38:49.529','142.8571428571429','100','1','0.565','0','0','0.7','0','0.565','2026-01-03 05:38:55.765','STOP_LOSS','-19.28571428571429','-19.28571428571429','0','CLOSED','2026-01-03 05:38:49.529','2026-01-03 05:38:55.766'
'1dc2727d-06b7-44b8-8b40-2a085ef8e793','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.255','2026-01-03 05:35:09.518','392.156862745098','100','1','0.465','0','0','0.505','1','0.465','2026-01-03 05:38:45.766','TP_TRAIL','82.3529411764706','82.3529411764706','3','CLOSED','2026-01-03 05:35:09.518','2026-01-03 05:38:45.767'
'216d2645-f905-4686-971d-99b3582a5239','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.51','2026-01-03 04:36:09.419','196.078431372549','100','1','0.545','0','0','0.62','1','0.545','2026-01-03 04:36:47.478','TP_TRAIL','6.862745098039222','6.862745098039222','0','CLOSED','2026-01-03 04:36:09.419','2026-01-03 04:36:47.478'
'28919576-df1c-4aa3-a78c-30bcdd173b67','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.745','2026-01-03 04:43:34.431','100.6711409395973','75','2','0.955','0','0','0.955','1','0.955','2026-01-03 04:49:59.529','HARD_CAP','21.14093959731543','28.18791946308724','6','CLOSED','2026-01-03 04:43:34.431','2026-01-03 04:49:59.530'
'37a574e2-83ea-4b3c-bace-0ab0c60ab62c','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.465','2026-01-03 04:28:39.410','215.0537634408602','100','1','0.505','0','0','0.53','1','0.505','2026-01-03 04:33:07.461','TP_TRAIL','8.602150537634403','8.602150537634403','4','CLOSED','2026-01-03 04:28:39.410','2026-01-03 04:33:07.462'
'37d91fbc-04ae-41b8-8e30-631e5e8dd525','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.725','2026-01-03 04:25:29.411','103.448275862069','75','2','0.625','0','0','0.775','0','0.625','2026-01-03 04:26:19.425','STOP_LOSS','-10.3448275862069','-13.79310344827586','0','CLOSED','2026-01-03 04:25:29.411','2026-01-03 04:26:19.426'
'421ca7e6-0642-4387-82ea-0e4726e5ab2c','98e64b31-2d08-47aa-a949-5e480dec0e3e','0.685','2026-01-02 21:52:21.514','145.985401459854','100','1','0.735','0','0','0.775','1','0.735','2026-01-02 22:11:01.787','TP_TRAIL','7.29927007299269','7.29927007299269','18','CLOSED','2026-01-02 21:52:21.514','2026-01-02 22:11:01.788'
'47188b00-3a7e-48da-b7b3-dfed365398a1','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.79','2026-01-03 04:43:24.435','126.5822784810127','100','1','0.695','0','0','0.79','0','0.695','2026-01-03 04:45:19.506','STOP_LOSS','-12.02531645569622','-12.02531645569622','1','CLOSED','2026-01-03 04:43:24.435','2026-01-03 04:45:19.507'
'51f9015b-a94b-4165-9f16-359b063a54f2','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.625','2026-01-03 04:26:24.407','160','100','1','0.54','0','0','0.635','0','0.54','2026-01-03 04:27:39.436','STOP_LOSS','-13.59999999999999','-13.6','1','CLOSED','2026-01-03 04:26:24.407','2026-01-03 04:27:39.437'
'52ac0aac-9229-4fd1-928e-bf12b35a965c','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.595','2026-01-03 04:40:29.424','168.0672268907563','100','1','0.665','0','0','0.7','1','0.665','2026-01-03 04:40:59.491','TP_TRAIL','11.76470588235295','11.76470588235295','0','CLOSED','2026-01-03 04:40:29.424','2026-01-03 04:40:59.492'
'5813df04-cd6d-4dd4-bce2-77c53eef779a','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.265','2026-01-03 05:10:59.478','377.3584905660377','100','1','0.29','0','0','0.305','1','0.29','2026-01-03 05:30:41.727','TP_TRAIL','9.43396226415093','9.43396226415093','19','CLOSED','2026-01-03 05:10:59.478','2026-01-03 05:30:41.727'
'5a45d203-bb08-4c07-93ff-eff0629640c0','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.465','2026-01-03 04:35:29.422','215.0537634408602','100','1','0.51','0','0','0.535','1','0.51','2026-01-03 04:36:05.470','TP_TRAIL','9.677419354838705','9.677419354838705','0','CLOSED','2026-01-03 04:35:29.422','2026-01-03 04:36:05.471'
'64560c22-a1b9-4729-9b0b-7ecf4af0b89c','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.505','2026-01-03 04:33:09.418','198.019801980198','100','1','0.525','0','0','0.59','1','0.525','2026-01-03 04:35:09.465','TP_TRAIL','3.960396039603963','3.960396039603963','2','CLOSED','2026-01-03 04:33:09.418','2026-01-03 04:35:09.466'
'6b2a1921-e464-499c-81e5-91f84b0a933c','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.18','2026-01-03 04:57:24.458','555.5555555555555','100','1','0.315','0','0','0.33','1','0.315','2026-01-03 04:58:15.554','TP_TRAIL','75','75','0','CLOSED','2026-01-03 04:57:24.458','2026-01-03 04:58:15.555'
'7eee489d-9923-47a6-a8b0-46c931f58aee','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.125','2026-01-03 05:07:39.474','800','100','1','0.135','0','0','0.145','1','0.135','2026-01-03 05:08:11.606','TP_TRAIL','8.000000000000007','8.000000000000007','0','CLOSED','2026-01-03 05:07:39.474','2026-01-03 05:08:11.606'
'8d201c62-900a-4d70-8c0a-33097306babc','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.585','2026-01-03 04:37:29.420','170.940170940171','100','1','0.605','0','0','0.715','1','0.605','2026-01-03 04:38:03.482','TP_TRAIL','3.418803418803423','3.418803418803423','0','CLOSED','2026-01-03 04:37:29.420','2026-01-03 04:38:03.483'
'8f50abc7-7bc3-4462-9738-d3091f5cb4ba','366df1f3-6782-4b40-921a-dc14bdc98d56','0.735','2026-01-02 23:46:13.935','102.0408163265306','75','2','0.725','0','0','0.855','1','0.725','2026-01-02 23:51:06.259','TP_TRAIL','-1.020408163265307','-1.360544217687076','4','CLOSED','2026-01-02 23:46:13.935','2026-01-02 23:51:06.260'
'973c970e-c893-4541-aa9e-0a72e71baeeb','366df1f3-6782-4b40-921a-dc14bdc98d56','0.755','2026-01-03 00:00:53.966','132.4503311258278','100','1','0.86','0','0','0.9','1','0.86','2026-01-03 00:02:48.317','TP_TRAIL','13.90728476821192','13.90728476821192','1','CLOSED','2026-01-03 00:00:53.966','2026-01-03 00:02:48.318'
'a0f74655-3a00-4ff1-8250-c89c73ab805f','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.14','2026-01-03 05:08:14.474','714.2857142857142','100','1','0.335','0','0','0.36','1','0.335','2026-01-03 05:10:29.620','TP_TRAIL','139.2857142857143','139.2857142857143','2','CLOSED','2026-01-03 05:08:14.474','2026-01-03 05:10:29.621'
'a157a6a2-e569-484a-86de-55bd21983411','f4e7cf4a-ff99-4000-bf9f-09438d21769f','0.8','2026-01-03 02:05:54.176','125','100','1','0.955','0','0','0.955','1','0.955','2026-01-03 02:48:07.011','HARD_CAP','19.37499999999999','19.37499999999999','42','CLOSED','2026-01-03 02:05:54.176','2026-01-03 02:48:07.011'
'a3458867-b856-47f5-848b-56f4b9eb1710','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.525','2026-01-03 04:36:49.419','190.4761904761905','100','1','0.585','0','0','0.615','1','0.585','2026-01-03 04:37:25.479','TP_TRAIL','11.42857142857142','11.42857142857142','0','CLOSED','2026-01-03 04:36:49.419','2026-01-03 04:37:25.480'
'aa9de8a3-1932-4dd0-a5f7-794fe792f8c7','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.525','2026-01-03 04:35:14.421','190.4761904761905','100','1','0.45','0','0','0.525','0','0.45','2026-01-03 04:35:25.469','STOP_LOSS','-14.28571428571429','-14.28571428571429','0','CLOSED','2026-01-03 04:35:14.421','2026-01-03 04:35:25.470'
'aef5a932-c11c-48eb-855e-dcd0bbcdef80','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.165','2026-01-03 05:06:54.472','606.060606060606','100','1','0.135','0','0','0.175','0','0.135','2026-01-03 05:07:35.605','STOP_LOSS','-18.18181818181818','-18.18181818181818','0','CLOSED','2026-01-03 05:06:54.472','2026-01-03 05:07:35.606'
'b1aee239-c15a-4915-8837-65d4aa199811','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.77','2026-01-03 04:23:54.403','129.8701298701299','100','1','0.655','0','0','0.805','0','0.655','2026-01-03 04:25:51.423','STOP_LOSS','-14.93506493506494','-14.93506493506494','1','CLOSED','2026-01-03 04:23:54.403','2026-01-03 04:25:51.424'
'b519a617-c7cc-4cd2-82d1-fdf3bb70a753','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.305','2026-01-03 04:58:19.459','327.8688524590164','100','1','0.145','0','0','0.33','0','0.145','2026-01-03 05:06:49.599','STOP_LOSS','-52.45901639344262','-52.45901639344262','8','CLOSED','2026-01-03 04:58:19.459','2026-01-03 05:06:49.600'
'bddd33e0-2a76-4752-a84c-8cecd374fe44','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.685','2026-01-03 04:38:44.422','145.985401459854','100','1','0.59','0','0','0.7','0','0.59','2026-01-03 04:40:25.489','STOP_LOSS','-13.86861313868614','-13.86861313868614','1','CLOSED','2026-01-03 04:38:44.422','2026-01-03 04:40:25.490'
'cd732842-9420-47de-a790-1ce506acd861','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.315','2026-01-03 05:10:34.481','317.4603174603175','100','1','0.265','0','0','0.315','0','0.265','2026-01-03 05:10:57.624','STOP_LOSS','-15.87301587301587','-15.87301587301587','0','CLOSED','2026-01-03 05:10:34.481','2026-01-03 05:10:57.625'
'cf530aba-494d-48ff-bc7f-36eabc019515','528a60ce-d62c-40a1-8a05-d1837f8f2c6f','0.5','2026-01-03 05:38:59.529','200','100','1','0.285','0','0','0.555','0','0.285','2026-01-03 06:05:47.887','STOP_LOSS','-43.00000000000001','-43.00000000000001','26','CLOSED','2026-01-03 05:38:59.529','2026-01-03 06:05:47.888'
'd6bdc3b9-895c-4a46-8457-c9fff6edaebb','a66cc1ae-78f6-4ec3-a886-d264cfa8b19c','0.685','2026-01-03 01:24:59.119','145.985401459854','100','1','0.83','0','0','0.865','1','0.83','2026-01-03 01:52:10.785','TP_TRAIL','21.16788321167882','21.16788321167882','27','CLOSED','2026-01-03 01:24:59.119','2026-01-03 01:52:10.786'
'd6e68f92-e021-4f94-ac66-82e98995acc6','366df1f3-6782-4b40-921a-dc14bdc98d56','0.72','2026-01-02 23:51:08.000','138.8888888888889','100','1','0.99','0','0','0.825','1','0.95','2026-01-02 23:56:30.000','TP_TRAIL','37.6','37.67','5','CLOSED','2026-01-02 23:51:08.000','2026-01-02 23:56:30.000'
'e6a25fb9-cc41-4db2-8322-57f31ba87519','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.645','2026-01-03 04:41:04.425','155.0387596899225','100','1','0.85','0','0','0.895','1','0.85','2026-01-03 04:43:23.499','TP_TRAIL','31.7829457364341','31.7829457364341','2','CLOSED','2026-01-03 04:41:04.425','2026-01-03 04:43:23.500'
'e9e5f444-db3e-4afb-825f-d010b557c8c1','1cc7ee52-855b-48f4-8c7f-454dc5dbeec3','0.545','2026-01-03 04:27:44.417','183.4862385321101','100','1','0.455','0','0','0.565','0','0.455','2026-01-03 04:28:35.441','STOP_LOSS','-16.51376146788991','-16.51376146788991','0','CLOSED','2026-01-03 04:27:44.417','2026-01-03 04:28:35.442'
""".strip()


@dataclass
class PaperTrade:
    id: str
    market_id: str
    entry_price: float
    entry_time: datetime
    shares: float
    cost_basis: float
    ladder_level: int
    current_price: float
    exit_price: float
    high_water_mark: float
    trailing_active: bool
    exit_time: datetime
    exit_reason: str
    realized_pnl: float
    realized_pct: float
    hold_time_minutes: int
    status: str


def parse_trades() -> List[PaperTrade]:
    trades = []
    for line in TRADE_DATA.strip().split('\n'):
        if not line.strip():
            continue
        # Remove single quotes and split
        parts = [p.strip().strip("'") for p in line.split("','")]
        if len(parts) < 20:
            continue
        
        trades.append(PaperTrade(
            id=parts[0],
            market_id=parts[1],
            entry_price=float(parts[2]),
            entry_time=datetime.fromisoformat(parts[3]),
            shares=float(parts[4]),
            cost_basis=float(parts[5]),
            ladder_level=int(parts[6]),
            current_price=float(parts[7]) if parts[7] else 0,
            exit_price=float(parts[12]) if parts[12] else 0,
            high_water_mark=float(parts[10]) if parts[10] else 0,
            trailing_active=parts[11] == '1',
            exit_time=datetime.fromisoformat(parts[13]) if parts[13] else None,
            exit_reason=parts[14],
            realized_pnl=float(parts[15]) if parts[15] else 0,
            realized_pct=float(parts[16]) if parts[16] else 0,
            hold_time_minutes=int(parts[17]) if parts[17] else 0,
            status=parts[18],
        ))
    return trades


def analyze():
    trades = parse_trades()
    
    print("=" * 80)
    print("PAPER TRADE ANALYSIS REPORT")
    print("=" * 80)
    
    # Basic stats
    total = len(trades)
    wins = [t for t in trades if t.realized_pnl > 0]
    losses = [t for t in trades if t.realized_pnl < 0]
    breakeven = [t for t in trades if t.realized_pnl == 0]
    
    total_pnl = sum(t.realized_pnl for t in trades)
    total_cost = sum(t.cost_basis for t in trades)
    
    print(f"\n📊 OVERVIEW:")
    print(f"   Total trades: {total}")
    print(f"   Wins: {len(wins)} ({len(wins)/total*100:.1f}%)")
    print(f"   Losses: {len(losses)} ({len(losses)/total*100:.1f}%)")
    print(f"   Breakeven: {len(breakeven)}")
    print(f"   Win Rate: {len(wins)/total*100:.1f}%")
    print(f"   Total P&L: ${total_pnl:.2f}")
    print(f"   Total Capital Deployed: ${total_cost:.2f}")
    print(f"   ROI: {total_pnl/total_cost*100:.2f}%")
    
    # P&L breakdown
    win_pnl = sum(t.realized_pnl for t in wins)
    loss_pnl = sum(t.realized_pnl for t in losses)
    
    print(f"\n💰 P&L BREAKDOWN:")
    print(f"   Total Wins: ${win_pnl:.2f}")
    print(f"   Total Losses: ${loss_pnl:.2f}")
    print(f"   Net P&L: ${total_pnl:.2f}")
    
    if wins:
        avg_win = win_pnl / len(wins)
        avg_win_pct = sum(t.realized_pct for t in wins) / len(wins)
        max_win = max(t.realized_pnl for t in wins)
        print(f"   Avg Win: ${avg_win:.2f} ({avg_win_pct:.1f}%)")
        print(f"   Max Win: ${max_win:.2f}")
    
    if losses:
        avg_loss = loss_pnl / len(losses)
        avg_loss_pct = sum(t.realized_pct for t in losses) / len(losses)
        max_loss = min(t.realized_pnl for t in losses)
        print(f"   Avg Loss: ${avg_loss:.2f} ({avg_loss_pct:.1f}%)")
        print(f"   Max Loss: ${max_loss:.2f}")
    
    # By exit reason
    print(f"\n📤 BY EXIT REASON:")
    exit_reasons = {}
    for t in trades:
        if t.exit_reason not in exit_reasons:
            exit_reasons[t.exit_reason] = {'count': 0, 'pnl': 0, 'trades': []}
        exit_reasons[t.exit_reason]['count'] += 1
        exit_reasons[t.exit_reason]['pnl'] += t.realized_pnl
        exit_reasons[t.exit_reason]['trades'].append(t)
    
    for reason, data in sorted(exit_reasons.items(), key=lambda x: -x[1]['count']):
        wins_in_reason = len([t for t in data['trades'] if t.realized_pnl > 0])
        print(f"   {reason}: {data['count']} trades, ${data['pnl']:.2f} P&L, {wins_in_reason}/{data['count']} wins")
    
    # Entry price analysis
    print(f"\n📈 ENTRY PRICE ANALYSIS:")
    
    config_in_range = [t for t in trades if 0.65 <= t.entry_price <= 0.85]
    below_range = [t for t in trades if t.entry_price < 0.65]
    above_range = [t for t in trades if t.entry_price > 0.85]
    
    print(f"   In Config Range (65-85%): {len(config_in_range)} trades")
    print(f"   Below Range (<65%): {len(below_range)} trades")
    print(f"   Above Range (>85%): {len(above_range)} trades")
    
    # Performance by entry price band
    print(f"\n   📊 Performance by Entry Price Band:")
    
    bands = [
        ("10-30%", 0.10, 0.30),
        ("30-50%", 0.30, 0.50),
        ("50-65%", 0.50, 0.65),
        ("65-75%", 0.65, 0.75),
        ("75-85%", 0.75, 0.85),
    ]
    
    for name, low, high in bands:
        band_trades = [t for t in trades if low <= t.entry_price < high]
        if band_trades:
            band_wins = len([t for t in band_trades if t.realized_pnl > 0])
            band_pnl = sum(t.realized_pnl for t in band_trades)
            print(f"      {name}: {len(band_trades)} trades, {band_wins} wins ({band_wins/len(band_trades)*100:.0f}%), ${band_pnl:.2f} P&L")
    
    # Hold time analysis
    print(f"\n⏱️  HOLD TIME ANALYSIS:")
    avg_hold = sum(t.hold_time_minutes for t in trades) / total
    win_hold = sum(t.hold_time_minutes for t in wins) / len(wins) if wins else 0
    loss_hold = sum(t.hold_time_minutes for t in losses) / len(losses) if losses else 0
    
    print(f"   Average Hold Time: {avg_hold:.1f} minutes")
    print(f"   Avg Hold (Wins): {win_hold:.1f} minutes")
    print(f"   Avg Hold (Losses): {loss_hold:.1f} minutes")
    
    very_fast = [t for t in trades if t.hold_time_minutes <= 1]
    print(f"   Very Fast Trades (<=1 min): {len(very_fast)} ({len(very_fast)/total*100:.1f}%)")
    very_fast_losses = [t for t in very_fast if t.realized_pnl < 0]
    print(f"     -> Losses in fast trades: {len(very_fast_losses)}")
    
    # Ladder level analysis
    print(f"\n🪜 LADDER LEVEL ANALYSIS:")
    l1_trades = [t for t in trades if t.ladder_level == 1]
    l2_trades = [t for t in trades if t.ladder_level == 2]
    
    l1_pnl = sum(t.realized_pnl for t in l1_trades)
    l2_pnl = sum(t.realized_pnl for t in l2_trades)
    
    l1_wins = len([t for t in l1_trades if t.realized_pnl > 0])
    l2_wins = len([t for t in l2_trades if t.realized_pnl > 0])
    
    print(f"   L1 (Initial $100): {len(l1_trades)} trades, {l1_wins} wins, ${l1_pnl:.2f} P&L")
    print(f"   L2 (DCA $75): {len(l2_trades)} trades, {l2_wins} wins, ${l2_pnl:.2f} P&L")
    
    # Market concentration
    print(f"\n🎯 MARKET CONCENTRATION:")
    markets = {}
    for t in trades:
        if t.market_id not in markets:
            markets[t.market_id] = {'count': 0, 'pnl': 0}
        markets[t.market_id]['count'] += 1
        markets[t.market_id]['pnl'] += t.realized_pnl
    
    for mkt, data in sorted(markets.items(), key=lambda x: -x[1]['count']):
        print(f"   {mkt[:8]}...: {data['count']} trades, ${data['pnl']:.2f} P&L")
    
    # STOP LOSS DEEP DIVE
    print(f"\n" + "=" * 80)
    print("🛑 STOP LOSS DEEP DIVE")
    print("=" * 80)
    
    sl_trades = exit_reasons.get('STOP_LOSS', {}).get('trades', [])
    
    if sl_trades:
        print(f"\n   Total Stop Loss Trades: {len(sl_trades)}")
        sl_pnl = sum(t.realized_pnl for t in sl_trades)
        print(f"   Total SL Loss: ${sl_pnl:.2f}")
        
        # Entry price distribution for SL trades
        print(f"\n   Entry Price Distribution for Stop Losses:")
        for name, low, high in bands:
            band_sl = [t for t in sl_trades if low <= t.entry_price < high]
            if band_sl:
                band_sl_pnl = sum(t.realized_pnl for t in band_sl)
                print(f"      {name}: {len(band_sl)} SL trades, ${band_sl_pnl:.2f} loss")
        
        # Hold time for SL trades
        sl_fast = [t for t in sl_trades if t.hold_time_minutes <= 1]
        print(f"\n   Fast SL (<=1 min): {len(sl_fast)} trades")
        print(f"   These instant losses suggest entering at wrong time or wrong side")
        
        # Check for trades that went positive then hit SL
        print(f"\n   SL Trades that saw positive territory (high_water_mark > entry):")
        for t in sl_trades:
            if t.high_water_mark > t.entry_price:
                profit_seen = ((t.high_water_mark - t.entry_price) / t.entry_price) * 100
                print(f"      Entry: {t.entry_price:.3f}, HWM: {t.high_water_mark:.3f} (+{profit_seen:.1f}% peak), Loss: {t.realized_pct:.1f}%")
    
    # ISSUES & RECOMMENDATIONS
    print(f"\n" + "=" * 80)
    print("🔍 ISSUES IDENTIFIED")
    print("=" * 80)
    
    issues = []
    
    # Issue 1: Trades outside config range
    out_of_range = below_range + above_range
    if out_of_range:
        out_pnl = sum(t.realized_pnl for t in out_of_range)
        issues.append(f"1. ENTRY RANGE VIOLATION: {len(out_of_range)} trades outside 65-85% range (P&L: ${out_pnl:.2f})")
        for t in out_of_range:
            print(f"      - Entry {t.entry_price:.2%}, Exit {t.exit_reason}, P&L: {t.realized_pct:.1f}%")
    
    # Issue 2: Instant stop losses
    instant_sl = [t for t in sl_trades if t.hold_time_minutes == 0]
    if instant_sl:
        instant_sl_pnl = sum(t.realized_pnl for t in instant_sl)
        issues.append(f"2. INSTANT STOP LOSSES: {len(instant_sl)} trades hit SL in <1 minute (Loss: ${instant_sl_pnl:.2f})")
    
    # Issue 3: Deep losses beyond configured SL
    deep_losses = [t for t in trades if t.realized_pct < -15]
    if deep_losses:
        deep_loss_pnl = sum(t.realized_pnl for t in deep_losses)
        issues.append(f"3. DEEP LOSSES (>15%): {len(deep_losses)} trades with losses beyond SL threshold (Loss: ${deep_loss_pnl:.2f})")
    
    # Issue 4: Low wins on low-price entries
    low_entries = [t for t in trades if t.entry_price < 0.50]
    if low_entries:
        low_wins = len([t for t in low_entries if t.realized_pnl > 0])
        low_pnl = sum(t.realized_pnl for t in low_entries)
        issues.append(f"4. LOW-PRICE ENTRIES: {len(low_entries)} trades at <50%, {low_wins} wins, Net: ${low_pnl:.2f}")
    
    for issue in issues:
        print(f"\n   {issue}")
    
    # RECOMMENDATIONS
    print(f"\n" + "=" * 80)
    print("💡 RECOMMENDATIONS")
    print("=" * 80)
    
    print("""
   1. ENFORCE ENTRY RANGE STRICTLY
      - Many trades entered outside the 65-85% range
      - Low-probability entries (<50%) are gambling, not edge
      - Consider raising MIN_PRICE to 0.60 or 0.65
   
   2. ADD ENTRY DELAY / CONFIRMATION
      - Many instant stop-losses suggest entering at volatile moments
      - Consider waiting 30-60 seconds after whale trade before entering
      - Or require price to be stable for 10-20 seconds before entry
   
   3. TIGHTEN STOP LOSS FOR LOW ENTRIES
      - Current -12% SL is too wide for low-probability entries
      - Low entries (<50%) should have tighter SL (e.g., -8%)
      - Or avoid low entries entirely
   
   4. IMPROVE DCA LOGIC
      - L2 trades show mixed results
      - Consider DCA only if first entry is in profit after X minutes
      - Avoid doubling down on instant losers
   
   5. ADD MOMENTUM CHECK
      - Check if price is rising vs falling before entry
      - Avoid entering if price has already moved 5%+ from whale's entry
   
   6. MARKET SELECTION
      - Some markets have multiple trades with losses
      - Consider limiting to 1-2 entries per market
      - Track per-market win rate and skip repeat losers
""")
    
    # Summary
    print(f"\n" + "=" * 80)
    print("📋 EXECUTIVE SUMMARY")
    print("=" * 80)
    print(f"""
   Win Rate: {len(wins)/total*100:.1f}%
   Total P&L: ${total_pnl:.2f}
   ROI: {total_pnl/total_cost*100:.2f}%
   
   STATUS: {"✅ PROFITABLE" if total_pnl > 0 else "❌ LOSING"}
   
   The strategy is {"working" if total_pnl > 0 else "not working"} overall.
   
   Key Issues:
   - {len(out_of_range)} trades violated entry range (config says 65-85%)
   - {len(instant_sl)} trades hit instant stop losses
   - {len(deep_losses)} trades had deep losses beyond expected SL
   
   The wins come from:
   - TP_TRAIL exits: ${exit_reasons.get('TP_TRAIL', {}).get('pnl', 0):.2f}
   - HARD_CAP exits: ${exit_reasons.get('HARD_CAP', {}).get('pnl', 0):.2f}
   
   The losses come from:
   - STOP_LOSS exits: ${exit_reasons.get('STOP_LOSS', {}).get('pnl', 0):.2f}
""")


if __name__ == '__main__':
    analyze()
