/**
 * RPC: GetSectorSummary -- reads seeded sector data from Railway seed cache.
 * All external Finnhub/Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  GetSectorSummaryRequest,
  GetSectorSummaryResponse,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { getCachedJson } from '../../../_shared/redis';

const SEED_CACHE_KEY = 'market:sectors:v2';

const FALLBACK_SECTORS = [
  { symbol: 'XLK', name: 'Technology', change: 1.85 },
  { symbol: 'XLF', name: 'Financials', change: 0.65 },
  { symbol: 'XLE', name: 'Energy', change: -0.45 },
  { symbol: 'XLV', name: 'Healthcare', change: 0.35 },
  { symbol: 'XLY', name: 'Consumer Discretionary', change: 1.15 },
  { symbol: 'XLP', name: 'Consumer Staples', change: 0.25 },
  { symbol: 'XLI', name: 'Industrials', change: 0.45 },
  { symbol: 'XLU', name: 'Utilities', change: 0.15 },
  { symbol: 'XLB', name: 'Materials', change: 0.55 },
  { symbol: 'XLC', name: 'Communication Services', change: 1.25 },
  { symbol: 'XLRE', name: 'Real Estate', change: -0.15 },
];

export async function getSectorSummary(
  _ctx: ServerContext,
  _req: GetSectorSummaryRequest,
): Promise<GetSectorSummaryResponse> {
  try {
    const result = await getCachedJson(SEED_CACHE_KEY, true) as GetSectorSummaryResponse | null;
    if (result?.sectors?.length) return result;
  } catch {
    // Fall through to fallback
  }
  return { sectors: FALLBACK_SECTORS };
}
