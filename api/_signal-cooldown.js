// @ts-check
/**
 * Signal Cooldown & Direction Lock Store
 * Prevents conflicting/spam signals from firing to Telegram.
 * - Hard 60-minute cooldown per asset
 * - 4-hour direction reversal lock (no Long→Short within 4h)
 */

/** @typedef {{ direction: 'long'|'short', firedAt: number, confluenceScore: number }} SignalRecord */

/** @type {Map<string, SignalRecord>} */
const signalStore = new Map();

const COOLDOWN_MS = 60 * 60 * 1000;        // 60 minutes hard cooldown
const REVERSAL_LOCK_MS = 4 * 60 * 60 * 1000; // 4 hours direction lock

/**
 * Check if a signal can fire for a given asset and direction.
 * @param {string} asset e.g. 'XAUUSD' | 'BTCUSDT'
 * @param {'long'|'short'} direction
 * @returns {{ allowed: boolean, reason: string }}
 */
export function canFireSignal(asset, direction) {
  const record = signalStore.get(asset);
  if (!record) return { allowed: true, reason: 'no_prior_signal' };

  const now = Date.now();
  const elapsed = now - record.firedAt;

  if (elapsed < COOLDOWN_MS) {
    const remaining = Math.ceil((COOLDOWN_MS - elapsed) / 60000);
    return { allowed: false, reason: `cooldown_active: ${remaining}m remaining` };
  }

  if (record.direction !== direction && elapsed < REVERSAL_LOCK_MS) {
    const remaining = Math.ceil((REVERSAL_LOCK_MS - elapsed) / 60000);
    return {
      allowed: false,
      reason: `direction_reversal_lock: last signal was ${record.direction.toUpperCase()}, cannot reverse for ${remaining}m more`
    };
  }

  return { allowed: true, reason: 'cleared' };
}

/**
 * Record that a signal was fired.
 * @param {string} asset
 * @param {'long'|'short'} direction
 * @param {number} confluenceScore
 */
export function recordSignalFired(asset, direction, confluenceScore) {
  signalStore.set(asset, { direction, firedAt: Date.now(), confluenceScore });
}

/**
 * Get the last signal record for an asset.
 * @param {string} asset
 * @returns {SignalRecord | undefined}
 */
export function getLastSignal(asset) {
  return signalStore.get(asset);
}
