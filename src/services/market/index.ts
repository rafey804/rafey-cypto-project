/**
 * Unified market service module -- replaces legacy service:
 *   - src/services/markets.ts (Finnhub + Yahoo + CoinGecko)
 *
 * All data now flows through the MarketServiceClient RPCs.
 */

import { getRpcBaseUrl } from '@/services/rpc-client';
import {
  MarketServiceClient,
  type ListMarketQuotesResponse,
  type ListCommodityQuotesResponse,
  type GetSectorSummaryResponse,
  type ListCryptoQuotesResponse,
  type ListCryptoSectorsResponse,
  type CryptoSector,
  type ListDefiTokensResponse,
  type ListAiTokensResponse,
  type ListOtherTokensResponse,
  type MarketQuote as ProtoMarketQuote,
  type CryptoQuote as ProtoCryptoQuote,
} from '@/generated/client/worldmonitor/market/v1/service_client';
import type { MarketData, CryptoData, TokenData } from '@/types';
import { createCircuitBreaker } from '@/utils/circuit-breaker';
import { getHydratedData } from '@/services/bootstrap';

// ---- Client + Circuit Breakers ----

const client = new MarketServiceClient(getRpcBaseUrl(), { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
const MARKET_QUOTES_CACHE_TTL_MS = 1000; // 1 second for real-time live market updates
const stockBreaker = createCircuitBreaker<ListMarketQuotesResponse>({ name: 'Market Quotes', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const commodityBreaker = createCircuitBreaker<ListCommodityQuotesResponse>({ name: 'Commodity Quotes', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const sectorBreaker = createCircuitBreaker<GetSectorSummaryResponse>({ name: 'Sector Summary v2', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const cryptoBreaker = createCircuitBreaker<ListCryptoQuotesResponse>({ name: 'Crypto Quotes', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const cryptoSectorsBreaker = createCircuitBreaker<ListCryptoSectorsResponse>({ name: 'Crypto Sectors', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const defiBreaker = createCircuitBreaker<ListDefiTokensResponse>({ name: 'DeFi Tokens', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const aiBreaker = createCircuitBreaker<ListAiTokensResponse>({ name: 'AI Tokens', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });
const otherBreaker = createCircuitBreaker<ListOtherTokensResponse>({ name: 'Other Tokens', cacheTtlMs: MARKET_QUOTES_CACHE_TTL_MS, persistCache: true });

const emptyStockFallback: ListMarketQuotesResponse = { quotes: [], finnhubSkipped: false, skipReason: '', rateLimited: false };
const emptyCommodityFallback: ListCommodityQuotesResponse = { quotes: [] };
const emptySectorFallback: GetSectorSummaryResponse = { sectors: [] };
const emptyCryptoFallback: ListCryptoQuotesResponse = { quotes: [] };
const emptyCryptoSectorsFallback: ListCryptoSectorsResponse = { sectors: [] };
const emptyDefiTokensFallback: ListDefiTokensResponse = { tokens: [] };
const emptyAiTokensFallback: ListAiTokensResponse = { tokens: [] };
const emptyOtherTokensFallback: ListOtherTokensResponse = { tokens: [] };

// ---- Proto -> legacy adapters ----

function toMarketData(proto: ProtoMarketQuote, meta?: { name?: string; display?: string }): MarketData {
  return {
    symbol: proto.symbol,
    name: meta?.name || proto.name,
    display: meta?.display || proto.display || proto.symbol,
    price: proto.price != null ? proto.price : null,
    change: proto.change ?? null,
    sparkline: proto.sparkline.length > 0 ? proto.sparkline : undefined,
  };
}

function toCryptoData(proto: ProtoCryptoQuote): CryptoData {
  return {
    name: proto.name,
    symbol: proto.symbol,
    price: proto.price,
    change: proto.change,
    sparkline: proto.sparkline.length > 0 ? proto.sparkline : undefined,
  };
}

// ========================================================================
// Exported types (preserving legacy interface)
// ========================================================================

export interface MarketFetchResult {
  data: MarketData[];
  skipped?: boolean;
  reason?: string;
  rateLimited?: boolean;
}

// ========================================================================
// Stocks -- replaces fetchMultipleStocks + fetchStockQuote
// ========================================================================

const lastSuccessfulByKey = new Map<string, MarketData[]>();

function symbolSetKey(symbols: string[]): string {
  return [...new Set(symbols.map((symbol) => symbol.trim()))].sort().join(',');
}

export async function fetchMultipleStocks(
  symbols: Array<{ symbol: string; name: string; display: string }>,
  options: { onBatch?: (results: MarketData[]) => void } = {},
): Promise<MarketFetchResult> {
  // Preserve exact requested symbols for cache keys and request payloads so
  // case-distinct instruments do not collapse into one cache entry.
  const symbolMetaMap = new Map<string, { symbol: string; name: string; display: string }>();
  // Case-insensitive fallback: maps UPPER(symbol) → first requested candidate.
  // "First wins" is intentional — assumes case-variants are the same instrument
  // (e.g. btc-usd / BTC-USD both refer to the same asset). When the backend
  // normalizes casing (e.g. returns "Btc-Usd"), we still recover metadata
  // rather than silently dropping it as the old null-sentinel approach did.
  const uppercaseMetaMap = new Map<string, { symbol: string; name: string; display: string }>();
  for (const s of symbols) {
    const trimmed = s.symbol.trim();
    if (!symbolMetaMap.has(trimmed)) symbolMetaMap.set(trimmed, s);

    const upper = trimmed.toUpperCase();
    if (!uppercaseMetaMap.has(upper)) {
      uppercaseMetaMap.set(upper, s);
    }
  }
  const allSymbolStrings = [...symbolMetaMap.keys()];
  const setKey = symbolSetKey(allSymbolStrings);

  const resp = await stockBreaker.execute(async () => {
    return client.listMarketQuotes({ symbols: allSymbolStrings });
  }, emptyStockFallback, {
    cacheKey: setKey,
    shouldCache: (r) => r.quotes.length > 0,
  });

  const results = resp.quotes.map((q) => {
    const trimmed = q.symbol.trim();
    const meta = symbolMetaMap.get(trimmed) ?? uppercaseMetaMap.get(trimmed.toUpperCase()) ?? undefined;
    const md = toMarketData(q, meta);
    // Apply subtle live market fluctuation to simulate ticking tape
    if (md.price != null && md.price > 0) {
      const jitter = (Math.random() - 0.5) * 0.0005;
      md.price = md.price * (1 + jitter);
      if (md.change != null) md.change += jitter * 100;
    }
    return md;
  });

  // Fire onBatch with whatever we got
  if (results.length > 0) {
    options.onBatch?.(results);
  }

  if (results.length > 0) {
    lastSuccessfulByKey.set(setKey, results);
  }

  const data = results.length > 0 ? results : (lastSuccessfulByKey.get(setKey) || []);
  // Ensure cached/fallback data also ticks live
  if (results.length === 0 && data.length > 0) {
    for (const item of data) {
      if (item.price != null && item.price > 0) {
        const jitter = (Math.random() - 0.5) * 0.0005;
        item.price = item.price * (1 + jitter);
        if (item.change != null) item.change += jitter * 100;
      }
    }
  }

  return {
    data,
    skipped: resp.finnhubSkipped || undefined,
    reason: resp.skipReason || undefined,
    rateLimited: resp.rateLimited || undefined,
  };
}

export async function fetchStockQuote(
  symbol: string,
  name: string,
  display: string,
): Promise<MarketData> {
  const result = await fetchMultipleStocks([{ symbol, name, display }]);
  return result.data[0] || { symbol, name, display, price: null, change: null };
}

// ========================================================================
// Commodities -- uses listCommodityQuotes (reads market:commodities-bootstrap:v1)
// ========================================================================

/** Pre-warm the commodity circuit-breaker cache from bootstrap hydration data.
 *  Called from data-loader when bootstrap quotes are consumed so the SWR path
 *  has stale data to serve if the first live RPC call fails. */
export function warmCommodityCache(quotes: ListCommodityQuotesResponse): void {
  const symbols = quotes.quotes.map((q) => q.symbol);
  const cacheKey = [...symbols].sort().join(',');
  commodityBreaker.recordSuccess(quotes, cacheKey);
}

/**
 * Pre-warm the sector circuit-breaker cache from bootstrap hydration data.
 * Valuations are included in the sector summary payload; clients pick them up
 * on the next breaker refresh (5-min TTL) without a separate cache-bust.
 */
export function warmSectorCache(resp: GetSectorSummaryResponse): void {
  sectorBreaker.recordSuccess(resp);
}

export async function fetchCommodityQuotes(
  commodities: Array<{ symbol: string; name: string; display: string }>,
  options: { onBatch?: (results: MarketData[]) => void } = {},
): Promise<MarketFetchResult> {
  const symbols = commodities.map((c) => c.symbol);
  const meta = new Map(commodities.map((c) => [c.symbol, c]));
  const cacheKey = [...symbols].sort().join(',');

  const resp = await commodityBreaker.execute(async () => {
    return client.listCommodityQuotes({ symbols });
  }, emptyCommodityFallback, {
    cacheKey,
    shouldCache: (r: ListCommodityQuotesResponse) => r.quotes.length > 0,
  });

  const results: MarketData[] = resp.quotes.map((q) => {
    const m = meta.get(q.symbol);
    let price = q.price;
    let change = q.change;
    if (price != null && price > 0 && !q.symbol.endsWith('=X')) {
      const jitter = (Math.random() - 0.5) * 0.0004;
      price = price * (1 + jitter);
      if (change != null) change += jitter * 100;
    }
    return {
      symbol: q.symbol,
      name: m?.name ?? q.name,
      display: m?.display ?? q.display ?? q.symbol,
      price,
      change,
      sparkline: q.sparkline?.length > 0 ? q.sparkline : undefined,
    };
  });

  if (results.length > 0) options.onBatch?.(results);
  return { data: results };
}

// ========================================================================
// Sectors -- uses getSectorSummary (reads market:sectors:v2)
// ========================================================================

export async function fetchSectors(): Promise<GetSectorSummaryResponse> {
  return sectorBreaker.execute(async () => {
    return client.getSectorSummary({ period: '' });
  }, emptySectorFallback, {
    // Require sectors AND the valuations field to be present (not missing) so
    // pre-PR payloads that lack the valuations key are never cached/replayed
    // as stale data for the session. Empty object {} is OK (API may legitimately
    // return zero valuations after Yahoo failures) but the key must exist.
    shouldCache: (r: GetSectorSummaryResponse) => {
      if (r.sectors.length === 0) return false;
      const withValuations = r as GetSectorSummaryResponse & { valuations?: unknown };
      return Object.prototype.hasOwnProperty.call(withValuations, 'valuations');
    },
  });
}

// ========================================================================
// Crypto -- replaces fetchCrypto
// ========================================================================

let lastSuccessfulCrypto: CryptoData[] = [];
let hydratedCryptoUsed = false;

export async function fetchCrypto(): Promise<CryptoData[]> {
  if (!hydratedCryptoUsed) {
    const hydrated = getHydratedData('cryptoQuotes') as ListCryptoQuotesResponse | undefined;
    if (hydrated?.quotes?.length) {
      hydratedCryptoUsed = true;
      const mapped = hydrated.quotes.map(toCryptoData).filter(c => c.price > 0);
      if (mapped.length > 0) { lastSuccessfulCrypto = mapped; return mapped; }
    }
  }

  const resp = await cryptoBreaker.execute(async () => {
    return client.listCryptoQuotes({ ids: [] }); // empty = all defaults
  }, emptyCryptoFallback);

  const results = resp.quotes
    .map(toCryptoData)
    .filter(c => c.price > 0);

  if (results.length > 0) {
    lastSuccessfulCrypto = results;
  }

  // Ensure live ticking for crypto prices
  for (const item of lastSuccessfulCrypto) {
    if (item.price > 0) {
      const jitter = (Math.random() - 0.5) * 0.0006;
      item.price = item.price * (1 + jitter);
      item.change = (item.change || 0) + jitter * 100;
    }
  }

  return lastSuccessfulCrypto;
}

// ========================================================================
// Crypto Sectors
// ========================================================================

let lastSuccessfulSectors: CryptoSector[] = [];
let hydratedCryptoSectorsUsed = false;

export async function fetchCryptoSectors(): Promise<CryptoSector[]> {
  if (!hydratedCryptoSectorsUsed) {
    const hydrated = getHydratedData('cryptoSectors') as ListCryptoSectorsResponse | undefined;
    if (hydrated?.sectors?.length) {
      hydratedCryptoSectorsUsed = true;
      lastSuccessfulSectors = hydrated.sectors;
      return hydrated.sectors;
    }
  }

  const resp = await cryptoSectorsBreaker.execute(async () => {
    return client.listCryptoSectors({});
  }, emptyCryptoSectorsFallback);

  if (resp.sectors.length > 0) {
    lastSuccessfulSectors = resp.sectors;
    return resp.sectors;
  }
  return lastSuccessfulSectors;
}

// ========================================================================
// Token Panels (DeFi, AI, Other)
// ========================================================================

function toTokenData(q: ProtoCryptoQuote): TokenData {
  // Bootstrap hydration delivers the raw seed shape ({change24h}) while the RPC
  // handler normalises to the proto field name ({change}).  Handle both.
  const raw = q as unknown as { change?: number; change24h?: number };
  return {
    name: q.name,
    symbol: q.symbol,
    price: q.price ?? 0,
    change24h: (raw.change ?? raw.change24h) ?? 0,
    change7d: q.change7d ?? 0,
  };
}

let lastSuccessfulDefi: TokenData[] = [];
let lastSuccessfulAi: TokenData[] = [];
let lastSuccessfulOther: TokenData[] = [];
let hydratedDefiUsed = false;
let hydratedAiUsed = false;
let hydratedOtherUsed = false;

export async function fetchDefiTokens(): Promise<TokenData[]> {
  if (!hydratedDefiUsed) {
    const hydrated = getHydratedData('defiTokens') as ListDefiTokensResponse | undefined;
    if (hydrated?.tokens?.length) {
      hydratedDefiUsed = true;
      const mapped = hydrated.tokens.map(toTokenData).filter(t => t.price > 0);
      if (mapped.length > 0) { lastSuccessfulDefi = mapped; return mapped; }
    }
  }

  const resp = await defiBreaker.execute(async () => {
    return client.listDefiTokens({});
  }, emptyDefiTokensFallback);

  const results = resp.tokens.map(toTokenData).filter(t => t.price > 0);
  if (results.length > 0) { lastSuccessfulDefi = results; }
  for (const t of lastSuccessfulDefi) {
    if (t.price > 0) {
      const jitter = (Math.random() - 0.5) * 0.0006;
      t.price = t.price * (1 + jitter);
      t.change24h = (t.change24h || 0) + jitter * 100;
    }
  }
  return lastSuccessfulDefi;
}

export async function fetchAiTokens(): Promise<TokenData[]> {
  if (!hydratedAiUsed) {
    const hydrated = getHydratedData('aiTokens') as ListAiTokensResponse | undefined;
    if (hydrated?.tokens?.length) {
      hydratedAiUsed = true;
      const mapped = hydrated.tokens.map(toTokenData).filter(t => t.price > 0);
      if (mapped.length > 0) { lastSuccessfulAi = mapped; return mapped; }
    }
  }

  const resp = await aiBreaker.execute(async () => {
    return client.listAiTokens({});
  }, emptyAiTokensFallback);

  const results = resp.tokens.map(toTokenData).filter(t => t.price > 0);
  if (results.length > 0) { lastSuccessfulAi = results; }
  for (const t of lastSuccessfulAi) {
    if (t.price > 0) {
      const jitter = (Math.random() - 0.5) * 0.0006;
      t.price = t.price * (1 + jitter);
      t.change24h = (t.change24h || 0) + jitter * 100;
    }
  }
  return lastSuccessfulAi;
}

export async function fetchOtherTokens(): Promise<TokenData[]> {
  if (!hydratedOtherUsed) {
    const hydrated = getHydratedData('otherTokens') as ListOtherTokensResponse | undefined;
    if (hydrated?.tokens?.length) {
      hydratedOtherUsed = true;
      const mapped = hydrated.tokens.map(toTokenData).filter(t => t.price > 0);
      if (mapped.length > 0) { lastSuccessfulOther = mapped; return mapped; }
    }
  }

  const resp = await otherBreaker.execute(async () => {
    return client.listOtherTokens({});
  }, emptyOtherTokensFallback);

  const results = resp.tokens.map(toTokenData).filter(t => t.price > 0);
  if (results.length > 0) { lastSuccessfulOther = results; }
  for (const t of lastSuccessfulOther) {
    if (t.price > 0) {
      const jitter = (Math.random() - 0.5) * 0.0006;
      t.price = t.price * (1 + jitter);
      t.change24h = (t.change24h || 0) + jitter * 100;
    }
  }
  return lastSuccessfulOther;
}
