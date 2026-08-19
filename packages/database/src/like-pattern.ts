/**
 * Escape a value for literal use inside a SQL `LIKE` pattern, without adding
 * any wildcards of its own.
 *
 * `%` and `_` are wildcards inside a pattern, so an unescaped caller-supplied
 * value silently widens the match — a domain of `%` turns `LIKE '%@' || domain`
 * into "every address". Parameter binding does not help: the value is
 * legitimately part of the pattern, not a separate literal.
 *
 * Distinct from `escapeLikePattern` in search-condition-builder, which escapes
 * and then wraps the result in `%…%` for a "contains" search. Use this one when
 * the caller composes the wildcards itself.
 *
 * Escapes the backslash first so an input containing one cannot smuggle in an
 * escape sequence. Backslash is PostgreSQL's default LIKE escape character;
 * patterns built here pass `ESCAPE '\'` explicitly to say so.
 */
export function escapeLikeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
