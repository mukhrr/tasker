'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Banknote,
  Check,
  Bug,
  ExternalLink,
  GitPullRequest,
} from 'lucide-react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { useStatuses } from '@/hooks/use-statuses';
import { getStatusColor } from '@/lib/status';
import { waitForQueuedSync } from '@/lib/sync-poll';
import { friendlySyncError } from '@/lib/sync-errors';
import type { AiBackend, SyncLog, UserStatus } from '@/types/database';

interface LinkedBug {
  number: number;
  title: string;
  url: string;
  state: string;
}

interface SyncUpdate {
  taskId: string;
  suggestedStatus: string;
  confidence: number;
  summary: string;
  linked_bugs?: LinkedBug[];
}

const openBugsOf = (u: SyncUpdate) =>
  (u.linked_bugs ?? []).filter((b) => b.state === 'open');

interface StatusChange {
  taskId: string;
  from: string;
  to: string;
  confidence: number;
}

interface TaskRef {
  id: string;
  issue_title: string | null;
  issue_url: string;
  pr_url: string | null;
  amount: number | null;
  status: string;
  archived: boolean;
  payment_date: string | null;
}

// sync_logs.details.jev, written while JEV_MODE is shadow.
interface JevObservation {
  taskId: string;
  choice: string | null;
}

interface SyncSettings {
  ai_backend: AiBackend;
  auto_sync_enabled: boolean;
  sync_interval_hours: number;
  sync_ready: boolean;
}

const BACKEND_LABELS: Record<AiBackend, string> = {
  api: 'Claude API',
  claude_cli: 'Claude CLI',
  codex_cli: 'Codex CLI',
};

const ACTION_STATUSES = new Set([
  'changes_required',
  'awaiting_payment',
  'regression',
]);

function shortRef(issueUrl: string): string {
  const m = issueUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  if (m) return `${m[1]}#${m[2]}`;
  const pr = issueUrl.match(/\/pull\/(\d+)[^#]*#/);
  return pr ? `PR #${pr[1]} comment` : issueUrl;
}

function repoBase(issueUrl: string): string | null {
  const m = issueUrl.match(/https:\/\/github\.com\/[^/]+\/[^/)\]]+/);
  return m ? m[0] : null;
}

function issueNumber(issueUrl: string): string | null {
  return issueUrl.match(/\/issues\/(\d+)/)?.[1] ?? null;
}

