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
}

async function fetchHelpWantedIssues(entry: WatchlistEntry): Promise<HelpWantedIssue[]> {
  const url =
    `https://api.github.com/repos/${encodeURIComponent(entry.owner)}/${encodeURIComponent(entry.repo)}/issues` +
    `?state=open&labels=${encodeURIComponent('Help Wanted')}&per_page=30&sort=created&direction=desc`;

  const res = await fetch(url, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as GithubIssue[];
  return data
    .filter((i) => !i.pull_request)
    .map((i) => ({ number: i.number, title: i.title, url: i.html_url }));
}

async function pollOne(entry: WatchlistEntry, notify: boolean): Promise<void> {
  let issues: HelpWantedIssue[];
  try {
    issues = await fetchHelpWantedIssues(entry);
  } catch (err) {
    console.warn('[tasker] poll failed', entry, err);
    return;
  }

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
    );
    if (!res.ok) console.warn('[tasker] notify failed', res.error);
  }
}

export async function runPollerTick(): Promise<void> {
  const settings = await getSettings();
  const watchlist = await getWatchlist();
  if (watchlist.length === 0) return;
  await Promise.all(watchlist.map((entry) => pollOne(entry, settings.notifyHelpWanted)));
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
