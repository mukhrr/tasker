import { friendlySyncError } from '@/lib/sync-errors';

// CLI-backend syncs are queued for the Railway worker; poll the log row until
// it settles and shape it like the synchronous /api/sync response.
export async function waitForQueuedSync(
  syncLogId: string,
  intervalMs = 3000,
  timeoutMs = 15 * 60 * 1000
): Promise<{ tasks_updated: number; errors: string[] }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const res = await fetch(`/api/sync/status?id=${syncLogId}`, {
      cache: 'no-store',
    });
    const log = await res.json().catch(() => null);
    if (!log) continue;
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
