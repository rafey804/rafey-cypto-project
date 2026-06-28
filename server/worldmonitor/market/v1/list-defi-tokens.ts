/**
 * RPC: ListDefiTokens -- reads seeded DeFi token data from Railway seed cache.
 */

import type {
  ServerContext,
  ListDefiTokensRequest,
  ListDefiTokensResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:defi-tokens:v1';

type TokenSeedEntry = { name: string; symbol: string; price: number; change24h: number; change7d: number };

const FALLBACK_DEFI_TOKENS: CryptoQuote[] = [
  { name: 'Uniswap', symbol: 'UNI', price: 9.85, change: 4.25, change7d: 8.50, sparkline: [8.9, 9.1, 9.5, 9.4, 9.85] },
  { name: 'Aave', symbol: 'AAVE', price: 92.40, change: 3.15, change7d: 6.20, sparkline: [85, 88, 90, 89, 92.40] },
  { name: 'Maker', symbol: 'MKR', price: 2450.00, change: 1.85, change7d: 4.10, sparkline: [2380, 2400, 2420, 2450] },
  { name: 'Curve DAO Token', symbol: 'CRV', price: 0.325, change: -1.20, change7d: -2.40, sparkline: [0.34, 0.33, 0.325] },
  { name: 'Lido DAO', symbol: 'LDO', price: 1.85, change: 5.40, change7d: 12.30, sparkline: [1.6, 1.7, 1.8, 1.85] },
  { name: 'PancakeSwap', symbol: 'CAKE', price: 2.15, change: 0.85, change7d: 1.45, sparkline: [2.05, 2.10, 2.15] },
  { name: 'Compound', symbol: 'COMP', price: 48.20, change: 2.10, change7d: 3.40, sparkline: [45, 46, 47, 48.20] },
  { name: 'Synthetix Network', symbol: 'SNX', price: 2.05, change: 1.15, change7d: 2.10, sparkline: [1.9, 1.95, 2.05] },
];

export async function listDefiTokens(
  _ctx: ServerContext,
  _req: ListDefiTokensRequest,
): Promise<ListDefiTokensResponse> {
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
  return { tokens: FALLBACK_DEFI_TOKENS };
}
