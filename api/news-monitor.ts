/**
 * Real-Time News Monitor + Multi-Timeframe Signal Engine
 * Called by GitHub Actions every 5 minutes.
 *
 * GET /api/news-monitor        → returns current market status + last signal
 * POST /api/news-monitor       → triggers full news check + multi-TF analysis + Telegram
 */

// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';

export const config = { runtime: 'edge' };

// ─── Types ────────────────────────────────────────────────────────────────────
interface Candle {
  open: number; high: number; low: number; close: number; volume: number;
}
interface TfSignal {
  tf: string;
  label: string;
  typeEmoji: string;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  entry: number;
  sl: number;
  tp: number;
  rr: number;
  confluenceScore: number;
  trend: string;
  reasons: string[];
}

// ─── In-memory last-seen news cache (persists within same Edge instance) ──────
let lastSeenNewsId = '';
let lastSignalTime = 0;
const NEWS_COOLDOWN_MS = 4 * 60 * 1000; // 4 min between same news bursts

// ─── Gold Market Hours ────────────────────────────────────────────────────────
function goldIsOpen(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  const minOfDay = now.getUTCHours() * 60 + now.getUTCMinutes();
  const FRI_CLOSE = 21 * 60 + 59;
  const SUN_OPEN  = 22 * 60;
  return !(day === 6 || (day === 5 && minOfDay >= FRI_CLOSE) || (day === 0 && minOfDay < SUN_OPEN));
}
function goldStatusText(): string {
  if (!goldIsOpen()) {
    const now = new Date();
    const d = now.getUTCDay();
    const m = now.getUTCHours() * 60 + now.getUTCMinutes();
    const remaining = d === 0 ? Math.round((22 * 60 - m) / 60) : null;
    return remaining !== null ? `🔴 Market Closed — Opens in ~${remaining}h (Sun 22:00 UTC)` : '🔴 Market Closed (Weekend)';
  }
  return '🟢 Market Open (FOREX 24/5)';
}

