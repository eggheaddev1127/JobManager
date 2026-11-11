import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, HttpError } from '../api';
import type { JobApplyDay, JobApplyLink, JobApplySearchResult, Profile, SeedLink, Category, ProfileCategories } from '../types';
import { useAuth, isAdmin as isAdminUser } from '../auth';
import Modal from '../components/Modal';
import ResumeSettingsModal from '../components/ResumeSettingsModal';
import { useResumeGen, ResumeControls, ResumeLinkAction, ResumeReviewModal } from '../components/resumeGen';
import { useDialogs } from '../components/Dialog';
import TruncatedLink from '../components/TruncatedLink';
import Empty from '../components/Empty';
import CategoryChips, { CategoryTags } from '../components/CategoryChips';
import { formatDate, initials } from '../util/format';
import { dayLabel, estNow, shiftDays, weekDays, weekRangeLabel } from '../util/calendar';
import { analyzeLinks, dbSet, missingFromDb, normLink, countLinksForProfile, type LinkStatus } from '../util/jobApply';
import { getCached, setCached } from '../util/dataCache';

type View = 'daily' | 'weekly' | 'database';
const EMPTY_DAY: JobApplyDay = { links: [], confirmed: [], done: false };

function copyText(text: string): boolean {
  try {
    if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.focus(); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta); return true;
  } catch { return false; }
}

// Best-effort company name from a job URL, for pasting alongside the link into a
// sheet. Most postings live on known ATS hosts where the company is either the
// subdomain (Workday/BambooHR/…) or the first path segment (Greenhouse/Lever/…);
// anything else falls back to the cleaned hostname. Never throws — returns '' if
// the URL can't be parsed, so a copied column always stays row-aligned.
function companyFromUrl(raw: string): string {
  const titleize = (s: string) =>
    s.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()
      .split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return ''; }
  const host = u.hostname.replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean);
  const seg = (i: number) => (segs[i] && !/^\d+$/.test(segs[i]) ? decodeURIComponent(segs[i]) : '');

  // ATS where the company is the FIRST path segment.
  if (/greenhouse\.io$/.test(host)) {
    // Embedded boards use .../embed/job_app?for=COMPANY instead of a path segment.
    const forParam = u.searchParams.get('for');
    return titleize(forParam || (seg(0) === 'embed' ? '' : seg(0)));
  }
  if (/(^|\.)lever\.co$/.test(host)) return titleize(seg(0));
  if (/(^|\.)ashbyhq\.com$/.test(host)) return titleize(seg(0));
  if (/(^|\.)smartrecruiters\.com$/.test(host)) return titleize(seg(0));
  if (host === 'apply.workable.com') return titleize(seg(0));
  if (/(^|\.)wellfound\.com$/.test(host) || /(^|\.)angel\.co$/.test(host)) return titleize(segs[0] === 'company' ? seg(1) : seg(0));
  if (/(^|\.)jobvite\.com$/.test(host)) return titleize(seg(0));

  // ATS where the company is the SUBDOMAIN.
  const sub = (suffix: RegExp) => { const m = host.match(suffix); return m ? titleize(host.slice(0, host.length - m[0].length)) : ''; };
  if (/myworkdayjobs\.com$/.test(host)) {
    // {tenant}.wdN.myworkdayjobs.com — tenant is the first label.
    const first = host.split('.')[0];
    return titleize(first);
  }
  let s = sub(/\.bamboohr\.com$/) || sub(/\.breezy\.hr$/) || sub(/\.workable\.com$/)
        || sub(/\.recruitee\.com$/) || sub(/\.applytojob\.com$/) || sub(/\.hire\.lever\.co$/);
  if (s) return s;

  // Job boards that don't carry the employer in the URL — surface the board name
  // so the row isn't blank (the user can fix these by hand).
  if (/(^|\.)linkedin\.com$/.test(host)) return 'LinkedIn';
  if (/(^|\.)indeed\.com$/.test(host)) return 'Indeed';
  if (/(^|\.)glassdoor\.com$/.test(host)) return 'Glassdoor';
  if (/(^|\.)ziprecruiter\.com$/.test(host)) return 'ZipRecruiter';
  if (/(^|\.)dice\.com$/.test(host)) return 'Dice';
  if (/(^|\.)builtin\.com$/.test(host)) return 'Built In';

  // Fallback: company careers site. Drop common prefixes and the TLD.
  const labels = host.split('.');
  const dropPrefix = /^(careers?|jobs?|apply|job|recruiting|talent|work|boards?)$/i;
  while (labels.length > 2 && dropPrefix.test(labels[0])) labels.shift();
  return titleize(labels.length > 1 ? labels[labels.length - 2] : labels[0]);
}