// Summaries name related issues as "#84139"; make those clickable.
function linkIssueRefs(text: string, base: string | null): React.ReactNode {
  if (!base) return text;
  return text.split(/(#\d{3,})/).map((part, i) =>
    /^#\d{3,}$/.test(part) ? (
      <a
        key={i}
        href={`${base}/issues/${part.slice(1)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-chart-1 hover:underline"
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

// Some issue_url values are stored as markdown [url](url); take the URL.
function GitHubLink({ url, pr = false }: { url: string; pr?: boolean }) {
  const href = url.match(/https:\/\/github\.com\/[^\s)\]]+/)?.[0];
  if (!href) return null;
  const label = pr ? 'Open the PR on GitHub' : 'Open the issue on GitHub';
  const Icon = pr ? GitPullRequest : ExternalLink;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      className="shrink-0 text-muted-foreground transition-opacity hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
    >
      <Icon className="h-3.5 w-3.5" />
    </a>
  );
}

function StatusPill({ status }: { status: UserStatus | undefined }) {
  const color = getStatusColor(status?.color ?? 'gray');
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ${color.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${color.dot}`} />
      {status?.label ?? 'Unknown'}
    </span>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'danger';
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-muted px-3.5 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`text-2xl font-semibold tracking-tight ${
          tone === 'danger' && value > 0 ? 'text-destructive' : ''
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function LastSyncCard({ userId }: { userId: string }) {
  const { statuses } = useStatuses(userId);
  const [log, setLog] = useState<SyncLog | null>(null);
  const [settings, setSettings] = useState<SyncSettings | null>(null);
  const [tasks, setTasks] = useState<Record<string, TaskRef>>({});
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Actions marked done in this view; their status change hides them after
  // the next load too, this just avoids waiting for it.
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const statusByKey = useMemo(
    () => new Map(statuses.map((s) => [s.key, s])),
    [statuses]
  );

  const load = useCallback(async () => {
    let logRes: Response;
    let settingsRes: Response;
    try {
      [logRes, settingsRes] = await Promise.all([
        fetch('/api/sync/status', { cache: 'no-store' }),
        fetch('/api/settings', { cache: 'no-store' }),
      ]);
    } catch {
      setLoadError('Could not reach the server');
      setLoaded(true);
      return;
    }
    if (!logRes.ok || !settingsRes.ok) {
      setLoadError(
        logRes.status === 401 || settingsRes.status === 401
          ? 'Session expired. Sign in again.'
          : `Could not load sync status (HTTP ${logRes.ok ? settingsRes.status : logRes.status})`
      );
      setLoaded(true);
      return;
    }
    setLoadError(null);
    const nextLog = (await logRes.json().catch(() => null)) as SyncLog | null;
    const nextSettings = (await settingsRes
      .json()
      .catch(() => null)) as SyncSettings | null;
    setLog(nextLog);
    setSettings(nextSettings);

    const updates =
      (nextLog?.details?.updates as SyncUpdate[] | undefined) ?? [];
    const changes =
      (nextLog?.details?.statusChanges as StatusChange[] | undefined) ?? [];
    const suggested =
      (nextLog?.details?.statusSuggestions as StatusChange[] | undefined) ?? [];
    const ids = [
      ...new Set([...updates, ...changes, ...suggested].map((u) => u.taskId)),
    ];
    if (ids.length) {
      const supabase = createClient();
      const { data } = await supabase
        .from('tasks')
        .select(
          'id, issue_title, issue_url, pr_url, amount, status, archived, payment_date'
        )
        .in('id', ids);
      setTasks(
        Object.fromEntries(((data as TaskRef[]) ?? []).map((t) => [t.id, t]))
      );
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the card live while a run is in flight (queued by the worker or by
  // the table's Sync Now); the status route is cheap.
  useEffect(() => {
    if (!log || (log.status !== 'queued' && log.status !== 'running')) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [log, load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      if (res.status === 202) await waitForQueuedSync(data.syncLogId);
      toast.success('Sync finished');
    } catch (err) {
      toast.error(
        friendlySyncError(err instanceof Error ? err.message : 'Sync failed')
      );
    } finally {
      setSyncing(false);
      load();
    }
  };

  // Hold the card's place while the first load runs, so the page does not
  // jump when it appears.
  if (!loaded) {
    return (
      <Card aria-busy="true">
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle>Last Sync</CardTitle>
            <Skeleton className="h-4 w-56" />
          </div>
          <Skeleton className="h-8 w-24" />
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle>Last Sync</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </Button>
        </CardHeader>
      </Card>
    );
  }

  const backend = settings?.ai_backend ?? 'api';
  const inFlight = log?.status === 'queued' || log?.status === 'running';

  if (!log) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Last Sync</CardTitle>
          <CardDescription>
            No sync has run yet. Sync pulls status, PR, assignment and payment
            data from GitHub.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing || !settings?.sync_ready}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`}
            />
            {settings?.sync_ready ? 'Sync Now' : 'Connect AI in Settings'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const updates = (log.details?.updates as SyncUpdate[] | undefined) ?? [];
  const errors = (log.details?.errors as string[] | undefined) ?? [];
  const changes =
    (log.details?.statusChanges as StatusChange[] | undefined) ?? [];
  const progress = log.details?.progress as
    | { done: number; total: number }
    | undefined;
  const skippedLowConfidence = updates.filter((u) => u.confidence < 0.6).length;
  const skippedUnchanged = (log.details?.skipped as number | undefined) ?? 0;
  // Only tasks still in the To do / In progress / Pending tabs: a task the
  // run finished or the user archived since has nothing left to act on.
  const isActive = (t: TaskRef | undefined): t is TaskRef =>
    !!t && !t.archived && statusByKey.get(t.status)?.group_name !== 'complete';
  // Status changes the sync would have made; it only suggests them unless
  // SYNC_STATUS_MODE=apply on the server.
  // Duplicate task rows for one issue collapse to one line; Apply and Done
  // update every row of that issue.
  const issueKeyOf = (t: TaskRef) =>
    `${repoBase(t.issue_url)}#${issueNumber(t.issue_url) ?? t.issue_url}`;
  const rowsOfIssue = (taskId: string) => {
    const key = issueKeyOf(tasks[taskId]);
    return Object.values(tasks)
      .filter((t) => isActive(t) && issueKeyOf(t) === key)
      .map((t) => t.id);
  };
  const seenSuggested = new Set<string>();
  const suggestions = (
    (log.details?.statusSuggestions as StatusChange[] | undefined) ?? []
  )
    .filter(
      (s) =>
        isActive(tasks[s.taskId]) &&
        tasks[s.taskId].status !== s.to &&
        statusByKey.has(s.to)
    )
    .sort((a, b) => b.confidence - a.confidence)
    .filter((s) => {
      const key = issueKeyOf(tasks[s.taskId]);
      if (seenSuggested.has(key)) return false;
      seenSuggested.add(key);
      return true;
    });
  const jevChoice = new Map(
    ((log.details?.jev as JevObservation[] | undefined) ?? []).map((j) => [
      j.taskId,
      j.choice,
    ])
  );
  const pendingTo = new Map(suggestions.map((s) => [s.taskId, s.to]));
  // A suggested move into an action status needs the user as much as an
  // applied one does. Payment only counts once it is due, and duplicate task
  // rows for one issue show once.
  const today = new Date().toISOString().slice(0, 10);
  const seenIssues = new Set<string>();
  const actions = updates.filter((u) => {
    const t = tasks[u.taskId];
    if (u.confidence < 0.6 || !isActive(t) || doneIds.has(u.taskId)) {
      return false;
    }
    const status = pendingTo.get(u.taskId) ?? t.status;
    if (!ACTION_STATUSES.has(status) && !openBugsOf(u).length) return false;
    if (
      status === 'awaiting_payment' &&
      (!t.payment_date || t.payment_date.slice(0, 10) > today)
    ) {
      return false;
    }
    const key = issueKeyOf(t);
    if (seenIssues.has(key)) return false;
    seenIssues.add(key);
    return true;
  });

  // "Done" is the status for the developer's part being finished, set as a
  // manual change so the next sync keeps it.
  const DONE_STATUS: Record<string, string> = {
    changes_required: 'reviewing',
    awaiting_payment: 'submit',
    regression: 'merged',
  };
  const markDone = async (taskId: string, status: string) => {
    const next = DONE_STATUS[status];
    if (!next || !statusByKey.has(next)) return;
    setDoneIds((prev) => new Set([...prev, ...rowsOfIssue(taskId)]));
    await applySuggestion(taskId, next);
  };

  const applySuggestion = async (taskId: string, status: string) => {
    const ids = rowsOfIssue(taskId);
    const group = statusByKey.get(status)?.group_name;
    const { error } = await createClient()
      .from('tasks')
      .update({
        status,
        ...(group ? { status_group: group } : {}),
        status_changed_at: new Date().toISOString(),
      })
      .in('id', ids);
    if (error) {
      toast.error(`Could not update the status: ${error.message}`);
      return;
    }
    setTasks((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = { ...next[id], status };
      return next;
    });
    toast.success(`Status set to ${statusByKey.get(status)?.label ?? status}`);
  };

  const endedAt = log.completed_at ?? log.started_at;
  const durationMs = log.completed_at
    ? new Date(log.completed_at).getTime() - new Date(log.started_at).getTime()
    : 0;
  const durationLabel =
    durationMs > 0
      ? durationMs < 60_000
        ? `${Math.round(durationMs / 1000)}s`
        : `${Math.floor(durationMs / 60_000)}m ${Math.round((durationMs % 60_000) / 1000)}s`
      : null;

  const nextRun =
    settings?.auto_sync_enabled && !inFlight
      ? new Date(
          new Date(log.started_at).getTime() +
            (settings.sync_interval_hours || 6) * 3_600_000
        )
      : null;

  const backendLabel = BACKEND_LABELS[log.backend ?? backend] ?? 'Claude API';
  const description = inFlight
    ? [
        backendLabel,
        progress ? `${progress.done} of ${progress.total} tasks` : null,
        log.status === 'queued'
          ? 'waiting for the worker'
          : `running for ${formatDistanceToNowStrict(new Date(log.started_at))}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : [
        backendLabel,
        log.task_id
          ? 'single task'
          : updates.length
            ? `${updates.length} tasks`
            : null,
        `${log.status === 'failed' ? 'stopped' : 'finished'} ${formatDistanceToNowStrict(new Date(endedAt))} ago${durationLabel ? ` in ${durationLabel}` : ''}`,
      ]
        .filter(Boolean)
        .join(' · ');

  const pill =
    log.status === 'completed'
      ? {
          text: 'Completed',
          cls: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
          dot: 'bg-green-500',
        }
      : log.status === 'failed'
        ? {
            text: 'Failed',
            cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
            dot: 'bg-red-500',
          }
        : {
            text: log.status === 'queued' ? 'Queued' : 'Running',
            cls: 'bg-muted text-muted-foreground',
            dot: 'bg-muted-foreground animate-pulse',
          };

  const visibleChanges = showAll ? changes : changes.slice(0, 4);
  const busy = inFlight || syncing;

  return (
    <Card className="relative">
      {busy && (
        // Skeleton's sweep over the stale numbers while a run is in flight.
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 animate-shimmer bg-[linear-gradient(110deg,transparent_35%,var(--color-foreground)_50%,transparent_65%)] bg-[length:200%_100%] opacity-[0.06]"
        />
      )}
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1">
          <CardTitle>Last Sync</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium ${pill.cls}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${pill.dot}`} />
            {pill.text}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing || inFlight || !settings?.sync_ready}
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncing || inFlight ? 'animate-spin' : ''}`}
            />
            {log.status === 'failed' ? 'Retry' : 'Sync Now'}
          </Button>
        </div>
      </CardHeader>

      {inFlight && (
        <div className="mx-4 h-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-chart-1 transition-[width] duration-500"
            style={{
              width: progress?.total
                ? `${Math.max(2, Math.round((progress.done / progress.total) * 100))}%`
                : '2%',
            }}
          />
        </div>
      )}
      <CardContent
        className={`flex flex-col gap-4 transition-opacity ${busy ? 'opacity-60' : ''}`}
      >
        {log.status === 'failed' && (
          <div className="flex gap-2.5 rounded-lg bg-destructive/8 px-3.5 py-3 ring-1 ring-destructive/25">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div className="grid gap-0.5">
              <p className="text-sm">
                {friendlySyncError(log.error_message ?? 'Sync failed')}
              </p>
              <p className="text-xs text-muted-foreground">
                {log.bounties_updated} task
                {log.bounties_updated === 1 ? '' : 's'} updated before the stop
                are kept
                {nextRun
                  ? `; the rest will be picked up by the next auto-sync.`
                  : '.'}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Counter label="Status changes" value={changes.length} />
          <Counter label="Fields updated" value={log.bounties_updated ?? 0} />
          <Counter
            label={
              skippedUnchanged
                ? 'Unchanged, skipped'
                : 'Skipped, low confidence'
            }
            value={skippedUnchanged || skippedLowConfidence}
          />
          <Counter
            label="Errors"
            value={errors.length + (log.status === 'failed' ? 1 : 0)}
            tone="danger"
          />
        </div>

        {errors.length > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium tracking-wide text-muted-foreground">
              Errors
            </p>
            {errors.slice(0, 5).map((e, i) => (
              <p key={i} className="truncate text-xs text-destructive">
                {friendlySyncError(e)}
              </p>
            ))}
            {errors.length > 5 && (
              <p className="text-xs text-muted-foreground">
                and {errors.length - 5} more
              </p>
            )}
          </div>
        )}

        {(changes.length > 0 ||
          actions.length > 0 ||
          suggestions.length > 0) && (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                Status changes
              </p>
              {changes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No status changed in this run.
                </p>
              )}
              {suggestions.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[11px] text-muted-foreground">
                    Suggested, not applied
                  </p>
                  {suggestions.map((s) => {
                    const t = tasks[s.taskId];
                    return (
                      <div
                        key={`suggest-${s.taskId}`}
                        className="group flex flex-col gap-1.5 border-b border-dashed border-border py-2 last:border-b-0 sm:h-11 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-0"
                      >
                        <div className="flex min-w-0 items-center gap-1.5">
                          <Link
                            href={`/tasks/${s.taskId}`}
                            className="min-w-0 truncate text-sm hover:underline"
                          >
                            {t.issue_title ?? shortRef(t.issue_url)}
                          </Link>
                          <GitHubLink url={t.issue_url} />
                          {t.pr_url && <GitHubLink url={t.pr_url} pr />}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:flex-nowrap">
                          <StatusPill status={statusByKey.get(t.status)} />
                          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                          <StatusPill status={statusByKey.get(s.to)} />
                          <span className="w-8 text-right font-mono text-[11px] text-muted-foreground">
                            {s.confidence.toFixed(2)}
                          </span>
                          {jevChoice.get(s.taskId) === s.to && (
                            <span
                              className="font-mono text-[11px] text-muted-foreground"
                              title="Jev reached the same status"
                            >
                              Jev ✓
                            </span>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="ml-auto h-7 px-2 text-xs sm:ml-0"
                            onClick={() => applySuggestion(s.taskId, s.to)}
                          >
                            Apply
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {visibleChanges.map((c) => {
                const t = tasks[c.taskId];
                return (
                  <div
                    key={c.taskId}
                    className="group flex flex-col gap-1.5 border-b border-border py-2 last:border-b-0 sm:h-11 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:py-0"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Link
                          href={`/tasks/${c.taskId}`}
                          className="block truncate text-sm hover:underline"
                        >
                          {t?.issue_title ??
                            (t ? shortRef(t.issue_url) : 'Task')}
                        </Link>
                        {t && <GitHubLink url={t.issue_url} />}
                        {t?.pr_url && <GitHubLink url={t.pr_url} pr />}
                      </div>
                      {t && (
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {shortRef(t.issue_url)}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:flex-nowrap">
                      <StatusPill status={statusByKey.get(c.from)} />
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <StatusPill status={statusByKey.get(c.to)} />
                      <span className="w-8 text-right font-mono text-[11px] text-muted-foreground">
                        {c.confidence.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {changes.length > 4 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="self-start text-xs text-muted-foreground hover:text-foreground"
                >
                  {showAll ? 'Show fewer' : `Show all ${changes.length}`}
                </button>
              )}
            </div>

            {actions.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium tracking-wide text-muted-foreground">
                  Needs your action
                </p>
                {actions.map((u) => {
                  const t = tasks[u.taskId];
                  const payment =
                    (pendingTo.get(u.taskId) ?? t?.status) ===
                    'awaiting_payment';
                  const bugs = openBugsOf(u);
                  const Icon = payment
                    ? Banknote
                    : bugs.length
                      ? Bug
                      : AlertCircle;
                  return (
                    <div
                      key={u.taskId}
                      className="group flex gap-2.5 rounded-lg bg-muted px-3 py-2.5"
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${payment ? 'text-green-600 dark:text-green-500' : bugs.length ? 'text-red-600 dark:text-red-500' : 'text-yellow-600 dark:text-yellow-500'}`}
                      />
                      <div className="grid min-w-0 gap-0.5">
                        <p className="text-sm">
                          {payment && t?.payment_date
                            ? `Payment was due ${format(new Date(`${t.payment_date.slice(0, 10)}T00:00:00`), 'MMM d')}.`
                            : linkIssueRefs(
                                u.summary,
                                t ? repoBase(t.issue_url) : null
                              )}
                          {t?.pr_url && (
                            <>
                              {' '}
                              <a
                                href={t.pr_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-chart-1 hover:underline"
                              >
                                PR
                              </a>
                            </>
                          )}
                        </p>
                        {bugs.map((b) => (
                          <a
                            key={b.number}
                            href={b.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate text-sm hover:underline"
                          >
                            <span className="font-mono text-chart-1">
                              #{b.number}
                            </span>{' '}
                            {b.title}
                          </a>
                        ))}
                        <p className="truncate text-xs text-muted-foreground">
                          {t && issueNumber(t.issue_url) && (
                            <>
                              <a
                                href={`${repoBase(t.issue_url)}/issues/${issueNumber(t.issue_url)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-chart-1 hover:underline"
                              >
                                #{issueNumber(t.issue_url)}
                              </a>
                              {' · '}
                            </>
                          )}
                          {payment && t?.amount
                            ? `$${t.amount.toLocaleString()} · `
                            : ''}
                          {t?.issue_title ?? (t ? shortRef(t.issue_url) : '')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          markDone(
                            u.taskId,
                            payment
                              ? 'awaiting_payment'
                              : bugs.length
                                ? 'regression'
                                : 'changes_required'
                          )
                        }
                        title={
                          payment
                            ? 'Done: payment requested (Submit in ND)'
                            : bugs.length
                              ? 'Done: linked bugs handled (Merged)'
                              : 'Done: changes made (Reviewing)'
                        }
                        aria-label="Mark as done"
                        className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center self-start rounded-md text-muted-foreground transition-opacity hover:bg-background hover:text-foreground focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            {settings?.auto_sync_enabled
              ? `Auto-sync every ${settings.sync_interval_hours} hours${
                  nextRun
                    ? nextRun.getTime() > Date.now()
                      ? ` · next run in ${formatDistanceToNowStrict(nextRun)}`
                      : ' · next run due now'
                    : ''
                }`
              : 'Auto-sync is off'}
          </span>
          <Link href="/settings" className="hover:text-foreground">
            Sync settings
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
