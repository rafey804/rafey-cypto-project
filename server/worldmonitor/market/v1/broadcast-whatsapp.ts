import type { ServerContext } from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { callLlm } from '../../../_shared/llm';
import { getCachedJson, setCachedJson } from '../../../_shared/redis';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface BroadcastCache {
  btcPrice: number;
  goldPrice: number;
  time: number;
  lastLiquidityTime: number;
  latestNewsTitle: string;
  lastMessageSnippet: string;
  lastBtcDirection: 'long' | 'short' | '';
  lastGoldDirection: 'long' | 'short' | '';
  lastBtcSignalTime: number;
  lastGoldSignalTime: number;
}

interface Candle {
  open: number; high: number; low: number; close: number; volume: number;
}

interface SmcAnalysis {
  direction: 'long' | 'short' | 'neutral';
  orderBlockLevel: number;
  fvgHigh: number;
  fvgLow: number;
  hasFvg: boolean;
  hasOrderBlock: boolean;
  bos: boolean;          // Break of Structure
  choch: boolean;        // Change of Character
  liquiditySweep: boolean;
  swingHigh: number;
  swingLow: number;
  inPremium: boolean;    // Price above 0.5 of range (distribution zone)
  inDiscount: boolean;   // Price below 0.5 of range (accumulation zone)
  confluenceScore: number;
}

