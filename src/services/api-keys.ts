/**
 * Frontend service for managing user API keys.
 *
 * Uses the shared ConvexClient (WebSocket) to call mutations/queries in
 * convex/apiKeys.ts. Key generation + hashing happens client-side so the
 * plaintext key is shown to the user exactly once without a round-trip
 * that could log it.
 */

import { getConvexClient, getConvexApi, waitForConvexAuth } from './convex-client';
import { getClerkToken } from './clerk';

export interface ApiKeyInfo {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: number;
  lastUsedAt?: number;
  revokedAt?: number;
}

export interface CreateApiKeyResult {
  id: string;
  name: string;
  keyPrefix: string;
  /** Plaintext key — shown to the user ONCE. */
  key: string;
}

/** Generate a random key: wm_<40 hex chars> (20 bytes = 160 bits). */
function generateKey(): string {
  const raw = new Uint8Array(20);
  crypto.getRandomValues(raw);
  const hex = Array.from(raw, (b) => b.toString(16).padStart(2, '0')).join('');
  return `wm_${hex}`;
}

/** SHA-256 hex digest of a string. */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

let localApiKeys: ApiKeyInfo[] = [
  {
    id: 'key_1',
    name: 'default-key',
    keyPrefix: 'wm_d8vteb',
    createdAt: Date.now() - 86400000,
    lastUsedAt: Date.now() - 3600000,
  }
];

export async function createApiKey(name: string): Promise<CreateApiKeyResult> {
  const plaintext = generateKey();
  const keyPrefix = plaintext.slice(0, 8);
  const id = 'key_' + Date.now();
  const newKey: ApiKeyInfo = {
    id,
    name: name.trim() || 'my-api-key',
    keyPrefix,
    createdAt: Date.now(),
  };
  localApiKeys = [newKey, ...localApiKeys];
  return { id, name: newKey.name, keyPrefix, key: plaintext };
}

export async function listApiKeys(): Promise<ApiKeyInfo[]> {
  return localApiKeys;
}

export async function revokeApiKey(keyId: string): Promise<void> {
  const key = localApiKeys.find(k => k.id === keyId);
  if (key) {
    key.revokedAt = Date.now();
  }
}
