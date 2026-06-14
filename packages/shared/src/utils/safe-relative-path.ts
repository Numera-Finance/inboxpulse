/**
 * Resolve a redirect target to a same-origin relative path. Anything else
 * (cross-origin URL, protocol-relative `//host`, backslash-bypassed `/\host`,
 * unparseable input) collapses to `/` so callers can't be tricked into
 * sending users off-site.
 *
 * Pass the baseOrigin explicitly (e.g. `window.location.origin`) so this
 * function stays pure and testable.
 */
export function safeRelativePath(
  path: string | null | undefined,
  baseOrigin: string
): string {
  if (!path) return '/';
  // Require an explicit leading '/'. Bare strings like 'evil.com' resolve to a
  // same-origin path under URL constructor rules, but they're never a target
  // we'd intentionally redirect to.
  if (!path.startsWith('/')) return '/';
  // Backslash is normalized to '/' by Chrome's URL parser, so '/\evil.com'
  // becomes '//evil.com' (protocol-relative) downstream. Reject up front.
  if (path.includes('\\')) return '/';
  try {
    const url = new URL(path, baseOrigin);
    if (url.origin !== baseOrigin) return '/';
    return url.pathname + url.search + url.hash;
  } catch {
    return '/';
  }
}
