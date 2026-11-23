// Privacy (CLAUDE.md §7): the buyer's location is sent per request and must never be logged at
// full precision. Coordinates in a logged URL are rounded to 2 decimals (~1 km).

const COORDINATE_KEYS = new Set(['lat', 'lng', 'lon', 'latitude', 'longitude']);

export function roundCoordinate(value: string): string {
  const n = Number(value);
  if (value.trim() === '' || !Number.isFinite(n)) return value === '' ? '' : '[redacted]';
  return n.toFixed(2);
}

/** Returns the URL (path + query) with coordinate query values rounded to 2 decimals. */
export function redactUrlForLog(originalUrl: string): string {
  const queryStart = originalUrl.indexOf('?');
  if (queryStart === -1) return originalUrl;
  const path = originalUrl.slice(0, queryStart);
  const entries = [...new URLSearchParams(originalUrl.slice(queryStart + 1))].map(
    ([key, value]): [string, string] => [key, COORDINATE_KEYS.has(key.toLowerCase()) ? roundCoordinate(value) : value],
  );
  const query = new URLSearchParams(entries).toString();
  return query ? `${path}?${query}` : path;
}
