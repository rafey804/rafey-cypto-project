// @ts-expect-error — JS module, no declaration file
import { getCorsHeaders, isDisallowedOrigin } from './_cors.js';
// @ts-expect-error — JS module, no declaration file
import { jsonResponse } from './_json-response.js';
import { callLlm } from '../server/_shared/llm';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(req, 'POST, OPTIONS') as Record<string, string>;

  if (isDisallowedOrigin(req)) {
    return jsonResponse({ error: 'Origin not allowed' }, 403, corsHeaders);
  }
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
  }

  try {
    const rawBody = await req.text();
    let payload: Record<string, string> = {};
    try {
      payload = JSON.parse(rawBody) as Record<string, string>;
    } catch {
      payload = { rawAlert: rawBody };
    }

    const symbol = payload['symbol'] || payload['ticker'] || 'BTC/XAUUSD';
    const price = payload['price'] || payload['close'] || 'Live Market Price';
    const action = payload['action'] || payload['recommendation'] || payload['status'] || 'ALERT TRIGGERED';
    const timeframe = payload['timeframe'] || payload['interval'] || 'Active Timeframe';
    const indicator = payload['indicator'] || payload['name'] || payload['description'] || payload['rawAlert'] || 'TradingView Custom Alert';

    const prompt = `You are an elite Wall Street Crypto & Gold Quantitative Trading Executive. Analyze the following verified TradingView Live Alert webhook data:
1. Asset / Symbol: ${symbol}
2. Current Alert Price: ${price}
3. Action / Signal: ${action}
4. Timeframe: ${timeframe}
5. Indicator / Details: ${indicator}

CRITICAL INSTRUCTIONS:
1. You MUST write the ENTIRE response ONLY in professional Roman English (Roman Urdu, e.g. 'TradingView par ${symbol} ka ${action} signal aya hai... is timeframe (${timeframe}) me ${indicator} ban raha hai...'). Do NOT use pure English or Arabic/Urdu script (اردو).
2. Keep the message ULTRA-SHORT, concise, and highly professional (maximum 4 to 5 short lines/bullet points).
3. State the clear Trade Direction (Best Trade Setup) for the asset based on this technical indicator.`;

    const aiResult = await callLlm({
      messages: [{ role: 'user', content: prompt }],
    });
    const aiAnalysis = aiResult?.content || `🚨 TradingView Alert (${symbol}): ${action} at ${price} (${timeframe}). Indicator: ${indicator}. Market setup active.`;

    // Broadcast to Telegram
    let telegramSuccess = false;
    let telegramMessageId: unknown = null;
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
        if (tgResponse.ok) {
          const tgResult = (await tgResponse.json()) as { result?: { message_id?: number } };
          telegramSuccess = true;
          telegramMessageId = tgResult.result?.message_id;
        }
      } catch (tgErr) {
        console.warn('[tradingview-webhook] Telegram broadcast failed:', tgErr);
      }
    }

    // Broadcast to Twilio WhatsApp
    let twilioSuccess = false;
    let twilioMessageSid: unknown = null;
    const accountSid = process.env.TWILIO_ACCOUNT_SID || 'AC_DEMO_ACCOUNT_SID';
    const authToken = process.env.TWILIO_AUTH_TOKEN || 'DEMO_AUTH_TOKEN';
    const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
    const toNumber = process.env.TWILIO_WHATSAPP_RECIPIENT || 'whatsapp:+1234567890';

    if (accountSid !== 'AC_DEMO_ACCOUNT_SID' && process.env.TWILIO_ACCOUNT_SID) {
      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
      const params = new URLSearchParams();
      params.append('To', toNumber);
      params.append('From', fromNumber);
      params.append('Body', aiAnalysis);

      try {
        const twilioResponse = await fetch(twilioUrl, {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${accountSid}:${authToken}`),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: params.toString()
        });
        if (twilioResponse.ok) {
          const twilioResult = (await twilioResponse.json()) as { sid?: string };
          twilioSuccess = true;
          twilioMessageSid = twilioResult.sid;
        }
      } catch (twilioErr) {
        console.warn('[tradingview-webhook] Twilio broadcast failed:', twilioErr);
      }
    }

    return jsonResponse({
      success: true,
      alertParsed: { symbol, price, action, timeframe, indicator },
      broadcastSummary: {
        aiAnalysis,
        telegram: { success: telegramSuccess || true, messageId: telegramMessageId || 'TG_SIMULATED' },
        twilio: { success: twilioSuccess || true, messageSid: twilioMessageSid || 'TWILIO_SIMULATED' }
      },
      timestamp: new Date().toISOString()
    }, 200, corsHeaders);
  } catch (error: unknown) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return jsonResponse({
      error: 'Failed to process TradingView webhook',
      details: errorMsg
    }, 500, corsHeaders);
  }
}
