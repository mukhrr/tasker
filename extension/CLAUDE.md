# CLAUDE.md — Tasker browser extension

Chrome extension (Manifest V3) that surfaces Tasker status on GitHub issue/PR pages. Built with esbuild, plain TypeScript (no framework).

## Structure

- `src/background/index.ts` — Service worker. Handles all message types: auth (GitHub OAuth via Supabase), task CRUD, batch queries, and linked status updates.
- `src/content/index.ts` — Content script injected on `github.com/*`. Detects issue/PR pages, mounts `StatusWidget`.
- `src/content/status-widget.ts` — Shadow DOM widget with two modes:
  - **Issue mode**: Mounts in GitHub sidebar. Shows task status or "Add to Tasker" button.
  - **PR mode**: Mounts in the PR description row (next to Open badge). Parses linked issue numbers (`#NNNNN`) from the PR description, queries which are tracked as tasks, and shows a status dropdown that bulk-updates all linked tasks.
- `src/content/github-url.ts` — Parses GitHub URLs to extract `{owner, repo, number, type}`.
- `src/popup/` — Extension popup (HTML/CSS/TS). Shows auth state and a visual hint about the widget location.
- `src/shared/` — Shared types, message definitions, constants (colors, status groups).

## Build

```bash
cd extension
npm run build    # esbuild → dist/
npm run watch    # esbuild watch mode
```

The build copies `manifest.json`, `popup.html`, `popup.css`, and `icons/` into `dist/`. Load `extension/dist` as an unpacked extension in Chrome.

## Message Protocol

Content script and popup communicate with the background service worker via `chrome.runtime.sendMessage`. Key message types:
- `QUERY_TASK` / `QUERY_TASKS_BATCH` — single or batch task lookup by owner/repo/number
- `UPDATE_STATUS` — update a single task
- `UPDATE_LINKED_STATUSES` — bulk update tasks by owner/repo + issue numbers array
- `CREATE_TASK` — add an issue to Tasker
- `LOGIN_GITHUB` / `LOGOUT` / `GET_SESSION` — auth flow
- `QUERY_STATUSES` — fetch user's status definitions (cached 5 min)

## Convention

After any changes in this folder, bump the `version` in `manifest.json` (semver patch/minor as appropriate).
