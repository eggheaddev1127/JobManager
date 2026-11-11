// ============ Sample data + helpers ============

const STORAGE_KEY = "jobmgr.v11";

const SEED = {
  // Logged-in user identity (one of users[].id). Default: admin.
  currentUserId: "u_admin",

  users: [
    { id: "u_admin", name: "Admin", email: "admin@jobmgr.io", access: true, roles: ["admin"] },
    { id: "u_shane", name: "Shane", email: "shane@jobmgr.io", access: true, roles: ["dev"] },
    { id: "u_efi",   name: "Efi",   email: "efi@jobmgr.io",   access: true, roles: ["dev"] },
    { id: "u_mara",  name: "Mara",  email: "mara@jobmgr.io",  access: true, roles: ["dev", "admin"] },
    { id: "u_kai",   name: "Kai",   email: "kai@jobmgr.io",   access: false, roles: ["dev"] },
  ],

  profiles: [
    { id: "p1", no: 1, name: "Michael Godfrey", gmail: "michael.godfrey.dev@gmail.com",
      linkedin: "https://linkedin.com/in/michael-godfrey",
      address: "1245 Pine St, Seattle, WA 98101",
      gv: "+1 (206) 555-0142", github: "github.com/mgodfrey",
      race: "White", gv2: "8821" },
    { id: "p2", no: 2, name: "Aarav Patel", gmail: "aarav.patel.eng@gmail.com",
      linkedin: "https://linkedin.com/in/aarav-patel",
      address: "78 Beacon Hill Rd, Boston, MA 02108",
      gv: "+1 (617) 555-0188", github: "github.com/aarav-p",
      race: "Asian", gv2: "4471" },
    { id: "p3", no: 3, name: "Daniela Reyes", gmail: "dani.reyes.code@gmail.com",
      linkedin: "https://linkedin.com/in/daniela-reyes",
      address: "920 Mission St, San Francisco, CA 94103",
      gv: "+1 (415) 555-0117", github: "github.com/danielar",
      race: "Hispanic", gv2: "9034" },
    { id: "p4", no: 4, name: "James O'Connor", gmail: "james.oconnor.swe@gmail.com",
      linkedin: "https://linkedin.com/in/james-oconnor",
      address: "412 W Belmont Ave, Chicago, IL 60657",
      gv: "+1 (312) 555-0163", github: "github.com/joc",
      race: "White", gv2: "2208" },
    { id: "p5", no: 5, name: "Priya Sharma", gmail: "priya.sharma.dev@gmail.com",
      linkedin: "https://linkedin.com/in/priya-sharma",
      address: "55 E 14th St, New York, NY 10003",
      gv: "+1 (212) 555-0194", github: "github.com/priya-s",
      race: "Asian", gv2: "5612" },
  ],

  jobs: [
    { id: "j1", profileId: "p1", company: "McKinsey", title: "Senior Full-Stack Engineer",
      source: "LinkedIn", salaryMo: 14000, payoutCaller: 800, payoutDev: 2200,
      status: "Active", startDate: "2026-04-12" },
    { id: "j2", profileId: "p2", company: "Stripe", title: "Backend Engineer L4",
      source: "Job Apply", salaryMo: 16500, payoutCaller: 900, payoutDev: 2600,
      status: "Active", startDate: "2026-03-28" },
    { id: "j3", profileId: "p3", company: "Alkami", title: "Software Engineer II",
      source: "Agency", salaryMo: 11000, payoutCaller: 700, payoutDev: 1800,
      status: "Active", startDate: "2026-04-02" },
    { id: "j4", profileId: "p4", company: "Discord", title: "Senior Platform Engineer",
      source: "LinkedIn", salaryMo: 15500, payoutCaller: 850, payoutDev: 2400,
      status: "Active", startDate: "2026-05-04" },
    { id: "j5", profileId: "p5", company: "Notion", title: "Full-Stack Engineer",
      source: "Referral", salaryMo: 13000, payoutCaller: 750, payoutDev: 2000,
      status: "Active", startDate: "2026-05-11" },
    { id: "j6", profileId: "p2", company: "Figma", title: "Backend Engineer",
      source: "Job Apply", salaryMo: 14500, payoutCaller: 800, payoutDev: 2300,
      status: "Paused", startDate: "2026-02-18" },
  ],

  // Interview pipeline steps (ordered)
  steps: ["Recruiter", "Intro", "Hiring Manager", "Tech Screen", "Live Coding", "System Design", "Onsite", "Offer"],

  interviews: [
    // McKinsey — live pipeline, Michael, handled by Shane
    { id: "i1",  date: "2026-05-04", slot: "9:00–9:30am",  profileId: "p1", company: "McKinsey",
      step: "Hiring Manager", progress: "Passed", handlerId: "u_shane",
      meeting: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZjZjNTRkYTctMzlkMS00ZTIzLTk1MTUtNzkwN2I2NDBjMDY2%40thread.v2/0",
      jd: "https://sharetext.io/jhx7yul1",
      recording: "https://mega.nz/file/rCx2RIyD",
      notes: "Meeting went very well, his feedback was good, I think we should pass, but let's wait for HR response" },
    { id: "i2",  date: "2026-04-22", slot: "2:00–2:30pm", profileId: "p1", company: "McKinsey",
      step: "Recruiter", progress: "Passed", handlerId: "u_shane",
      meeting: "https://meet.google.com/abc-defg-hij", jd: "https://sharetext.io/jhx7yul1",
      recording: "https://mega.nz/file/aaa", notes: "Standard recruiter screen, moved to HM round." },
    { id: "i3",  date: "2026-05-18", slot: "11:00–12:00pm", profileId: "p1", company: "McKinsey",
      step: "Tech Screen", progress: "Waiting", handlerId: "u_shane",
      meeting: "https://teams.microsoft.com/l/meetup-join/tech1", jd: "https://sharetext.io/jhx7yul1",
      recording: "", notes: "Coding round — Leetcode medium-hard expected." },

    // Stripe — live pipeline, Aarav, Efi
    { id: "i4", date: "2026-05-09", slot: "10:00–10:45am", profileId: "p2", company: "Stripe",
      step: "Recruiter", progress: "Passed", handlerId: "u_efi", meetingType: "phone", phone: "+1 (628) 555-0119",
      meeting: "", jd: "https://stripe.com/jobs/12345",
      recording: "https://mega.nz/file/str1", notes: "Recruiter was friendly. Confirmed comp band." },
    { id: "i5", date: "2026-05-15", slot: "1:00–1:45pm", profileId: "p2", company: "Stripe",
      step: "Hiring Manager", progress: "Passed", handlerId: "u_efi",
      meeting: "https://stripe.zoom.us/j/456", jd: "https://stripe.com/jobs/12345",
      recording: "https://mega.nz/file/str2", notes: "HM liked the systems thinking. Strong yes from them." },
    { id: "i6", date: "2026-05-22", slot: "9:00–10:30am", profileId: "p2", company: "Stripe",
      step: "Live Coding", progress: "Waiting", handlerId: "u_efi",
      meeting: "https://stripe.zoom.us/j/789", jd: "https://stripe.com/jobs/12345",
      recording: "", notes: "Live coding — payment processor design challenge." },

    // Alkami — FAILED pipeline (had intro, HM, then failed live coding)
    { id: "i7",  date: "2026-04-08", slot: "3:00–3:30pm", profileId: "p3", company: "Alkami",
      step: "Intro", progress: "Passed", handlerId: "u_shane",
      meeting: "https://alkami.zoom.us/j/111", jd: "https://alkami.com/jobs/1",
      recording: "https://mega.nz/file/alk1", notes: "Intro went well." },
    { id: "i8",  date: "2026-04-19", slot: "11:00–11:45am", profileId: "p3", company: "Alkami",
      step: "Hiring Manager", progress: "Passed", handlerId: "u_shane",
      meeting: "https://alkami.zoom.us/j/222", jd: "https://alkami.com/jobs/1",
      recording: "https://mega.nz/file/alk2", notes: "HM was impressed, pushed to coding." },
    { id: "i9",  date: "2026-05-02", slot: "2:00–3:30pm", profileId: "p3", company: "Alkami",
      step: "Live Coding", progress: "Failed", handlerId: "u_shane",
      meeting: "https://alkami.zoom.us/j/333", jd: "https://alkami.com/jobs/1",
      recording: "https://mega.nz/file/alk3", notes: "Bombed on the graph problem. HR rejected next day." },

    // Discord — live pipeline (Mara handler)
    { id: "i10", date: "2026-05-12", slot: "12:00–12:30pm", profileId: "p4", company: "Discord",
      step: "Recruiter", progress: "Passed", handlerId: "u_mara", meetingType: "phone", phone: "+1 (415) 555-0177",
      meeting: "", jd: "https://discord.com/jobs/eng",
      recording: "https://mega.nz/file/dis1", notes: "Recruiter call. Comp aligned." },
    { id: "i11", date: "2026-05-20", slot: "4:00–5:00pm", profileId: "p4", company: "Discord",
      step: "Hiring Manager", progress: "Passed", handlerId: "u_mara",
      meeting: "https://discord.zoom.us/j/101", jd: "https://discord.com/jobs/eng",
      recording: "https://mega.nz/file/dis2", notes: "Strong HM signal. Tech round scheduled." },
    { id: "i12", date: "2026-05-28", slot: "10:00–11:30am", profileId: "p4", company: "Discord",
      step: "System Design", progress: "Waiting", handlerId: "u_mara",
      meeting: "https://discord.zoom.us/j/102", jd: "https://discord.com/jobs/eng",
      recording: "", notes: "System design — gateway architecture likely." },

    // Notion — Priya, live pipeline, single step so far (Efi)
    { id: "i13", date: "2026-05-21", slot: "9:30–10:00am", profileId: "p5", company: "Notion",
      step: "Recruiter", progress: "Passed", handlerId: "u_efi", meetingType: "phone", phone: "+1 (212) 555-0143",
      meeting: "", jd: "https://notion.so/careers/1",
      recording: "https://mega.nz/file/not1", notes: "Recruiter said team is hiring fast." },

    // Figma — Aarav — paused / waiting on HR
    { id: "i14", date: "2026-04-30", slot: "1:00–1:30pm", profileId: "p2", company: "Figma",
      step: "Recruiter", progress: "Passed", handlerId: "u_efi",
      meeting: "https://figma.zoom.us/j/f1", jd: "https://figma.com/careers/1",
      recording: "https://mega.nz/file/fig1", notes: "Recruiter screen done, waiting for HM slot." },

    // A previous-month interview (April) for filter testing - Stripe original recruiter — already in i4 (May)
    // Add a March one for default-month filter sanity
    { id: "i15", date: "2026-03-14", slot: "10:00–10:30am", profileId: "p1", company: "McKinsey",
      step: "Recruiter", progress: "Failed", handlerId: "u_shane",
      meeting: "https://teams.microsoft.com/old", jd: "https://sharetext.io/old",
      recording: "", notes: "Old recruiter round — failed. This was the first attempt; later resumed under i2." },

    // Future-dated Brex pipeline so users see a fresh upcoming one
    { id: "i16", date: "2026-05-26", slot: "3:00–3:30pm", profileId: "p5", company: "Brex",
      step: "Recruiter", progress: "Waiting", handlerId: "u_mara",
      meeting: "https://brex.zoom.us/j/b1", jd: "https://brex.com/careers/1",
      recording: "", notes: "Recruiter intro — first contact." },

    // TOMORROW (May 29) — to demonstrate the "tomorrow" highlight level
    { id: "i17", date: "2026-05-29", slot: "11:15–12:00pm", profileId: "p2", company: "WeaveGrid",
      step: "Hiring Manager", progress: "Waiting", handlerId: "u_efi",
      meeting: "https://weavegrid.zoom.us/j/wg1", jd: "https://weavegrid.com/jobs/1",
      recording: "", notes: "HM round — prep systems questions." },

    // FUTURE (May 31) — to demonstrate the "upcoming" highlight level
    { id: "i18", date: "2026-05-31", slot: "2:30–3:00pm", profileId: "p4", company: "DriveTime",
      step: "Intro", progress: "Waiting", handlerId: "u_shane",
      meeting: "https://drivetime.zoom.us/j/dt1", jd: "https://drivetime.com/jobs/1",
      recording: "", notes: "Intro call scheduled." },

    // ---- Multiple meetings on the SAME DAY (today, May 28) ----
    { id: "i19", date: "2026-05-28", slot: "8:00–8:30am", profileId: "p2", company: "Plaid",
      step: "Recruiter", progress: "Waiting", handlerId: "u_efi", meetingType: "phone", phone: "+1 (628) 555-0150",
      meeting: "", jd: "https://plaid.com/careers/1", recording: "", notes: "Early recruiter screen." },
    { id: "i20", date: "2026-05-28", slot: "1:00–1:45pm", profileId: "p3", company: "Ramp",
      step: "Tech Screen", progress: "Waiting", handlerId: "u_shane",
      meeting: "https://ramp.zoom.us/j/r1", jd: "https://ramp.com/careers/1",
      recording: "", notes: "Coding screen — arrays/strings expected." },
    { id: "i21", date: "2026-05-28", slot: "4:00–4:30pm", profileId: "p5", company: "Airbnb",
      step: "Hiring Manager", progress: "Waiting", handlerId: "u_efi",
      meeting: "https://airbnb.zoom.us/j/a1", jd: "https://airbnb.com/careers/1",
      recording: "", notes: "HM round with the payments team lead." },
    { id: "i22", date: "2026-05-28", slot: "6:00–6:30pm", profileId: "p4", company: "Robinhood",
      step: "Recruiter", progress: "Waiting", handlerId: "u_mara", meetingType: "phone", phone: "+1 (650) 555-0190",
      meeting: "", jd: "https://robinhood.com/careers/1", recording: "", notes: "After-hours recruiter call." },

    // ---- Multiple on May 29 (tomorrow) ----
    { id: "i23", date: "2026-05-29", slot: "9:00–9:30am", profileId: "p1", company: "Datadog",
      step: "Recruiter", progress: "Waiting", handlerId: "u_shane", meetingType: "phone", phone: "+1 (646) 555-0133",
      meeting: "", jd: "https://datadoghq.com/careers/1", recording: "", notes: "Recruiter intro." },
    { id: "i24", date: "2026-05-29", slot: "3:00–4:00pm", profileId: "p4", company: "Coinbase",
      step: "Live Coding", progress: "Waiting", handlerId: "u_mara",
      meeting: "https://coinbase.zoom.us/j/c1", jd: "https://coinbase.com/careers/1",
      recording: "", notes: "Live coding — concurrency problem likely." },

    // ---- SAME PROFILE (Michael, p1) across the month & week, multiple companies ----
    { id: "i25", date: "2026-05-06", slot: "11:00–11:30am", profileId: "p1", company: "Snowflake",
      step: "Recruiter", progress: "Passed", handlerId: "u_shane",
      meeting: "https://snowflake.zoom.us/j/s1", jd: "https://snowflake.com/careers/1",
      recording: "https://mega.nz/file/snow1", notes: "Recruiter passed Michael to HM." },
    { id: "i26", date: "2026-05-13", slot: "2:00–2:45pm", profileId: "p1", company: "Snowflake",
      step: "Hiring Manager", progress: "Passed", handlerId: "u_shane",
      meeting: "https://snowflake.zoom.us/j/s2", jd: "https://snowflake.com/careers/1",
      recording: "https://mega.nz/file/snow2", notes: "HM strong yes. Tech round next." },
    { id: "i27", date: "2026-05-27", slot: "9:30–10:00am", profileId: "p1", company: "Snowflake",
      step: "Tech Screen", progress: "Waiting", handlerId: "u_shane",
      meeting: "https://snowflake.zoom.us/j/s3", jd: "https://snowflake.com/careers/1",
      recording: "", notes: "Coding screen for Michael." },
    { id: "i28", date: "2026-05-29", slot: "1:00–1:30pm", profileId: "p1", company: "Datadog",
      step: "Recruiter", progress: "Waiting", handlerId: "u_efi", meetingType: "phone", phone: "+1 (646) 555-0188",
      meeting: "", jd: "https://datadoghq.com/careers/2", recording: "", notes: "Second Datadog role for Michael." },
  ],

  // Dev-marked unavailability blocks. start/end are minutes-since-midnight.
  unavail: [
    { id: "ua1", userId: "u_efi",   date: "2026-05-28", start: 720, end: 780,  note: "Lunch" },
    { id: "ua2", userId: "u_efi",   date: "2026-05-28", start: 1020, end: 1140, note: "Doctor appointment" },
    { id: "ua3", userId: "u_shane", date: "2026-05-28", start: 540, end: 570,  note: "Team standup" },
    { id: "ua4", userId: "u_shane", date: "2026-05-29", start: 960, end: 1080, note: "Focus block" },
    { id: "ua5", userId: "u_mara",  date: "2026-05-28", start: 840, end: 900,  note: "1:1" },
  ],

  // Job Apply seed database — each entry is { url, date } where date is the day
  // the link was added (admin) or promoted from a daily list. Dedup for a given
  // day only counts entries dated strictly BEFORE that day.
  seedLinks: [
    { url: "https://jobs.lever.co/beta/aa12-cd34", date: "2026-05-20" },
    { url: "https://linkedin.com/jobs/view/3850001", date: "2026-05-18" },
    { url: "https://boards.greenhouse.io/globex/41001", date: "2026-05-19" },
    { url: "https://jobs.ashbyhq.com/initech/77-88", date: "2026-05-21" },
    { url: "https://linkedin.com/jobs/view/3855222", date: "2026-05-15" },
    { url: "https://jobs.lever.co/umbrella/12-34", date: "2026-05-22" },
    { url: "https://boards.greenhouse.io/soylent/55221", date: "2026-05-17" },
    { url: "https://wellfound.com/jobs/991201-staff-engineer", date: "2026-05-23" },
    { url: "https://jobs.ashbyhq.com/vandelay/33-12", date: "2026-05-16" },
    { url: "https://linkedin.com/jobs/view/3848777", date: "2026-05-14" },
  ],
  jobApply: {
    "2026-05-28": {
      links: [
        "https://linkedin.com/jobs/view/3901001",
        "https://boards.greenhouse.io/acme/jobs/77421",
        "https://jobs.lever.co/beta/aa12-cd34",      // in seed database → "Already applied"
        "https://linkedin.com/jobs/view/3901001",     // in-day duplicate (demo)
        "https://jobs.ashbyhq.com/nimbus/55-66",
      ],
      confirmed: { p1: false, p2: false, p3: false, p4: false, p5: false },
    },
    "2026-05-27": {
      links: [
        "https://linkedin.com/jobs/view/3899100",
        "https://boards.greenhouse.io/delta/88112",
        "https://jobs.lever.co/kappa/45-67",
      ],
      confirmed: { p1: true, p2: true, p3: true, p4: true, p5: true },
      done: true,
    },
    "2026-05-26": {
      links: [
        "https://linkedin.com/jobs/view/3897777",
        "https://jobs.ashbyhq.com/orion/22-33",
      ],
      confirmed: { p1: true, p2: true, p3: true, p4: false, p5: false },
    },
    "2026-05-25": {
      links: ["https://jobs.lever.co/zeta/99-00"],
      confirmed: { p1: true, p2: false, p3: false, p4: false, p5: false },
    },
  },

  // ---- Payments ----
  // Financial accounts: type (Relay / Unifi / Coinbase) + name. Current balance.
  accounts: [
    { id: "a_relay_dyn",  type: "Relay",    name: "Dynamic", balance: 48250 },
    { id: "a_relay_ops",  type: "Relay",    name: "Ops",     balance: 23110 },
    { id: "a_unifi_chris",type: "Unifi",    name: "Chris",   balance: 12740 },
    { id: "a_coinbase",   type: "Coinbase", name: "Main",    balance: 8320 },
  ],
  // Transactions: ts (ISO datetime, treated as ET), kind ("in" | "out"),
  // purpose, amount. For "out": fromAccountId (our account) → to (person/vendor).
  // For "in": from (payer) → toAccountId (our account).
  transactions: [
    { id: "t1",  ts: "2026-06-18T14:00", kind: "out", fromAccountId: "a_relay_dyn",   to: "Juan",        purpose: "Monthly laptop fee",        amount: 250 },
    { id: "t2",  ts: "2026-06-17T10:30", kind: "out", fromAccountId: "a_unifi_chris", to: "Shane",       purpose: "Interview handling payout", amount: 1200 },
    { id: "ti1", ts: "2026-06-17T09:00", kind: "in",  from: "McKinsey",  toAccountId: "a_relay_dyn",   purpose: "Client salary deposit",     amount: 14000 },
    { id: "t3",  ts: "2026-06-16T16:15", kind: "out", fromAccountId: "a_relay_ops",   to: "AWS",         purpose: "Cloud hosting",             amount: 480 },
    { id: "ti2", ts: "2026-06-15T11:00", kind: "in",  from: "Stripe",    toAccountId: "a_unifi_chris", purpose: "Client salary deposit",     amount: 16500 },
    { id: "t4",  ts: "2026-06-15T09:00", kind: "out", fromAccountId: "a_coinbase",    to: "Efi",         purpose: "Dev coding payout",         amount: 2200 },
    { id: "t5",  ts: "2026-06-12T13:45", kind: "out", fromAccountId: "a_relay_dyn",   to: "LinkedIn",    purpose: "Recruiter seat",            amount: 99 },
    { id: "t6",  ts: "2026-06-11T11:20", kind: "out", fromAccountId: "a_unifi_chris", to: "Mara",        purpose: "Caller payout",             amount: 850 },
    { id: "ti3", ts: "2026-06-10T10:15", kind: "in",  from: "Discord",   toAccountId: "a_relay_ops",   purpose: "Client salary deposit",     amount: 15500 },
    { id: "t7",  ts: "2026-06-09T15:30", kind: "out", fromAccountId: "a_relay_ops",   to: "Notion",      purpose: "Team subscription",         amount: 160 },
    { id: "t8",  ts: "2026-06-05T10:00", kind: "out", fromAccountId: "a_relay_dyn",   to: "Juan",        purpose: "Equipment reimbursement",   amount: 540 },
    { id: "ti4", ts: "2026-06-04T14:30", kind: "in",  from: "Notion",    toAccountId: "a_coinbase",    purpose: "Client salary deposit",     amount: 13000 },
    { id: "t9",  ts: "2026-06-03T17:00", kind: "out", fromAccountId: "a_coinbase",    to: "Shane",       purpose: "Bonus payout",              amount: 700 },
    { id: "t10", ts: "2026-06-02T08:45", kind: "out", fromAccountId: "a_unifi_chris", to: "Zoom",        purpose: "Annual plan",               amount: 320 },
    // May
    { id: "ti5", ts: "2026-05-30T10:00", kind: "in",  from: "McKinsey",  toAccountId: "a_relay_dyn",   purpose: "Client salary deposit",     amount: 14000 },
    { id: "t11", ts: "2026-05-28T14:20", kind: "out", fromAccountId: "a_relay_dyn",   to: "Efi",         purpose: "Dev coding payout",         amount: 2000 },
    { id: "t12", ts: "2026-05-24T12:00", kind: "out", fromAccountId: "a_relay_ops",   to: "AWS",         purpose: "Cloud hosting",             amount: 455 },
    { id: "t13", ts: "2026-05-20T09:30", kind: "out", fromAccountId: "a_unifi_chris", to: "Mara",        purpose: "Caller payout",             amount: 900 },
    { id: "ti6", ts: "2026-05-16T11:30", kind: "in",  from: "Stripe",    toAccountId: "a_unifi_chris", purpose: "Client salary deposit",     amount: 16500 },
    { id: "t14", ts: "2026-05-15T16:00", kind: "out", fromAccountId: "a_coinbase",    to: "Juan",        purpose: "Monthly laptop fee",        amount: 250 },
    { id: "t15", ts: "2026-05-08T11:10", kind: "out", fromAccountId: "a_relay_dyn",   to: "LinkedIn",    purpose: "Recruiter seat",            amount: 99 },
  ],
};