// ─── Fetch klines → Candle[] ──────────────────────────────────────────────────
async function fetchKlines(url: string, limit = 25): Promise<Candle[]> {
  try {
    const r = await fetch(`${url}&limit=${limit}`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return [];
    const raw = await r.json() as [string, string, string, string, string, string][];
    if (!Array.isArray(raw) || raw.length < 3) return [];
    return raw.map(c => ({
      open: parseFloat(c[1]), high: parseFloat(c[2]),
      low: parseFloat(c[3]),  close: parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  } catch { return []; }
}

// ─── SMC Analysis (Order Block, FVG, BOS, CHoCH, Liquidity Sweep) ────────────
function smcAnalyze(candles: Candle[], price: number): {
  direction: 'long' | 'short' | 'neutral';
  score: number;
  obLevel: number;
  fvgLow: number;
  fvgHigh: number;
  hasFvg: boolean;
  hasOb: boolean;
  bos: boolean;
  choch: boolean;
  sweep: boolean;
  inDiscount: boolean;
  inPremium: boolean;
  swingHigh: number;
  swingLow: number;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (candles.length < 5) return {
    direction: 'neutral', score: 0, obLevel: 0, fvgLow: 0, fvgHigh: 0,
    hasFvg: false, hasOb: false, bos: false, choch: false, sweep: false,
    inDiscount: false, inPremium: false, swingHigh: price, swingLow: price, reasons
  };

  const lb = candles.slice(-12);
  const swingHigh = Math.max(...lb.map(c => c.high));
  const swingLow  = Math.min(...lb.map(c => c.low));
  const mid       = (swingHigh + swingLow) / 2;
  const inDiscount = price < mid;
  const inPremium  = price > mid;

  // FVG detection
  let hasFvg = false, fvgLow = 0, fvgHigh = 0;
  for (let i = candles.length - 4; i >= Math.max(0, candles.length - 10); i--) {
    const c1 = candles[i], c3 = candles[i + 2];
    if (!c1 || !c3) continue;
    if (c1.high < c3.low && (c3.low - c1.high) / c1.high > 0.0003) {
      hasFvg = true; fvgLow = c1.high; fvgHigh = c3.low;
      reasons.push(`Bullish FVG $${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)}`);
      break;
    }
    if (c1.low > c3.high && (c1.low - c3.high) / c1.low > 0.0003) {
      hasFvg = true; fvgLow = c3.high; fvgHigh = c1.low;
      reasons.push(`Bearish FVG $${fvgLow.toFixed(2)}–$${fvgHigh.toFixed(2)}`);
      break;
    }
  }

  // Order Block
  let hasOb = false, obLevel = 0;
  for (let i = candles.length - 5; i < candles.length - 1; i++) {
    const c = candles[i], next = candles[i + 1];
    if (!c || !next) continue;
    const body = Math.abs(c.close - c.open);
    const nextBody = Math.abs(next.close - next.open);
    if (c.close < c.open && next.close > next.open && nextBody > body * 1.4) {
      hasOb = true; obLevel = c.low;
      reasons.push(`Bullish OB at $${obLevel.toFixed(2)}`);
      break;
    }
    if (c.close > c.open && next.close < next.open && nextBody > body * 1.4) {
      hasOb = true; obLevel = c.high;
      reasons.push(`Bearish OB at $${obLevel.toFixed(2)}`);
      break;
    }
  }

  // BOS
  const last = candles[candles.length - 1];
  const prev5 = candles.slice(-6, -1);
  const pH = Math.max(...prev5.map(c => c.high));
  const pL  = Math.min(...prev5.map(c => c.low));
  let bos = false;
  let direction: 'long' | 'short' | 'neutral' = 'neutral';
  if (last.close > pH) { bos = true; direction = 'long';  reasons.push('BOS Bullish (Break of Structure)'); }
  if (last.close < pL) { bos = true; direction = 'short'; reasons.push('BOS Bearish (Break of Structure)'); }

  // CHoCH
  let choch = false;
  if (candles.length >= 8) {
    const fh = candles.slice(0, 4);
    const sh = candles.slice(-4);
    const prevUp   = fh[fh.length - 1].close > fh[0].close;
    const recentUp = sh[sh.length - 1].close > sh[0].close;
    if (prevUp !== recentUp) {
      choch = true;
      direction = recentUp ? 'long' : 'short';
      reasons.push(`CHoCH — Trend Reversal to ${direction.toUpperCase()}`);
    }
  }

  // Liquidity Sweep
  let sweep = false;
  if (candles.length >= 3) {
    const c = candles[candles.length - 1];
    const pr = candles[candles.length - 2];
    if (c.low < swingLow && c.close > pr.low) {
      sweep = true; if (direction === 'neutral') direction = 'long';
      reasons.push('Liquidity Sweep (equal lows swept → Long)');
    }
    if (c.high > swingHigh && c.close < pr.high) {
      sweep = true; if (direction === 'neutral') direction = 'short';
      reasons.push('Liquidity Sweep (equal highs swept → Short)');
    }
  }

  if (inDiscount && direction === 'long')  reasons.push('Price in Discount Zone ✓');
  if (inPremium  && direction === 'short') reasons.push('Price in Premium Zone ✓');

  let score = 0;
  if (bos)    score += 2.0;
  if (choch)  score += 1.5;
  if (hasOb)  score += 2.0;
  if (hasFvg) score += 1.5;
  if (sweep)  score += 1.5;
  if ((inDiscount && direction === 'long') || (inPremium && direction === 'short')) score += 0.5;

  return {
    direction, score: Math.min(10, score), obLevel, fvgLow, fvgHigh,
    hasFvg, hasOb, bos, choch, sweep, inDiscount, inPremium,
    swingHigh, swingLow, reasons
  };
}

// ─── Build TF Signal ──────────────────────────────────────────────────────────
function buildTfSignal(
  tf: string, label: string, typeEmoji: string,
  candles: Candle[], price: number,
  riskPct: number, rrTarget: number
): TfSignal {
  const smc = smcAnalyze(candles, price);
  const dir = smc.direction;

  if (dir === 'neutral' || smc.score < 4) {
    return { tf, label, typeEmoji, direction: 'WAIT', entry: price, sl: 0, tp: 0, rr: 0, confluenceScore: smc.score, trend: 'No clear setup', reasons: smc.reasons };
  }

  const isLong = dir === 'long';
  let entry = price;
  if (smc.hasOb && Math.abs(smc.obLevel - price) / price < 0.004) entry = smc.obLevel;
  else if (smc.hasFvg && isLong && price <= smc.fvgHigh && price >= smc.fvgLow) entry = smc.fvgLow;

  const sl  = isLong ? entry * (1 - riskPct) : entry * (1 + riskPct);
  const risk = Math.abs(entry - sl);
  const tp  = isLong ? entry + risk * rrTarget : entry - risk * rrTarget;
  const rr  = parseFloat(rrTarget.toFixed(1));

  const trendStr = smc.bos ? `${isLong ? '🟢' : '🔴'} BOS ${isLong ? 'Bullish' : 'Bearish'}`
                 : smc.choch ? `${isLong ? '🟢' : '🔴'} CHoCH Reversal`
                 : `${isLong ? '🟢' : '🔴'} ${isLong ? 'Bullish' : 'Bearish'} Bias`;

  return {
    tf, label, typeEmoji,
    direction: isLong ? 'LONG' : 'SHORT',
    entry: parseFloat(entry.toFixed(2)),
    sl:    parseFloat(sl.toFixed(2)),
    tp:    parseFloat(tp.toFixed(2)),
    rr, confluenceScore: parseFloat(smc.score.toFixed(1)),
    trend: trendStr,
    reasons: smc.reasons
  };
}

// ─── Format one TF block ──────────────────────────────────────────────────────
function fmtTfBlock(s: TfSignal): string {
  if (s.direction === 'WAIT') {
    return `━━━ ${s.typeEmoji} ${s.label} ━━━\n${s.trend} — Confluence: ${s.confluenceScore}/10\n⏳ Wait — No strong setup yet`;
  }
  const dir = s.direction === 'LONG' ? '🟢 LONG' : '🔴 SHORT';
  const confBar = '█'.repeat(Math.round(s.confluenceScore)) + '░'.repeat(10 - Math.round(s.confluenceScore));
  const topReasons = s.reasons.slice(0, 3).map(r => `   • ${r}`).join('\n');
  return `━━━ ${s.typeEmoji} ${s.label} ━━━
Trend: ${s.trend}
${dir} | Confidence: ${s.confluenceScore}/10 [${confBar}]
📍 Entry: $${s.entry}  🛑 SL: $${s.sl}  🎯 TP: $${s.tp}
📐 R:R: 1:${s.rr}
${topReasons}`;
}

// ─── Fetch Gold price ─────────────────────────────────────────────────────────
async function fetchGold(): Promise<{ price: number; change: number; source: string }> {
  const attempts = [
    () => fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=XAUUSDT', { signal: AbortSignal.timeout(4000) })
      .then(r => r.json() as Promise<{ lastPrice?: string; priceChangePercent?: string }>)
      .then(d => ({ price: parseFloat(d.lastPrice || '0'), change: parseFloat(d.priceChangePercent || '0'), source: 'MEXC' })),
    () => fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=XAUUSDT', { signal: AbortSignal.timeout(4000) })
      .then(r => r.json() as Promise<{ result?: { list?: { lastPrice?: string }[] } }>)
      .then(d => ({ price: parseFloat(d.result?.list?.[0]?.lastPrice || '0'), change: 0, source: 'Bybit' })),
    () => fetch('https://min-api.cryptocompare.com/data/pricemultifull?fsyms=XAU&tsyms=USD', { signal: AbortSignal.timeout(5000) })
      .then(r => r.json() as Promise<{ RAW?: { XAU?: { USD?: { PRICE?: number; CHANGEPCT24HOUR?: number } } } }>)
      .then(d => ({ price: d.RAW?.XAU?.USD?.PRICE || 0, change: d.RAW?.XAU?.USD?.CHANGEPCT24HOUR || 0, source: 'CryptoCompare' }))
  ];
  for (const fn of attempts) {
    try { const r = await fn(); if (r.price > 1000 && r.price < 10000) return r; } catch { /**/ }
  }
  return { price: 4040.12, change: 0, source: 'Fallback' };
}

// ─── Fetch BTC consensus ──────────────────────────────────────────────────────
async function fetchBtc(): Promise<{ price: number; change: number }> {
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT', { signal: AbortSignal.timeout(4000) });
    const d = await r.json() as { lastPrice?: string; priceChangePercent?: string };
    return { price: parseFloat(d.lastPrice || '0') || 68000, change: parseFloat(d.priceChangePercent || '0') };
  } catch { return { price: 68000, change: 0 }; }
}

// ─── Fetch Breaking News (5 sources, last 10 minutes) ────────────────────────
async function fetchBreakingNews(): Promise<{
  headline: string; source: string; publishedAt: string; isMajor: boolean; id: string;
} | null> {
  const MAJOR_KW = ['trump', 'powell', 'fed', 'fomc', 'rate cut', 'rate hike', 'sec', 'ban',
                    'crash', 'emergency', 'elon', 'musk', 'saylor', 'blackrock', 'war',
                    'approve', 'reject', 'etf', 'liquidate', 'hack', 'attack'];
  const TEN_MIN = 10 * 60;

  try {
    const [ccRes, cpRes] = await Promise.allSettled([
      fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest', { signal: AbortSignal.timeout(5000) }),
      fetch('https://api.coinpaprika.com/v1/coins/btc-bitcoin/twitter', { signal: AbortSignal.timeout(5000) })
    ]);

    if (ccRes.status === 'fulfilled' && ccRes.value.ok) {
      const d = await ccRes.value.json() as { Data?: { id: string; title: string; source: string; published_on: number; url: string }[] };
      const recent = (d.Data || []).filter(n => (Date.now() / 1000 - n.published_on) < TEN_MIN);
      if (recent.length > 0) {
        const top = recent[0];
        if (top.id === lastSeenNewsId) return null;
        const isMajor = MAJOR_KW.some(kw => top.title.toLowerCase().includes(kw));
        return { headline: top.title, source: top.source, publishedAt: `${Math.round(Date.now() / 1000 - top.published_on / 1)} min ago`, isMajor, id: top.id };
      }
    }

    if (cpRes.status === 'fulfilled' && cpRes.value.ok) {
      const d = await cpRes.value.json() as { status?: string; user_name?: string; id?: string }[];
      if (d?.length > 0 && d[0].status) {
        const id = d[0].id?.toString() || '';
        if (id === lastSeenNewsId) return null;
        const isMajor = MAJOR_KW.some(kw => (d[0].status || '').toLowerCase().includes(kw));
        return { headline: d[0].status || '', source: `@${d[0].user_name}`, publishedAt: 'Just now', isMajor, id };
      }
    }
  } catch { /**/ }
  return null;
}

// ─── Send Telegram ────────────────────────────────────────────────────────────
async function sendTelegram(text: string): Promise<boolean> {
  const token  = (process.env.TELEGRAM_BOT_TOKEN || '8718094603:AAFgfSk5nl2D7Ura9mlc9ASBc2mo4FgSiaI').trim();
  const chatId = (process.env.TELEGRAM_CHAT_ID   || '7782980175').trim();
  const host   = (process.env.TELEGRAM_API_HOST  || 'https://api.telegram.org').trim();
  try {
    const r = await fetch(`${host}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    });
    return r.ok;
  } catch { return false; }
}

// ─── Main Handler ─────────────────────────────────────────────────────────────
export default async function handler(req: Request): Promise<Response> {
  const cors = getCorsHeaders(req, 'GET, POST, OPTIONS') as Record<string, string>;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  if (req.method === 'GET') {
    return jsonResponse({ status: 'ok', lastSignalTime, lastSeenNewsId, goldOpen: goldIsOpen() }, 200, cors);
  }

  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405, cors);

  const now = Date.now();

  try {
    // ── Fetch everything in parallel ──────────────────────────────────────────
    const [goldData, btcData, breakingNews,
           btc1m, btc1h, btc4h,
           xau15m, xau1h] = await Promise.allSettled([
      fetchGold(),
      fetchBtc(),
      fetchBreakingNews(),
      fetchKlines('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m', 30),
      fetchKlines('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h', 25),
      fetchKlines('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h', 25),
      fetchKlines('https://api.mexc.com/api/v3/klines?symbol=XAUUSDT&interval=15m', 25),
      fetchKlines('https://api.mexc.com/api/v3/klines?symbol=XAUUSDT&interval=1h',  25),
    ]);

    const gold   = goldData.status  === 'fulfilled' ? goldData.value  : { price: 4040.12, change: 0, source: 'Fallback' };
    const btc    = btcData.status   === 'fulfilled' ? btcData.value   : { price: 68000, change: 0 };
    const news   = breakingNews.status === 'fulfilled' ? breakingNews.value : null;
    const c1m    = btc1m.status  === 'fulfilled' ? btc1m.value  : [];
    const c1h    = btc1h.status  === 'fulfilled' ? btc1h.value  : [];
    const c4h    = btc4h.status  === 'fulfilled' ? btc4h.value  : [];
    const cXau15 = xau15m.status === 'fulfilled' ? xau15m.value : [];
    const cXau1h = xau1h.status  === 'fulfilled' ? xau1h.value  : [];

    const sentMessages: string[] = [];

    // ── BREAKING NEWS ALERT (fires immediately, no cooldown) ─────────────────
    if (news && (now - lastSignalTime) > NEWS_COOLDOWN_MS) {
      lastSeenNewsId = news.id;
      lastSignalTime = now;

      const btcImpact = news.headline.toLowerCase().includes('rate cut') || news.headline.toLowerCase().includes('approve') || news.headline.toLowerCase().includes('etf')
        ? '🟢 BULLISH — Positive for risk assets'
        : news.headline.toLowerCase().includes('ban') || news.headline.toLowerCase().includes('crash') || news.headline.toLowerCase().includes('hack')
        ? '🔴 BEARISH — Negative for risk assets'
        : '🟡 NEUTRAL — Monitor closely';

      const goldImpact = news.headline.toLowerCase().includes('rate cut') || news.headline.toLowerCase().includes('war') || news.headline.toLowerCase().includes('emergency')
        ? '🟢 BULLISH — Safe haven demand expected'
        : news.headline.toLowerCase().includes('rate hike')
        ? '🔴 BEARISH — Higher rates hurt Gold'
        : '🟡 NEUTRAL — Watch price reaction';

      const newsAlert = `🚨 BREAKING NEWS ALERT
━━━━━━━━━━━━━━━━━━━━━━━━━━
📰 [${news.source}] ${news.headline}
⏰ Published: ${news.publishedAt}
${news.isMajor ? '⭐ MAJOR EVENT — High Market Impact!' : ''}

⚡ Instant Impact Analysis:
   BTC:    ${btcImpact}
   XAUUSD: ${goldImpact}

💰 Current Prices:
   BTC: $${btc.price.toFixed(2)} (${btc.change > 0 ? '+' : ''}${btc.change.toFixed(2)}%)
   XAU: $${gold.price.toFixed(2)} | ${goldStatusText()}

━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 WorldMonitor News Engine`;

      await sendTelegram(newsAlert);
      sentMessages.push('news_alert');
    }

    // ── MULTI-TIMEFRAME SIGNAL REPORT ─────────────────────────────────────────
    // BTC signals
    const btcScalp    = buildTfSignal('1m',  '⚡ 1M SCALP (Quick Trade)',   '⚡', c1m,  btc.price, 0.003, 2.0);
    const btcIntraday = buildTfSignal('1h',  '📊 1H INTRADAY (Main Trade)', '📊', c1h,  btc.price, 0.007, 2.5);
    const btcSwing    = buildTfSignal('4h',  '🌊 4H SWING (Big Trade)',     '🌊', c4h,  btc.price, 0.015, 3.5);

    // Gold signals
    const xauScalp    = buildTfSignal('15m', '⚡ 15M SCALP (Quick Trade)',  '⚡', cXau15, gold.price, 0.003, 1.8);
    const xauIntraday = buildTfSignal('1h',  '📊 1H INTRADAY (Main Trade)', '📊', cXau1h, gold.price, 0.007, 2.5);

    // Best recommendation — highest confluence signal across all
    const allSignals = [btcScalp, btcIntraday, btcSwing, xauScalp, xauIntraday]
      .filter(s => s.direction !== 'WAIT')
      .sort((a, b) => b.confluenceScore - a.confluenceScore);
    const best = allSignals[0];

    const bestBlock = best
      ? `━━━ 🏆 BEST TRADE OF THE MOMENT ━━━
${best.typeEmoji} ${best.direction} ${best.tf.includes('m') ? 'XAUUSD' : 'BTC'} @ ${best.label}
📍 Entry: $${best.entry}  🛑 SL: $${best.sl}  🎯 TP: $${best.tp}
📐 R:R: 1:${best.rr} | Confidence: ${best.confluenceScore}/10
→ ${best.reasons[0] || 'Multi-TF confluence confirmed'}`
      : `━━━ 🏆 BEST TRADE OF THE MOMENT ━━━
⏳ No strong setup right now — Wait for clear confluence`;

    const multiTfReport = `📊 WORLDMONITOR — MULTI-TF ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━
🟠 BTC: $${btc.price.toFixed(2)} (${btc.change > 0 ? '+' : ''}${btc.change.toFixed(2)}%)
🥇 XAU: $${gold.price.toFixed(2)} (${gold.source}) | ${goldStatusText()}
⏰ ${new Date().toUTCString()}

━━━ 📈 BTC / USDT ━━━
${fmtTfBlock(btcScalp)}

${fmtTfBlock(btcIntraday)}

${fmtTfBlock(btcSwing)}

━━━ 🥇 XAUUSD (Gold) ━━━
${goldIsOpen() ? fmtTfBlock(xauScalp) + '\n\n' + fmtTfBlock(xauIntraday) : '🔴 Gold market is closed — Signals paused until Sunday 22:00 UTC'}

${bestBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━
📡 WorldMonitor Signal Engine v2
⏰ Next analysis in ~5 min`;

    await sendTelegram(multiTfReport);
    sentMessages.push('multi_tf_report');
    lastSignalTime = now;

    return jsonResponse({
      success: true,
      sent: sentMessages,
      btcPrice: btc.price,
      goldPrice: gold.price,
      goldOpen: goldIsOpen(),
      bestSignal: best ?? null,
      timestamp: new Date().toISOString()
    }, 200, cors);

  } catch (err: unknown) {
    return jsonResponse({ error: err instanceof Error ? err.message : String(err) }, 500, cors);
  }
}
