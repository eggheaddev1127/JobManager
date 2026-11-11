export type User = {
  id: number;
  name: string;
  email: string;
  active: boolean;
  roles: string[]; // 'admin' | 'dev'
};

// A dev-marked unavailable time block (shown on the Calendar). Times are
// minutes-since-midnight in EST. user_name is the owner's name (for admins).
export type Unavailability = {
  id: number;
  user_id: number;
  user_name: string;
  date: string;
  start_min: number;
  end_min: number;
  note: string | null;
};

// Job Apply
export type SeedLink = { id: number; url: string; date: string };
export type JobApplyLink = { id: number; url: string; category_ids?: number[]; company?: string | null };
export type JobApplyDay = { links: JobApplyLink[]; confirmed: number[]; done: boolean };
export type JobApplySearchResult = { id: number; url: string; date: string; company: string | null; matchedCompany: boolean; matchedJd: boolean; snippet: string | null; resumes: { id: number; profile: string }[] };
export type JobApplyRange = { days: Record<string, JobApplyDay> };

// Job categories (AI/ML, Full Stack, …). Links and profiles are each tagged
// with any number of categories; a profile applies to a link if they share a
// category, or if the link has no category (uncategorized → everyone).
export type Category = { id: number; name: string; sort?: number };
// { profileId: [categoryId, ...] }
export type ProfileCategories = Record<number, number[]>;

// Resume generation
export type ResumeSettings = {
  has_api_key: boolean;
  api_key_hint: string | null; // e.g. "…ab12"
  prompt: string;
  is_default_prompt: boolean;
};

// Which profiles have a master resume on file (badges on Profiles page).
export type MasterResumeMeta = {
  profile_id: number;
  filename: string;
  has_text: boolean; // extracted text is non-empty (required to generate)
  text_len: number;
  updated_at?: string;
};

export type GenStatus = 'fetching' | 'ready' | 'pending' | 'generating' | 'done' | 'error' | 'needs_jd';

// One tailored resume in a day's generation run (list shape — no heavy text).
export type GeneratedResume = {
  id: number;
  date: string;
  profile_id: number;
  link_id: number;
  url: string;
  company_name: string | null;
  jd_source: 'fetched' | 'manual' | 'failed' | null;
  status: GenStatus;
  error: string | null;
  has_jd: boolean;
  has_resume: boolean;
  custom_prompt: string | null;
  updated_at: string;
};

// Full detail (review pane) — adds JD text + resume markdown.
export type GeneratedResumeDetail = GeneratedResume & {
  jd_text: string;
  resume_md: string;
};

export type Profile = {
  id: number;
  no: number | null;
  name: string;
  gmail: string | null;
  linkedin_url: string | null;
  full_address: string | null;
  gv: string | null;
  github: string | null;
  race: string | null;
  gv2: string | null;
  apply_enabled?: number; // 1 = included in Job Apply, 0 = excluded
  color?: string | null; // chosen badge color (hex, e.g. "#7c3aed"), null = auto
};

// Payments
export type FinancialAccount = {
  id: number;
  acct_type: string;       // e.g. "Relay", "Unifi", "Coinbase"
  name: string;            // e.g. "Dynamic", "Chris"
  balance: number;         // CURRENT balance = opening + income − expenses (server-computed)
  opening_balance?: number; // the seeded opening balance
};

export type TransactionKind = 'deposit' | 'payout' | 'transfer';

export type Transaction = {
  id: number;
  ts: string;          // ISO-ish datetime (EST), e.g. "2026-06-18T14:00"
  kind: TransactionKind;
  from_account_id: number | null;
  from_job_id: number | null;
  from_text: string | null;
  to_account_id: number | null;
  to_job_id: number | null;
  to_text: string | null;
  purpose: string | null;
  amount: number;
  group_id: number | null; // payment-cycle group this transaction belongs to (or null)
  from_label: string;  // resolved display label (server-computed)
  to_label: string;
};

