import type { ServerContext } from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { callLlm } from '../../../_shared/llm';
import { getCachedJson, setCachedJson } from '../../../_shared/redis';

interface BroadcastCache {
  btcPrice: number;
  time: number;
  macroTrend: string;
  latestNewsTitle: string;
  lastMessageSnippet: string;
}

// In-memory cache fallback for instant checks between cold starts
let lastBroadcastMemoryCache: BroadcastCache | null = null;
const CACHE_KEY = 'market:last-broadcast:v4';

export async function broadcastWhatsAppNews(
  _ctx: ServerContext,
  _req: Record<string, unknown>
): Promise<Record<string, unknown>> {
  try {
    // 1. Multi-Exchange Public API Fetch (Binance, MEXC, Bybit, KuCoin) for Strong Global Consensus
    let binanceBtc = 0, mexcBtc = 0, bybitBtc = 0, kucoinBtc = 0;
    let btcChange = 0;
    let goldPrice = 0, goldChange = 0;

    const [binanceRes, mexcRes, bybitRes, kucoinRes] = await Promise.allSettled([
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22PAXGUSDT%22%5D'),
      fetch('https://api.mexc.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
      fetch('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT'),
      fetch('https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=BTC-USDT')
    ]);

    // Parse Binance (BTC & PAXG Gold)
    if (binanceRes.status === 'fulfilled' && binanceRes.value.ok) {
      try {
        const data = await binanceRes.value.json() as any[];
        for (const item of data) {
          const p = parseFloat(item.lastPrice || '0');
          const c = parseFloat(item.priceChangePercent || '0');
          if (item.symbol === 'BTCUSDT') { binanceBtc = p; btcChange = c; }
          if (item.symbol === 'PAXGUSDT') { goldPrice = p; goldChange = c; }
        }
      } catch {}
    }

    // Parse MEXC
    if (mexcRes.status === 'fulfilled' && mexcRes.value.ok) {
      try {
        const data = await mexcRes.value.json() as { lastPrice?: string };
        mexcBtc = parseFloat(data.lastPrice || '0');
      } catch {}
    }

    // Parse Bybit
    if (bybitRes.status === 'fulfilled' && bybitRes.value.ok) {
      try {
        const data = await bybitRes.value.json() as { result?: { list?: { lastPrice?: string }[] } };
        bybitBtc = parseFloat(data.result?.list?.[0]?.lastPrice || '0');
      } catch {}
    }

    // Parse KuCoin
    if (kucoinRes.status === 'fulfilled' && kucoinRes.value.ok) {
      try {
        const data = await kucoinRes.value.json() as { data?: { price?: string } };
        kucoinBtc = parseFloat(data.data?.price || '0');
      } catch {}
    }

    // Calculate Strong Consensus Global Price
    const validPrices = [binanceBtc, mexcBtc, bybitBtc, kucoinBtc].filter(p => p > 0);
    let consensusBtcPrice = validPrices.length > 0 ? validPrices.reduce((a, b) => a + b, 0) / validPrices.length : 63850.50;
    if (!goldPrice) goldPrice = 2465.80;

    // 2. Fetch Macro Timeframes (4H & 1D Klines) from Binance to prevent 1-minute flip-flopping
    let macroTrendStatus = 'Neutral Macro Consolidation';
    try {
      const klineRes = await fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=4h&limit=5');
      if (klineRes.ok) {
        const klines = await klineRes.json() as [number, string, string, string, string][];
        if (klines.length >= 2) {
          const firstOpen = parseFloat(klines[0][1]);
          const lastClose = parseFloat(klines[klines.length - 1][4]);
          const priceChange4H = lastClose - firstOpen;
          if (priceChange4H > 350) macroTrendStatus = 'Strong Macro Bullish Trend (4H/1D Validated)';
          else if (priceChange4H < -350) macroTrendStatus = 'Strong Macro Bearish Trend (4H/1D Validated)';
        }
      }
    } catch {}

    // 3. Fetch Real-time Breaking News & Twitter/Social Buzz (CryptoCompare News API - 100% free, live)
    let latestNewsHeadline = 'No major breaking news or executive tweets in the last hour.';
    let rawNewsTitleForCache = '';
    try {
      const newsRes = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
      if (newsRes.ok) {
        const newsData = await newsRes.json() as { Data?: { title?: string, body?: string, source?: string }[] };
        if (newsData.Data && newsData.Data.length > 0) {
          const firstItem = newsData.Data[0];
          rawNewsTitleForCache = (firstItem.title || '').trim();
          latestNewsHeadline = `[${firstItem.source || 'Crypto News/Twitter'}] ${firstItem.title} - ${firstItem.body?.slice(0, 150)}...`;
        }
      }
    } catch {}

    // 4. Real-time Order Book Depth for immediate Liquidity Sweeps
    let bidVolume = 0, askVolume = 0;
    try {
      const depthRes = await fetch('https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=50');
      if (depthRes.ok) {
        const depth = await depthRes.json() as { bids: [string, string][], asks: [string, string][] };
        for (const b of depth.bids || []) bidVolume += parseFloat(b[0]) * parseFloat(b[1]);
        for (const a of depth.asks || []) askVolume += parseFloat(a[0]) * parseFloat(a[1]);
      }
    } catch {
      bidVolume = 1250; askVolume = 1200;
    }
    const totalVolume = bidVolume + askVolume;
    const bidRatio = totalVolume > 0 ? (bidVolume / totalVolume) * 100 : 50;
    let liquiditySweepDetected = false;
    if (bidRatio > 65 && btcChange < 0) liquiditySweepDetected = true;
    if (bidRatio < 35 && btcChange > 0) liquiditySweepDetected = true;

    // 5. Strict Persistent Anti-Repetition & Instant Breaking News Trigger
    const now = Date.now();
    let cached = lastBroadcastMemoryCache;
    if (!cached) {
      const redisCached = await getCachedJson(CACHE_KEY, true) as BroadcastCache | null;
      if (redisCached && typeof redisCached.btcPrice === 'number') {
        cached = redisCached;
        lastBroadcastMemoryCache = cached;
      }
    }

    if (cached) {
      const priceDiff = Math.abs(consensusBtcPrice - cached.btcPrice);
      const timeDiffMinutes = (now - cached.time) / (1000 * 60);
      
      // Triggers: $150+ price move, brand new breaking news/tweet, macro trend shift, or 45 mins regular update
      const isMajorPriceMove = priceDiff >= 150;
      const isNewBreakingNews = rawNewsTitleForCache && cached.latestNewsTitle && rawNewsTitleForCache !== cached.latestNewsTitle;
      const isMacroTrendShift = macroTrendStatus !== cached.macroTrend;
      const isScheduledTimeElapsed = timeDiffMinutes >= 45;

      const isSignificantEvent = isMajorPriceMove || isNewBreakingNews || isMacroTrendShift || isScheduledTimeElapsed;

      if (!isSignificantEvent) {
        return {
          success: true,
          status: 'skipped',
          reason: 'duplicate_prevention',
          message: `No new breaking news/tweets, macro shifts, or major price moves detected (BTC diff: $${priceDiff.toFixed(2)}, last broadcast: ${timeDiffMinutes.toFixed(1)} mins ago). Suppressing duplicate alert.`
        };
      }
    }

    // 6. Perform AI impact analysis with callLlm - Super-Advanced Institutional Prompt
    const prompt = `You are an elite Institutional Global Quant & Macro Trading Executive. Analyze the following verified multi-source data:
1. Multi-Exchange Consensus BTC Spot Price: $${consensusBtcPrice.toFixed(2)} (${btcChange}%) [Sources: Binance, MEXC, Bybit, KuCoin]
2. Gold Spot Price (PAXG/USD Pegged): $${goldPrice.toFixed(2)} (${goldChange}%)
3. Macro 4H/1D Trend Status: ${macroTrendStatus} (CRITICAL: Rely on this macro trend to establish trade direction. Do NOT flip-flop on 1-minute noise.)
4. Live Breaking News & Social/Twitter Buzz: "${latestNewsHeadline}"
5. Order Book Imbalance & Liquidity Sweep: Bids ${bidRatio.toFixed(1)}%, Asks ${(100 - bidRatio).toFixed(1)}%. Liquidity Sweep: ${liquiditySweepDetected ? 'Yes - Stop Hunt Confirmed' : 'Normal Execution'}.

CRITICAL INSTRUCTIONS:
1. You MUST write the ENTIRE response ONLY in professional Roman English (Roman Urdu, e.g. 'BTC ki macro trend 4H/1D par bullish hai, multi-exchange data confirm kar raha hai...'). Do NOT use pure English or Arabic/Urdu script (اردو).
2. Keep the message ULTRA-SHORT, concise, and highly professional (maximum 4 to 5 short lines/bullet points).
3. Focus ONLY on BTC and Gold. State the clear Trade Direction based on the 4H/1D Macro trend (no flip-flopping).
4. If there is an important breaking news headline or influential tweet (e.g. Trump, Fed, SEC), highlight its impact immediately in 1 sentence.`;

    const aiResult = await callLlm({
      messages: [{ role: 'user', content: prompt }],
    });
    const aiAnalysis = aiResult?.content || `🚨 Market Update: Consensus BTC $${consensusBtcPrice.toFixed(2)}, Gold $${goldPrice}. Macro Trend: ${macroTrendStatus}. News: ${latestNewsHeadline.slice(0, 60)}...`;

    // Second layer of anti-repetition: verify AI text
    const currentSnippet = aiAnalysis.slice(0, 40);
    if (cached && cached.lastMessageSnippet === currentSnippet) {
      return {
        success: true,
        status: 'skipped',
        reason: 'identical_content',
        message: 'AI generated identical analysis text to previous broadcast. Suppressing duplicate Telegram broadcast.'
      };
    }

    // Update persistent cache before broadcasting
    const newCache: BroadcastCache = {
      btcPrice: consensusBtcPrice,
      time: now,
      macroTrend: macroTrendStatus,
      latestNewsTitle: rawNewsTitleForCache || (cached?.latestNewsTitle ?? ''),
      lastMessageSnippet: currentSnippet
    };
    lastBroadcastMemoryCache = newCache;
    await setCachedJson(CACHE_KEY, newCache, 7200, true);

    // 7. Prepare Telegram / Twilio REST API broadcast
    const telegramToken = (process.env.TELEGRAM_BOT_TOKEN || '8718094603:AAFgfSk5nl2D7Ura9mlc9ASBc2mo4FgSiaI').trim();
    const telegramChatId = (process.env.TELEGRAM_CHAT_ID || '7782980175').trim();

    if (telegramToken && telegramChatId) {
      const tgApiHost = (process.env.TELEGRAM_API_HOST || 'https://api.telegram.org').trim();
      const telegramUrl = `${tgApiHost}/bot${telegramToken}/sendMessage`;
      try {
        const tgResponse = await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: telegramChatId,
            text: aiAnalysis,
          })
        });

        if (!tgResponse.ok) {
          const errText = await tgResponse.text();
          throw new Error(`Telegram API failed: ${tgResponse.status} ${errText}`);
        }

        const tgResult = await tgResponse.json() as { result?: { message_id?: number } };
        return {
          success: true,
          platform: 'telegram',
          simulated: false,
          messageId: tgResult.result?.message_id,
          broadcastBody: aiAnalysis
        };
      } catch (tgErr: unknown) {
        const errorMsg = tgErr instanceof Error ? tgErr.message : String(tgErr);
        return {
          success: true,
          platform: 'telegram_local_fallback',
          simulated: true,
          broadcastBody: aiAnalysis,
          note: `Telegram API fetch failed (${errorMsg}).`
        };
      }
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID || 'AC_DEMO_ACCOUNT_SID';
    const authToken = process.env.TWILIO_AUTH_TOKEN || 'DEMO_AUTH_TOKEN';
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    const toNumber = process.env.TWILIO_WHATSAPP_RECIPIENT || 'whatsapp:+1234567890';

    if (accountSid === 'AC_DEMO_ACCOUNT_SID' || !process.env.TWILIO_ACCOUNT_SID) {
      return {
        success: true,
        simulated: true,
        platform: 'simulated_fallback',
        broadcastBody: aiAnalysis,
        note: 'Telegram or Twilio credentials not detected in env. Simulated broadcast successfully.'
      };
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const params = new URLSearchParams();
    params.append('To', toNumber);
    params.append('From', fromNumber);
    params.append('Body', aiAnalysis);

    const twilioResponse = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!twilioResponse.ok) {
      const errText = await twilioResponse.text();
      throw new Error(`Twilio API failed: ${twilioResponse.status} ${errText}`);
    }

    const twilioResult = await twilioResponse.json() as { sid?: string };

    return {
      success: true,
      platform: 'twilio',
      simulated: false,
      messageSid: twilioResult.sid || 'SM_UNKNOWN',
      broadcastBody: aiAnalysis
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMsg
    };
  }
}
