/** Small, dependency-free string helpers for the distribution layer. */

/** Remove trailing "/" characters (linear; avoids a backtracking regex). */
export function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return s.slice(0, end);
}

/** The value if it is a string, else `fallback` — never stringifies objects. */
export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
