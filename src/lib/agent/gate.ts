export interface ChangeInput {
  lastSyncedAt: string | null;
  userEdited: boolean;
  issueUpdatedAt: string | null;
  prUpdatedAt: string | null;
  commentDates: string[];
  eventDates: string[];
}

// True means "must analyse". Everything unknown counts as changed: a skip
// has to be provably safe, and an unnecessary analysis only costs money.
export function hasChangedSince(input: ChangeInput): boolean {
  if (!input.lastSyncedAt || input.userEdited) return true;
  const since = new Date(input.lastSyncedAt).getTime();
  if (Number.isNaN(since)) return true;

  const candidates = [
    input.issueUpdatedAt,
    input.prUpdatedAt,
    ...input.commentDates,
    ...input.eventDates,
  ];

  return candidates.some((iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return Number.isNaN(t) || t > since;
  });
}
