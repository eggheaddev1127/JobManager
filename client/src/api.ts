import type { Profile, Job, JobsResponse, Interview, InterviewsResponse, User, Unavailability, SeedLink, JobApplyDay, JobApplyRange, JobApplySearchResult, FinancialAccount, Transaction, TransactionGroup, JobRef, ResumeSettings, MasterResumeMeta, GeneratedResume, GeneratedResumeDetail, Category, ProfileCategories, CallerPayResponse } from './types';

export class HttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let on401: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  on401 = fn;
}

const ATTEMPT_TIMEOUT_MS = 12_000; // abort a stalled request well before Cloudflare's 100s (524)
const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Fetch with a per-attempt timeout and automatic retry on network stalls. This
// host's loopback intermittently stalls request *bodies* (~30% of POSTs), so a
// save would otherwise hang until the tunnel returns a 524. We abort a stalled
// attempt after 12s and retry; a retry almost always lands. We retry only when
// the fetch itself fails (timeout/connection error) — never on an HTTP response
// (4xx/5xx), which is a real answer from the server, not a stall.
async function fetchWithRetry(path: string, init: RequestInit): Promise<Response> {
  // Respect a caller-supplied signal by not layering our own timeout/retry.
  if (init.signal) return fetch(path, init);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      return await fetch(path, { ...init, signal: controller.signal });
    } catch (e) {
      lastErr = e;
      // AbortError (our timeout) or TypeError (connection reset) → transient; retry.
      if (attempt < MAX_ATTEMPTS) { await sleep(200 * attempt); continue; }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetchWithRetry(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    cache: 'no-store', // always revalidate against the server — never serve a stale GET
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    const text = await res.text().catch(() => '');
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const msg = (body && typeof body === 'object' && 'error' in (body as Record<string, unknown>))
      ? String((body as { error: unknown }).error)
      : `${res.status} ${res.statusText}`;
    // A 401 means the login session is invalid → trigger global logout. Exclude
    // the auth probes and the Jobs page-password endpoints: a wrong *page*
    // password is not an expired login and must not log the user out.
    const isPagePasswordCheck = path.endsWith('/api/jobs/unlock') || path.endsWith('/api/jobs/change-password');
    if (res.status === 401 && !path.endsWith('/api/auth/me') && !path.endsWith('/api/auth/login') && !isPagePasswordCheck) {
      on401?.();
    }
    throw new HttpError(res.status, body, msg);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  auth: {
    me: () => request<User>('/api/auth/me'),
    login: (email: string, password: string) =>
      request<User>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
    logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
    changePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  },
  users: {
    list: () => request<User[]>('/api/users'),
    create: (data: { name: string; email: string; password: string; active: boolean; roles: string[] }) =>
      request<User>('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<{ name: string; email: string; password: string; active: boolean; roles: string[] }>) =>
      request<User>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/api/users/${id}`, { method: 'DELETE' }),
  },
  profiles: {
    list: () => request<Profile[]>('/api/profiles'),
    create: (data: Partial<Profile>) => request<Profile>('/api/profiles', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Profile>) =>
      request<Profile>(`/api/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/api/profiles/${id}`, { method: 'DELETE' }),
  },
  jobs: {
    list: () => request<JobsResponse>('/api/jobs'),
    create: (data: Partial<Job>) => request<Job>('/api/jobs', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Job>) =>
      request<Job>(`/api/jobs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
    setBaseFee: (base_fee: number) =>
      request<{ base_fee: number }>('/api/jobs/base-fee', { method: 'PUT', body: JSON.stringify({ base_fee }) }),
    unlockStatus: () => request<{ unlocked: boolean }>('/api/jobs/unlock-status'),
    unlock: (password: string) =>
      request<{ ok: true }>('/api/jobs/unlock', { method: 'POST', body: JSON.stringify({ password }) }),
    lock: () => request<{ ok: true }>('/api/jobs/lock', { method: 'POST' }),
    changePagePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>('/api/jobs/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  },
  callerPay: {
    callers: () => request<{ callers: string[] }>('/api/caller-pay/callers'),
    get: (caller: string, months: number) =>
      request<CallerPayResponse>(`/api/caller-pay?caller=${encodeURIComponent(caller)}&months=${months}`),
    mark: (jobId: number, payDate: string, paid: boolean) =>
      request<{ ok: true; paid: boolean }>('/api/caller-pay/mark', { method: 'POST', body: JSON.stringify({ job_id: jobId, pay_date: payDate, paid }) }),
  },
  interviews: {
    list: () => request<InterviewsResponse>('/api/interviews'),
    create: (data: Partial<Interview>) =>
      request<Interview>('/api/interviews', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Interview>) =>
      request<Interview>(`/api/interviews/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/api/interviews/${id}`, { method: 'DELETE' }),
    markFollowedUp: (id: number) =>
      request<Interview>(`/api/interviews/${id}/follow-up`, { method: 'POST' }),
    uploadResume: (id: number, payload: { filename: string; mime: string; data: string }) =>
      request<{ ok: true; pipeline_key: string; resume_filename: string }>(`/api/interviews/${id}/resume`, { method: 'POST', body: JSON.stringify(payload) }),
    removeResume: (id: number) =>
      request<void>(`/api/interviews/${id}/resume`, { method: 'DELETE' }),
    // Same-origin GET; the browser sends the session cookie and the server
    // responds with a Content-Disposition: attachment to trigger a download.
    resumeUrl: (id: number) => `/api/interviews/${id}/resume`,
    // The pipeline's Job Apply tailored resume, served handler-scoped through the
    // interviews router (so devs can download it — /api/resumes is admin-only).
    jaResumeUrl: (id: number) => `/api/interviews/${id}/ja-resume`,
    // The pipeline's job description text (from Job Apply, matched by profile +
    // company). 404 when none is on file.
    jd: (id: number) => request<{ jd_text: string; company_name: string | null }>(`/api/interviews/${id}/jd`),
    // Distinct company names for the editor autocomplete.
    companies: () => request<{ companies: string[] }>('/api/interviews/companies'),
    // Mark / unmark this interview's pipeline as "landed an offer".
    setOffer: (id: number, offered: boolean) =>
      request<{ ok: true; offered: boolean }>(`/api/interviews/${id}/offer`, { method: 'POST', body: JSON.stringify({ offered }) }),
    // What already exists for a (profile, company) pipeline — JD + resume — for
    // the editor's heads-up before an interview is created.
    pipelinePreview: (profile: string, company: string) =>
      request<{ jd_url: string | null; jd_text: string | null; resume_filename: string | null; resume_interview_id: number | null; ja_resume_id: number | null }>(
        `/api/interviews/pipeline-preview?profile=${encodeURIComponent(profile)}&company=${encodeURIComponent(company)}`),
  },
  jobApply: {
    range: (start: string, end: string) => request<JobApplyRange>(`/api/job-apply?start=${start}&end=${end}`),
    search: (q: string) => request<{ results: JobApplySearchResult[] }>(`/api/job-apply/search?q=${encodeURIComponent(q)}`),
    addLink: (date: string, url: string, categoryIds?: number[]) =>
      request<{ id: number; url: string; category_ids: number[] }>('/api/job-apply/links', { method: 'POST', body: JSON.stringify({ date, url, category_ids: categoryIds ?? [] }) }),
    addLinksBulk: (date: string, urls: string[], categoryIds?: number[]) =>
      request<{ added: number }>('/api/job-apply/links/bulk', { method: 'POST', body: JSON.stringify({ date, urls, category_ids: categoryIds ?? [] }) }),
    setLinkCategories: (id: number, categoryIds: number[]) =>
      request<{ id: number; category_ids: number[] }>(`/api/job-apply/links/${id}/categories`, { method: 'PUT', body: JSON.stringify({ category_ids: categoryIds }) }),
    deleteLinks: (date: string, ids: number[]) =>
      request<void>('/api/job-apply/links', { method: 'DELETE', body: JSON.stringify({ date, ids }) }),
    toggleConfirm: (date: string, profileId: number) =>
      request<JobApplyDay>('/api/job-apply/confirm', { method: 'POST', body: JSON.stringify({ date, profile_id: profileId }) }),
    setDone: (date: string, done: boolean) =>
      request<JobApplyDay>('/api/job-apply/done', { method: 'POST', body: JSON.stringify({ date, done }) }),
    promote: (date: string, urls: string[]) =>
      request<{ added: number; skipped: number }>('/api/job-apply/promote', { method: 'POST', body: JSON.stringify({ date, urls }) }),
    seed: {
      list: () => request<SeedLink[]>('/api/job-apply/seed'),
      add: (url: string) => request<SeedLink>('/api/job-apply/seed', { method: 'POST', body: JSON.stringify({ url }) }),
      addBulk: (urls: string[]) => request<{ added: number; skipped: number }>('/api/job-apply/seed/bulk', { method: 'POST', body: JSON.stringify({ urls }) }),
      remove: (id: number) => request<void>(`/api/job-apply/seed/${id}`, { method: 'DELETE' }),
    },
    categories: {
      list: () => request<Category[]>('/api/job-apply/categories'),
      add: (name: string) => request<Category>('/api/job-apply/categories', { method: 'POST', body: JSON.stringify({ name }) }),
      rename: (id: number, name: string) => request<Category>(`/api/job-apply/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
      remove: (id: number) => request<void>(`/api/job-apply/categories/${id}`, { method: 'DELETE' }),
    },
    profileCategories: {
      all: () => request<ProfileCategories>('/api/job-apply/profile-categories'),
      set: (profileId: number, categoryIds: number[]) =>
        request<{ profile_id: number; category_ids: number[] }>(`/api/job-apply/profile-categories/${profileId}`, { method: 'PUT', body: JSON.stringify({ category_ids: categoryIds }) }),
    },
  },
  payments: {
    // Page lock (mirrors Running Jobs).
    unlockStatus: () => request<{ unlocked: boolean }>('/api/payments/unlock-status'),
    unlock: (password: string) =>
      request<{ ok: true }>('/api/payments/unlock', { method: 'POST', body: JSON.stringify({ password }) }),
    lock: () => request<{ ok: true }>('/api/payments/lock', { method: 'POST' }),
    changePagePassword: (currentPassword: string, newPassword: string) =>
      request<{ ok: true }>('/api/payments/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
    // Accounts.
    accounts: () => request<FinancialAccount[]>('/api/payments/accounts'),
    createAccount: (data: { acct_type: string; name: string; balance?: number }) =>
      request<FinancialAccount>('/api/payments/accounts', { method: 'POST', body: JSON.stringify(data) }),
    updateAccount: (id: number, data: Partial<{ acct_type: string; name: string; balance: number }>) =>
      request<FinancialAccount>(`/api/payments/accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeAccount: (id: number) => request<void>(`/api/payments/accounts/${id}`, { method: 'DELETE' }),
    // Jobs picker (lightweight, for the transaction editor).
    jobs: () => request<JobRef[]>('/api/payments/jobs'),
    // Transactions. Pass an accountId for the per-account drill-down (oldest first).
    transactions: (accountId?: number) =>
      request<Transaction[]>(`/api/payments/transactions${accountId != null ? `?account=${accountId}` : ''}`),
    createTransaction: (data: Partial<Transaction>) =>
      request<Transaction>('/api/payments/transactions', { method: 'POST', body: JSON.stringify(data) }),
    updateTransaction: (id: number, data: Partial<Transaction>) =>
      request<Transaction>(`/api/payments/transactions/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    removeTransaction: (id: number) => request<void>(`/api/payments/transactions/${id}`, { method: 'DELETE' }),
    // Transaction groups (payment cycles).
    txnGroups: () => request<TransactionGroup[]>('/api/payments/transactions/groups'),
    groupTxns: (ids: number[], label?: string) =>
      request<{ id: number; label: string }>('/api/payments/transactions/group', { method: 'POST', body: JSON.stringify({ ids, label }) }),
    addToGroup: (gid: number, ids: number[]) =>
      request<{ ok: true; id: number }>(`/api/payments/transactions/group/${gid}/add`, { method: 'POST', body: JSON.stringify({ ids }) }),
    ungroupTxns: (ids: number[]) =>
      request<{ ok: true }>('/api/payments/transactions/ungroup', { method: 'POST', body: JSON.stringify({ ids }) }),
    deleteTxnGroup: (gid: number) => request<void>(`/api/payments/transactions/group/${gid}`, { method: 'DELETE' }),
  },
  unavailability: {
    list: () => request<Unavailability[]>('/api/unavailability'),
    create: (data: { date: string; start: number; end: number; note?: string }) =>
      request<Unavailability>('/api/unavailability', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { date: string; start: number; end: number; note?: string }) =>
      request<Unavailability>(`/api/unavailability/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: number) => request<void>(`/api/unavailability/${id}`, { method: 'DELETE' }),
  },
  resumes: {
    // Settings: Claude API key (write-only) + global tailoring prompt.
    getSettings: () => request<ResumeSettings>('/api/resumes/settings'),
    saveSettings: (data: { api_key?: string; prompt?: string }) =>
      request<ResumeSettings>('/api/resumes/settings', { method: 'PUT', body: JSON.stringify(data) }),
    // Master resume per profile.
    masters: () => request<MasterResumeMeta[]>('/api/resumes/masters'),
    uploadMaster: (profileId: number, payload: { filename: string; mime: string; data: string }) =>
      request<MasterResumeMeta>(`/api/resumes/masters/${profileId}`, { method: 'POST', body: JSON.stringify(payload) }),
    removeMaster: (profileId: number) => request<void>(`/api/resumes/masters/${profileId}`, { method: 'DELETE' }),
    masterUrl: (profileId: number) => `/api/resumes/masters/${profileId}/file`,
    // Generation for a day + profile.
    day: (date: string, profileId: number) =>
      request<{ items: GeneratedResume[] }>(`/api/resumes/day/${date}/${profileId}`),
    // Phase 1: check/fetch every link's JD without building. Poll day() to watch.
    prepare: (date: string, profileId: number) =>
      request<{ ok: true; started: boolean }>(`/api/resumes/prepare/${date}/${profileId}`, { method: 'POST' }),
    // Phase 2: build resumes. Rejects (409) if any link still needs a JD.
    generate: (date: string, profileId: number) =>
      request<{ ok: true; started: boolean; count: number }>(`/api/resumes/generate/${date}/${profileId}`, { method: 'POST' }),
    item: (id: number) => request<GeneratedResumeDetail>(`/api/resumes/item/${id}`),
    // Plain save (no generate flag) never triggers generation. Pass generate:true
    // to also (re)build the resume in the background.
    setJd: (id: number, data: { jd_text: string; company_name?: string; generate?: boolean }) =>
      request<GeneratedResumeDetail>(`/api/resumes/item/${id}/jd`, { method: 'PUT', body: JSON.stringify(data) }),
    setResume: (id: number, resume_md: string) =>
      request<GeneratedResumeDetail>(`/api/resumes/item/${id}/resume`, { method: 'PUT', body: JSON.stringify({ resume_md }) }),
    // Kicks off regeneration in the background; poll item(id) until it leaves
    // the 'generating' status.
    regenerate: (id: number, custom_prompt?: string) =>
      request<{ ok: true; started: boolean; id: number }>(`/api/resumes/item/${id}/regenerate`, { method: 'POST', body: JSON.stringify({ custom_prompt: custom_prompt ?? '' }) }),
    pdfUrl: (id: number) => `/api/resumes/item/${id}/pdf`,
    zipUrl: (date: string, profileId: number) => `/api/resumes/zip/${date}/${profileId}`,
  },
};
