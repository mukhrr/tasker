'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, RefreshCw, AlertCircle, Banknote } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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

interface SyncUpdate {
  taskId: string;
  suggestedStatus: string;
  confidence: number;
  summary: string;
}

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

// Statuses whose arrival means the developer has something to do.
const ACTION_STATUSES = new Set(['changes_required', 'awaiting_payment']);

function shortRef(issueUrl: string): string {
  const m = issueUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)/);
  return m ? `${m[1]}#${m[2]}` : issueUrl;
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
  const [syncing, setSyncing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const statusByKey = useMemo(
    () => new Map(statuses.map((s) => [s.key, s])),
    [statuses]
  );

  const load = useCallback(async () => {
    const [logRes, settingsRes] = await Promise.all([
      fetch('/api/sync/status', { cache: 'no-store' }),
      fetch('/api/settings', { cache: 'no-store' }),
    ]);
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
    const ids = [...new Set([...updates, ...changes].map((u) => u.taskId))];
    if (ids.length) {
      const supabase = createClient();
      const { data } = await supabase
        .from('tasks')
        .select('id, issue_title, issue_url, pr_url, amount')
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

  if (!loaded) return null;

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
  const skipped = updates.filter((u) => u.confidence < 0.6).length;
  const actions = updates.filter(
    (u) => u.confidence >= 0.6 && ACTION_STATUSES.has(u.suggestedStatus)
  );

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

  const description = inFlight
    ? `${BACKEND_LABELS[log.backend ?? backend]} · running since ${formatDistanceToNowStrict(new Date(log.started_at))} ago`
    : [
        BACKEND_LABELS[log.backend ?? backend],
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
        // Same sweep as Skeleton, laid over the stale numbers while a run
        // is in flight so the card reads as "updating", not "done".
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
          <Counter label="Skipped, low confidence" value={skipped} />
          <Counter
            label="Errors"
            value={errors.length + (log.status === 'failed' ? 1 : 0)}
            tone="danger"
          />
        </div>

        {(changes.length > 0 || actions.length > 0) && (
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
              {visibleChanges.map((c) => {
                const t = tasks[c.taskId];
                return (
                  <div
                    key={c.taskId}
                    className="flex h-11 items-center justify-between gap-3 border-b border-border last:border-b-0"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/tasks/${c.taskId}`}
                        className="block truncate text-sm hover:underline"
                      >
                        {t?.issue_title ?? (t ? shortRef(t.issue_url) : 'Task')}
                      </Link>
                      {t && (
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {shortRef(t.issue_url)}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
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
                  const payment = u.suggestedStatus === 'awaiting_payment';
                  const Icon = payment ? Banknote : AlertCircle;
                  return (
                    <div
                      key={u.taskId}
                      className="flex gap-2.5 rounded-lg bg-muted px-3 py-2.5"
                    >
                      <Icon
                        className={`mt-0.5 h-4 w-4 shrink-0 ${payment ? 'text-green-600 dark:text-green-500' : 'text-yellow-600 dark:text-yellow-500'}`}
                      />
                      <div className="grid min-w-0 gap-0.5">
                        <p className="text-sm">
                          {u.summary}
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
                        <p className="truncate text-xs text-muted-foreground">
                          {payment && t?.amount
                            ? `$${t.amount.toLocaleString()} · `
                            : ''}
                          {t?.issue_title ?? (t ? shortRef(t.issue_url) : '')}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
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
