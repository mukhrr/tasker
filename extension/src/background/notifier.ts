import type { MessageResponse } from '../shared/messages';
import { getSettings } from '../shared/settings';
import { sendTelegramHelpWanted } from './telegram';

const NOTIF_PREFIX = 'tasker-hw:';

export function registerBrowserNotificationClicks(): void {
  chrome.notifications.onClicked.addListener((notificationId) => {
    if (!notificationId.startsWith(NOTIF_PREFIX)) return;
    const url = notificationId.slice(NOTIF_PREFIX.length);
    chrome.tabs.create({ url }).catch(() => { /* ignore */ });
    chrome.notifications.clear(notificationId).catch(() => { /* ignore */ });
  });
}

async function sendBrowserNotification(
  owner: string,
  repo: string,
  number: number,
  title: string,
  url: string,
): Promise<void> {
  await chrome.notifications.create(`${NOTIF_PREFIX}${url}`, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: `${owner}/${repo} — help wanted`,
    message: `#${number} ${title}`,
    priority: 1,
    requireInteraction: false,
  });
}

export async function handleSendHelpWantedNotification(
  owner: string,
  repo: string,
  number: number,
  title: string,
  url: string,
): Promise<MessageResponse> {
  const settings = await getSettings();
  if (!settings.notifyHelpWanted) return { ok: false, error: 'Notifications disabled' };

  const errors: string[] = [];
  let sentAny = false;

  if (settings.notifyChannels.includes('browser')) {
    try {
      await sendBrowserNotification(owner, repo, number, title, url);
      sentAny = true;
    } catch (err) {
      errors.push(`browser: ${(err as Error).message}`);
    }
  }

  if (settings.notifyChannels.includes('telegram')) {
    try {
      await sendTelegramHelpWanted(owner, repo, number, title, url);
      sentAny = true;
    } catch (err) {
      errors.push(`telegram: ${(err as Error).message}`);
    }
  }

  if (!sentAny) return { ok: false, error: errors.join('; ') || 'No channels enabled' };
  return { ok: true };
}

export async function handleTestBrowserNotification(): Promise<MessageResponse> {
  try {
    await chrome.notifications.create(`${NOTIF_PREFIX}test`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'Tasker — test',
      message: 'Browser notifications are working.',
      priority: 1,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export async function handleTestNotification(): Promise<MessageResponse> {
  const settings = await getSettings();
  const channels = settings.notifyChannels;
  if (channels.length === 0) return { ok: false, error: 'No channels selected' };

  const errors: string[] = [];
  let sentAny = false;

  if (channels.includes('browser')) {
    try {
      await sendBrowserNotification(
        'tasker',
        'test',
        0,
        'Sample help-wanted issue (test)',
        'https://github.com/',
      );
      sentAny = true;
    } catch (err) {
      errors.push(`browser: ${(err as Error).message}`);
    }
  }

  if (channels.includes('telegram')) {
    try {
      await sendTelegramHelpWanted(
        'tasker',
        'test',
        0,
        'Sample help-wanted issue (test)',
        'https://github.com/',
      );
      sentAny = true;
    } catch (err) {
      errors.push(`telegram: ${(err as Error).message}`);
    }
  }

  if (!sentAny) return { ok: false, error: errors.join('; ') };
  return { ok: errors.length === 0, error: errors.length ? errors.join('; ') : undefined };
}
