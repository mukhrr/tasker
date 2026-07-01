import type { HelpWantedIssue, ExtensionSettings } from '../shared/types';
import type { SendHelpWantedNotificationRequest } from '../shared/messages';
import { getSettings } from '../shared/settings';
import { getSeen, setSeen } from '../shared/seen-issues';
import { showNewBugDailyAlert } from './issue-alert';

// The in-page lightning popup fires on any brand-new issue matching the user's
// configured watched label groups (the same groups that drive notifications) —
// a fresh bounty can already carry Bug + Daily + External + Help Wanted at once,
// so we trust the user's curated groups instead of a hardcoded pair. Deduped via
// its own seen namespace so it pops each issue once and never disturbs the
// watched-label OS-notification dedup.
const POPUP_SEEN_NS = 'seenBugDailyPopup';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildLabelRegex(label: string): RegExp {
  // Allow optional whitespace/hyphen between words (e.g. "Help Wanted" matches "help-wanted")
  const flexible = escapeRegex(label).replace(/\s+/g, '[\\s-]?');
  return new RegExp(`(?:^|[^a-z0-9])${flexible}(?:$|[^a-z0-9])`, 'i');
}

function detectMatchingGroups(rowText: string, groups: string[][]): string[] {
  const matched: string[] = [];
  for (const group of groups) {
    if (group.length === 0) continue;
    const allPresent = group.every((label) => buildLabelRegex(label).test(rowText));
    if (allPresent) matched.push(group.join(' + '));
  }
  return matched;
}

function hasExcludedLabel(rowText: string, excluded: string[]): boolean {
  for (const label of excluded) {
    if (buildLabelRegex(label).test(rowText)) return true;
  }
  return false;
}

function scanWatchedIssues(groups: string[][], excluded: string[]): HelpWantedIssue[] {
  const results = new Map<number, HelpWantedIssue>();
  if (groups.length === 0) return [];

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
    const rowText = row.textContent ?? '';
    if (hasExcludedLabel(rowText, excluded)) continue;
    const labels = detectMatchingGroups(rowText, groups);
    if (labels.length === 0) continue;

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
    results.set(number, { number, title, url: href, labels });
  }

  return Array.from(results.values());
}

export class IssueListWatcher {
  private refreshTimer: number | null = null;
  private scanTimer: number | null = null;
  private destroyed = false;

  constructor(private owner: string, private repo: string) {}

  async init(): Promise<void> {
    const settings = await getSettings();

    // Visual preview: open …/issues#tasker-test-alert to see the popup on demand.
    if (window.location.hash === '#tasker-test-alert') {
      showNewBugDailyAlert(
        [
          {
            number: 99999,
            title: 'Test bounty — Bug + Daily lightning popup',
            url: window.location.href,
            labels: ['Bug + Daily'],
          },
        ],
        { sound: settings.bugDailyPopupSound },
      );
    }

    // First scan runs shortly after mount to let Turbo finish rendering.
    this.scanTimer = window.setTimeout(() => {
      void this.runScan(true);
    }, 1500);

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
      const settings = await getSettings();

      // In-page lightning popup for brand-new issues matching the watched label
      // groups. Runs before the notification flow (and its early return) so the
      // popup fires on its own toggle, independent of whether notifications are on.
      await this.checkBugDailyPopup(settings, isFirstLoad);

      const issues = scanWatchedIssues(settings.watchedLabelGroups, settings.excludedLabels);
      const seen = await getSeen(this.owner, this.repo);

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
          labels: issue.labels,
        };
        chrome.runtime.sendMessage(msg).catch(() => { /* ignore */ });
      }
    } catch {
      /* ignore scan errors */
    }
  }

  private async checkBugDailyPopup(
    settings: Pick<
      ExtensionSettings,
      'watchedLabelGroups' | 'excludedLabels' | 'bugDailyPopupEnabled' | 'bugDailyPopupSound'
    >,
    isFirstLoad: boolean,
  ): Promise<void> {
    if (this.destroyed || !settings.bugDailyPopupEnabled) return;
    const matches = scanWatchedIssues(settings.watchedLabelGroups, settings.excludedLabels);
    if (matches.length === 0) return;

    const seen = await getSeen(this.owner, this.repo, POPUP_SEEN_NS);
    const fresh = matches.filter((i) => !seen.has(i.number));
    if (fresh.length === 0) return;

    // First time we ever scan this repo for popups: seed silently so we don't
    // flash every pre-existing matching issue at once.
    const isSeedingRun = seen.size === 0 && isFirstLoad;

    for (const issue of fresh) seen.add(issue.number);
    await setSeen(this.owner, this.repo, seen, POPUP_SEEN_NS);

    if (isSeedingRun || this.destroyed) return;
    showNewBugDailyAlert(fresh, { sound: settings.bugDailyPopupSound });
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
