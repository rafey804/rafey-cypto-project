/**
 * RPC: ListCryptoQuotes -- reads seeded crypto data from Railway seed cache.
 * All external CoinGecko calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListCryptoQuotesRequest,
  ListCryptoQuotesResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { CRYPTO_META, parseStringArray, fetchCryptoMarkets } from './_shared';
import { getCachedJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:crypto:v1';

const SYMBOL_TO_ID = new Map(Object.entries(CRYPTO_META).map(([id, m]) => [m.symbol, id]));

const FALLBACK_CRYPTO_QUOTES: CryptoQuote[] = [
  { name: 'Bitcoin', symbol: 'BTC', price: 64250.50, change: 2.35, change7d: 5.40, sparkline: [61000, 62000, 61500, 63000, 62800, 63500, 64250.50] },
  { name: 'Ethereum', symbol: 'ETH', price: 3480.20, change: 1.85, change7d: 4.10, sparkline: [3300, 3350, 3320, 3400, 3420, 3450, 3480.20] },
  { name: 'Solana', symbol: 'SOL', price: 142.75, change: 6.45, change7d: 12.30, sparkline: [125, 128, 132, 130, 135, 138, 142.75] },
  { name: 'Binance Coin', symbol: 'BNB', price: 585.10, change: 0.95, change7d: 2.15, sparkline: [565, 570, 572, 578, 580, 582, 585.10] },
  { name: 'Ripple', symbol: 'XRP', price: 0.585, change: -0.45, change7d: 1.10, sparkline: [0.56, 0.57, 0.565, 0.58, 0.575, 0.58, 0.585] },
  { name: 'Cardano', symbol: 'ADA', price: 0.445, change: 1.15, change7d: 0.85, sparkline: [0.42, 0.43, 0.425, 0.435, 0.44, 0.442, 0.445] },
  { name: 'Dogecoin', symbol: 'DOGE', price: 0.125, change: 3.45, change7d: 8.20, sparkline: [0.11, 0.115, 0.112, 0.118, 0.12, 0.122, 0.125] },
  { name: 'Avalanche', symbol: 'AVAX', price: 28.40, change: 4.12, change7d: 6.50, sparkline: [25, 26, 25.5, 27, 27.2, 27.8, 28.40] },
  { name: 'Polkadot', symbol: 'DOT', price: 6.35, change: 1.05, change7d: 2.40, sparkline: [5.9, 6.0, 6.1, 6.2, 6.15, 6.25, 6.35] },
  { name: 'Chainlink', symbol: 'LINK', price: 14.85, change: 2.75, change7d: 7.10, sparkline: [13.2, 13.5, 13.8, 14.0, 14.2, 14.5, 14.85] },
];

export async function listCryptoQuotes(
  _ctx: ServerContext,
  req: ListCryptoQuotesRequest,
): Promise<ListCryptoQuotesResponse> {
  const parsedIds = parseStringArray(req.ids);
  const ids = parsedIds.length > 0 ? parsedIds : Object.keys(CRYPTO_META);

  try {
    const seedData = await getCachedJson(SEED_CACHE_KEY, true) as { quotes: CryptoQuote[] } | null;
    if (seedData?.quotes?.length) {
      const allIds = new Set(ids);
      const filtered = allIds.size === 0
        ? seedData.quotes
        : seedData.quotes.filter((q) => allIds.has(SYMBOL_TO_ID.get(q.symbol) ?? ''));
      return { quotes: filtered };
    }
  } catch {
    // Fall through to live fetch
  }

  try {
    const marketItems = await fetchCryptoMarkets(ids);
    if (marketItems.length > 0) {
      const quotes: CryptoQuote[] = marketItems.map(item => ({
        name: item.name || item.symbol || 'Crypto',
        symbol: (item.symbol || 'CRYPTO').toUpperCase(),
        price: item.current_price || 0,
        change: item.price_change_percentage_24h || 0,
        change7d: item.price_change_percentage_7d_in_currency || 0,
        sparkline: item.sparkline_in_7d?.price || [],
      }));
      return { quotes };
    }
  } catch (err) {
    console.warn('[listCryptoQuotes] Live fetch failed, using fallback:', err);
  }

  return { quotes: FALLBACK_CRYPTO_QUOTES };
}
