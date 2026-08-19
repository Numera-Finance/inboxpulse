/**
 * A safe one-line summary of a failed HTTP response.
 *
 * Every model and Gmail call logged `await res.text()` truncated to a couple of
 * hundred characters. That was defended on the grounds that an API's error body
 * is the API's output rather than the user's mail — true, and not good enough.
 * A reviewer reading the permissions page put it plainly: the storage promise
 * was scoped to our cache and said nothing about what lands in logs, and an
 * error body is the one place message-adjacent text could surface. A 400 from a
 * content filter can quote the input that tripped it.
 *
 * So the raw body is never logged. Providers return JSON shaped
 * `{ error: { code, status, message } }`; the code and status are diagnostic and
 * carry no content, while `message` can echo input and is dropped. Anything
 * unparseable is reported by length alone, which still distinguishes "empty
 * 500" from "HTML error page" without reproducing either.
 */
export function safeErrorDetail(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) return 'empty body';
  try {
    const parsed = JSON.parse(trimmed) as { error?: { code?: unknown; status?: unknown } };
    const code = parsed.error?.code;
    const status = parsed.error?.status;
    if (code !== undefined || status !== undefined) {
      return `error.code=${String(code ?? '?')} error.status=${String(status ?? '?')}`;
    }
    return 'json body, no error object';
  } catch {
    return `unparseable body, ${trimmed.length} chars`;
  }
}
