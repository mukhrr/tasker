import type {
  LoginGithubRequest,
  LogoutRequest,
  GetSessionRequest,
  LoginResponse,
  SessionResponse,
  TestNotificationRequest,
  ReschedulePollerRequest,
  MessageResponse,
} from '../shared/messages';
import type { NotifyChannel, WatchlistEntry } from '../shared/types';
import { getSettings, setSettings } from '../shared/settings';
import {
  setTelegramToken,
  hasTelegramToken,
  clearTelegramToken,
} from '../shared/secret-store';
import {
  getWatchlist,
  addWatchlistEntry,
  removeWatchlistEntry,
  parseRepoInput,
} from '../shared/watchlist';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const loadingView = $('#loading');
const loginView = $('#login-view');
const loggedInView = $('#logged-in-view');

function showView(view: HTMLElement) {
  loadingView.classList.add('hidden');
  loginView.classList.add('hidden');
  loggedInView.classList.add('hidden');
  view.classList.remove('hidden');
}

function sendMessage<T>(msg: LoginGithubRequest | LogoutRequest | GetSessionRequest): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

// ── Init ──

async function init() {
  const res = await sendMessage<SessionResponse>({ type: 'GET_SESSION' });
  if (res.ok && res.data) {
    setUser(res.data.username || res.data.email);
    showView(loggedInView);
  } else {
    showView(loginView);
  }
}

function setUser(name: string) {
  $('#user-email').textContent = `@${name}`;
  $('#user-avatar').textContent = name.charAt(0).toUpperCase();
}

// ── GitHub Login ──

