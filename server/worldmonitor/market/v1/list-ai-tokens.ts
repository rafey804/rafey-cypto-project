/**
 * RPC: ListAiTokens -- reads seeded AI token data from Railway seed cache.
 */

import type {
  ServerContext,
  ListAiTokensRequest,
  ListAiTokensResponse,
  CryptoQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:ai-tokens:v1';

type TokenSeedEntry = { name: string; symbol: string; price: number; change24h: number; change7d: number };

const FALLBACK_AI_TOKENS: CryptoQuote[] = [
  { name: 'Fetch.ai', symbol: 'FET', price: 1.45, change: 8.45, change7d: 14.20, sparkline: [1.2, 1.3, 1.35, 1.45] },
  { name: 'SingularityNET', symbol: 'AGIX', price: 0.655, change: 6.25, change7d: 11.40, sparkline: [0.55, 0.60, 0.62, 0.655] },
  { name: 'Render', symbol: 'RNDR', price: 7.85, change: 4.15, change7d: 9.80, sparkline: [7.1, 7.4, 7.6, 7.85] },
  { name: 'Bittensor', symbol: 'TAO', price: 285.40, change: 12.50, change7d: 22.40, sparkline: [250, 265, 275, 285.40] },
  { name: 'Ocean Protocol', symbol: 'OCEAN', price: 0.685, change: 5.15, change7d: 8.90, sparkline: [0.61, 0.64, 0.66, 0.685] },
  { name: 'Worldcoin', symbol: 'WLD', price: 2.85, change: 3.45, change7d: 6.20, sparkline: [2.6, 2.7, 2.75, 2.85] },
  { name: 'NEAR Protocol', symbol: 'NEAR', price: 5.45, change: 7.85, change7d: 15.30, sparkline: [4.8, 5.0, 5.2, 5.45] },
  { name: 'Akash Network', symbol: 'AKT', price: 3.25, change: 4.55, change7d: 8.10, sparkline: [2.9, 3.0, 3.15, 3.25] },
];

export async function listAiTokens(
  _ctx: ServerContext,
  _req: ListAiTokensRequest,
): Promise<ListAiTokensResponse> {
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
  return { tokens: FALLBACK_AI_TOKENS };
}