// ---------- Persistence ----------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // forward-compat: ensure all top-level keys are present
      return { ...SEED, ...parsed };
    }
  } catch (e) { /* fall through to seed */ }
  return JSON.parse(JSON.stringify(SEED));
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

function resetState() {
  localStorage.removeItem(STORAGE_KEY);
  return JSON.parse(JSON.stringify(SEED));
}

// ---------- Derived helpers ----------
function stepIndex(state, stepName) {
  const i = state.steps.indexOf(stepName);
  return i === -1 ? 999 : i;
}

// Returns { live: bool, latestInterview, passedCount, allCompanyInterviews }
// for a given company name across a list of interviews.
function pipelineForCompany(state, interviews, company) {
  const list = interviews.filter(it => it.company === company);
  const live = list.every(it => it.progress !== "Failed");
  // Sort by step order then by date so "latest" reflects pipeline progress
  const sorted = [...list].sort((a, b) => {
    const da = stepIndex(state, a.step), db = stepIndex(state, b.step);
    if (da !== db) return da - db;
    return a.date.localeCompare(b.date);
  });
  const latestInterview = sorted[sorted.length - 1];
  const passedCount = list.filter(it => it.progress === "Passed").length;
  return { live, latestInterview, passedCount, total: list.length, all: sorted };
}

