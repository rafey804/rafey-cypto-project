/**
 * RPC: ListCryptoSectors -- reads seeded crypto sector data from Railway seed cache.
 */

import type {
  ServerContext,
  ListCryptoSectorsRequest,
  ListCryptoSectorsResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:crypto-sectors:v1';

const FALLBACK_CRYPTO_SECTORS = [
  { id: 'layer-1', name: 'Layer 1 (L1)', change: 3.45 },
  { id: 'layer-2', name: 'Layer 2 (L2)', change: 4.15 },
  { id: 'defi', name: 'DeFi Protocols', change: 2.85 },
  { id: 'ai', name: 'AI & Big Data', change: 8.40 },
  { id: 'memes', name: 'Meme Coins', change: 12.30 },
  { id: 'depin', name: 'DePIN', change: 5.15 },
  { id: 'rwa', name: 'Real World Assets (RWA)', change: 3.10 },
  { id: 'gamefi', name: 'Gaming (GameFi)', change: 1.45 },
];

export async function listCryptoSectors(
  _ctx: ServerContext,
  _req: ListCryptoSectorsRequest,
): Promise<ListCryptoSectorsResponse> {
  try {
    const seedData = await getCachedJson(SEED_CACHE_KEY, true) as { sectors: Array<{ id: string; name: string; change: number }> } | null;
    if (seedData?.sectors?.length) return { sectors: seedData.sectors };
  } catch {
    // Fall through to fallback
  }
  return { sectors: FALLBACK_CRYPTO_SECTORS };
}
