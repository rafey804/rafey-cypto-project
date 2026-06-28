/**
 * RPC: ListOtherTokens -- reads seeded other/trending token data from Railway seed cache.
 */

import type {
  ServerContext,
  ListOtherTokensRequest,
  ListOtherTokensResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:other-tokens:v1';

type TokenSeedEntry = { name: string; symbol: string; price: number; change24h: number; change7d: number };

const FALLBACK_OTHER_TOKENS: CryptoQuote[] = [
  { name: 'Pepe', symbol: 'PEPE', price: 0.0000125, change: 15.45, change7d: 28.20, sparkline: [0.000010, 0.000011, 0.0000125] },
  { name: 'Shiba Inu', symbol: 'SHIB', price: 0.0000185, change: 4.25, change7d: 8.40, sparkline: [0.000017, 0.000018, 0.0000185] },
  { name: 'Floki', symbol: 'FLOKI', price: 0.000175, change: 8.15, change7d: 14.80, sparkline: [0.00015, 0.00016, 0.000175] },
  { name: 'Bonk', symbol: 'BONK', price: 0.0000245, change: 12.30, change7d: 21.40, sparkline: [0.000020, 0.000022, 0.0000245] },
  { name: 'dogwifhat', symbol: 'WIF', price: 2.45, change: 18.50, change7d: 35.20, sparkline: [1.9, 2.1, 2.45] },
  { name: 'BOOK OF MEME', symbol: 'BOME', price: 0.0115, change: 9.45, change7d: 16.20, sparkline: [0.009, 0.010, 0.0115] },
  { name: 'Jupiter', symbol: 'JUP', price: 0.885, change: 5.15, change7d: 9.10, sparkline: [0.81, 0.84, 0.885] },
  { name: 'Pyth Network', symbol: 'PYTH', price: 0.355, change: 3.45, change7d: 6.50, sparkline: [0.32, 0.34, 0.355] },
];

export async function listOtherTokens(
  _ctx: ServerContext,
  _req: ListOtherTokensRequest,
): Promise<ListOtherTokensResponse> {
  try {
    const seedData = await getCachedJson(SEED_CACHE_KEY, true) as { tokens: TokenSeedEntry[] } | null;
    if (seedData?.tokens?.length) {
      const tokens: CryptoQuote[] = seedData.tokens.map(t => ({
        name: t.name,
        symbol: t.symbol,
        price: t.price,
        change: t.change24h,
        change7d: t.change7d,
        sparkline: [],
      }));
      return { tokens };
    }
  } catch {
    // Fall through to fallback
  }
  return { tokens: FALLBACK_OTHER_TOKENS };
}
