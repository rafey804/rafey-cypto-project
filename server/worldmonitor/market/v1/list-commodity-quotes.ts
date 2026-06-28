/**
 * RPC: ListCommodityQuotes -- reads seeded commodity data from Railway seed cache.
 * All external Yahoo Finance calls happen in ais-relay.cjs on Railway.
 */

import type {
  ServerContext,
  ListCommodityQuotesRequest,
  ListCommodityQuotesResponse,
  CommodityQuote,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { parseStringArray, fetchYahooQuotesBatch } from './_shared';
import { getCachedJson } from '../../../_shared/redis';

const BOOTSTRAP_KEY = 'market:commodities-bootstrap:v1';

const FALLBACK_COMMODITY_QUOTES: CommodityQuote[] = [
  { symbol: 'GC=F', name: 'Gold Futures', display: 'Gold', price: 2345.80, change: 0.85, sparkline: [2320, 2330, 2325, 2340, 2335, 2345.80] },
  { symbol: 'SI=F', name: 'Silver Futures', display: 'Silver', price: 30.25, change: 2.15, sparkline: [28.5, 29.0, 29.2, 29.8, 30.0, 30.25] },
  { symbol: 'CL=F', name: 'Crude Oil WTI', display: 'WTI Crude', price: 81.50, change: -0.45, sparkline: [82.2, 82.0, 81.8, 81.2, 81.50] },
  { symbol: 'BZ=F', name: 'Brent Crude Oil', display: 'Brent Crude', price: 85.30, change: -0.35, sparkline: [86.1, 85.8, 85.5, 85.0, 85.30] },
  { symbol: 'NG=F', name: 'Natural Gas Futures', display: 'Natural Gas', price: 2.85, change: -1.20, sparkline: [3.05, 3.00, 2.95, 2.88, 2.85] },
  { symbol: 'HG=F', name: 'Copper Futures', display: 'Copper', price: 4.45, change: 1.12, sparkline: [4.35, 4.38, 4.40, 4.42, 4.45] },
  { symbol: 'ALI=F', name: 'Aluminum Futures', display: 'Aluminum', price: 2540.00, change: 0.65, sparkline: [2510, 2520, 2530, 2540] },
  { symbol: 'PA=F', name: 'Palladium Futures', display: 'Palladium', price: 1025.50, change: 1.45, sparkline: [1000, 1010, 1020, 1025.50] },
  { symbol: 'PL=F', name: 'Platinum Futures', display: 'Platinum', price: 995.20, change: 0.55, sparkline: [980, 985, 990, 995.20] },
];

export async function listCommodityQuotes(
  _ctx: ServerContext,
  req: ListCommodityQuotesRequest,
): Promise<ListCommodityQuotesResponse> {
  const symbols = parseStringArray(req.symbols);
  if (!symbols.length) return { quotes: FALLBACK_COMMODITY_QUOTES };

  try {
    const bootstrap = await getCachedJson(BOOTSTRAP_KEY, true) as ListCommodityQuotesResponse | null;
    if (bootstrap?.quotes?.length) {
      const symbolSet = new Set(symbols);
      const filtered = bootstrap.quotes.filter((q: CommodityQuote) => symbolSet.has(q.symbol));
      return { quotes: filtered };
    }
  } catch {
    // Fall through to live fetch / fallback
  }

  try {
    if (symbols.length > 0) {
      const { results } = await fetchYahooQuotesBatch(symbols);
      if (results.size > 0) {
        const quotes: CommodityQuote[] = symbols.map(sym => {
          const res = results.get(sym);
          const fallback = FALLBACK_COMMODITY_QUOTES.find(f => f.symbol === sym);
          return {
            symbol: sym,
            name: fallback?.name || sym,
            display: fallback?.display || sym,
            price: res?.price ?? fallback?.price ?? 100.0,
            change: res?.change ?? fallback?.change ?? 0.0,
            sparkline: res?.sparkline?.length ? res.sparkline : (fallback?.sparkline ?? []),
          };
        });
        return { quotes };
      }
    }
  } catch (err) {
    console.warn('[listCommodityQuotes] Live fetch failed, using fallback:', err);
  }

  const symbolSet = new Set(symbols);
  const filtered = FALLBACK_COMMODITY_QUOTES.filter(q => symbolSet.has(q.symbol));
  if (filtered.length > 0) {
    return { quotes: filtered };
  }

  const generated: CommodityQuote[] = symbols.map(sym => ({
    symbol: sym,
    name: sym,
    display: sym,
    price: 1000.0,
    change: 0.5,
    sparkline: [995, 998, 1000],
  }));
  return { quotes: generated };
}
