/** Local recent search history for Figma V1 03 · Tìm kiếm (client-only). */

const STORAGE_KEY = "sm-recent-searches";
const MAX_ITEMS = 6;

function storage(): globalThis.Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadRecentSearches(): string[] {
  const ls = storage();
  if (!ls) return [];
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function saveRecentSearches(items: string[]): void {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    // ignore quota errors
  }
}

export function addRecentSearch(term: string, current: string[] = loadRecentSearches()): string[] {
  const cleaned = term.trim();
  if (!cleaned) return current;
  const lower = cleaned.toLocaleLowerCase("vi");
  const next = [cleaned, ...current.filter((item) => item.toLocaleLowerCase("vi") !== lower)].slice(0, MAX_ITEMS);
  saveRecentSearches(next);
  return next;
}

export function removeRecentSearch(term: string, current: string[] = loadRecentSearches()): string[] {
  const lower = term.toLocaleLowerCase("vi");
  const next = current.filter((item) => item.toLocaleLowerCase("vi") !== lower);
  saveRecentSearches(next);
  return next;
}

export function clearRecentSearches(): string[] {
  saveRecentSearches([]);
  return [];
}
