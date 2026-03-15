import { parseGitHubUrl } from './github-url';
import { StatusWidget } from './status-widget';

let currentWidget: StatusWidget | null = null;
let lastUrl = '';

function findSidebar(): Element | null {
  // GitHub uses CSS modules with hashed class names.
  // New React-based UI (2025+): full sidebar with all sections
  return (
    document.querySelector('[class*="sidebarContent"]') ??
    // Legacy layout (older repos / enterprise):
    document.querySelector('.Layout-sidebar .BorderGrid') ??
    null
  );
}

function mountWidget() {
  const url = window.location.href;
  if (url === lastUrl) return;
  lastUrl = url;

  // Cleanup previous widget
  if (currentWidget) {
    currentWidget.destroy();
    currentWidget = null;
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) return;

  // Wait for sidebar to be available (GitHub loads asynchronously)
  const tryMount = (attempts = 0) => {
    const sidebar = findSidebar();
    if (!sidebar) {
      if (attempts < 20) {
        setTimeout(() => tryMount(attempts + 1), 250);
      }
      return;
    }

    currentWidget = new StatusWidget(parsed.owner, parsed.repo, parsed.number);
    sidebar.appendChild(currentWidget.element);
    currentWidget.init();
  };

  tryMount();
}

// Initial mount
mountWidget();

// GitHub SPA navigation via Turbo
document.addEventListener('turbo:load', () => {
  lastUrl = ''; // force re-check
  mountWidget();
});

// Fallback: poll for URL changes (handles edge cases)
let pollUrl = window.location.href;
setInterval(() => {
  if (window.location.href !== pollUrl) {
    pollUrl = window.location.href;
    lastUrl = ''; // force re-check
    mountWidget();
  }
}, 1000);