// A "payment cycle" grouping of transactions (job deposit + its Uni→Cwallet and
// deduction legs). Labeled by the depositing company.
export type TransactionGroup = { id: number; label: string | null };

// Minimal job reference for the transaction editor's Job picker.
export type JobRef = { id: number; company_name: string; profile_name: string };

// Caller Pay payout frequency for a job. Empty/absent = no payouts scheduled.
export type PayCycle = 'weekly' | 'bi-weekly' | 'semi-monthly' | 'monthly';

export type Job = {
  id: number;
  profile_name: string;
  company_name: string;
  role_title: string | null;
  specs: string | null;
  source: string | null;
  salary_monthly: number;
  caller_payout: number;
  dev_payout: number;
  started_on: string | null;
  status: string;
  notes: string | null;
  // Caller Pay: the caller this job pays out to, and its per-job payout cycle.
  // (The job's started_on is the job start date.)
  caller: string | null;
  pay_first_date: string | null;  // first paid date — the schedule anchor
  pay_cycle: PayCycle | null;
  // Auto-suggested caller from the matching interview pipeline's handler (server-
  // computed; shown as the default when no caller is assigned yet).
  suggested_caller?: string | null;
};

// Caller Pay tab
export type CallerPayItem = {
  job_id: number;
  company_name: string;
  profile_name: string;
  role_title: string | null;
  caller: string | null;
  pay_cycle: PayCycle | null;
  pay_date: string;
  amount: number;
  paid: boolean;
};

export type CallerPayHistoryItem = {
  job_id: number;
  company_name: string;
  profile_name: string;
  role_title: string | null;
  pay_date: string;
  amount: number;
  paid_at: string;
};

export type CallerPayResponse = {
  caller: string;
  months: number;
  schedule: CallerPayItem[];
  history: CallerPayHistoryItem[];
};

export type JobsResponse = {
  jobs: Job[];
  summary: {
    active_count: number;
    monthly_income: number;
    monthly_caller_payout: number;
    monthly_dev_payout: number;
    base_fee: number;
    monthly_net: number;
  };
};

// Calendar recurrence frequencies. Absent/null on an interview means one-off.
export type Recurrence = 'daily' | 'weekday' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';

export type Interview = {
  id: number;
  date: string | null;
  meeting_slot: string | null;
  country: string | null;
  profile_name: string | null;
  company_name: string | null;
  step: string | null;
  step_details: string | null;
  agency_recruiter_id: number | null;
  agency_name: string | null;
  progress: string | null;
  meeting_url: string | null;
  jd_url: string | null;
  recording_url: string | null;
  notes: string | null;
  handler: string | null;
  last_followed_up_at: string | null;
  meeting_type: 'video' | 'phone' | null;
  // How this interview repeats on the calendar. null/absent = one-off.
  recurrence?: Recurrence | null;
  // Resume is shared per pipeline (profile + company); this is the shared
  // filename, computed by the server for every interview in the pipeline.
  resume_filename: string | null;
  // A saved job description exists in Job Apply for this pipeline (profile +
  // company); the text is fetched on demand via api.interviews.jd().
  has_jd: boolean;
  // JD posting URL shared across the whole pipeline group — any interview in the
  // pipeline that has a jd_url populates this for all of them.
  pipeline_jd_url: string | null;
  // Tailored resume built in Job Apply for this (profile, company), if any —
  // shown in the details when no resume was uploaded to the pipeline.
  ja_resume_id: number | null;
  pipeline_key: string;
  pipeline_status: 'failed' | 'complete' | 'passed' | 'pending';
  pipeline_first_step_passed: boolean;
  // Candidate landed an offer on this pipeline (marked via checkbox, or it has a
  // "Job" step). Offered pipelines leave "Live pipelines" and show in "Offers".
  pipeline_offered: boolean;
};

export type Pipeline = {
  profile_name: string;
  company_name: string;
  status: 'failed' | 'complete' | 'passed' | 'pending';
  rows: number;
  latest_step: string | null;
};

export type InterviewsResponse = {
  interviews: Interview[];
  pipelines: Pipeline[];
};
