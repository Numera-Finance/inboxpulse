import { getEnv } from '../env';
import { logger } from '../utils/logger';

/**
 * Share a thread summary into Google Chat via an incoming webhook.
 *
 * Deliberately a webhook rather than the Chat API. The API route would need a
 * Chat OAuth scope on the add-on, another consent cycle, and a space-picker UI;
 * an incoming webhook is a plain HTTPS POST to a URL the space owner creates, so
 * it needs no Google scope at all and nothing new to authorise. The trade is
 * that the destination is fixed per deployment rather than chosen per share —
 * which matches how escalations actually get routed here (one team space), and
 * can be widened to a picker later without changing this function's contract.
 *
 * Disabled when CHAT_WEBHOOK_URL is blank, and the button is not rendered.
 */

export interface ChatShare {
  subject?: string;
  from?: string;
  sentiment?: string;
  reason?: string;
  /** Permalink back to the thread in Gmail. */
  link?: string;
  /** Who pressed the button. */
  sharedBy?: string;
}

export function isChatShareEnabled(): boolean {
  return getEnv().CHAT_WEBHOOK_URL.trim().length > 0;
}

export async function shareToChat(share: ChatShare): Promise<boolean> {
  const env = getEnv();
  const url = env.CHAT_WEBHOOK_URL.trim();
  if (!url) return false;

  // Plain text rather than a Chat card: cards posted by webhook render
  // inconsistently across mobile clients, and this content is three short
  // lines. The quoted reason is what makes the post worth reading.
  const lines: string[] = [];
  lines.push(`*${share.subject ?? 'Email thread'}*`);
  if (share.from) lines.push(`From: ${share.from}`);
  if (share.sentiment) lines.push(`InboxPulse read: *${share.sentiment}*`);
  if (share.reason) lines.push(`_${share.reason}_`);
  if (share.link) lines.push(share.link);
  if (share.sharedBy) lines.push(`Shared by ${share.sharedBy}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ text: lines.join('\n') }),
    });
    if (!res.ok) {
      const detail = await res.text().then((t) => t.slice(0, 200)).catch(() => '');
      logger.warn({ status: res.status, detail }, 'chat share: non-OK');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err: String(err) }, 'chat share: failed');
    return false;
  } finally {
    clearTimeout(timer);
  }
}
