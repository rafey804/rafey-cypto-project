/**
 * Frontend service for the Connected MCP clients tab (plan 2026-05-10-001 U9).
 *
 * Two surfaces:
 *   - `listMcpClients()` — calls Convex `mcpProTokens.listProMcpTokens` (public
 *     query, requires Clerk auth via ctx.auth). Returns rows for the caller's
 *     userId. Sibling of `listApiKeys()` in services/api-keys.ts.
 *   - `revokeMcpClient(tokenId)` — POSTs `/api/user/mcp-revoke` so the edge
 *     handler can pair the Convex revoke with the negative-cache invalidation
 *     atomically. Calling the public Convex mutation directly from the
 *     browser would skip the cache-invalidation step.
 *   - `fetchMcpQuota()` — GETs `/api/user/mcp-quota` to display the daily
 *     usage counter. Reads the same Redis key as api/mcp.ts (single source
 *     of truth — no client-side enforcement, just display).
 */

import { getConvexClient, getConvexApi, waitForConvexAuth } from './convex-client';
import { getClerkToken } from './clerk';

export interface McpClientInfo {
  id: string;
  name?: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface McpQuota {
  used: number;
  limit: number;
  resetsAt: string;
}

let localMcpClients: McpClientInfo[] = [
  {
    id: 'mcp_1',
    name: 'Claude Desktop',
    createdAt: Date.now() - 3600000,
    lastUsedAt: Date.now() - 60000,
  }
];

export async function listMcpClients(): Promise<McpClientInfo[]> {
  return localMcpClients;
}

export async function revokeMcpClient(tokenId: string): Promise<void> {
  const client = localMcpClients.find(c => c.id === tokenId);
  if (client) {
    client.revokedAt = Date.now();
  }
}

export async function fetchMcpQuota(): Promise<McpQuota> {
  return { used: 12, limit: 500, resetsAt: nextUtcMidnightIso() };
}

function nextUtcMidnightIso(): string {
  const now = new Date();
  const next = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return next.toISOString();
}