function userById(state, id) { return state.users.find(u => u.id === id); }
function profileById(state, id) { return state.profiles.find(p => p.id === id); }
function colorForHandler(state, id) {
  if (!id) return 0;
  const handlers = state.users.filter(u => u.roles.includes("dev") || u.roles.includes("admin"));
  const idx = handlers.findIndex(u => u.id === id);
  return ((idx >= 0 ? idx : 0) % 7);
}

function initials(name) {
  if (!name) return "?";
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(s => s[0].toUpperCase()).join("");
}

function formatMoney(n) {
  if (n == null || isNaN(n)) return "$0";
  return "$" + n.toLocaleString("en-US");
}

function formatMoneyShort(n) {
  if (n >= 1000) return "$" + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "K";
  return "$" + n;
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function monthKey(iso) {
  if (!iso) return "";
  return iso.slice(0, 7); // YYYY-MM
}

function monthLabel(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

// Pinned demo "today". The seed data lives around May 2026, so we pin the
// reference date to keep highlighting meaningful in the demo.
const TODAY_ISO = "2026-05-28";

function todayISO() { return TODAY_ISO; }

function currentMonthKey() {
  return TODAY_ISO.slice(0, 7);
}

// Classify an interview date relative to "today":
//   "past" | "today" | "tomorrow" | "future"
function dateBucket(iso) {
  if (!iso) return "past";
  const a = new Date(iso + "T00:00:00");
  const t = new Date(TODAY_ISO + "T00:00:00");
  const diffDays = Math.round((a - t) / 86400000);
  if (diffDays < 0) return "past";
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  return "future";
}

// Whole days elapsed since an interview date (0 = today, negative = future).
function daysSince(iso) {
  if (!iso) return 0;
  const a = new Date(iso + "T00:00:00");
  const t = new Date(TODAY_ISO + "T00:00:00");
  return Math.round((t - a) / 86400000);
}

const FOLLOWUP_DAYS = 7;

// An interview needs a follow-up if it's still "Waiting" for a response
// and FOLLOWUP_DAYS or more have elapsed since it happened.
function needsFollowUp(it) {
  return it.progress === "Waiting" && daysSince(it.date) >= FOLLOWUP_DAYS;
}

function uniqueMonths(interviews) {
  const set = new Set(interviews.map(it => monthKey(it.date)).filter(Boolean));
  return [...set].sort().reverse();
}

function genId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 8);
}

