// Text extraction for master resumes (PDF / DOCX / TXT) and JD fetching from a
// job URL. Both are best-effort: callers must handle empty/failed results (the
// UI falls back to manual JD paste, and blocks generation without resume text).
import mammoth from 'mammoth';

// Extract plain text from an uploaded master resume buffer.
export async function extractResumeText(buf: Buffer, mime: string, filename: string): Promise<string> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  try {
    if (mime === 'application/pdf' || ext === 'pdf') {
      // pdf-parse v2 exports a named `pdf` / default function; import lazily so a
      // parse failure on one file never crashes the server at boot.
      const mod: any = await import('pdf-parse');
      const pdf = mod.default ?? mod.pdf ?? mod;
      const data = await pdf(buf);
      return String(data.text ?? '').trim();
    }
    if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return String(value ?? '').trim();
    }
    // txt / rtf / doc / anything else: treat as UTF-8 text (best effort).
    return buf.toString('utf8').trim();
  } catch {
    return '';
  }
}

// Strip HTML to a rough plain-text approximation of the visible body. Good
// enough to feed a JD to the model; not a full renderer.
function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  // Turn block-level tags into newlines so the JD keeps some structure.
  s = s.replace(/<\/(p|div|li|h[1-6]|section|article|br|tr)>/gi, '\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  // Decode a handful of common entities.
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  s = s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

export type JdFetch = { ok: boolean; text: string; company: string | null };

// --- Structured ATS fetchers --------------------------------------------------
// Modern ATS platforms (Greenhouse, Lever, Ashby, Rippling, SmartRecruiters) are
// JavaScript single-page apps: a plain HTML fetch returns an empty shell, so the
// JD never appears and generic scraping fails. Each, however, exposes a public
// JSON API that returns the full posting. We hit that directly — far more
// reliable than scraping — and fall back to HTML for anything we don't recognise.

// Decode HTML entities (named + numeric) — ATS JSON often ships entity-encoded
// HTML (e.g. Greenhouse's `content` is `&lt;p&gt;…`).
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&([a-z0-9#]+);/gi, (m, name) => (name.toLowerCase() in named ? named[name.toLowerCase()] : m));
}

function titleizeSlug(s: string): string {
  return s.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim()
    .split(' ').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

// Fetch JSON with a timeout and a browser-y UA. Returns null on any failure.
async function fetchJson(url: string, timeoutMs = 8_000): Promise<any | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json',
      },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Convert a possibly-HTML JD body to clean text and enforce the same 400-char /
// 12k-cap contract as the HTML path.
function finishJd(rawHtmlOrText: string, company: string | null): JdFetch | null {
  const text = htmlToText(decodeEntities(rawHtmlOrText));
  if (text.length < 400) return null;
  return { ok: true, text: text.slice(0, 12_000), company: company ? cleanCompany(company) : null };
}

// Try to pull the JD from a known ATS JSON API. Returns null when the host isn't
// a recognised ATS or the API call yields nothing usable (caller then scrapes).
async function fetchViaAts(target: string): Promise<JdFetch | null> {
  let u: URL;
  try { u = new URL(target); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  const segs = u.pathname.split('/').filter(Boolean);

  // Greenhouse — boards-api. Path form: /{board}/jobs/{id}; embed form:
  // /embed/job_app?for={board}&token={id}.
  if (/greenhouse\.io$/.test(host)) {
    let board = u.searchParams.get('for') || '';
    let id = u.searchParams.get('token') || '';
    if (!board || !id) {
      const ji = segs.indexOf('jobs');
      if (ji >= 1 && segs[ji + 1]) { board = segs[ji - 1]; id = segs[ji + 1]; }
    }
    if (!board || !id) return null;
    const j = await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}?content=true`);
    if (!j?.content) return null;
    return finishJd(j.content, j.company_name || titleizeSlug(board));
  }

  // Lever — v0 postings API. Path: /{company}/{postingId}.
  if (/(^|\.)lever\.co$/.test(host)) {
    const company = segs[0], id = segs[1];
    if (!company || !id) return null;
    const j = await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(id)}?mode=json`);
    if (!j) return null;
    const lists = Array.isArray(j.lists) ? j.lists.map((l: any) => `${l.text}\n${l.content}`).join('\n') : '';
    const body = [j.descriptionPlain || j.description || '', lists].filter(Boolean).join('\n');
    return finishJd(body, titleizeSlug(company));
  }

  // Ashby — posting-api job board (returns all jobs; match by id). Path:
  // /{org}/{jobId}.
  if (/(^|\.)ashbyhq\.com$/.test(host)) {
    const org = segs[0], jobId = segs[1];
    if (!org || !jobId) return null;
    const j = await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`);
    const jobs: any[] = j?.jobs || [];
    const m = jobs.find((x) => x.id === jobId || (x.jobUrl || '').includes(jobId)) || null;
    if (!m) return null;
    return finishJd(m.descriptionHtml || m.descriptionPlain || '', titleizeSlug(org));
  }

  // Rippling — ATS board API. Path: /{locale?}/{company}/jobs/{jobId}.
  if (/(^|\.)rippling\.com$/.test(host)) {
    let idx = 0;
    if (/^[a-z]{2}-[A-Za-z]{2}$/.test(segs[0] || '')) idx = 1; // skip locale like en-GB
    const company = segs[idx];
    const ji = segs.indexOf('jobs');
    const jobId = ji >= 0 ? segs[ji + 1] : '';
    if (!company || !jobId) return null;
    const j = await fetchJson(`https://api.rippling.com/platform/api/ats/v1/board/${encodeURIComponent(company)}/jobs/${encodeURIComponent(jobId)}`);
    const d = j?.description;
    const body = d ? [d.company || '', d.role || ''].filter(Boolean).join('\n') : '';
    if (!body) return null;
    // Derive the employer from the board slug ("agentsync-careers" → AgentSync),
    // NOT j.companyName — Rippling frequently returns the generic ATS label
    // "Rippling Recruiting" (or even the job title) there. cleanCompany() (inside
    // finishJd) strips the trailing "careers"/"jobs" from the slug.
    return finishJd(body, titleizeSlug(company));
  }

  // Workday — CXS job API. Host: {tenant}.wdN.myworkdayjobs.com. Path:
  // /{locale?}/{site}/job/{path…}. The job JSON lives at
  // /wday/cxs/{tenant}/{site}/job/{path}.
  if (/myworkdayjobs\.com$/.test(host)) {
    const tenant = host.split('.')[0];
    let s = [...segs];
    if (/^[a-z]{2}-[A-Za-z]{2}$/.test(s[0] || '')) s = s.slice(1); // drop locale
    const ji = s.indexOf('job');
    if (ji < 1) return null;
    const site = s[0];
    const path = s.slice(ji + 1).join('/');
    if (!site || !path) return null;
    const j = await fetchJson(`https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/job/${path}`);
    const info = j?.jobPostingInfo;
    if (!info?.jobDescription) return null;
    return finishJd(info.jobDescription, titleizeSlug(tenant));
  }

  // BambooHR — careers detail JSON. Host: {company}.bamboohr.com. Path:
  // /careers/{id}.
  if (/(^|\.)bamboohr\.com$/.test(host)) {
    const company = host.split('.')[0];
    const ci = segs.indexOf('careers');
    const id = ci >= 0 ? segs[ci + 1] : '';
    if (!company || !/^\d+$/.test(id || '')) return null;
    const j = await fetchJson(`https://${company}.bamboohr.com/careers/${id}/detail`);
    const o = j?.result?.jobOpening;
    if (!o?.description) return null;
    return finishJd(o.description, titleizeSlug(company));
  }

  // SmartRecruiters — public postings API. Path: /{company}/{numericId-title}.
  if (/(^|\.)smartrecruiters\.com$/.test(host)) {
    const company = segs[0];
    const idMatch = (segs[1] || '').match(/^\d+/);
    if (!company || !idMatch) return null;
    const j = await fetchJson(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${idMatch[0]}`);
    const sections = j?.jobAd?.sections;
    if (!sections) return null;
    const body = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map((k) => sections[k]?.text).filter(Boolean).join('\n');
    return finishJd(body, j?.company?.name || titleizeSlug(company));
  }

  return null;
}

// Attempt to fetch a job description from a URL. Tries a structured ATS API first
// (reliable for the JS-app job boards), then falls back to HTML scraping. Returns
// ok=false when nothing yields enough text (login walls, unknown JS shells),
// signalling the UI to ask for a manual paste.
export async function fetchJobDescription(url: string): Promise<JdFetch> {
  const target = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  // 1) Structured ATS API (Greenhouse/Lever/Ashby/Rippling/SmartRecruiters).
  try {
    const viaAts = await fetchViaAts(target);
    if (viaAts) return viaAts;
  } catch { /* fall through to HTML scrape */ }
  // 2) Generic HTML scrape.
  try {
    // 8s cap: a job page that hasn't responded by then is almost always a login
    // wall or JS shell we can't scrape anyway → fall back to manual JD. Keeps the
    // "Check job descriptions" pass snappy instead of waiting on hanging sites.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    let res: Response;
    try {
      res = await fetch(target, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          // A desktop UA gets fuller HTML from many job boards than the default.
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return { ok: false, text: '', company: null };
    const html = await res.text();
    const company = extractCompany(html, target);
    const text = htmlToText(html);
    // Heuristic: real JD pages have a few hundred chars of body text. Anything
    // shorter is almost certainly a JS shell or login wall — fall back to manual.
    if (text.length < 400) return { ok: false, text, company };
    // Cap the JD we send to the model (keeps token use sane).
    return { ok: true, text: text.slice(0, 12_000), company };
  } catch {
    return { ok: false, text: '', company: null };
  }
}

// Best-effort company name from OpenGraph/site name/title, else the hostname.
export function extractCompany(html: string, url: string): string | null {
  const pick = (re: RegExp): string | null => {
    const m = re.exec(html);
    return m && m[1] ? m[1].trim() : null;
  };
  // Candidate company strings in priority order.
  const cands: string[] = [];
  const og = pick(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i);
  if (og) cands.push(og);
  const title = pick(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) {
    // Titles are often "Job Title - Company | Board" or "Job Application for
    // Role at Company". Prefer the segment after " at ", else the 2nd segment.
    const atSplit = title.split(/\s+at\s+/i);
    if (atSplit.length >= 2) cands.push(atSplit[atSplit.length - 1]);
    const parts = title.split(/[|–—\-·]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) cands.push(parts[1]);
    if (parts.length >= 1) cands.push(parts[0]);
  }
  // First candidate that survives noise-stripping wins (skips "Greenhouse", etc.).
  for (const c of cands) {
    const cleaned = cleanCompany(c);
    if (cleaned) return cleaned;
  }
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return cleanCompany(titleizeSlug(host.split('.')[0])) || null;
  } catch {
    return null;
  }
}

// Normalise a company string: decode entities, drop HTML, strip ATS/board/noise
// words, and trim stray separators. Returns '' when nothing but noise remains, so
// callers can fall through to the next candidate instead of surfacing junk.
function cleanCompany(s: string): string {
  let out = decodeEntities(String(s)).replace(/<[^>]+>/g, ' ');
  // Multiword phrases first so "Job Board" isn't half-eaten by "jobs?".
  out = out.replace(/\b(job board|job application(?: for)?|now hiring|careers?|jobs?|hiring|openings?|greenhouse|lever|ashby(?:hq)?|workday|myworkdayjobs|smartrecruiters|rippling|workable|jobvite|breezy(?:hr)?|bamboohr|recruitee)\b/gi, ' ');
  out = out.replace(/^\s*at\s+/i, ''); // leftover "… at Company" glue
  out = out.replace(/\s{2,}/g, ' ').replace(/^[\s\-–—|·:,]+|[\s\-–—|·:,]+$/g, '').trim();
  return out.slice(0, 60);
}
