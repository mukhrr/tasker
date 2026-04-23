import type { MessageResponse } from '../shared/messages';
import { getTelegramToken } from '../shared/secret-store';
import { getSettings } from '../shared/settings';

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

export async function sendTelegramHelpWanted(
  owner: string,
  repo: string,
  number: number,
  title: string,
  url: string,
): Promise<void> {
  const settings = await getSettings();
  if (!settings.telegramChatId) throw new Error('No chat ID configured');

  const token = await getTelegramToken();
  if (!token) throw new Error('No Telegram token configured');

  const text =
    `🆕 <b>help wanted</b> in ${escapeHtml(`${owner}/${repo}`)}\n` +
    `<a href="${url}">#${number} ${escapeHtml(title)}</a>`;

  await sendTelegramMessage(token, settings.telegramChatId, text);
}

export async function handleTestTelegram(
  token: string,
  chatId: string,
): Promise<MessageResponse> {
  if (!token || typeof token !== 'string') return { ok: false, error: 'Missing token' };
  if (!chatId || typeof chatId !== 'string') return { ok: false, error: 'Missing chat ID' };
  try {
    await sendTelegramMessage(
      token,
      chatId,
      '✅ <b>Tasker</b> — test message. Your bot and chat ID are configured correctly.',
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
