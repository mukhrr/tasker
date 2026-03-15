import { parseGitHubUrl } from './github-url';
import { StatusWidget } from './status-widget';

let currentWidget: StatusWidget | null = null;
let lastUrl = '';

function findSidebar(): Element | null {
  return (
    document.querySelector('[class*="sidebarContent"]') ??
    document.querySelector('.Layout-sidebar .BorderGrid') ??
    null
  );
}

function findPrDescriptionRow(): Element | null {
  // The flex row containing the "Open" badge and merge info
  return (
    document.querySelector('[class*="PageHeader-Description"] .d-flex.flex-justify-between') ??
    null
  );
}

/** Parse issue numbers referenced in the PR description body */
function parseLinkedIssueNumbers(): number[] {
  // Look for issue links in the first comment (PR description)
  const descriptionBody =
    document.querySelector('.js-comment-body') ??
    document.querySelector('[data-testid="issue-body"]');

  if (!descriptionBody) return [];

  const numbers = new Set<number>();
  // Match #NNNNN references (links or text)
  const links = descriptionBody.querySelectorAll('a[href*="/issues/"]');
  for (const link of links) {
    const href = (link as HTMLAnchorElement).href;
    const match = href.match(/\/issues\/(\d+)/);
    if (match) numbers.add(parseInt(match[1], 10));
  }

  // Also match plain #NNN text references
  const text = descriptionBody.textContent ?? '';
  const textMatches = text.matchAll(/#(\d{2,})/g);
  for (const m of textMatches) {
    numbers.add(parseInt(m[1], 10));
  }

  return Array.from(numbers);
}

function mountWidget() {
  const url = window.location.href;
  if (url === lastUrl) return;
  lastUrl = url;

  if (currentWidget) {
    currentWidget.destroy();
    currentWidget = null;
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) return;

  const tryMount = (attempts = 0) => {
    if (parsed.type === 'pr') {
      // Mount in the description row for PRs (next to Open badge)
      const descRow = findPrDescriptionRow();
      if (!descRow) {
        if (attempts < 20) setTimeout(() => tryMount(attempts + 1), 250);
        return;
      }
      const linkedIssues = parseLinkedIssueNumbers();
      currentWidget = new StatusWidget(parsed.owner, parsed.repo, parsed.number, 'pr', linkedIssues);
      descRow.appendChild(currentWidget.element);
      currentWidget.init();
    } else {
      // Mount in sidebar for issues
      const sidebar = findSidebar();
      if (!sidebar) {
        if (attempts < 20) setTimeout(() => tryMount(attempts + 1), 250);
        return;
      }
      currentWidget = new StatusWidget(parsed.owner, parsed.repo, parsed.number, 'issue', []);
      sidebar.appendChild(currentWidget.element);
      currentWidget.init();
    }
  };

  tryMount();
}

// Initial mount
mountWidget();

// GitHub SPA navigation via Turbo
document.addEventListener('turbo:load', () => {
  lastUrl = '';
  mountWidget();
});

// Fallback: poll for URL changes
let pollUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== pollUrl) {
    pollUrl = window.location.href;
    lastUrl = '';
    mountWidget();
  }
}, 1000);
