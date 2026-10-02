import { friendlySyncError } from '@/lib/sync-errors';

// CLI-backend syncs are queued for the Railway worker; poll the log row until
// it settles and shape it like the synchronous /api/sync response.
export async function waitForQueuedSync(
  syncLogId: string,
  intervalMs = 3000,
  timeoutMs = 60 * 60 * 1000
): Promise<{ tasks_updated: number; errors: string[] }> {
  const deadline = Date.now() + timeoutMs;
  let misses = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(`/api/sync/status?id=${syncLogId}`, {
      cache: 'no-store',
    });
    if (res.status === 401) throw new Error('Session expired. Sign in again.');
    const log = res.ok ? await res.json().catch(() => null) : null;
    if (!log) {
      // A few blips are fine; a dead route or vanished row is not.
      if (++misses >= 5) {
        throw new Error(`Could not read sync status (HTTP ${res.status})`);
      }
      continue;
    }
    misses = 0;
    if (log.status === 'completed') {
      const errors = (log.details?.errors as string[] | undefined) ?? [];
      return { tasks_updated: log.bounties_updated ?? 0, errors };
    }
    if (log.status === 'failed') {
      throw new Error(friendlySyncError(log.error_message || 'Sync failed'));
    }
  }
  throw new Error('Sync worker timed out');
}
