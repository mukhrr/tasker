import type { HelpWantedIssue } from '../shared/types';
import type { SendHelpWantedNotificationRequest } from '../shared/messages';
import { getSettings } from '../shared/settings';
import { getSeen, setSeen } from '../shared/seen-issues';

const HELP_WANTED_RE = /help[\s-]?wanted/i;

function scanHelpWantedIssues(): HelpWantedIssue[] {
  const results = new Map<number, HelpWantedIssue>();

  const rowCandidates = new Set<Element>();
  document
    .querySelectorAll('[data-testid="list-view-item"], [data-testid="list-view-items"] > li, div[id^="issue_"], li[id^="issue_"]')
    .forEach((el) => rowCandidates.add(el));

  // Fallback: any anchor that looks like an issue link, walk up to a plausible row container
  if (rowCandidates.size === 0) {
    document.querySelectorAll('a[href*="/issues/"]').forEach((a) => {
      const row = a.closest('li, article, div[role="listitem"]');
      if (row) rowCandidates.add(row);
    });
  }

  for (const row of rowCandidates) {
    const text = (row.textContent ?? '').toLowerCase();
    if (!HELP_WANTED_RE.test(text)) continue;

    const link = row.querySelector<HTMLAnchorElement>(
      'a[data-testid="issue-pr-title-link"], a[id^="issue_"][href*="/issues/"], a[href*="/issues/"]',
    );
    if (!link) continue;
    const href = link.href;
    const match = href.match(/\/issues\/(\d+)(?:[?#].*)?$/);
    if (!match) continue;
    const number = parseInt(match[1], 10);
    if (!Number.isFinite(number) || number <= 0) continue;
    if (results.has(number)) continue;

    const title = (link.textContent ?? '').trim() || `Issue #${number}`;
    results.set(number, { number, title, url: href });
  }

  return Array.from(results.values());
}

export class IssueListWatcher {
  private refreshTimer: number | null = null;
  private scanTimer: number | null = null;
  private destroyed = false;

  constructor(private owner: string, private repo: string) {}

  async init(): Promise<void> {
    // First scan runs shortly after mount to let Turbo finish rendering.
    this.scanTimer = window.setTimeout(() => {
      void this.runScan(true);
    }, 1500);

    const settings = await getSettings();
    if (settings.autoRefreshEnabled) {
      const ms = Math.max(5, settings.autoRefreshSeconds) * 1000;
      this.refreshTimer = window.setTimeout(() => {
        if (!this.destroyed) window.location.reload();
      }, ms);
    }
  }

  private async runScan(isFirstLoad: boolean): Promise<void> {
    if (this.destroyed) return;
    try {
      const issues = scanHelpWantedIssues();
      const seen = await getSeen(this.owner, this.repo);

      const settings = await getSettings();
      const notify = settings.notifyHelpWanted;

      const newIssues = issues.filter((i) => !seen.has(i.number));
      if (newIssues.length === 0) return;

      // On the very first scan for a repo (no prior seen set), don't flood — just seed.
      const isSeedingRun = seen.size === 0 && isFirstLoad;

      for (const issue of newIssues) seen.add(issue.number);
      await setSeen(this.owner, this.repo, seen);

      if (isSeedingRun || !notify) return;

      for (const issue of newIssues.slice(0, 10)) {
        const msg: SendHelpWantedNotificationRequest = {
          type: 'SEND_HELP_WANTED',
          owner: this.owner,
          repo: this.repo,
          number: issue.number,
          title: issue.title,
          url: issue.url,
        };
        chrome.runtime.sendMessage(msg).catch(() => { /* ignore */ });
      }
    } catch {
      /* ignore scan errors */
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer !== null) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.scanTimer !== null) {
      clearTimeout(this.scanTimer);
      this.scanTimer = null;
    }
  }
}
