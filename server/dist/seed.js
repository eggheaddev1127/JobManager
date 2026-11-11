import bcrypt from 'bcryptjs';
import { db, tx } from './db.js';
const profileSeeds = [
    { no: 1, name: 'Michael Godfrey' },
    { no: 2, name: 'Chris Lewis' },
    { no: 3, name: 'Chris Schwab' },
];
const jobSeeds = [
    {
        profile_name: 'Chris Schwab',
        company_name: 'Per4mer',
        role_title: 'Engineer',
        source: 'Agency',
        salary_monthly: 8000,
        caller_payout: 800,
        dev_payout: 5600,
        status: 'active',
        started_on: '2026-05-12',
        notes: 'Weekly updates',
    },
];
const interviewSeeds = [
    { date: '2026-05-04', meeting_slot: '9-9.30am', country: 'US', profile_name: 'Michael Godfrey', company_name: 'McKinsey', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ZjZjNTRkYTctMzlkMS00ZTIzLTk1MTUtNzkwN2I2NDBjMDY2%40thread.v2/0?context=%7b%22Tid%22%3a%222ef625bc-21d7-4d0a-9680-c38b62143eb9%22%2c%22Oid%22%3a%223c14e811-2f86-43bb-b53f-3cea1f8ff553%22%7d', jd_url: 'https://sharetext.io/jhx7yul1', recording_url: 'https://mega.nz/file/rCx2RIyD#TwcWhHErY3xIe4UlpJTWWbI9YzYXXGOepHscNylNfJ8', notes: 'Meeting went very well, his feedback was good, I think we should pass, but let’s wait for HR response' },
    { date: '2026-05-04', meeting_slot: '10.30-10.55am', country: 'US', profile_name: 'Chris Lewis', company_name: 'PageDNA', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://us06web.zoom.us/j/89876391041?pwd=TH0biugyAtSBYznWdCBu8soKEi9MAS.1&jst=2', jd_url: 'https://sharetext.io/ljgb0o06', recording_url: 'https://mega.nz/file/Kah32C6A#t2EWx-vP-i-CWB0AF7oEzOYg4l3ehsUVzLLTVO77U10', notes: 'meeting went very nicely, as for right now they are doing these intro calls with all the applicants, so we should wait for their feedback when they have made a decision on which to move forward' },
    { date: '2026-05-04', meeting_slot: '12.30-1pm', country: 'US', profile_name: 'Michael Godfrey', company_name: 'Life360', step: 'Hiring Manager', progress: 'Passed', meeting_url: 'https://life360.zoom.us/j/98609575960?pwd=a0Yf5UGg445u5o8LAWtkuvigia3AdP.1&jst=2', jd_url: 'https://sharetext.io/zsqs9p1d', recording_url: 'https://mega.nz/file/7bY1WBTR#cCmypBZziafzs2AzAjjWrsyfa1VWlGwcxGGdKQpr8r0', notes: 'meeting was very nice, mostly background check questions, as for now we should wait for their HR feedback' },
    { date: '2026-05-06', meeting_slot: '11.45-12pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Meet w/ Hermine', step: 'Intro', progress: 'Passed', meeting_url: 'https://goodwinrecruiting.zoom.us/j/99880567406?from=addon', jd_url: 'https://sharetext.io/k7gb6l1z', recording_url: 'https://mega.nz/file/GbR1XRqT#01FDL8DTTGHgikSuFgrDIPLCBMkcsjs2Bzia3bJxDz0', notes: 'finished the call, it was really a quick check, now she will move forward our application to the client, so we have to wait for their decision' },
    { date: '2026-05-06', meeting_slot: '12-12.15pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Meet w/ Trevor', step: 'Hiring Manager', progress: 'Passed', meeting_url: 'https://meet.google.com/suu-yvdm-smv', jd_url: 'https://sharetext.io/ags5ahp3', recording_url: 'https://mega.nz/file/OGZDSYQC#a-C5yi0WGcKRBm8mHXRN20DZRmxCmwAUy5kGwDumcYc', notes: 'as for the last call we passed, seems like the client will accept remote only for exceptional fits, so let\'s go for it' },
    { date: '2026-05-06', meeting_slot: '2-2.45pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'ButterflyMX', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://meet.google.com/ggz-eqmn-qsy', jd_url: 'https://sharetext.io/yf76ghv8', recording_url: 'No recording', notes: 'Handled by shane' },
    { date: '2026-05-06', meeting_slot: '4-4.30pm', country: 'US', profile_name: 'Michael Godfrey', company_name: 'Icon Health', step: 'Intro', progress: 'Passed', meeting_url: 'https://meet.google.com/ppd-vzgk-rai', jd_url: 'https://iconhealth.applytojob.com/apply/ISBIaIJowt/Full-Stack-Engineer', recording_url: 'https://mega.nz/file/efZEUDTR#vDQhlP0dNJXPM602xseoNX5m6WpeYt-Lyb--C0HlNMo', notes: 'we passed, he will move forward our application, next call will be a technical call, and after that a final one with head of product' },
    { date: '2026-05-07', meeting_slot: '12-12.15pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Cencora', step: 'Intro', progress: 'Waiting...', meeting_url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_YjQzNmJmMWYtNTMyZS00NzM0LTk1OWQtZDI3ZjdkYTJlOTli%40thread.v2/0?context=%7b%22Tid%22%3a%220b5ac31e-e17a-4021-9d04-550f86320765%22%2c%22Oid%22%3a%2201298e48-b423-485b-bfa8-dc4c158736ef%22%7d', jd_url: 'https://sharetext.io/o17kl0u7', recording_url: 'https://mega.nz/file/rOJSwIzb#HAC4zhBGNbwLll3r--VdssFU5JTQQpd7HAZ6h-1rN1E', notes: 'just finished the 12 pm call, as for it, it went all good, we passed the screening call, now we should wait for the client decision, you should receive the next step from them' },
    { date: '2026-05-08', meeting_slot: '1-1.30pm', country: 'US', profile_name: 'Michael Godfrey', company_name: 'Icon Health', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://meet.google.com/vfv-jqeb-yac', jd_url: 'https://iconhealth.applytojob.com/apply/ISBIaIJowt/Full-Stack-Engineer', recording_url: 'https://mega.nz/file/jPITxTZb#_mQmYsRT04d49qTzVsenb8-M5jcYXxovl5rAc_aEfrs', notes: 'he will move forward with the HR team for next steps' },
    { date: '2026-05-12', meeting_slot: '10.30-11am', country: 'US', profile_name: 'Michael Godfrey', company_name: 'Icon Health', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://meet.google.com/phr-cpyc-woc', jd_url: 'https://iconhealth.applytojob.com/apply/ISBIaIJowt/Full-Stack-Engineer', recording_url: 'https://mega.nz/file/CeYhwC6T#Y3CICviCOF2bAqW2dXYF-YFX-0Of8TWxtr6HOTsSWvQ', notes: 'it went very nice, he seemed to have like very much our conversation, as for now we should wait for the next steps, he didn\'t say them but said he will be in contact by tomorrow with them' },
    { date: '2026-05-12', meeting_slot: '12.45-1.15pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Meet w/ Hermine', step: 'Intro', progress: 'Passed', meeting_url: 'https://goodwinrecruiting.zoom.us/j/96877084350?from=addon', jd_url: 'https://sharetext.io/izru1z3c', recording_url: 'https://mega.nz/file/mXoQTIbJ#hJN40YT4-t5ht4VeaiRv8mY97acH55lFslcBKpVHfe8', notes: 'Prep Call with Good Win Recruiting Recruiter' },
    { date: '2026-05-12', meeting_slot: '3.30-3.45pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Per4mer', step: 'Job', progress: 'Passed', meeting_url: 'https://meet.google.com/ydb-soyj-icq', jd_url: 'no jd yet', recording_url: 'https://mega.nz/file/fD5xWL5J#QyxAaI9EFuKwPxWsglm_vLV72YRLRVnyII7-e6zlvko', notes: 'Weekly updates' },
    { date: '2026-05-13', meeting_slot: '11.30-12pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Paperless Post', step: 'Intro', progress: 'Failed', meeting_url: 'https://meet.google.com/zne-royb-pwg', jd_url: 'https://job-boards.greenhouse.io/paperlesspost/jobs/7438623', recording_url: 'https://mega.nz/file/KXY2zJLL#iSkpT45nuU5qEONd2pxHyTgWtILNFQGZLBhzkiA2Y6o', notes: 'this call went very well, as for now their team will review our application, if decided to move forward they will want to schedule a 60 min live coding call' },
    { date: '2026-05-14', meeting_slot: '2.30-3pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'HiDO Health', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://calendly.com/events/47fd5304-5796-4216-8550-308ab39d6a98/google_meet', jd_url: 'https://www.linkedin.com/jobs/view/mid-to-senior-full-stack-engineer-at-hidohealth-4406213752', recording_url: 'https://mega.nz/file/ieAGWbxL#zh2rG5fGWt8OFYlwqAwQ1z_VcX3-c_k6o-Ii2bmwS2w', notes: 'meeting finished, sadly they require on site for a few days once a quarter, that\'s why they prefer local people for this role, because of this i said that would not be able to handle in the next few months, but could do it after these months, doesn\'t seemed to be a deal breaker for him, the meeting went very well, lets see what could be his decision' },
    { date: '2026-05-15', meeting_slot: '12:30-1pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'Goodwinrecruiting', step: 'Intro', progress: 'Passed', meeting_url: 'https://goodwinrecruiting.zoom.us/j/96147886355?from=addon', jd_url: 'https://sharetext.io/d7uit8ag', recording_url: 'https://mega.nz/file/iLZQkRga#yrOuK8wFKVur7RrHpVT8MmqEaYiHnjHeDp3hCFB_JaM', notes: 'meeting went well, she got a little bit confused with the recoding feature she needed to use so she ended the meeting before saying the next steps, but she said that will be in contact to tell us what they will be' },
    { date: '2026-05-15', meeting_slot: '2-2.30pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Cotiviti', step: 'Intro', progress: 'Passed', meeting_url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_OTEzYjM5YzEtOTUzOC00ZTNhLThhMmMtYmY5YTdjOGI5Yjc4%40thread.v2/0?context=%7b%22Tid%22%3a%227680316a-5e9e-4cc5-a52e-9ee89ee8c404%22%2c%22Oid%22%3a%2226d35f21-f26d-4fa8-9114-e2e0ed7bd5df%22%7d', jd_url: 'https://careers-cotiviti.icims.com/jobs/19052/software-engineer/job', recording_url: 'https://mega.nz/file/CCQVkKII#dcop45NbV53nIAIQrjH8A-yycG-Xkqic3ogNkVnEdzk', notes: 'as for last call the next steps was already scheduled for next week' },
    { date: '2026-05-15', meeting_slot: '3-3.15pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Synthetic', step: 'Intro', progress: 'Failed', meeting_url: 'https://meet.google.com/ifv-yhdr-saa', jd_url: 'https://jobs.ashbyhq.com/synthetic/75c6a73a-7dbb-4566-9338-047c76160d7c', recording_url: 'https://mega.nz/file/nbB1iaDL#fsP19KNymZBrHWXtatXUI3z9WklS1nLk2MmQFoitVVo', notes: 'Five more steps: Screen with Ian (CEO); Live coding with Daniel (90 min); System design with Matayush (90 min); Final culture chat with Ian' },
    { date: '2026-05-18', meeting_slot: '1.30-1.50pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'Procore', step: 'Intro', progress: 'Passed', meeting_url: 'https://procore.zoom.us/j/6955052484', jd_url: 'https://sharetext.io/8r4m76ul', recording_url: 'https://mega.nz/file/HXYGybwC#Nivs0gIzSbetBxCNlBEfaUiAYxAYEA5OsDm3bc1BGbE', notes: 'Procore next steps: recruiter feedback by EOD tomorrow; 1-on-1 with Director; live technical interview (RoR + REST); final with hiring manager' },
    { date: '2026-05-18', meeting_slot: '3-3.45pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Headway', step: 'Intro', progress: 'Passed', meeting_url: 'https://us02web.zoom.us/j/84968629608?pwd=m2bZSqaYoagutJbR5peAs82MgAE2ZW.1', jd_url: 'https://job-boards.greenhouse.io/headway/jobs/5308863004', recording_url: 'https://mega.nz/file/6GBXXTgQ#YRzPl7HPAxZ0IZ45caMATW8nxlIaPIUa-nOJ0SxW13o', notes: 'Pair programming round, open repo, build feature; have Cursor + Claude ready' },
    { date: '2026-05-18', meeting_slot: '5.30-6pm', country: 'US', profile_name: 'Michael Godfrey', company_name: 'Urrly', step: 'Intro', progress: 'Failed', meeting_url: 'https://us06web.zoom.us/j/84929824651', jd_url: 'https://urrly.breezy.hr/p/cb0fce88e0d4-founding-technical-lead-defense-systems', recording_url: 'https://mega.nz/file/OegmkLxL#jiSLXCss94ZLzGFLVK0QD6LTac3sHhCLSfqrMvQOY_Q', notes: 'meeting did not got very well, hard required FEDRAMP experience' },
    { date: '2026-05-19', meeting_slot: '12.15-12.35pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'Fixify', step: 'Intro', progress: 'Passed', meeting_url: 'https://fixify.zoom.us/j/85626664470?pwd=XZb0sDMYF1QTHfUJEchnSvIo6txyrg.1', jd_url: 'https://job-boards.greenhouse.io/fixify/jobs/5215746008', recording_url: 'https://mega.nz/file/3SZlCAqb#j5p1UJ0pNTxItp-RlrgvVMdhbvaHWMwaCKkQQ-Yajyk', notes: 'Passed!' },
    { date: '2026-05-19', meeting_slot: '1-1.30pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'Procore', step: 'Hiring Manager', progress: 'Passed', meeting_url: 'https://procore.zoom.us/j/98649279047?pwd=2QiVcV1vS7l8agQ95yGigRRgsjGe85.1&jst=3', jd_url: 'https://sharetext.io/8r4m76ul', recording_url: 'https://mega.nz/file/uGYAiB6Q#oJK_ZJ-9-49fxRQkftXAf25fLyute2uwPfEKdHErlrI', notes: 'Passed!' },
    { date: '2026-05-19', meeting_slot: '4.30-5pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'Swoop', step: 'Intro', progress: 'Waiting...', meeting_url: 'https://candidatelabs.zoom.us/j/87526503815', jd_url: 'https://sharetext.io/12sh45y4', recording_url: 'https://mega.nz/file/ubQ3WJ5D#pVNylD1Vs2JA38HAm1osgAtxlTwwR2wAxtjru918pIY', notes: 'call finished, it went all good, more calls, no live coding required, only technical assessment' },
    { date: '2026-05-20', meeting_slot: '10.30-11am', country: 'US', profile_name: 'Chris Schwab', company_name: 'Beam Benefits', step: 'Intro', progress: 'Passed', meeting_url: 'https://meet.google.com/nes-yazj-rts', jd_url: 'https://ats.rippling.com/beam-benefits/jobs/7a75d894-640f-44f3-9631-c1beea3a472e', recording_url: 'https://mega.nz/file/jGYShZzI#bUoHhQeDnyitJ6pD85WxJMt7rti54S8UH1SqmXJ4zC8', notes: 'Passed!' },
    { date: '2026-05-20', meeting_slot: '2-2.30pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'Mon Ami', step: 'Intro', progress: 'Waiting...', meeting_url: 'https://us06web.zoom.us/j/81141674707?pwd=JKfKkHuh8XHVYMI7F8WwVbM6kya4Ih.1', jd_url: 'https://sharetext.io/4k4yu9lw', recording_url: 'https://mega.nz/file/HHJkjThJ#mOk5Z3tpU4zsmjPb197R8Lj7A4akwwIHiDR7BQmsVS8', notes: 'Passed!' },
    { date: '2026-05-20', meeting_slot: '3-3.45pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Cotiviti', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_OTU5ZjZiOTMtZDA5NS00Y2ExLWFhMzgtODBiMmRjNmE4ZjVl%40thread.v2/0', jd_url: 'https://careers-cotiviti.icims.com/jobs/19052/software-engineer/job', recording_url: 'https://mega.nz/file/fSQy0I5Q#pFx2sBfByAjjbTe1VwESXH9_xUthfaUJ31GBIzNGmmU', notes: 'long conversation, next is technical call, possibly whiteboarding' },
    { date: '2026-05-20', meeting_slot: '4-4.15pm', country: 'US', profile_name: 'Michael Godfrey', company_name: 'Synthetic', step: 'Intro', progress: 'Failed', meeting_url: 'https://meet.google.com/gdw-jrhh-dff', jd_url: 'https://jobs.ashbyhq.com/synthetic/75c6a73a-7dbb-4566-9338-047c76160d7c', recording_url: 'No recording', notes: 'Joined with wrong persona! Call busted!' },
    { date: '2026-05-21', meeting_slot: '1-1.30pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Project Expedition', step: 'Intro', progress: 'Waiting...', meeting_url: 'https://meet.google.com/gns-ihnd-zef', jd_url: 'https://sharetext.io/roz9a26e', recording_url: 'https://mega.nz/file/SbhzmTKD#2ZtmSA2njZqv5gHoizSk5KnCSZOMqrwUuGlOt-RLzKg', notes: 'super quick, interviewer seemed bored' },
    { date: '2026-05-21', meeting_slot: '2-2.30pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'WeaveGrid', step: 'Intro', progress: 'Passed', meeting_url: 'https://weavegrid.zoom.us/j/86207113888?pwd=96DhbZs0FmCyXOkm9l91gv0WlXS2Wb.1', jd_url: 'https://jobs.ashbyhq.com/weave-grid/fe455659-d2b5-4440-8bca-53f0ce513994', recording_url: 'https://mega.nz/file/3PwGWIJT#oSMjd_l26_4HBHxx6Pka1s8c2EUO0Gsabc0y_S3kfOE', notes: 'Recruiter shares notes; HM interview next; then 3 panels (live-coding, system design, collab); final with CEO possible' },
    { date: '2026-05-22', meeting_slot: '10-11am', country: 'US', profile_name: 'Chris Lewis', company_name: 'Fixify', step: 'Hiring Manager', progress: 'Failed', meeting_url: 'https://fixify.zoom.us/j/84668735729?pwd=CFD79k4FbJY67RVq0QEp1D88QEXMCg.1', jd_url: 'https://job-boards.greenhouse.io/fixify/jobs/5217978008', recording_url: 'https://mega.nz/file/iXp3EShB#RM0T1jFay8JH5NGKyqr-0QLP5KRwy3uszupLwPZxzzQ', notes: 'meeting went nice; waiting on hiring team feedback' },
    { date: '2026-05-26', meeting_slot: '10-10.30am', country: 'US', profile_name: 'Michael Godfrey', company_name: 'PlayOn', step: 'Intro', progress: 'Failed', meeting_url: 'https://playonsports.zoom.us/j/93658914458?pwd=cM7Md9kNMZk1dHSnPX1UDUNUD0TjCo.1', jd_url: 'https://jobs.lever.co/playonsports/fff463cb-dd97-4383-b0bf-c2e6b5a6ba55', recording_url: 'No recording', notes: 'Busted!' },
    { date: '2026-05-26', meeting_slot: '11.15-12pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'Ubiquity', step: 'Hiring Manager', progress: 'Waiting...', meeting_url: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_NmZmMGI4YmItNTBhMC00OTRlLTg5Y2QtNTkxYzM1Nzc0ODNh%40thread.v2/0', jd_url: 'https://jobs.lever.co/myubiquity/960e6775-8572-474c-8a84-9a0adc31edb5', recording_url: 'uploading', notes: 'good chat; let\'s hope for good feedback' },
    { date: '2026-05-26', meeting_slot: '3-3.30pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'Teak', step: 'Intro', progress: 'Waiting...', meeting_url: 'https://meet.google.com/pit-zpxu-mci', jd_url: 'https://teak.applytojob.com/apply/zWO2iubF5b/Senior-Backend-Engineer', recording_url: 'uploading', notes: 'Recruiter forwards résumé to Lance Lee; 45-min virtual interview; exercise stage; panel; decision. Update in 24-48h.' },
    { date: '2026-05-28', meeting_slot: '2-2.30pm', country: 'US', profile_name: 'Chris Lewis', company_name: 'AlphaSense', step: 'Intro', progress: 'Not started', meeting_url: 'https://meet.google.com/tir-qwgr-het', jd_url: 'no jd yet', recording_url: '', notes: '' },
    { date: '2026-05-29', meeting_slot: '11.15am-12pm', country: 'US', profile_name: 'Chris Schwab', company_name: 'WeaveGrid', step: 'Hiring Manager', progress: 'Not started', meeting_url: 'https://weavegrid.zoom.us/j/82371207467?pwd=emRE2CfvyILIXOb80X2TBl8xU9wTOi.1', jd_url: 'no jd yet', recording_url: '', notes: '' },
    { date: '', meeting_slot: '', country: 'US', profile_name: 'Chris Lewis', company_name: 'Hallow', step: 'Intro', progress: 'Not started', meeting_url: 'https://hallow.zoom.us/j/82032028505?pwd=btavBVzCtfqps9BNr0tg4eKbKhYbZ7.1', jd_url: 'no jd yet', recording_url: '', notes: '' },
];
export function seedIfEmpty() {
    const { count: profileCount } = db.prepare('SELECT COUNT(*) AS count FROM profiles').get();
    const { count: interviewCount } = db.prepare('SELECT COUNT(*) AS count FROM interviews').get();
    const { count: jobCount } = db.prepare('SELECT COUNT(*) AS count FROM jobs').get();
    // Settings: seed the Running Jobs page password (bcrypt-hashed) if not present.
    const existingJobsPw = db.prepare("SELECT value FROM settings WHERE key = 'jobs_password_hash'").get();
    if (!existingJobsPw) {
        const hash = bcrypt.hashSync('Password718!', 10);
        db.prepare("INSERT INTO settings (key, value) VALUES ('jobs_password_hash', ?)").run(hash);
        console.log("Seeded Running Jobs page password (default 'Password718!') — change it on the Jobs page");
    }
    // Settings: seed the Payments page password (independent from Running Jobs).
    const existingPayPw = db.prepare("SELECT value FROM settings WHERE key = 'payments_password_hash'").get();
    if (!existingPayPw) {
        const hash = bcrypt.hashSync('Password718!', 10);
        db.prepare("INSERT INTO settings (key, value) VALUES ('payments_password_hash', ?)").run(hash);
        console.log("Seeded Payments page password (default 'Password718!') — change it on the Payments page");
    }
    // Seed default users ONLY on a fresh (empty) users table. Once the table has
    // any users, we never re-add seed accounts — otherwise deleting a user (e.g.
    // Philip) would resurrect them on the next restart. db.ts no longer creates
    // Philip during init, so on a brand-new DB this seeds all three.
    const { count: userCount } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
    if (userCount === 0) {
        const insertUser = db.prepare(`
      INSERT INTO users (name, email, password_hash, active, roles)
      VALUES (@name, @email, @password_hash, @active, @roles)
    `);
        const userSeeds = [
            { name: 'Shane', email: 'shanecard926@gmail.com', password: 'admin', active: 1, roles: 'superadmin,dev' },
            { name: 'Philip', email: 'philip@example.com', password: 'philip', active: 1, roles: 'admin' },
            { name: 'Efi', email: 'efi@example.com', password: 'efi', active: 1, roles: 'dev' },
        ];
        tx(() => {
            for (const u of userSeeds) {
                insertUser.run({
                    name: u.name,
                    email: u.email,
                    password_hash: bcrypt.hashSync(u.password, 10),
                    active: u.active,
                    roles: u.roles,
                });
            }
        });
        console.log(`Seeded ${userSeeds.length} users (default passwords — CHANGE THEM)`);
    }
    if (profileCount === 0) {
        const insert = db.prepare(`
      INSERT INTO profiles (no, name, gmail, linkedin_url, full_address, gv, github, race)
      VALUES (@no, @name, @gmail, @linkedin_url, @full_address, @gv, @github, @race)
    `);
        tx(() => {
            for (const r of profileSeeds) {
                insert.run({
                    no: r.no,
                    name: r.name,
                    gmail: r.gmail ?? null,
                    linkedin_url: r.linkedin_url ?? null,
                    full_address: r.full_address ?? null,
                    gv: r.gv ?? null,
                    github: r.github ?? null,
                    race: r.race ?? null,
                });
            }
        });
        console.log(`Seeded ${profileSeeds.length} profiles`);
    }
    if (jobCount === 0) {
        const insert = db.prepare(`
      INSERT INTO jobs (profile_name, company_name, role_title, source, salary_monthly, caller_payout, dev_payout, status, started_on, notes)
      VALUES (@profile_name, @company_name, @role_title, @source, @salary_monthly, @caller_payout, @dev_payout, @status, @started_on, @notes)
    `);
        tx(() => {
            for (const r of jobSeeds)
                insert.run({ ...r, notes: r.notes ?? null });
        });
        console.log(`Seeded ${jobSeeds.length} jobs`);
    }
    if (interviewCount === 0) {
        const insert = db.prepare(`
      INSERT INTO interviews (date, meeting_slot, country, profile_name, company_name, step, progress, meeting_url, jd_url, recording_url, notes)
      VALUES (@date, @meeting_slot, @country, @profile_name, @company_name, @step, @progress, @meeting_url, @jd_url, @recording_url, @notes)
    `);
        tx(() => {
            for (const r of interviewSeeds)
                insert.run(r);
        });
        console.log(`Seeded ${interviewSeeds.length} interviews`);
    }
}