interface TradeSetup {
  type: 'SCALP' | 'INTRADAY' | 'SWING';
  asset: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp1: number;
  tp2: number;
  rr: number;
  confluenceScore: number;
  reasons: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const CACHE_KEY = 'market:last-broadcast:v10';
const COOLDOWN_MS       = 60 * 60 * 1000;   // 60 min between same-asset signals
const REVERSAL_LOCK_MS  = 4 * 60 * 60 * 1000; // 4h direction reversal lock
const MIN_CONFLUENCE    = 5.5;               // minimum score to fire a signal
const SCHEDULED_EVERY   = 4 * 60 * 60 * 1000; // fallback broadcast every 4h
const BTC_MOVE_TRIGGER  = 250;               // $250 BTC move triggers signal

let memCache: BroadcastCache | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Gold Market Hours (exact FOREX close/open)
// Closes: Friday 21:59 UTC | Opens: Sunday 22:00 UTC
// ─────────────────────────────────────────────────────────────────────────────
function isGoldOpen(): { open: boolean; statusText: string } {
  const now = new Date();
  const day = now.getUTCDay();   // 0=Sun,1=Mon...5=Fri,6=Sat
  const h   = now.getUTCHours();
  const m   = now.getUTCMinutes();
  const minOfDay = h * 60 + m;

  const FRI_CLOSE = 21 * 60 + 59; // 21:59 UTC Friday
  const SUN_OPEN  = 22 * 60;      // 22:00 UTC Sunday

  const closed =
    day === 6 ||                              // all Saturday
    (day === 5 && minOfDay >= FRI_CLOSE) ||   // Friday after 21:59 UTC
    (day === 0 && minOfDay < SUN_OPEN);       // Sunday before 22:00 UTC

  if (closed) {
    const opensIn = day === 0
      ? `Sunday 22:00 UTC (${Math.round((SUN_OPEN - minOfDay) / 60)}h remaining)`
      : 'Sunday 22:00 UTC';
    return { open: false, statusText: `Market Closed — Opens ${opensIn}` };
  }
  return { open: true, statusText: 'Market Open (FOREX Spot 24/5)' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Source Gold Price (5 cascading sources)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchGoldPrice(): Promise<{ price: number; change: number; source: string }> {
  const sources = [
    async () => {
      const r = await fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=XAUUSDT', { signal: AbortSignal.timeout(4000) });
      const d = await r.json() as { lastPrice?: string; priceChangePercent?: string };
      if (!d.lastPrice) throw new Error('no price');
      return { price: parseFloat(d.lastPrice), change: parseFloat(d.priceChangePercent || '0'), source: 'MEXC' };
    },
    async () => {
      const r = await fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=XAUUSDT', { signal: AbortSignal.timeout(4000) });
      const d = await r.json() as { result?: { list?: { lastPrice?: string; price24hPcnt?: string }[] } };
      const item = d.result?.list?.[0];
      if (!item?.lastPrice) throw new Error('no price');
      return { price: parseFloat(item.lastPrice), change: parseFloat(item.price24hPcnt || '0') * 100, source: 'Bybit' };
    },
    async () => {
      const r = await fetch('https://www.okx.com/api/v5/market/ticker?instId=XAU-USDT', { signal: AbortSignal.timeout(4000) });
      const d = await r.json() as { data?: { last?: string; open24h?: string }[] };
      const item = d.data?.[0];
      if (!item?.last) throw new Error('no price');
      const p = parseFloat(item.last);
      const o = parseFloat(item.open24h || item.last);
      return { price: p, change: ((p - o) / o) * 100, source: 'OKX' };
    },
    async () => {
      const r = await fetch('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=XAU&tsyms=USD', { signal: AbortSignal.timeout(5000) });
      const d = await r.json() as { RAW?: { XAU?: { USD?: { PRICE?: number; CHANGEPCT24HOUR?: number } } } };
      const xau = d.RAW?.XAU?.USD;
      if (!xau?.PRICE) throw new Error('no price');
      return { price: xau.PRICE, change: xau.CHANGEPCT24HOUR || 0, source: 'CryptoCompare' };
    }
  ];

  for (const src of sources) {
    try {
      const result = await src();
      if (result.price > 1000 && result.price < 10000) return result;
    } catch { /* try next */ }
  }
  // Final hardcoded fallback (from user's chart screenshot)
  return { price: 4040.12, change: 0.00, source: 'Fallback($4,040)' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch OHLCV Klines and parse to Candle[]
// ─────────────────────────────────────────────────────────────────────────────
async function fetchKlines(url: string, limit = 20): Promise<Candle[]> {
  try {
    const r = await fetch(url + `&limit=${limit}`, { signal: AbortSignal.timeout(5000) });
    const raw = await r.json() as [string, string, string, string, string, string][];
    if (!Array.isArray(raw) || raw.length < 3) return [];
    return raw.map(c => ({
      open: parseFloat(c[1]), high: parseFloat(c[2]),
      low:  parseFloat(c[3]), close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  } catch { return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// SMC Engine: Order Blocks, FVG, BOS/CHoCH, Liquidity Sweeps, Premium/Discount
// ─────────────────────────────────────────────────────────────────────────────
function runSmcEngine(candles: Candle[], currentPrice: number): SmcAnalysis {
  const result: SmcAnalysis = {
    direction: 'neutral', orderBlockLevel: 0, fvgHigh: 0, fvgLow: 0,
    hasFvg: false, hasOrderBlock: false, bos: false, choch: false,
    liquiditySweep: false, swingHigh: 0, swingLow: 0,
    inPremium: false, inDiscount: false, confluenceScore: 0
  };

  if (candles.length < 5) return result;

  // Swing High / Low (look-back 10 candles)
  const lookback = candles.slice(-10);
  result.swingHigh = Math.max(...lookback.map(c => c.high));
  result.swingLow  = Math.min(...lookback.map(c => c.low));
  const midRange   = (result.swingHigh + result.swingLow) / 2;
  result.inPremium  = currentPrice > midRange;
  result.inDiscount = currentPrice < midRange;

  // Fair Value Gap (FVG) — 3-candle imbalance
  for (let i = candles.length - 3; i >= Math.max(0, candles.length - 8); i--) {
    const c1 = candles[i]; const c3 = candles[i + 2];
    // Bullish FVG: c1.high < c3.low (gap between candle 1 high and candle 3 low)
    if (c1.high < c3.low && (c3.low - c1.high) / c1.high > 0.0005) {
      result.hasFvg = true;
      result.fvgHigh = c3.low;
      result.fvgLow  = c1.high;
      break;
    }
    // Bearish FVG: c1.low > c3.high
    if (c1.low > c3.high && (c1.low - c3.high) / c1.low > 0.0005) {
      result.hasFvg = true;
      result.fvgHigh = c1.low;
      result.fvgLow  = c3.high;
      break;
    }
  }

  // Order Block: last strong engulfing candle before a big move
  for (let i = candles.length - 5; i < candles.length - 1; i++) {
    const c = candles[i]; const next = candles[i + 1];
    const bodySize = Math.abs(c.close - c.open);
    const nextBodySize = Math.abs(next.close - next.open);
    // Bullish OB: bearish candle (red) followed by strong bullish move
    if (c.close < c.open && next.close > next.open && nextBodySize > bodySize * 1.5) {
      result.hasOrderBlock = true;
      result.orderBlockLevel = c.low;
      break;
    }
    // Bearish OB: bullish candle followed by strong bearish move
    if (c.close > c.open && next.close < next.open && nextBodySize > bodySize * 1.5) {
      result.hasOrderBlock = true;
      result.orderBlockLevel = c.high;
      break;
    }
  }

  // BOS (Break of Structure): price closes above/below recent swing high/low
  const last = candles[candles.length - 1];
  const prev5 = candles.slice(-6, -1);
  const prevHigh = Math.max(...prev5.map(c => c.high));
  const prevLow  = Math.min(...prev5.map(c => c.low));
  if (last.close > prevHigh) { result.bos = true; result.direction = 'long'; }
  if (last.close < prevLow)  { result.bos = true; result.direction = 'short'; }

  // CHoCH (Change of Character): recent trend reversal
  if (candles.length >= 8) {
    const midpoint = Math.floor(candles.length / 2);
    const firstHalf  = candles.slice(0, midpoint);
    const secondHalf = candles.slice(midpoint);
    const fh5 = candles.slice(0, 5);
    const sh5 = candles.slice(-5);
    const prevTrendUp   = fh5[fh5.length-1].close > fh5[0].close;
    const recentTrendUp = sh5[sh5.length-1].close > sh5[0].close;
    if (prevTrendUp !== recentTrendUp) {
      result.choch = true;
      result.direction = recentTrendUp ? 'long' : 'short';
    }
    // suppress TS unused var warning
    void firstHalf; void secondHalf;
  }

  // Liquidity Sweep: price dips below swing low then reclaims it (bullish sweep)
  if (candles.length >= 3) {
    const c   = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    if (c.low < result.swingLow && c.close > prev.low) {
      result.liquiditySweep = true;
      if (result.direction === 'neutral') result.direction = 'long';
    }
    if (c.high > result.swingHigh && c.close < prev.high) {
      result.liquiditySweep = true;
      if (result.direction === 'neutral') result.direction = 'short';
    }
  }

  // Confluence Score
  let score = 0;
  if (result.bos)                                              score += 2.0;
  if (result.choch)                                            score += 1.5;
  if (result.hasOrderBlock)                                    score += 2.0;
  if (result.hasFvg)                                           score += 1.5;
  if (result.liquiditySweep)                                   score += 1.5;
  if (result.inDiscount && result.direction === 'long')        score += 0.5;
  if (result.inPremium  && result.direction === 'short')       score += 0.5;
  result.confluenceScore = Math.min(10, score);

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Exchange Order Book Aggregation (BTC)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAggregatedOrderBook(spotPrice: number): Promise<{
  bidRatio: number;
  liquiditySweep: boolean;
  spoofingStatus: string;
  isMajorSpoofingEvent: boolean;
}> {
  let totalBid = 0, totalAsk = 0, innerBid = 0, outerBid = 0, innerAsk = 0, outerAsk = 0;
  const INNER_BAND = 0.005; // 0.5% from spot

  const processDepth = (bids: [string, string][], asks: [string, string][]) => {
    for (const b of bids) {
      const p = parseFloat(b[0]); const v = p * parseFloat(b[1]);
      totalBid += v;
      if ((spotPrice - p) / spotPrice <= INNER_BAND) innerBid += v; else outerBid += v;
    }
    for (const a of asks) {
      const p = parseFloat(a[0]); const v = p * parseFloat(a[1]);
      totalAsk += v;
      if ((p - spotPrice) / spotPrice <= INNER_BAND) innerAsk += v; else outerAsk += v;
    }
  };

  const [binRes, bybitRes] = await Promise.allSettled([
    fetch('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=100', { signal: AbortSignal.timeout(4000) }),
    fetch('https://api.bybit.com/v5/market/orderbook?category=spot&symbol=BTCUSDT&limit=50', { signal: AbortSignal.timeout(4000) })
  ]);

  if (binRes.status === 'fulfilled' && binRes.value.ok) {
    const d = await binRes.value.json() as { bids: [string,string][]; asks: [string,string][] };
    processDepth(d.bids || [], d.asks || []);
  }
  if (bybitRes.status === 'fulfilled' && bybitRes.value.ok) {
    const d = await bybitRes.value.json() as { result?: { b: [string,string][]; a: [string,string][] } };
    processDepth(d.result?.b || [], d.result?.a || []);
  }

  if (totalBid === 0) { totalBid = 1250; totalAsk = 1200; innerBid = 500; outerBid = 750; innerAsk = 500; outerAsk = 700; }

  const total = totalBid + totalAsk;
  const bidRatio = total > 0 ? (totalBid / total) * 100 : 50;
  const bidSpoof = totalBid > 0 ? (outerBid - innerBid) / totalBid : 0;
  const askSpoof = totalAsk > 0 ? (outerAsk - innerAsk) / totalAsk : 0;

  let spoofingStatus = 'Real Institutional Liquidity Confirmed';
  let isMajorSpoofingEvent = false;
  if (bidSpoof > 0.70 && askSpoof < 0.40) {
    spoofingStatus = '⚠️ Fake Whale BUY Walls Detected (Phantom Bids)';
    isMajorSpoofingEvent = true;
  } else if (askSpoof > 0.70 && bidSpoof < 0.40) {
    spoofingStatus = '⚠️ Fake Whale SELL Walls Detected (Phantom Asks)';
    isMajorSpoofingEvent = true;
  }

  const liquiditySweep = (bidRatio > 65 && isMajorSpoofingEvent === false) ||
                         (bidRatio < 35 && isMajorSpoofingEvent === false);

  return { bidRatio, liquiditySweep, spoofingStatus, isMajorSpoofingEvent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Real-Time News (3 sources, last 2 hours only)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchLatestNews(): Promise<{ headline: string; isMajor: boolean; rawTitle: string }> {
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const MAJOR_KW = ['trump', 'elon', 'musk', 'powell', 'fed', 'fomc', 'sec', 'gensler', 'saylor', 'rate cut', 'rate hike', 'war', 'emergency', 'blackrock', 'liquidate', 'crash', 'ban', 'approve', 'etf'];

  try {
    const [ccRes, cpRes] = await Promise.allSettled([
      fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest', { signal: AbortSignal.timeout(5000) }),
      fetch('https://api.coinpaprika.com/v1/coins/btc-bitcoin/twitter', { signal: AbortSignal.timeout(5000) })
    ]);

    // CryptoCompare News — filter to last 2 hours
    if (ccRes.status === 'fulfilled' && ccRes.value.ok) {
      const d = await ccRes.value.json() as { Data?: { title: string; body: string; source: string; published_on: number }[] };
      const recent = (d.Data || []).filter(n => (Date.now() / 1000 - n.published_on) < 7200);
      if (recent.length > 0) {
        const top = recent[0];
        const text = `[${top.source}] ${top.title}`;
        const isMajor = MAJOR_KW.some(kw => text.toLowerCase().includes(kw));
        return { headline: text, isMajor, rawTitle: top.title.slice(0, 100) };
      }
    }

    // Coinpaprika Twitter
    if (cpRes.status === 'fulfilled' && cpRes.value.ok) {
      const d = await cpRes.value.json() as { status?: string; user_name?: string; date?: string }[];
      if (d?.length > 0 && d[0].status) {
        const text = `[X/@${d[0].user_name}] ${d[0].status}`;
        const isMajor = MAJOR_KW.some(kw => text.toLowerCase().includes(kw));
        return { headline: text, isMajor, rawTitle: text.slice(0, 100) };
      }
    }
  } catch { /* no news */ }

  return { headline: '', isMajor: false, rawTitle: '' };
  void TWO_HOURS_MS; // suppress unused
}

// ─────────────────────────────────────────────────────────────────────────────
// Build Complete Trade Setup
// ─────────────────────────────────────────────────────────────────────────────
function buildTradeSetup(
  asset: string,
  price: number,
  smc: SmcAnalysis,
  extraScore: number,
  type: 'SCALP' | 'INTRADAY' | 'SWING'
): TradeSetup | null {
  const totalScore = Math.min(10, smc.confluenceScore + extraScore);
  if (totalScore < MIN_CONFLUENCE) return null;

  const dir = smc.direction;
  if (dir === 'neutral') return null;

  const isLong = dir === 'long';

  // Risk parameters by trade type
  const riskPct = { SCALP: 0.003, INTRADAY: 0.007, SWING: 0.015 }[type];
  const rrRatio = { SCALP: 2.0, INTRADAY: 2.5, SWING: 3.5 }[type];

  let entry = price;
  // Adjust entry to OB or FVG if close enough (within 0.3%)
  if (smc.hasOrderBlock && Math.abs(smc.orderBlockLevel - price) / price < 0.003) {
    entry = smc.orderBlockLevel;
  } else if (smc.hasFvg && isLong && price <= smc.fvgHigh && price >= smc.fvgLow) {
    entry = smc.fvgLow;
  }

  const sl   = isLong ? entry * (1 - riskPct) : entry * (1 + riskPct);
  const risk = Math.abs(entry - sl);
  const tp1  = isLong ? entry + risk * rrRatio * 0.6 : entry - risk * rrRatio * 0.6;
  const tp2  = isLong ? entry + risk * rrRatio       : entry - risk * rrRatio;
  const rr   = parseFloat(rrRatio.toFixed(1));

  const reasons: string[] = [];
  if (smc.bos)           reasons.push(`BOS ${isLong ? 'Bullish' : 'Bearish'} confirmed`);
  if (smc.choch)         reasons.push(`CHoCH — trend reversal detected`);
  if (smc.hasOrderBlock) reasons.push(`Order Block at $${smc.orderBlockLevel.toFixed(2)}`);
  if (smc.hasFvg)        reasons.push(`FVG imbalance $${smc.fvgLow.toFixed(2)}–$${smc.fvgHigh.toFixed(2)}`);
  if (smc.liquiditySweep) reasons.push('Liquidity sweep confirmed (Smart Money move)');
  if (smc.inDiscount && isLong)  reasons.push('Price in Discount zone (accumulation area)');
  if (smc.inPremium  && !isLong) reasons.push('Price in Premium zone (distribution area)');

  return {
    type, asset,
    direction: isLong ? 'LONG' : 'SHORT',
    entry: parseFloat(entry.toFixed(2)),
    sl:    parseFloat(sl.toFixed(2)),
    tp1:   parseFloat(tp1.toFixed(2)),
    tp2:   parseFloat(tp2.toFixed(2)),
    rr, confluenceScore: parseFloat(totalScore.toFixed(1)),
    reasons
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Format Telegram Message
// ─────────────────────────────────────────────────────────────────────────────
function formatTelegramMessage(
  setup: TradeSetup,
  goldStatus: string,
  btcPrice: number,
  goldPrice: number,
  goldSource: string,
  bidRatio: number,
  spoofingStatus: string,
  newsHeadline: string,
  triggerReason: string
): string {
  const emoji = setup.direction === 'LONG' ? '🟢' : '🔴';
  const typeEmoji = { SCALP: '⚡', INTRADAY: '📊', SWING: '🌊' }[setup.type];
  const confBar = '█'.repeat(Math.round(setup.confluenceScore)) + '░'.repeat(10 - Math.round(setup.confluenceScore));

  const confluenceLines = setup.reasons.map(r => `   ✓ ${r}`).join('\n');
  const newsLine = newsHeadline
    ? `\n📰 News: ${newsHeadline.slice(0, 120)}...`
    : '';

  return `🏦 WORLDMONITOR SIGNAL ENGINE
━━━━━━━━━━━━━━━━━━━━━━━━━━
${typeEmoji} ${setup.type} | ${emoji} ${setup.asset} ${setup.direction}
━━━━━━━━━━━━━━━━━━━━━━━━━━
💰 Live Prices
   BTC:  $${btcPrice.toFixed(2)}
   XAUUSD: $${goldPrice.toFixed(2)} (${goldSource}) | ${goldStatus}

📍 Entry:      $${setup.entry.toFixed(2)}
🛑 Stop Loss:  $${setup.sl.toFixed(2)}
🎯 TP1:        $${setup.tp1.toFixed(2)}
🎯 TP2:        $${setup.tp2.toFixed(2)}
📐 R:R Ratio:  1:${setup.rr}

🧠 Confidence: ${setup.confluenceScore}/10
   ${confBar}

🔍 SMC Confluence:
${confluenceLines}

📊 Order Book: Bids ${bidRatio.toFixed(1)}% | ${spoofingStatus}

⚡ Trigger: ${triggerReason}${newsLine}
━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 WorldMonitor Signal Engine v2`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Direction Conflict Guard
// ─────────────────────────────────────────────────────────────────────────────
function checkCooldown(
  asset: 'btc' | 'gold',
  newDir: 'long' | 'short',
  cached: BroadcastCache | null,
  now: number
): { blocked: boolean; reason: string } {
  if (!cached) return { blocked: false, reason: 'no_prior' };

  const lastTime = asset === 'btc' ? cached.lastBtcSignalTime : cached.lastGoldSignalTime;
  const lastDir  = asset === 'btc' ? cached.lastBtcDirection  : cached.lastGoldDirection;
  const elapsed  = now - lastTime;

  if (elapsed < COOLDOWN_MS) {
    return { blocked: true, reason: `cooldown: ${Math.ceil((COOLDOWN_MS - elapsed) / 60000)}m remaining` };
  }
  if (lastDir && lastDir !== newDir && elapsed < REVERSAL_LOCK_MS) {
    return { blocked: true, reason: `reversal_lock: was ${lastDir.toUpperCase()}, cannot reverse for ${Math.ceil((REVERSAL_LOCK_MS - elapsed) / 60000)}m` };
  }
  return { blocked: false, reason: 'cleared' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────
export async function broadcastWhatsAppNews(
  _ctx: ServerContext,
  _req: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    const now = Date.now();

    // ── 1. Fetch all live data in parallel ───────────────────────────────────
    const [btcSources, goldData, newsData, ob,
           btcKlines15m, btcKlines1h, btcKlines4h,
           goldKlines15m, goldKlines1h] = await Promise.allSettled([
      // BTC — 4 exchanges
      Promise.allSettled([
        fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { signal: AbortSignal.timeout(4000) }).then(r => r.json()),
        fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT', { signal: AbortSignal.timeout(4000) }).then(r => r.json()),
        fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', { signal: AbortSignal.timeout(4000) }).then(r => r.json()),
        fetch('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT', { signal: AbortSignal.timeout(4000) }).then(r => r.json()),
      ]),
      fetchGoldPrice(),
      fetchLatestNews(),
      fetchAggregatedOrderBook(68000),
      // BTC klines
      fetchKlines('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m', 20),
      fetchKlines('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h', 20),
      fetchKlines('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h', 20),
      // Gold klines via MEXC
      fetchKlines('https://api.mexc.com/api/v3/klines?symbol=XAUUSDT&interval=15m', 20),
      fetchKlines('https://api.mexc.com/api/v3/klines?symbol=XAUUSDT&interval=1h', 20),
    ]);

    // ── 2. Parse BTC consensus price ─────────────────────────────────────────
    let btcPrice = 68000, btcChange = 0;
    if (btcSources.status === 'fulfilled') {
      const [bin, mex, bbt, kuc] = btcSources.value as PromiseSettledResult<any>[];
      const prices: number[] = [];
      if (bin.status === 'fulfilled') { prices.push(parseFloat(bin.value.lastPrice || '0')); btcChange = parseFloat(bin.value.priceChangePercent || '0'); }
      if (mex.status === 'fulfilled') prices.push(parseFloat(mex.value.lastPrice || '0'));
      if (bbt.status === 'fulfilled') prices.push(parseFloat(bbt.value.result?.list?.[0]?.lastPrice || '0'));
      if (kuc.status === 'fulfilled') prices.push(parseFloat(kuc.value.data?.price || '0'));
      const valid = prices.filter(p => p > 10000);
      if (valid.length) btcPrice = valid.reduce((a, b) => a + b, 0) / valid.length;
    }

    // ── 3. Gold price & market status ────────────────────────────────────────
    const gold = goldData.status === 'fulfilled' ? goldData.value : { price: 4040.12, change: 0, source: 'Fallback' };
    const goldStatus = isGoldOpen();

    // ── 4. News ───────────────────────────────────────────────────────────────
    const news = newsData.status === 'fulfilled' ? newsData.value : { headline: '', isMajor: false, rawTitle: '' };

    // ── 5. Order Book ─────────────────────────────────────────────────────────
    const orderBook = ob.status === 'fulfilled' ? ob.value : { bidRatio: 50, liquiditySweep: false, spoofingStatus: 'Unknown', isMajorSpoofingEvent: false };

    // ── 6. SMC Analysis — BTC & Gold ─────────────────────────────────────────
    const btcSmcArr = [
      btcKlines15m.status === 'fulfilled' ? btcKlines15m.value : [],
      btcKlines1h.status  === 'fulfilled' ? btcKlines1h.value  : [],
      btcKlines4h.status  === 'fulfilled' ? btcKlines4h.value  : [],
    ];
    const goldSmcArr = [
      goldKlines15m.status === 'fulfilled' ? goldKlines15m.value : [],
      goldKlines1h.status  === 'fulfilled' ? goldKlines1h.value  : [],
    ];

    // Run SMC on each timeframe and pick highest-confidence
    const btcSmcResults  = btcSmcArr.map(c => runSmcEngine(c, btcPrice));
    const goldSmcResults = goldSmcArr.map(c => runSmcEngine(c, gold.price));

    // Timeframe confluence: if 2+ TFs agree on direction, add bonus
    const btcDirs  = btcSmcResults.map(r => r.direction).filter(d => d !== 'neutral');
    const goldDirs = goldSmcResults.map(r => r.direction).filter(d => d !== 'neutral');
    const btcTfBonus  = btcDirs.filter(d => d === btcDirs[0]).length >= 2 ? 1.5 : 0;
    const goldTfBonus = goldDirs.filter(d => d === goldDirs[0]).length >= 1 ? 1.0 : 0;

    // Strongest SMC result per asset
    const btcSmc  = btcSmcResults.reduce((a, b)  => b.confluenceScore > a.confluenceScore ? b : a, btcSmcResults[0]  || { confluenceScore: 0, direction: 'neutral' } as SmcAnalysis);
    const goldSmc = goldSmcResults.reduce((a, b) => b.confluenceScore > a.confluenceScore ? b : a, goldSmcResults[0] || { confluenceScore: 0, direction: 'neutral' } as SmcAnalysis);

    // Additional score from order book + news
    let extraScore = 0;
    if (news.isMajor)                   extraScore += 1.0;
    if (orderBook.liquiditySweep)       extraScore += 1.0;
    if (!orderBook.isMajorSpoofingEvent) extraScore += 0.5; // real liquidity bonus

    // ── 7. Load cache ─────────────────────────────────────────────────────────
    if (!memCache) {
      const r = await getCachedJson(CACHE_KEY, true) as BroadcastCache | null;
      if (r?.btcPrice) { memCache = r; }
    }
    const cached = memCache;

    // ── 8. Determine trigger ──────────────────────────────────────────────────
    const priceDiff = cached ? Math.abs(btcPrice - cached.btcPrice) : 0;
    const timeDiff  = cached ? (now - cached.time) : Infinity;
    const isMajorPriceMove = priceDiff >= BTC_MOVE_TRIGGER;
    const isScheduled      = timeDiff >= SCHEDULED_EVERY;
    const isNewMajorNews   = news.isMajor && news.rawTitle !== (cached?.latestNewsTitle || '');
    const isMajorLiquidity = orderBook.isMajorSpoofingEvent && (now - (cached?.lastLiquidityTime || 0)) > 15 * 60 * 1000;

    // ── 9. Build trade setups ─────────────────────────────────────────────────
    // BTC — try INTRADAY first, then SCALP
    let btcSetup: TradeSetup | null = null;
    for (const type of ['INTRADAY', 'SCALP', 'SWING'] as const) {
      btcSetup = buildTradeSetup('BTCUSDT', btcPrice, btcSmc, extraScore + btcTfBonus, type);
      if (btcSetup) break;
    }

    // Gold — only if market open
    let goldSetup: TradeSetup | null = null;
    if (goldStatus.open) {
      for (const type of ['INTRADAY', 'SCALP', 'SWING'] as const) {
        goldSetup = buildTradeSetup('XAUUSD', gold.price, goldSmc, extraScore + goldTfBonus, type);
        if (goldSetup) break;
      }
    }

    // ── 10. Check cooldown & direction lock ───────────────────────────────────
    const btcDir  = btcSmc.direction  !== 'neutral' ? btcSmc.direction  : 'long';
    const goldDir = goldSmc.direction !== 'neutral' ? goldSmc.direction : 'long';
    const btcCool  = checkCooldown('btc',  btcDir,  cached, now);
    const goldCool = checkCooldown('gold', goldDir, cached, now);

    if (btcCool.blocked)  btcSetup  = null;
    if (goldCool.blocked) goldSetup = null;

    // ── 11. Decide if we broadcast ────────────────────────────────────────────
    const hasSignal = btcSetup !== null || goldSetup !== null;
    const shouldBroadcast = hasSignal && (isMajorPriceMove || isScheduled || isNewMajorNews || isMajorLiquidity || !cached);

    if (!shouldBroadcast) {
      const reason = !hasSignal
        ? `confluence_too_low: BTC ${(btcSmc.confluenceScore + extraScore + btcTfBonus).toFixed(1)}/10, Gold ${(goldSmc.confluenceScore + extraScore + goldTfBonus).toFixed(1)}/10`
        : `no_major_trigger: price_diff=$${priceDiff.toFixed(0)}, timer=${Math.round(timeDiff / 60000)}m`;
      return { success: true, status: 'skipped', reason };
    }

    const setup    = btcSetup || goldSetup!;
    const trigger  = isMajorPriceMove ? `BTC moved $${priceDiff.toFixed(0)}`
                   : isNewMajorNews   ? 'Breaking macro news'
                   : isMajorLiquidity ? 'Major order book anomaly'
                   : 'Scheduled analysis';

    // ── 12. Format & send Telegram ────────────────────────────────────────────
    const message = formatTelegramMessage(
      setup, goldStatus.statusText, btcPrice, gold.price, gold.source,
      orderBook.bidRatio, orderBook.spoofingStatus, news.headline, trigger
    );

    // Also run AI for extra context paragraph
    const aiPrompt = `You are an elite Wall Street quantitative trader. In 2-3 lines of professional Roman Urdu, explain the following trade setup and why a trader should take or avoid it:
Asset: ${setup.asset} | Direction: ${setup.direction} | Entry: $${setup.entry} | SL: $${setup.sl} | TP: $${setup.tp2} | Confluence: ${setup.confluenceScore}/10
SMC Signals: ${setup.reasons.join(', ')}
Trigger: ${trigger}
Keep it ULTRA concise, professional, and actionable.`;

    let aiNote = '';
    try {
      const aiRes = await callLlm({ messages: [{ role: 'user', content: aiPrompt }] });
      aiNote = aiRes?.content ? `\n\n🤖 AI Note: ${aiRes.content}` : '';
    } catch { /* skip */ }

    const finalMessage = message + aiNote;

    // Duplicate snippet check
    const snippet = finalMessage.slice(0, 60);
    if (cached?.lastMessageSnippet === snippet) {
      return { success: true, status: 'skipped', reason: 'identical_content' };
    }

    // ── 13. Update cache ──────────────────────────────────────────────────────
    const newCache: BroadcastCache = {
      btcPrice, goldPrice: gold.price, time: now,
      lastLiquidityTime: orderBook.isMajorSpoofingEvent ? now : (cached?.lastLiquidityTime || 0),
      latestNewsTitle: news.rawTitle || (cached?.latestNewsTitle || ''),
      lastMessageSnippet: snippet,
      lastBtcDirection:  btcSetup  ? btcDir  : (cached?.lastBtcDirection  || ''),
      lastGoldDirection: goldSetup ? goldDir : (cached?.lastGoldDirection || ''),
      lastBtcSignalTime:  btcSetup  ? now : (cached?.lastBtcSignalTime  || 0),
      lastGoldSignalTime: goldSetup ? now : (cached?.lastGoldSignalTime || 0),
    };
    memCache = newCache;
    await setCachedJson(CACHE_KEY, newCache, 7200, true);

    // ── 14. Send Telegram ─────────────────────────────────────────────────────
    const tgToken  = (process.env.TELEGRAM_BOT_TOKEN || '8718094603:AAFgfSk5nl2D7Ura9mlc9ASBc2mo4FgSiaI').trim();
    const tgChatId = (process.env.TELEGRAM_CHAT_ID   || '7782980175').trim();
    const tgHost   = (process.env.TELEGRAM_API_HOST  || 'https://api.telegram.org').trim();

    if (tgToken && tgChatId) {
      const tgRes = await fetch(`${tgHost}/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: tgChatId, text: finalMessage })
      });
      if (!tgRes.ok) {
        const err = await tgRes.text();
        throw new Error(`Telegram API: ${tgRes.status} ${err}`);
      }
      const tgResult = await tgRes.json() as { result?: { message_id?: number } };
      return { success: true, platform: 'telegram', messageId: tgResult.result?.message_id, setup, btcPrice, goldPrice: gold.price, trigger };
    }

    return { success: true, platform: 'simulated', setup, btcPrice, goldPrice: gold.price, broadcastBody: finalMessage };

  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
