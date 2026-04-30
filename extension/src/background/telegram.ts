import type { MessageResponse } from '../shared/messages';
import { getTelegramToken } from '../shared/secret-store';
import { getSettings } from '../shared/settings';

export function formatLabels(labels: string[]): string {
  return labels.join(' + ');
}

export function leadEmoji(labels: string[]): string {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.some((l) => l.includes('bug'))) return '🐞';
  if (lower.some((l) => l.includes('daily'))) return '📅';
  return '🆕';
}

export async function sendTelegramMessage(
  token: string,
  chatId: string,
  text: string,
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Telegram API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { ok: boolean; description?: string };
  if (!data.ok) throw new Error(data.description ?? 'Telegram rejected the message');
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function parseChatIds(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  );
}

async function sendToAll(
  token: string,
  chatIds: string[],
  text: string,
): Promise<void> {
  const errors: string[] = [];
  let sentAny = false;
  for (const chatId of chatIds) {
    try {
      await sendTelegramMessage(token, chatId, text);
      sentAny = true;
    } catch (err) {
      errors.push(`${chatId}: ${(err as Error).message}`);
    }
  }
  if (!sentAny) throw new Error(errors.join('; ') || 'No chat IDs configured');
  if (errors.length > 0) console.warn('[tasker] partial telegram failures', errors);
}

export async function sendTelegramHelpWanted(
  owner: string,
  repo: string,
  number: number,
  title: string,
  url: string,
  labels: string[],
): Promise<void> {
  const settings = await getSettings();
  const chatIds = parseChatIds(settings.telegramChatId);
  if (chatIds.length === 0) throw new Error('No chat ID configured');

  const token = await getTelegramToken();
  if (!token) throw new Error('No Telegram token configured');

  const labelText = formatLabels(labels) || 'issue';
  const text =
    `${leadEmoji(labels)} <b>${escapeHtml(labelText)}</b> in ${escapeHtml(`${owner}/${repo}`)}\n` +
    `<a href="${url}">#${number} ${escapeHtml(title)}</a>`;

  await sendToAll(token, chatIds, text);
}

export async function handleTestTelegram(
  token: string,
  chatId: string,
): Promise<MessageResponse> {
  if (!token || typeof token !== 'string') return { ok: false, error: 'Missing token' };
  const chatIds = parseChatIds(chatId);
  if (chatIds.length === 0) return { ok: false, error: 'Missing chat ID' };
  try {
    await sendToAll(
      token,
      chatIds,
      '✅ <b>Tasker</b> — test message. Your bot and chat ID are configured correctly.',
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
