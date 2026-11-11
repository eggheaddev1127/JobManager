import { db } from './db.js';
// Thin typed accessor over the key/value `settings` table (also used by the
// Jobs and Payments page-password features). Used here for the Claude API key
// and the global resume-tailoring prompt.
export function getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
}
export function setSetting(key, value) {
    db.prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(key, value);
}
export const SETTINGS_KEYS = {
    claudeApiKey: 'claude_api_key',
    resumePrompt: 'resume_tailoring_prompt',
};
// A sensible starting prompt so the feature works before the user customizes it.
export const DEFAULT_RESUME_PROMPT = `You are an expert resume writer. Given a candidate's master resume and a specific job description, produce a tailored resume for that job.

Rules:
- Only use real experience, skills, and facts from the master resume. Never invent employers, titles, dates, or credentials.
- Reorder and reword bullet points to emphasize the experience most relevant to the job description.
- Mirror important keywords and technologies from the job description where the candidate genuinely has them.
- Keep it concise and professional — ideally one page.
- Preserve the candidate's real contact information from the master resume.

Output the tailored resume as clean Markdown with clear section headings (e.g. # Name, ## Experience, ## Skills). Do not include any commentary before or after the resume.`;
