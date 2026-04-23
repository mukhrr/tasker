import type { ExtensionSettings, NotifyChannel } from './types';

const SETTINGS_KEY = 'extensionSettings';

export const MIN_POLL_SECONDS = 30;

export const DEFAULT_SETTINGS: Omit<ExtensionSettings, 'telegramTokenSaved'> = {
  autoRefreshEnabled: false,
  autoRefreshSeconds: 20,
  notifyHelpWanted: false,
  notifyChannels: ['browser'],
  telegramChatId: '',
  pollSeconds: 45,
};

const VALID_CHANNELS: NotifyChannel[] = ['browser', 'telegram'];

function sanitizeChannels(raw: unknown): NotifyChannel[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SETTINGS.notifyChannels];
  const filtered = raw.filter(
    (c): c is NotifyChannel => typeof c === 'string' && (VALID_CHANNELS as string[]).includes(c),
  );
  return filtered.length > 0 ? Array.from(new Set(filtered)) : [...DEFAULT_SETTINGS.notifyChannels];
}

export async function getSettings(): Promise<Omit<ExtensionSettings, 'telegramTokenSaved'>> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const raw = stored[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  return {
    autoRefreshEnabled: raw?.autoRefreshEnabled ?? DEFAULT_SETTINGS.autoRefreshEnabled,
    autoRefreshSeconds: Math.max(5, raw?.autoRefreshSeconds ?? DEFAULT_SETTINGS.autoRefreshSeconds),
    notifyHelpWanted: raw?.notifyHelpWanted ?? DEFAULT_SETTINGS.notifyHelpWanted,
    notifyChannels: sanitizeChannels(raw?.notifyChannels),
    telegramChatId: raw?.telegramChatId ?? DEFAULT_SETTINGS.telegramChatId,
    pollSeconds: Math.max(MIN_POLL_SECONDS, raw?.pollSeconds ?? DEFAULT_SETTINGS.pollSeconds),
  };
}

export async function setSettings(
  patch: Partial<Omit<ExtensionSettings, 'telegramTokenSaved'>>,
): Promise<void> {
  const current = await getSettings();
  const next = { ...current, ...patch };
  if (typeof next.autoRefreshSeconds === 'number') {
    next.autoRefreshSeconds = Math.max(5, Math.floor(next.autoRefreshSeconds));
  }
  if (typeof next.pollSeconds === 'number') {
    next.pollSeconds = Math.max(MIN_POLL_SECONDS, Math.floor(next.pollSeconds));
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
}
