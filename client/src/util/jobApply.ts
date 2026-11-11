// Job Apply link helpers: normalization + duplicate analysis (mirror of the
// server's normLink). Seed entries carry the date they were added; a day's link
// is only flagged "already applied" if a matching seed entry was added BEFORE
// that day.
import type { SeedLink } from '../types';

export type LinkStatus = 'ok' | 'dup' | 'prior';

export function normLink(u: string): string {
  return (u || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

// Per-index status: "dup" = repeated within the list, "prior" = already in the
// prior set (seed DB before the day), "ok" = new.
export function analyzeLinks(links: string[], priorNorms: Set<string>): LinkStatus[] {
  const seen: Record<string, number> = {};
  return links.map((raw) => {
    const n = normLink(raw);
    seen[n] = (seen[n] || 0) + 1;
    if (priorNorms.has(n)) return 'prior';
    if (seen[n] > 1) return 'dup';
    return 'ok';
  });
}

// Normalized set of seed URLs. If `beforeDate` is given, only entries dated
// strictly before it (so same-day promotions don't self-flag).
export function dbSet(seedLinks: SeedLink[], beforeDate?: string): Set<string> {
  const set = new Set<string>();
  for (const e of seedLinks) {
    if (beforeDate && !((e.date || '0000-00-00') < beforeDate)) continue;
    set.add(normLink(e.url));
  }
  return set;
}

// Does a link apply to a profile, given the link's categories and the profile's
// categories? Rule: an uncategorized link (no categories) goes to EVERYONE.
// Otherwise it applies only to profiles sharing at least one category.
export function linkAppliesToProfile(linkCatIds: number[] | undefined, profileCatIds: number[] | undefined): boolean {
  const lc = linkCatIds ?? [];
  if (lc.length === 0) return true; // uncategorized → everyone
  const pc = new Set(profileCatIds ?? []);
  return lc.some((id) => pc.has(id));
}

// Count how many of a day's links apply to a given profile.
export function countLinksForProfile(
  links: { category_ids?: number[] }[],
  profileCatIds: number[] | undefined,
): number {
  return links.reduce((n, l) => n + (linkAppliesToProfile(l.category_ids, profileCatIds) ? 1 : 0), 0);
}

// Unique day-links not present anywhere in the seed database (any date).
export function missingFromDb(links: string[], seedLinks: SeedLink[]): string[] {
  const have = dbSet(seedLinks);
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const l of links) {
    const n = normLink(l);
    if (have.has(n) || seen.has(n)) continue;
    seen.add(n);
    missing.push(l);
  }
  return missing;
}
