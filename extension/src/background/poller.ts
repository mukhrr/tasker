import type { HelpWantedIssue, WatchlistEntry } from '../shared/types';
import { getSeen, setSeen } from '../shared/seen-issues';
import { getSettings, MIN_POLL_SECONDS } from '../shared/settings';
import { getWatchlist } from '../shared/watchlist';
import { handleSendHelpWantedNotification } from './notifier';

const ALARM_NAME = 'tasker-help-wanted-poll';

interface GithubIssue {
  number: number;
  title: string;
  html_url: string;
  pull_request?: unknown;
  labels?: Array<{ name?: string } | string>;
}

function issueLabelNames(issue: GithubIssue): string[] {
  if (!Array.isArray(issue.labels)) return [];
  return issue.labels
    .map((l) => (typeof l === 'string' ? l : l?.name ?? ''))
    .filter((n) => n.length > 0);
}

async function fetchIssuesByLabelGroup(
  entry: WatchlistEntry,
  labels: string[],
): Promise<GithubIssue[]> {
  // GitHub's REST API treats comma-separated labels= as AND.
  const labelQuery = labels.join(',');
  const url =
    `https://api.github.com/repos/${encodeURIComponent(entry.owner)}/${encodeURIComponent(entry.repo)}/issues` +
    `?state=open&labels=${encodeURIComponent(labelQuery)}&per_page=30&sort=created&direction=desc`;

  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as GithubIssue[];
  return data.filter((i) => !i.pull_request);
}

async function fetchWatchedIssues(
  entry: WatchlistEntry,
  watchedLabelGroups: string[][],
  excludedLabels: string[],
): Promise<HelpWantedIssue[]> {
  const excludedLower = new Set(excludedLabels.map((l) => l.toLowerCase()));
  const merged = new Map<number, HelpWantedIssue>();

  for (const group of watchedLabelGroups) {
    if (group.length === 0) continue;
    let batch: GithubIssue[];
    try {
      batch = await fetchIssuesByLabelGroup(entry, group);
    } catch (err) {
      console.warn('[tasker] poll failed', entry, group, err);
      continue;
    }
    const groupSummary = group.join(' + ');
    for (const i of batch) {
      const names = issueLabelNames(i);
      if (names.some((n) => excludedLower.has(n.toLowerCase()))) continue;

      const existing = merged.get(i.number);
      if (existing) {
        if (!existing.labels.includes(groupSummary)) existing.labels.push(groupSummary);
      } else {
        merged.set(i.number, {
          number: i.number,
          title: i.title,
          url: i.html_url,
          labels: [groupSummary],
        });
      }
    }
  }
  return Array.from(merged.values());
}

async function pollOne(
  entry: WatchlistEntry,
  notify: boolean,
  watchedLabelGroups: string[][],
  excludedLabels: string[],
): Promise<void> {
  if (watchedLabelGroups.length === 0) return;
  const issues = await fetchWatchedIssues(entry, watchedLabelGroups, excludedLabels);
  if (issues.length === 0) return;

  const seen = await getSeen(entry.owner, entry.repo);
  const isSeeding = seen.size === 0;

  const newIssues = issues.filter((i) => !seen.has(i.number));
  if (newIssues.length === 0) return;

  for (const issue of newIssues) seen.add(issue.number);
  await setSeen(entry.owner, entry.repo, seen);

  if (isSeeding || !notify) return;

  for (const issue of newIssues.slice(0, 10)) {
    const res = await handleSendHelpWantedNotification(
      entry.owner,
      entry.repo,
      issue.number,
      issue.title,
      issue.url,
      issue.labels,
    );
    if (!res.ok) console.warn('[tasker] notify failed', res.error);
  }
}

export async function runPollerTick(): Promise<void> {
  const settings = await getSettings();
  const watchlist = await getWatchlist();
  if (watchlist.length === 0) return;
  await Promise.all(
    watchlist.map((entry) =>
      pollOne(
        entry,
        settings.notifyHelpWanted,
        settings.watchedLabelGroups,
        settings.excludedLabels,
      ),
    ),
  );
}

export async function scheduleAlarm(): Promise<void> {
  const settings = await getSettings();
  const seconds = Math.max(MIN_POLL_SECONDS, settings.pollSeconds);
  const minutes = seconds / 60;
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: minutes, delayInMinutes: minutes });
}

export function registerAlarmListener(): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    runPollerTick().catch((e) => console.warn('[tasker] poll tick failed', e));
  });
}
