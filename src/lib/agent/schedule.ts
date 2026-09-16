export const DEFAULT_SYNC_INTERVAL_HOURS = 6;

export function isSyncDue(
  lastStartedAt: string | null | undefined,
  intervalHours: number | null | undefined
): boolean {
  if (!lastStartedAt) return true;
  const hoursSince =
    (Date.now() - new Date(lastStartedAt).getTime()) / (1000 * 60 * 60);
  return hoursSince >= (intervalHours || DEFAULT_SYNC_INTERVAL_HOURS);
}