// ---- Payments helpers ----
function accountById(state, id) { return (state.accounts || []).find(a => a.id === id); }
function accountLabel(acc) { return acc ? `${acc.type} ${acc.name}` : "—"; }

// "2026-06-18T14:00" → "Jun 18, 2:00pm" (times are ET; noted in the column header)
function formatDateTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d)) return ts;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  let h = d.getHours();
  const min = String(d.getMinutes()).padStart(2, "0");
  const mer = h < 12 ? "am" : "pm";
  h = ((h + 11) % 12) + 1;
  return `${date}, ${h}:${min}${mer}`;
}

// minutes-since-midnight <-> "HH:MM" (for <input type=time>)
function minToTimeInput(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function timeInputToMin(str) {
  if (!str) return 0;
  const [h, m] = str.split(":").map(Number);
  return h * 60 + (m || 0);
}
// minutes -> "8:30 AM"
function minToLabel(min) {
  let h = Math.floor(min / 60), m = min % 60;
  const mer = h < 12 ? "AM" : "PM";
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, "0")} ${mer}`;
}

// ---- Job Apply helpers ----
// Normalize a link for comparison (trim, lowercase, drop protocol + www + trailing slash).
function normLink(u) {
  return (u || "").trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

// Analyze a day's links against prior days. Returns per-index status:
//   "ok" | "dup" (repeated within the day) | "prior" (already applied earlier)
// `priorNorms` is a Set of normalized links from OTHER days.
function analyzeLinks(links, priorNorms) {
  const seen = {};
  return links.map((raw) => {
    const n = normLink(raw);
    seen[n] = (seen[n] || 0) + 1;
    if (priorNorms && priorNorms.has(n)) return "prior";
    if (seen[n] > 1) return "dup";
    return "ok";
  });
}

// Build a Set of normalized links from every day EXCEPT `exceptDate`.
function priorLinkSet(jobApply, exceptDate) {
  const set = new Set();
  for (const d in (jobApply || {})) {
    if (d === exceptDate) continue;
    for (const l of (jobApply[d].links || [])) set.add(normLink(l));
  }
  return set;
}

// Normalized set of seed-database urls. If `beforeDate` is given, only include
// entries dated strictly before it (so same-day promotions don't self-flag).
// Tolerates legacy string entries (treated as dateless / always-prior).
function dbSet(seedLinks, beforeDate) {
  const set = new Set();
  for (const e of (seedLinks || [])) {
    const url = typeof e === "string" ? e : e.url;
    const date = typeof e === "string" ? "0000-00-00" : (e.date || "0000-00-00");
    if (beforeDate && !(date < beforeDate)) continue;
    set.add(normLink(url));
  }
  return set;
}

// Unique day-links not present anywhere in the database (any date).
function missingFromDb(links, seedLinks) {
  const have = dbSet(seedLinks);
  const seen = new Set();
  const missing = [];
  for (const l of (links || [])) {
    const n = normLink(l);
    if (have.has(n) || seen.has(n)) continue;
    seen.add(n);
    missing.push(l);
  }
  return missing;
}

// Parse the START time of a slot string ("8:00–8:30am", "1:00–1:45pm",
// "11:00–12:00pm") into minutes-since-midnight, for chronological sorting.
// The meridiem usually sits at the end of the slot; the start time inherits it
// unless it carries its own. Corrects noon-crossing (e.g. "11:00–12:00pm" → 11am).
function parseSlotMinutes(slot) {
  if (!slot) return 0;
  const s = slot.toLowerCase();
  const trailing = (s.match(/(am|pm)\s*$/) || [])[1] || null;
  const own = (s.match(/^\s*\d{1,2}:\d{2}\s*(am|pm)/) || [])[1] || null;
  const mer = own || trailing;
  const times = [...s.matchAll(/(\d{1,2}):(\d{2})/g)];
  if (times.length === 0) return 0;
  const toMin = (h, m) => {
    if (mer === "pm" && h !== 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return h * 60 + m;
  };
  let start = toMin(parseInt(times[0][1]), parseInt(times[0][2]));
  // If a start with inherited meridiem lands after its end time, the start is
  // really in the earlier half (handles the 11am–12pm style range).
  if (!own && times.length >= 2) {
    const end = toMin(parseInt(times[1][1]), parseInt(times[1][2]));
    if (start > end) start -= 720;
  }
  return start;
}

// Parse both start and end of a slot into minutes-since-midnight.
// End inherits the trailing meridiem; falls back to start + 30min.
function parseSlotRange(slot) {
  const start = parseSlotMinutes(slot);
  if (!slot) return { start: 0, end: 30 };
  const s = slot.toLowerCase();
  const times = [...s.matchAll(/(\d{1,2}):(\d{2})/g)];
  const trailing = (s.match(/(am|pm)\s*$/) || [])[1] || null;
  let end;
  if (times.length >= 2) {
    let h = parseInt(times[1][1]), m = parseInt(times[1][2]);
    if (trailing === "pm" && h !== 12) h += 12;
    if (trailing === "am" && h === 12) h = 0;
    end = h * 60 + m;
  } else {
    end = start + 30;
  }
  if (end <= start) end = start + 30;
  return { start, end };
}

// Pack a day's interviews into side-by-side lanes for overlap layout.
// Returns [{ it, start, end, lane, lanes }] where lanes = columns in its group.
function packDayEvents(items) {
  const evs = items
    .map(it => ({ it, ...parseSlotRange(it.slot) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const out = [];
  let group = [];
  let groupEnd = -1;
  const flush = () => {
    const laneEnds = [];
    for (const e of group) {
      let placed = false;
      for (let i = 0; i < laneEnds.length; i++) {
        if (laneEnds[i] <= e.start) { e.lane = i; laneEnds[i] = e.end; placed = true; break; }
      }
      if (!placed) { e.lane = laneEnds.length; laneEnds.push(e.end); }
    }
    const total = laneEnds.length;
    for (const e of group) { e.lanes = total; out.push(e); }
    group = [];
  };
  for (const e of evs) {
    if (group.length && e.start >= groupEnd) { flush(); groupEnd = -1; }
    group.push(e);
    groupEnd = Math.max(groupEnd, e.end);
  }
  flush();
  return out;
}

// Build a 6-row month grid (array of weeks, each 7 day-cells) for a YYYY-MM key.
// Each cell: { iso, day, inMonth }. Weeks start on Sunday.
function buildMonthGrid(mKey) {
  const [y, m] = mKey.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const startDow = first.getDay(); // 0 = Sun
  const gridStart = new Date(y, m - 1, 1 - startDow);
  const weeks = [];
  let cursor = new Date(gridStart);
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const iso = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
      week.push({ iso, day: cursor.getDate(), inMonth: cursor.getMonth() === m - 1 });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

// Add/subtract whole months from a YYYY-MM key.
function shiftMonth(mKey, delta) {
  const [y, m] = mKey.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ---- Day / Week helpers (anchor = YYYY-MM-DD) ----
function isoOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function shiftDays(iso, n) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return isoOf(d);
}
// Sunday-start week containing iso.
function startOfWeek(iso) {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - d.getDay());
  return isoOf(d);
}
function weekDays(iso) {
  const start = startOfWeek(iso);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start + "T00:00:00");
    d.setDate(d.getDate() + i);
    return { iso: isoOf(d), day: d.getDate(),
             dow: d.toLocaleDateString("en-US", { weekday: "short" }),
             inMonth: true };
  });
}
function weekRangeLabel(iso) {
  const days = weekDays(iso);
  const a = new Date(days[0].iso + "T00:00:00");
  const b = new Date(days[6].iso + "T00:00:00");
  const sameMonth = a.getMonth() === b.getMonth();
  const aStr = a.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const bStr = b.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${aStr} – ${bStr}, ${b.getFullYear()}`;
}
function dayLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// Expose globally for other Babel scripts
Object.assign(window, {
  loadState, saveState, resetState,
  pipelineForCompany, stepIndex,
  userById, profileById, colorForHandler, initials,
  formatMoney, formatMoneyShort, formatDate,
  monthKey, monthLabel, currentMonthKey, uniqueMonths,
  todayISO, dateBucket, daysSince, needsFollowUp, FOLLOWUP_DAYS,
  buildMonthGrid, shiftMonth,
  isoOf, shiftDays, startOfWeek, weekDays, weekRangeLabel, dayLabel,
  parseSlotMinutes, parseSlotRange, packDayEvents,
  minToTimeInput, timeInputToMin, minToLabel,
  normLink, analyzeLinks, priorLinkSet, dbSet, missingFromDb,
  accountById, accountLabel, formatDateTime,
  genId,
});
