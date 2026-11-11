// Tiny in-memory cache for page data, keyed by resource. Lets pages render the
// last-known data instantly on remount (tab navigation) and after an edit, then
// revalidate quietly in the background — no full "Loading…" flash. Cleared on
// login/logout so a different user never sees the previous user's data.
const store = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}
export function setCached<T>(key: string, value: T): void {
  store.set(key, value);
}
export function clearCache(): void {
  store.clear();
}