$('#github-login-btn').addEventListener('click', async () => {
  const btn = $('#github-login-btn') as HTMLButtonElement;
  const errorEl = $('#login-error');
  errorEl.classList.add('hidden');

  btn.disabled = true;
  btn.textContent = 'Signing in...';

  const res = await sendMessage<LoginResponse>({ type: 'LOGIN_GITHUB' });

  if (res.ok && res.data) {
    setUser(res.data.username || res.data.email);
    showView(loggedInView);
  } else {
    errorEl.textContent = res.error ?? 'Login failed';
    errorEl.classList.remove('hidden');
  }

  btn.disabled = false;
  btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
    </svg>
    Sign in with GitHub
  `;
});

// ── Logout ──

$('#logout-btn').addEventListener('click', async () => {
  await sendMessage({ type: 'LOGOUT' });
  showView(loginView);
});

// ── Star count ──

async function fetchStarCount() {
  try {
    const res = await fetch('https://api.github.com/repos/mukhrr/tasker');
    const data = await res.json();
    if (typeof data.stargazers_count === 'number') {
      const countEl = document.querySelector('#star-count');
      if (countEl) {
        const n = data.stargazers_count;
        countEl.textContent = n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n);
        countEl.classList.remove('hidden');
      }
    }
  } catch { /* ignore */ }
}

// ── Settings ──

const settingsStatus = $('#settings-status');
const tokenInput = $('#tg-token') as HTMLInputElement;
const tokenSavedRow = $('#token-saved-row');
const chatIdInput = $('#tg-chat-id') as HTMLInputElement;
const autoRefreshToggle = $('#auto-refresh-toggle') as HTMLInputElement;
const refreshSecondsInput = $('#refresh-seconds') as HTMLInputElement;
const pollSecondsInput = $('#poll-seconds') as HTMLInputElement;
const notifyToggle = $('#notify-toggle') as HTMLInputElement;
const channelBrowser = $('#channel-browser') as HTMLInputElement;
const channelTelegram = $('#channel-telegram') as HTMLInputElement;
const watchlistEl = $('#watchlist');
const watchlistInput = $('#watchlist-input') as HTMLInputElement;

function showStatus(text: string, kind: 'ok' | 'error'): void {
  settingsStatus.textContent = text;
  settingsStatus.classList.remove('hidden', 'status-ok', 'status-error');
  settingsStatus.classList.add(kind === 'ok' ? 'status-ok' : 'status-error');
  window.setTimeout(() => settingsStatus.classList.add('hidden'), 4000);
}

function renderTokenState(hasToken: boolean): void {
  if (hasToken) {
    tokenInput.classList.add('hidden');
    tokenInput.value = '';
    tokenSavedRow.classList.remove('hidden');
  } else {
    tokenInput.classList.remove('hidden');
    tokenSavedRow.classList.add('hidden');
  }
}

function renderWatchlist(list: WatchlistEntry[]): void {
  watchlistEl.innerHTML = '';
  if (list.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'watchlist-empty';
    empty.textContent = 'No repos watched yet';
    watchlistEl.appendChild(empty);
    return;
  }
  for (const entry of list) {
    const row = document.createElement('div');
    row.className = 'watchlist-item';

    const label = document.createElement('span');
    label.textContent = `${entry.owner}/${entry.repo}`;
    row.appendChild(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-btn';
    remove.textContent = 'Remove';
    remove.addEventListener('click', async () => {
      const next = await removeWatchlistEntry(entry.owner, entry.repo);
      renderWatchlist(next);
    });
    row.appendChild(remove);

    watchlistEl.appendChild(row);
  }
}

async function loadSettingsIntoForm(): Promise<void> {
  const settings = await getSettings();
  autoRefreshToggle.checked = settings.autoRefreshEnabled;
  refreshSecondsInput.value = String(settings.autoRefreshSeconds);
  pollSecondsInput.value = String(settings.pollSeconds);
  notifyToggle.checked = settings.notifyHelpWanted;
  channelBrowser.checked = settings.notifyChannels.includes('browser');
  channelTelegram.checked = settings.notifyChannels.includes('telegram');
  chatIdInput.value = settings.telegramChatId;
  renderTokenState(await hasTelegramToken());
  renderWatchlist(await getWatchlist());
}

$('#watchlist-add-btn').addEventListener('click', async () => {
  const parsed = parseRepoInput(watchlistInput.value);
  if (!parsed) {
    showStatus('Enter as owner/repo (e.g. Expensify/App)', 'error');
    return;
  }
  try {
    const next = await addWatchlistEntry(parsed.owner, parsed.repo);
    watchlistInput.value = '';
    renderWatchlist(next);
    const msg: ReschedulePollerRequest = { type: 'RESCHEDULE_POLLER' };
    void chrome.runtime.sendMessage(msg);
  } catch (err) {
    showStatus((err as Error).message, 'error');
  }
});

watchlistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#watchlist-add-btn').click();
  }
});

$('#test-notification-btn').addEventListener('click', async () => {
  const channels: string[] = [];
  if (channelBrowser.checked) channels.push('browser');
  if (channelTelegram.checked) channels.push('telegram');
  if (channels.length === 0) {
    showStatus('Pick at least one channel (Browser / Telegram)', 'error');
    return;
  }

  const req: TestNotificationRequest = { type: 'TEST_NOTIFICATION' };
  const res = (await chrome.runtime.sendMessage(req)) as MessageResponse;
  if (res.ok) {
    showStatus(`Test sent via ${channels.join(' + ')}`, 'ok');
  } else {
    showStatus(res.error ?? 'Test failed', 'error');
  }
});

$('#token-change-btn').addEventListener('click', async () => {
  await clearTelegramToken();
  renderTokenState(false);
  tokenInput.focus();
});

$('#settings-save-btn').addEventListener('click', async () => {
  const seconds = parseInt(refreshSecondsInput.value, 10);
  if (!Number.isFinite(seconds) || seconds < 5) {
    showStatus('Refresh interval must be at least 5 seconds', 'error');
    return;
  }
  const poll = parseInt(pollSecondsInput.value, 10);
  if (!Number.isFinite(poll) || poll < 30) {
    showStatus('Poll interval must be at least 30 seconds', 'error');
    return;
  }

  const channels: NotifyChannel[] = [];
  if (channelBrowser.checked) channels.push('browser');
  if (channelTelegram.checked) channels.push('telegram');
  if (notifyToggle.checked && channels.length === 0) {
    showStatus('Pick at least one notification channel', 'error');
    return;
  }

  try {
    await setSettings({
      autoRefreshEnabled: autoRefreshToggle.checked,
      autoRefreshSeconds: seconds,
      pollSeconds: poll,
      notifyHelpWanted: notifyToggle.checked,
      notifyChannels: channels.length > 0 ? channels : ['browser'],
      telegramChatId: chatIdInput.value.trim(),
    });

    const newToken = tokenInput.value.trim();
    if (newToken) {
      await setTelegramToken(newToken);
      renderTokenState(true);
    }

    const msg: ReschedulePollerRequest = { type: 'RESCHEDULE_POLLER' };
    void chrome.runtime.sendMessage(msg);

    showStatus('Settings saved', 'ok');
  } catch (err) {
    showStatus((err as Error).message ?? 'Failed to save', 'error');
  }
});

fetchStarCount();
init();
void loadSettingsIntoForm();