export default function JobApplyPage() {
  const { user: me } = useAuth();
  const admin = isAdminUser(me); // admins + superadmins manage the seed database
  const { alert } = useDialogs();

  const [view, setView] = useState<View>('daily');
  const [anchor, setAnchor] = useState<string>(() => estNow().iso);
  const [profiles, setProfiles] = useState<Profile[]>(() => (getCached<Profile[]>('profiles') ?? []).filter((p) => p.apply_enabled !== 0));
  const [seed, setSeed] = useState<SeedLink[]>(() => getCached<SeedLink[]>('jobApplySeed') ?? []);
  const [days, setDays] = useState<Record<string, JobApplyDay>>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [dbPromptOpen, setDbPromptOpen] = useState(false);
  const [resumeSettingsOpen, setResumeSettingsOpen] = useState(false);
  // Categories + per-profile category assignment (for link↔profile matching).
  const [categories, setCategories] = useState<Category[]>([]);
  const [profileCats, setProfileCats] = useState<ProfileCategories>({});
  // Active category filter: null = All. Persisted. Drives the visible links,
  // auto-tagging on add, and the generate-resume profile list.
  const [activeCat, setActiveCat] = useState<number | null>(() => {
    const s = localStorage.getItem('jobApply.activeCat');
    return s && s !== 'all' ? Number(s) : null;
  });
  useEffect(() => { localStorage.setItem('jobApply.activeCat', activeCat == null ? 'all' : String(activeCat)); }, [activeCat]);
  // generated_resume id currently open in the review modal (null = closed).
  const [reviewId, setReviewId] = useState<number | null>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = estNow().iso;

  // Search across company name + JD text (all dates). Debounced; a non-empty
  // query replaces the daily/weekly view with a results list.
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<JobApplySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchActive = search.trim().length >= 2;
  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) { setSearchResults([]); setSearching(false); return; }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.jobApply.search(q);
        if (!cancelled) setSearchResults(r.results);
      } catch { if (!cancelled) setSearchResults([]); }
      finally { if (!cancelled) setSearching(false); }
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
  }, [search]);

  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  useEffect(() => { if (view === 'database' && !admin) setView('daily'); }, [admin, view]);

  // Load the week containing `anchor` (covers both daily + weekly) plus seed/profiles.
  const reloadDays = async () => {
    const wk = weekDays(anchor);
    const { days: d } = await api.jobApply.range(wk[0].iso, wk[6].iso).catch(() => ({ days: {} }));
    setDays(d);
  };
  const reloadSeed = async () => { const s = await api.jobApply.seed.list().catch(() => []); setSeed(s); setCached('jobApplySeed', s); };
  const reloadCategories = async () => {
    const [cats, pc] = await Promise.all([
      api.jobApply.categories.list().catch(() => []),
      api.jobApply.profileCategories.all().catch(() => ({} as ProfileCategories)),
    ]);
    setCategories(cats); setProfileCats(pc);
  };
  useEffect(() => { reloadDays(); /* eslint-disable-next-line */ }, [anchor]);
  useEffect(() => {
    reloadSeed();
    reloadCategories();
    // Only profiles enabled for Job Apply (toggled on the Profiles tab) appear.
    api.profiles.list().then((prs) => { setCached('profiles', prs); setProfiles(prs.filter((p) => p.apply_enabled !== 0)); }).catch(() => { /* non-fatal */ });
    // eslint-disable-next-line
  }, []);

  const curDay = days[anchor] ?? EMPTY_DAY;
  const locked = curDay.done;

  // A link is visible under the active category filter if it has that category
  // (or, for "All", always). Uncategorized links show under every filter.
  const linkVisible = (l: JobApplyLink): boolean => {
    if (activeCat == null) return true;
    const cats = l.category_ids ?? [];
    return cats.length === 0 || cats.includes(activeCat);
  };
  const visibleDayLinkCount = curDay.links.filter(linkVisible).length;

  // Profiles offered in the generate dropdown: when a category is active, only
  // profiles in that category (or with no category). "All" → every profile.
  const genProfiles = useMemo(() => {
    if (activeCat == null) return profiles;
    return profiles.filter((p) => {
      const pc = profileCats[p.id] ?? [];
      return pc.length === 0 || pc.includes(activeCat);
    });
  }, [profiles, profileCats, activeCat]);

  // Resume generation for the current day, lifted to page level so the toolbar
  // controls and the per-link Review/Failed actions share one state.
  const gen = useResumeGen(anchor, profiles[0]?.id ?? null);
  useEffect(() => { setReviewId(null); }, [anchor, gen.profileId]);
  // When the active category changes, keep the generate profile valid: if the
  // current pick isn't in the filtered list, switch to the first that is.
  useEffect(() => {
    if (genProfiles.length === 0) return;
    if (gen.profileId == null || !genProfiles.some((p) => p.id === gen.profileId)) {
      gen.setProfileId(genProfiles[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genProfiles]);

  const fail = (e: unknown) => alert({ title: 'Something went wrong', message: e instanceof HttpError ? e.message : String(e) });

  // Links added while a category is active are auto-tagged with it (unless the
  // caller passes an explicit set, e.g. the bulk modal's own picker).
  const withActiveCat = (categoryIds?: number[]): number[] | undefined => {
    if (categoryIds && categoryIds.length) return categoryIds;
    return activeCat != null ? [activeCat] : categoryIds;
  };

  // --- daily mutations ---
  const addLink = async (url: string, categoryIds?: number[]) => { try { await api.jobApply.addLink(anchor, url, withActiveCat(categoryIds)); await reloadDays(); } catch (e) { await fail(e); } };
  const addLinksBulk = async (urls: string[], categoryIds?: number[]) => { try { await api.jobApply.addLinksBulk(anchor, urls, withActiveCat(categoryIds)); await reloadDays(); } catch (e) { await fail(e); } };
  const setLinkCats = async (id: number, categoryIds: number[]) => { try { await api.jobApply.setLinkCategories(id, categoryIds); await reloadDays(); } catch (e) { await fail(e); } };
  const deleteLinks = async (ids: number[]) => { try { await api.jobApply.deleteLinks(anchor, ids); await reloadDays(); } catch (e) { await fail(e); } };
  const toggleConfirm = async (pid: number) => { try { await api.jobApply.toggleConfirm(anchor, pid); await reloadDays(); } catch (e) { await fail(e); } };
  const setDayDone = async (val: boolean) => { try { await api.jobApply.setDone(anchor, val); await reloadDays(); } catch (e) { await fail(e); } };
  const promote = async (date: string, urls: string[]) => {
    try {
      const r = await api.jobApply.promote(date, urls);
      await reloadSeed();
      flash(r.added ? `Added ${r.added} new link${r.added === 1 ? '' : 's'} to the database${r.skipped ? ` · ${r.skipped} already there` : ''}` : `All links already in the database`);
    } catch (e) { await fail(e); }
  };

  const goTomorrow = () => setAnchor((a) => shiftDays(a, 1));
  const requestGoTomorrow = () => {
    if (missingFromDb(curDay.links.map((l) => l.url), seed).length > 0) setDbPromptOpen(true);
    else goTomorrow();
  };
  const confirmFinish = async (addToDb: boolean) => {
    const urls = curDay.links.map((l) => l.url);
    if (addToDb) await promote(anchor, urls);
    await setDayDone(true);
    setFinishOpen(false);
    flash('Day locked — moving to tomorrow');
    goTomorrow();
  };

  const go = (dir: number) => setAnchor((a) => shiftDays(a, view === 'weekly' ? dir * 7 : dir));
  const label = view === 'weekly' ? weekRangeLabel(anchor) : dayLabel(anchor);

  // Existing-set for the daily bulk modal = the WHOLE database (any date) +
  // current day's links. We exclude entries dated on this very day so a
  // finished day's own promoted links don't flag it on reopen.
  const dailyExisting = useMemo(() => {
    const set = dbSet(seed.filter((e) => e.date !== anchor));
    for (const l of curDay.links) set.add(normLink(l.url));
    return set;
  }, [seed, anchor, curDay.links]);

  const missing = useMemo(() => missingFromDb(curDay.links.map((l) => l.url), seed), [curDay.links, seed]);

  const views: [View, string][] = [['daily', 'Daily'], ['weekly', 'Weekly'], ...(admin ? [['database', 'Database'] as [View, string]] : [])];

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Job Apply</h1>
          <p className="page-subtitle">
            Add the day's job links, clear duplicates, then sign off each profile. Links are checked against past days and the seed database.
          </p>
        </div>
        <div className="page-actions">
          <div className="ja-search">
            <span className="ja-search-icon">🔍</span>
            <input className="input ja-search-input" value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Search company or JD…" title="Search all links by company name or job description" />
            {search && <button className="ja-search-clear" onClick={() => setSearch('')} title="Clear search">✕</button>}
          </div>
          <div className="seg">
            {views.map(([v, lbl]) => (
              <button key={v} className={view === v ? 'active' : ''} onClick={() => setView(v)}>{lbl}</button>
            ))}
          </div>
        </div>
      </div>

      {searchActive && (
        <JobApplySearchPanel
          query={search.trim()} results={searchResults} searching={searching}
          onGoToDay={(date) => { setView('daily'); setAnchor(date); setSearch(''); }}
        />
      )}

      {!searchActive && view !== 'database' && (
        <div className="cal-toolbar">
          <div className="cal-nav">
            <button className="btn btn-icon" onClick={() => go(-1)} title="Previous">‹</button>
            <button className="btn btn-icon" onClick={() => go(1)} title="Next">›</button>
          </div>
          <span className="cal-month-label">{label}</span>
          <button className="btn" onClick={() => setAnchor(today)}>Today</button>
          {categories.length > 0 && (
            <div className="seg ja-cat-seg" title="Show only links in this category">
              <button className={activeCat == null ? 'active' : ''} onClick={() => setActiveCat(null)}>All</button>
              {categories.map((c) => (
                <button key={c.id} className={activeCat === c.id ? 'active' : ''} onClick={() => setActiveCat(c.id)}>{c.name}</button>
              ))}
            </div>
          )}
          {view === 'daily' && (
            <div className="ja-toolbar-right">
              <ResumeControls gen={gen} profiles={genProfiles} hasLinks={visibleDayLinkCount > 0}
                              onOpenSettings={() => setResumeSettingsOpen(true)} />
              {!locked && <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>＋ Bulk add links</button>}
            </div>
          )}
        </div>
      )}

      {!searchActive && view === 'daily' && (
        <JobApplyDaily
          anchor={anchor} day={curDay} seed={seed} profiles={profiles} locked={locked}
          onAdd={addLink} onDeleteMany={deleteLinks} onToggle={toggleConfirm}
          onRequestFinish={() => setFinishOpen(true)} onReopen={() => setDayDone(false)}
          onGoTomorrow={requestGoTomorrow} onCopy={flash}
          gen={gen} setReviewId={setReviewId}
          admin={admin} categories={categories} profileCats={profileCats} onSetLinkCats={setLinkCats}
          activeCat={activeCat}
        />
      )}
      {!searchActive && view === 'weekly' && <JobApplyWeekly anchor={anchor} today={today} days={days} profiles={profiles} categories={categories} profileCats={profileCats} />}
      {!searchActive && view === 'database' && admin && (
        <JobApplyDatabase seed={seed} onChanged={reloadSeed} onFlash={flash} onFail={fail} />
      )}

      {bulkOpen && (
        <BulkAddModal
          title={`Bulk add links — ${formatDate(anchor)}`}
          subtitle={activeCat != null
            ? `These links will be added to the “${categories.find((c) => c.id === activeCat)?.name}” category. Paste one per line; duplicates are flagged.`
            : 'Paste the day\'s job links, one per line. Duplicates (within the paste, earlier days, or the seed database) are flagged and must be removed.'}
          existing={dailyExisting}
          // Only offer the in-modal category picker when viewing "All" — when a
          // category is active, links auto-tag with it (no picker needed).
          categories={activeCat == null ? categories : undefined}
          onAdd={(urls, catIds) => { addLinksBulk(urls, catIds); setBulkOpen(false); }}
          onClose={() => setBulkOpen(false)}
        />
      )}
      {finishOpen && (
        <FinishDayModal date={anchor} linkCount={curDay.links.length} profileCount={profiles.length}
                        missing={missing} onConfirm={confirmFinish} onClose={() => setFinishOpen(false)} />
      )}
      {dbPromptOpen && (
        <DbPromptModal date={anchor} missing={missing}
                       onAddContinue={async () => { await promote(anchor, curDay.links.map((l) => l.url)); setDbPromptOpen(false); goTomorrow(); }}
                       onSkip={() => { setDbPromptOpen(false); goTomorrow(); }}
                       onClose={() => setDbPromptOpen(false)} />
      )}

      {resumeSettingsOpen && (
        <ResumeSettingsModal onClose={() => setResumeSettingsOpen(false)} />
      )}
      {reviewId != null && (
        <ResumeReviewModal id={reviewId} onClose={() => setReviewId(null)} onChanged={() => void gen.reload()} />
      )}

      {toast && <div className="ja-toast">{toast}</div>}
    </div>
  );
}

// ---------- Search results (company + JD, all dates) ----------
// Suggested download filename for a tailored resume, e.g. "Acme_Chris_Lewis.pdf".
function resumeFileName(company: string | null, profile: string): string {
  const base = [company, profile].filter(Boolean).join('_') || 'resume';
  return base.replace(/[^\w.\-]+/g, '_').replace(/_{2,}/g, '_') + '.pdf';
}

// Bold every case-insensitive occurrence of `term` within `text`.
function Highlight({ text, term }: { text: string; term: string }) {
  if (!term) return <>{text}</>;
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  const t = term.toLowerCase();
  let i = 0, key = 0;
  for (;;) {
    const idx = lower.indexOf(t, i);
    if (idx < 0) { out.push(text.slice(i)); break; }
    if (idx > i) out.push(text.slice(i, idx));
    out.push(<mark key={key++} className="ja-hl">{text.slice(idx, idx + term.length)}</mark>);
    i = idx + term.length;
  }
  return <>{out}</>;
}

function JobApplySearchPanel({ query, results, searching, onGoToDay }: {
  query: string;
  results: JobApplySearchResult[];
  searching: boolean;
  onGoToDay: (date: string) => void;
}) {
  return (
    <div className="ja-search-panel">
      <div className="ja-search-head">
        {searching
          ? <span className="ja-search-count">Searching…</span>
          : <span className="ja-search-count">{results.length} result{results.length === 1 ? '' : 's'} for “{query}”</span>}
      </div>
      {!searching && results.length === 0
        ? <Empty title="No matches" hint={`No links with “${query}” in a company name or job description.`} />
        : (
          <div className="ja-search-list">
            {results.map((r) => (
              <div key={r.id} className="ja-search-row">
                <div className="ja-search-row-main">
                  <div className="ja-search-row-top">
                    <span className="ja-search-date">{formatDate(r.date)}</span>
                    {r.company && <span className="ja-search-company"><Highlight text={r.company} term={query} /></span>}
                    {r.matchedCompany && <span className="badge">company</span>}
                    {r.matchedJd && <span className="badge">JD</span>}
                  </div>
                  <a className="ja-link-url" href={r.url.startsWith('http') ? r.url : 'https://' + r.url} target="_blank" rel="noopener noreferrer" title={r.url}>{r.url}</a>
                  {r.snippet && <div className="ja-search-snippet"><Highlight text={r.snippet} term={query} /></div>}
                  {r.resumes.length > 0 && (
                    <div className="ja-search-resumes">
                      <span className="ja-search-resumes-label">Resume:</span>
                      {r.resumes.map((rz) => (
                        <a key={rz.id} className="btn btn-sm ja-resume-dl" href={api.resumes.pdfUrl(rz.id)}
                           download={resumeFileName(r.company, rz.profile)} target="_blank" rel="noopener noreferrer"
                           title={`Download ${rz.profile}'s tailored resume`}>
                          ⬇ {rz.profile}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
                <button className="btn btn-sm" onClick={() => onGoToDay(r.date)} title="Open the day this link belongs to">Go to day →</button>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}

// ---------- Daily view ----------
function JobApplyDaily({ anchor, day: fullDay, seed, profiles, locked, onAdd, onDeleteMany, onToggle, onRequestFinish, onReopen, onGoTomorrow, onCopy, gen, setReviewId, admin, categories, profileCats, onSetLinkCats, activeCat }: {
  anchor: string; day: JobApplyDay; seed: SeedLink[]; profiles: Profile[]; locked: boolean;
  onAdd: (url: string, categoryIds?: number[]) => void; onDeleteMany: (ids: number[]) => void; onToggle: (pid: number) => void;
  onRequestFinish: () => void; onReopen: () => void; onGoTomorrow: () => void; onCopy: (msg: string) => void;
  gen: ReturnType<typeof useResumeGen>;
  setReviewId: (id: number) => void;
  admin: boolean;
  categories: Category[];
  profileCats: ProfileCategories;
  onSetLinkCats: (id: number, categoryIds: number[]) => void;
  activeCat: number | null;
}) {
  // Show only links in the active category (uncategorized links show under every
  // filter; "All" shows everything). All row logic below runs on this view.
  const day = useMemo<JobApplyDay>(() => {
    if (activeCat == null) return fullDay;
    const links = fullDay.links.filter((l) => {
      const cats = l.category_ids ?? [];
      return cats.length === 0 || cats.includes(activeCat);
    });
    return { ...fullDay, links };
  }, [fullDay, activeCat]);
  const [newLink, setNewLink] = useState('');
  const [sel, setSel] = useState<Set<number>>(() => new Set()); // selected by index
  const lastClickRef = useRef<number | null>(null);
  const shiftRef = useRef(false);

  // Capture shift state in the capture phase (fires before React's onClick).
  useEffect(() => {
    const cap = (e: MouseEvent) => { shiftRef.current = e.shiftKey; };
    document.addEventListener('click', cap, true);
    return () => document.removeEventListener('click', cap, true);
  }, []);
  useEffect(() => { setSel(new Set()); lastClickRef.current = null; }, [anchor, day.links.length]);

  const urls = day.links.map((l) => l.url);
  // Check against the WHOLE database (any date), excluding entries dated on this
  // day itself (so a reopened, already-promoted day doesn't flag its own links).
  const prior = useMemo(() => dbSet(seed.filter((e) => e.date !== anchor)), [seed, anchor]);
  const statuses = useMemo(() => analyzeLinks(urls, prior), [urls, prior]);
  const dupCount = statuses.filter((s) => s !== 'ok').length;

  const confirmedSet = useMemo(() => new Set(day.confirmed), [day.confirmed]);
  const total = profiles.length;
  const confirmedCount = profiles.filter((p) => confirmedSet.has(p.id)).length;
  const allDone = total > 0 && confirmedCount === total && dupCount === 0;
  const canConfirm = !locked && dupCount === 0 && day.links.length > 0;
  const flagLabel = (s: LinkStatus) => (s === 'prior' ? 'Already applied' : 'Duplicate');

  const selCount = sel.size;
  const allSelected = day.links.length > 0 && selCount === day.links.length;
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(day.links.map((_, i) => i)));
  const onRowSelect = (shift: boolean, i: number) => {
    const last = lastClickRef.current;
    setSel((prev) => {
      const n = new Set(prev);
      if (shift && last !== null) {
        const a = Math.min(last, i), b = Math.max(last, i);
        const target = !prev.has(i);
        for (let k = a; k <= b; k++) { if (target) n.add(k); else n.delete(k); }
      } else {
        if (n.has(i)) n.delete(i); else n.add(i);
      }
      return n;
    });
    lastClickRef.current = i;
  };
  const copySel = () => {
    const picked = [...sel].sort((a, b) => a - b).map((i) => urls[i]);
    if (!picked.length) return;
    copyText(picked.join('\n'));
    onCopy(`Copied ${picked.length} link${picked.length === 1 ? '' : 's'} to clipboard`);
  };
  // Copy the company name for each selected link, one per line, in the SAME order
  // as "Copy" — so links and companies paste as two aligned columns in a sheet.
  // Prefer the name the user typed in the review modal; fall back to the URL.
  const copyCompanies = () => {
    const idx = [...sel].sort((a, b) => a - b);
    if (!idx.length) return;
    copyText(idx.map((i) => (day.links[i].company?.trim() || companyFromUrl(urls[i]))).join('\n'));
    onCopy(`Copied ${idx.length} company name${idx.length === 1 ? '' : 's'} to clipboard`);
  };
  const deleteSel = () => { onDeleteMany([...sel].map((i) => day.links[i].id)); setSel(new Set()); };

  // Bulk-assign a single category to all selected links (replaces any existing —
  // one category per link). mode 'clear' removes the category entirely.
  const applyCatToSel = (categoryId: number | null, mode: 'add' | 'clear') => {
    const chosen = [...sel].map((i) => day.links[i]);
    for (const l of chosen) {
      onSetLinkCats(l.id, mode === 'clear' ? [] : [categoryId!]);
    }
    const name = categoryId != null ? categories.find((c) => c.id === categoryId)?.name : null;
    onCopy(mode === 'clear'
      ? `Cleared categories on ${chosen.length} link${chosen.length === 1 ? '' : 's'}`
      : `Tagged ${chosen.length} link${chosen.length === 1 ? '' : 's'} as ${name}`);
    setSel(new Set());
  };

  return (
    <div>
      {dupCount > 0 && !locked && (
        <div className="ja-banner warn">
          ⚠️ {dupCount} duplicate {dupCount === 1 ? 'link' : 'links'} detected — delete {dupCount === 1 ? 'it' : 'them'} before signing off profiles.
        </div>
      )}
      {allDone && !locked && (
        <div className="ja-banner done">
          <span>🎉 All {total} profiles signed off — {day.links.length} {day.links.length === 1 ? 'link' : 'links'} applied.</span>
          <button className="btn btn-primary ja-done-actions" onClick={onRequestFinish}>Confirm &amp; finish day →</button>
        </div>
      )}
      {locked && (
        <div className="ja-banner done">
          <span>✓ Day complete — {day.links.length} {day.links.length === 1 ? 'link' : 'links'} applied across all {total} profiles. This day is locked.</span>
          <span className="ja-done-actions">
            <button className="btn" onClick={onReopen}>Reopen day</button>
            <button className="btn btn-primary" onClick={onGoTomorrow}>Go to tomorrow →</button>
          </span>
        </div>
      )}

      <div className="ja-grid">
        <div className={'ja-card' + (locked ? ' ja-locked' : '')}>
          <div className="ja-card-head">
            <span className="ja-card-title">Job links · {day.links.length}</span>
            {!locked && dupCount > 0 && <span className="badge danger">{dupCount} to remove</span>}
            {locked && <span className="badge success">Locked</span>}
          </div>
          <div className="ja-card-body">
            {!locked && (
              <div className="ja-add">
                <input className="input" placeholder="Paste a job link and press Enter…" value={newLink}
                       onChange={(e) => setNewLink(e.target.value)}
                       onKeyDown={(e) => { if (e.key === 'Enter' && newLink.trim()) { onAdd(newLink.trim()); setNewLink(''); } }} />
                <button className="btn" disabled={!newLink.trim()} onClick={() => { onAdd(newLink.trim()); setNewLink(''); }}>Add</button>
              </div>
            )}

            {day.links.length === 0
              ? <Empty title="No links yet" hint={locked ? 'No links were added this day.' : 'Add a link above or use “Bulk add links”.'} />
              : (
                <>
                  <div className="ja-sel-bar">
                    <label className="ja-sel-all">
                      <input type="checkbox" className="ja-check" checked={allSelected} onChange={toggleAll} style={{ pointerEvents: 'auto' }} />
                      Select all
                    </label>
                    {selCount > 0
                      ? <span className="ja-sel-count">{selCount} selected</span>
                      : <span className="ja-sel-count">Click a row to select · Shift-click for a range</span>}
                    <span className="ja-sel-actions">
                      {selCount > 0 && admin && !locked && categories.length > 0 && (
                        <AssignCategoryMenu categories={categories} count={selCount}
                                            onAssign={(id) => applyCatToSel(id, 'add')}
                                            onClear={() => applyCatToSel(null, 'clear')} />
                      )}
                      {selCount > 0 && <button className="btn" onClick={copySel}>⧉ Copy links</button>}
                      {selCount > 0 && <button className="btn" onClick={copyCompanies} title="Copy company names, one per line, aligned with the links">⧉ Copy companies</button>}
                      {selCount > 0 && !locked && <button className="btn btn-danger" onClick={deleteSel}>✕ Delete</button>}
                    </span>
                  </div>

                  <div className="ja-links">
                    {day.links.map((l, i) => {
                      const s = statuses[i];
                      const flagged = s !== 'ok';
                      const checked = sel.has(i);
                      const genItem = gen.byLinkId.get(l.id);
                      return (
                        <div key={l.id} className="ja-link-wrap">
                          <div
                             className={'ja-link selectable' + (flagged ? ' flag-' + s : '') + (checked ? ' selected' : '')}
                             onClick={(e) => { const t = e.target as HTMLElement; if (t.closest('a') || t.closest('.trunc-more') || t.closest('.rg-link-btn') || t.closest('.ja-link-cats')) return; onRowSelect(shiftRef.current, i); }}>
                            <input type="checkbox" className="ja-check" checked={checked} readOnly />
                            <span className="ja-link-num">{i + 1}</span>
                            <TruncatedLink href={l.url} limit={52} title="Job link" />
                            {flagged && <span className="ja-flag">{flagLabel(s)}</span>}
                            {categories.length > 0 && (
                              <span className="ja-link-cats">
                                <CategoryTags categories={categories} ids={l.category_ids ?? []} />
                                {admin && !locked && (
                                  <LinkCategoryEditor link={l} categories={categories} onSave={(ids) => onSetLinkCats(l.id, ids)} />
                                )}
                              </span>
                            )}
                            <span className="ja-link-resume">
                              <ResumeLinkAction item={genItem} open={false} disabled={gen.profileId == null}
                                                onToggle={() => genItem && setReviewId(genItem.id)} />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {day.links.length > 1 && (
                    <div style={{ fontSize: 11.5, color: 'var(--text-soft)', marginTop: 8 }}>
                      Tip: click a row to select, then <strong>Shift</strong>-click another to select the whole range.
                    </div>
                  )}
                </>
              )}
          </div>
        </div>

        <div className="ja-card">
          <div className="ja-card-head">
            <span className="ja-card-title">Profile sign-off</span>
            <span className="badge accent">{confirmedCount}/{total}</span>
          </div>
          <div className="ja-card-body">
            <div className="ja-progress-track">
              <div className="ja-progress-fill" style={{ width: (total ? (confirmedCount / total * 100) : 0) + '%' }}></div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {confirmedCount} of {total} profiles applied{categories.length > 0 ? ' · links per profile by category' : day.links.length ? ` · ${day.links.length} links each` : ''}
            </div>
            {!locked && !canConfirm && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginBottom: 8 }}>
                {day.links.length === 0 ? 'Add job links before signing off.' : 'Resolve duplicate links to enable sign-off.'}
              </div>
            )}
            {profiles.map((p, idx) => {
              const done = confirmedSet.has(p.id);
              // How many of the day's links apply to THIS profile (category match
              // or uncategorized). Computed against ALL of the day's links
              // (fullDay), NOT the category-filtered view — a profile's count is
              // intrinsic to the profile and must not change with the active tab.
              const nForProfile = countLinksForProfile(fullDay.links, profileCats[p.id]);
              return (
                <div className="ja-profile" key={p.id}>
                  <span className="avatar" data-color={((p.no ?? idx + 1) - 1) % 7}>{initials(p.name)}</span>
                  <span className="ja-profile-name">{p.name}</span>
                  {categories.length > 0 && (
                    <span className="ja-profile-count" title="Links matching this profile's categories">{nForProfile}</span>
                  )}
                  <button className={'ja-confirm-btn' + (done ? ' done' : '')}
                          disabled={locked || (!done && !canConfirm)} onClick={() => onToggle(p.id)}>
                    {done ? '✓ Applied' : 'Mark applied'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Weekly view ----------
function JobApplyWeekly({ anchor, today, days, profiles, categories, profileCats }: {
  anchor: string; today: string; days: Record<string, JobApplyDay>; profiles: Profile[];
  categories: Category[]; profileCats: ProfileCategories;
}) {
  const wk = useMemo(() => weekDays(anchor), [anchor]);
  const getDay = (iso: string): JobApplyDay => days[iso] ?? EMPTY_DAY;
  // A profile's applied count for a day = the links matching their categories,
  // but only if they signed off that day. Uncategorized links count for all.
  const apps = (iso: string, pid: number) => {
    const d = getDay(iso);
    if (!d.confirmed.includes(pid)) return 0;
    return categories.length > 0 ? countLinksForProfile(d.links, profileCats[pid]) : d.links.length;
  };
  const profileTotal = (pid: number) => wk.reduce((s, d) => s + apps(d.iso, pid), 0);
  const dayTotal = (iso: string) => profiles.reduce((s, p) => s + apps(iso, p.id), 0);
  const grand = profiles.reduce((s, p) => s + profileTotal(p.id), 0);

  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="ja-week">
          <thead>
            <tr>
              <th className="profile-col">Profile</th>
              {wk.map((d) => (
                <th key={d.iso} className={d.iso === today ? 'is-today' : ''}>
                  {d.dow}<br /><span style={{ fontWeight: 400, color: 'var(--text-soft)' }}>{d.day}</span>
                </th>
              ))}
              <th className="total-col">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="profile-col" style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Links posted</td>
              {wk.map((d) => {
                const n = getDay(d.iso).links.length;
                return <td key={d.iso} className={d.iso === today ? 'is-today' : ''}><span className={'ja-cell-count' + (n === 0 ? ' ja-cell-zero' : '')}>{n}</span></td>;
              })}
              <td className="total-col">{wk.reduce((s, d) => s + getDay(d.iso).links.length, 0)}</td>
            </tr>
            {profiles.map((p, idx) => (
              <tr key={p.id}>
                <td className="profile-col">
                  <span className="handler">
                    <span className="avatar" data-color={((p.no ?? idx + 1) - 1) % 7}>{initials(p.name)}</span>
                    {p.name}
                  </span>
                </td>
                {wk.map((d) => {
                  const n = apps(d.iso, p.id);
                  const done = getDay(d.iso).confirmed.includes(p.id);
                  return (
                    <td key={d.iso} className={d.iso === today ? 'is-today' : ''}>
                      <span className={'ja-cell-count' + (n === 0 ? ' ja-cell-zero' : '')}>{n}</span>
                      {done && <span className="ja-cell-done" title="Signed off"></span>}
                    </td>
                  );
                })}
                <td className="total-col">{profileTotal(p.id)}</td>
              </tr>
            ))}
            <tr className="totals-row">
              <td className="profile-col">Daily total</td>
              {wk.map((d) => <td key={d.iso} className={d.iso === today ? 'is-today' : ''}>{dayTotal(d.iso)}</td>)}
              <td className="total-col">{grand}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Seed database view (admin) ----------
function JobApplyDatabase({ seed, onChanged, onFlash, onFail }: {
  seed: SeedLink[]; onChanged: () => Promise<void>; onFlash: (m: string) => void; onFail: (e: unknown) => void;
}) {
  const [q, setQ] = useState('');
  const [newLink, setNewLink] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);

  const existing = useMemo(() => dbSet(seed), [seed]);
  const newIsDup = !!newLink.trim() && existing.has(normLink(newLink));
  const filtered = useMemo(() => {
    const base = [...seed].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!q.trim()) return base;
    const n = q.toLowerCase();
    return base.filter((e) => e.url.toLowerCase().includes(n));
  }, [seed, q]);

  const tryAdd = async () => {
    if (!newLink.trim() || newIsDup) return;
    try { await api.jobApply.seed.add(newLink.trim()); setNewLink(''); await onChanged(); } catch (e) { onFail(e); }
  };
  const remove = async (id: number) => { try { await api.jobApply.seed.remove(id); await onChanged(); } catch (e) { onFail(e); } };
  const bulkAdd = async (urls: string[]) => {
    try { const r = await api.jobApply.seed.addBulk(urls); setBulkOpen(false); await onChanged(); onFlash(`Added ${r.added} link${r.added === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already there` : ''}`); } catch (e) { onFail(e); }
  };

  return (
    <div className="ja-card">
      <div className="ja-card-head">
        <span className="ja-card-title">Seed database · {seed.length} links</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />
          <button className="btn btn-primary" onClick={() => setBulkOpen(true)}>＋ Bulk add</button>
        </div>
      </div>
      <div className="ja-card-body">
        <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>
          Reference links with the date each was added. These are <strong>never shown</strong> in the daily list — a day's link is only flagged if a matching entry was added <strong>before</strong> that day.
        </div>
        <div className="ja-add">
          <input className="input" placeholder="Add a single link to the database…" value={newLink}
                 onChange={(e) => setNewLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') tryAdd(); }} />
          <button className="btn" disabled={!newLink.trim() || newIsDup} onClick={tryAdd}>Add</button>
        </div>
        {newIsDup && <div style={{ fontSize: 12, color: 'var(--danger)', margin: '-6px 0 12px', fontWeight: 600 }}>This link is already in the database.</div>}

        {seed.length === 0
          ? <Empty title="Empty database" hint="Add links above or use “Bulk add”." />
          : filtered.length === 0
            ? <Empty title="No matches" hint="Try a different search." />
            : (
              <div className="ja-links">
                {filtered.map((e) => (
                  <div key={e.id} className="ja-link">
                    <span className="ja-db-date">{e.date ? formatDate(e.date) : '—'}</span>
                    <a className="ja-link-url" href={e.url.startsWith('http') ? e.url : 'https://' + e.url} target="_blank" rel="noopener noreferrer" title={e.url}>{e.url}</a>
                    <button className="ja-del" title="Remove from database" onClick={() => remove(e.id)}>✕</button>
                  </div>
                ))}
              </div>
            )}
      </div>

      {bulkOpen && (
        <BulkAddModal
          title="Bulk add to seed database"
          subtitle="Paste reference links, one per line. Duplicates (within the paste or already in the database) are flagged and must be removed. Added with today's date."
          existing={existing}
          onAdd={bulkAdd}
          onClose={() => setBulkOpen(false)}
        />
      )}
    </div>
  );
}

// ---------- Reusable bulk-add modal ----------
function BulkAddModal({ title, subtitle, existing, onAdd, onClose, categories }: {
  title: string; subtitle?: string; existing: Set<string>;
  onAdd: (urls: string[], categoryIds?: number[]) => void; onClose: () => void;
  categories?: Category[]; // when provided, show a category picker applied to all pasted links
}) {
  const [text, setText] = useState('');
  const [catIds, setCatIds] = useState<number[]>([]);
  const lines = useMemo(() => text.split('\n').map((l) => l.trim()).filter(Boolean), [text]);
  const statuses = useMemo(() => analyzeLinks(lines, existing), [lines, existing]);
  const flagged = statuses.filter((s) => s !== 'ok').length;
  const cleanCount = lines.length - flagged;
  // Drop every flagged line at once (keeps the first copy of each new link,
  // removes in-paste repeats and links already in the database).
  const removeDuplicates = () => setText(lines.filter((_, i) => statuses[i] === 'ok').join('\n'));
  const toggleCat = (id: number) => setCatIds((cur) => cur.includes(id) ? [] : [id]);

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={lines.length === 0 || flagged > 0} onClick={() => onAdd(lines, catIds)}>
          {flagged > 0 ? `Remove ${flagged} duplicate${flagged === 1 ? '' : 's'} first` : `Add ${lines.length} link${lines.length === 1 ? '' : 's'}`}
        </button>
      </>}
    >
      {subtitle && <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 12 }}>{subtitle}</div>}
      {categories && categories.length > 0 && (
        <div className="form-field full" style={{ marginBottom: 12 }}>
          <label>Category for these links <span className="muted">· optional — applied to every link below</span></label>
          <CategoryChips categories={categories} selected={catIds} onToggle={toggleCat} single />
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            Leave blank to send these links to <strong>all</strong> profiles. Pick one or more to route them only to matching profiles.
          </div>
        </div>
      )}
      <div className="form-field full" style={{ marginBottom: 14 }}>
        <label>Job links — one per line</label>
        <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={'https://linkedin.com/jobs/view/…\nhttps://boards.greenhouse.io/…'}
                  style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
      </div>
      {lines.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span>{cleanCount} new · {flagged > 0
              ? <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{flagged} duplicate</span>
              : 'no duplicates'}</span>
            {flagged > 0 && (
              <button type="button" className="btn btn-sm btn-danger" onClick={removeDuplicates}>
                ✕ Remove {flagged} duplicate{flagged === 1 ? '' : 's'}
              </button>
            )}
          </div>
          <div className="ja-links">
            {lines.map((url, i) => {
              const s = statuses[i];
              const flag = s !== 'ok';
              return (
                <div key={i} className={'ja-link' + (flag ? ' flag-' + s : '')}>
                  <span className="ja-link-num">{i + 1}</span>
                  <span className="ja-link-url" title={url}>{url}</span>
                  {flag && <span className="ja-flag">{s === 'prior' ? 'Already applied' : 'Duplicate'}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- Finish-day confirmation ----------
function FinishDayModal({ date, linkCount, profileCount, missing, onConfirm, onClose }: {
  date: string; linkCount: number; profileCount: number; missing: string[]; onConfirm: (addToDb: boolean) => void; onClose: () => void;
}) {
  const hasMissing = missing.length > 0;
  const [addToDb, setAddToDb] = useState(true);
  return (
    <Modal
      title="Finish the day?"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Not yet</button>
        <button className="btn btn-primary" onClick={() => onConfirm(hasMissing && addToDb)}>Finish &amp; go to tomorrow →</button>
      </>}
    >
      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 4 }}>{formatDate(date)}</div>
      <div className="ja-finish-summary">
        <div className="ja-finish-stat"><span>Job links applied</span><span className="num">{linkCount}</span></div>
        <div className="ja-finish-stat"><span>Profiles signed off</span><span className="num">{profileCount}/{profileCount}</span></div>
      </div>
      {hasMissing && (
        <label className="ja-db-optin" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={addToDb} onChange={(e) => setAddToDb(e.target.checked)} />
          <span>
            Add <strong>{missing.length}</strong> new link{missing.length === 1 ? '' : 's'} to the seed database
            <span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: 12 }}>So future days flag them as already applied.</span>
          </span>
        </label>
      )}
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        Confirming <strong>locks this day</strong> — you won't be able to add or edit its links afterwards.
        You'll be taken to <strong>tomorrow</strong> to continue applying. You can always reopen a locked day if you need to.
      </div>
    </Modal>
  );
}

// ---------- Go-to-tomorrow DB guard ----------
function DbPromptModal({ date, missing, onAddContinue, onSkip, onClose }: {
  date: string; missing: string[]; onAddContinue: () => void; onSkip: () => void; onClose: () => void;
}) {
  const n = missing.length;
  return (
    <Modal
      title="Add today's links to the database?"
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onSkip}>Continue without adding</button>
        <button className="btn btn-primary" onClick={onAddContinue}>Add to database &amp; continue →</button>
      </>}
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.55 }}>
        <strong>{n}</strong> link{n === 1 ? '' : 's'} from {formatDate(date)} {n === 1 ? "isn't" : "aren't"} in the seed database yet.
        Adding {n === 1 ? 'it' : 'them'} keeps future days from re-applying to the same posting.
      </div>
      <div className="ja-links" style={{ marginTop: 12, maxHeight: 200 }}>
        {missing.slice(0, 8).map((url, i) => (
          <div key={i} className="ja-link">
            <span className="ja-link-num">{i + 1}</span>
            <span className="ja-link-url" title={url}>{url}</span>
          </div>
        ))}
        {n > 8 && <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '4px 2px' }}>+{n - 8} more…</div>}
      </div>
    </Modal>
  );
}

// ---------- Bulk "assign category" menu (in the selection bar) ----------
function AssignCategoryMenu({ categories, count, onAssign, onClear }: {
  categories: Category[]; count: number; onAssign: (categoryId: number) => void; onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <span className="ja-assign-cat" ref={ref}>
      <button className="btn" onClick={() => setOpen((o) => !o)}>🏷 Assign category ▾</button>
      {open && (
        <div className="ja-assign-pop">
          <div className="ja-assign-head">Tag {count} selected link{count === 1 ? '' : 's'}</div>
          {categories.map((c) => (
            <button key={c.id} className="ja-assign-item" onClick={() => { onAssign(c.id); setOpen(false); }}>
              {c.name}
            </button>
          ))}
          <div className="ja-assign-sep" />
          <button className="ja-assign-item ja-assign-clear" onClick={() => { onClear(); setOpen(false); }}>
            Clear categories
          </button>
        </div>
      )}
    </span>
  );
}

// ---------- Per-link category editor (inline popover on a link row) ----------
function LinkCategoryEditor({ link, categories, onSave }: {
  link: JobApplyLink; categories: Category[]; onSave: (ids: number[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<number[]>(link.category_ids ?? []);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setIds(link.category_ids ?? []); }, [link.category_ids]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); } };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  // One category per link: selecting replaces, clicking the active one clears.
  const toggle = (id: number) => setIds((cur) => cur.includes(id) ? [] : [id]);
  const apply = () => { onSave(ids); setOpen(false); };

  return (
    <span className="ja-cat-edit" ref={ref}>
      <button type="button" className="ja-cat-edit-btn" title="Set category for this link"
              onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}>🏷</button>
      {open && (
        <div className="ja-cat-pop" onClick={(e) => e.stopPropagation()}>
          <div className="ja-cat-pop-title">Category</div>
          <CategoryChips categories={categories} selected={ids} onToggle={toggle} single />
          <div className="ja-cat-pop-actions">
            <button className="btn btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn-sm btn-primary" onClick={apply}>Save</button>
          </div>
        </div>
      )}
    </span>
  );
}
