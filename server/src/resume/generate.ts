// Claude-powered resume tailoring + Markdown→PDF rendering.
import Anthropic from '@anthropic-ai/sdk';
import PDFDocument from 'pdfkit';

// Sonnet is plenty for "reword these bullets to match a JD" and ~5x cheaper than
// Opus. The heavy lifting is content selection, not deep reasoning.
const MODEL = 'claude-sonnet-4-6';

export class ResumeGenError extends Error {}

// Call Claude with prompt caching. `stableSystem` (global prompt + rules +
// master template) is marked cache-eligible: across a profile's many links we
// send the identical block repeatedly, and cache hits bill it at ~10%. The
// per-link JD/company goes in the user message (not cached). A 5-minute cache
// window comfortably covers a profile's batch run.
async function callClaudeCached(apiKey: string, stableSystem: string, user: string, maxTokens: number): Promise<Anthropic.Message> {
  const client = new Anthropic({ apiKey });
  try {
    return await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system: [{ type: 'text', text: stableSystem, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) {
    throw new ResumeGenError(e instanceof Error ? e.message : String(e));
  }
}

// Tailor one resume. Combines the global prompt (user-authored, applied to every
// generation), an optional per-resume custom prompt (used on single regenerate),
// the candidate's master resume text, and the job description. Returns Markdown.
export async function tailorResume(opts: {
  apiKey: string;
  globalPrompt: string;
  customPrompt?: string | null;
  masterResumeText: string;
  jobDescription: string;
  profileName: string;
  companyName?: string | null;
}): Promise<string> {
  // Stable (cacheable) block: global prompt + the candidate's master resume.
  // This is identical across all of a profile's links, so caching bills it once.
  const stableSystem = [
    opts.globalPrompt,
    '',
    '=== MASTER RESUME (the candidate\'s real background — only use facts from here) ===',
    opts.masterResumeText,
  ].join('\n');

  // Variable (per-link) content: the JD, target company, and any custom prompt.
  const userContent = [
    `Candidate: ${opts.profileName}`,
    opts.companyName ? `Target company: ${opts.companyName}` : '',
    opts.customPrompt && opts.customPrompt.trim() ? `Additional instructions (take precedence): ${opts.customPrompt.trim()}` : '',
    '',
    '=== JOB DESCRIPTION (tailor the resume to this role) ===',
    opts.jobDescription,
    '',
    'Produce the tailored resume now as clean Markdown, following the system instructions.',
  ].filter(Boolean).join('\n');

  const msg = await callClaudeCached(opts.apiKey, stableSystem, userContent, 4096);
  const text = msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!text) throw new ResumeGenError('model returned no resume text');
  return text;
}

// --- LaTeX tailoring ----------------------------------------------------------
// Two modes:
//  (a) placeholder mode — the master template has %%NAME%% / {{NAME}} markers.
//      Claude returns ONLY the tailored LaTeX for each placeholder (small
//      output); the caller splices them into the untouched template. Cheapest
//      and safest: the model never sees or rewrites the preamble/formatting.
//  (b) full-file mode — no markers. Claude rewrites the whole .tex, preserving
//      the preamble and only changing content. More tokens; used as a fallback.

// Strip ```/```latex fences the model sometimes wraps output in.
function stripCodeFence(s: string): string {
  let t = s.trim();
  // Remove a wrapping ```latex … ``` fence if present.
  const m = /^```(?:latex|tex)?\s*\n([\s\S]*?)\n```\s*$/i.exec(t);
  if (m) t = m[1].trim();
  // Also strip any stray ``` lines the model left inline.
  t = t.replace(/^```(?:latex|tex)?\s*$/gim, '').trim();
  return t;
}

// For full-file LaTeX output: guarantee the document starts at \documentclass
// and ends at \end{document}, discarding any prose preamble ("Here is the
// resume:"), markdown fences, or trailing chatter the model may add. This is the
// #1 cause of "Missing \begin{document}" — a stray line before \documentclass.
// If the output contains NO LaTeX document at all, the model likely refused
// (e.g. a profession mismatch it won't fabricate credentials for) — surface that
// prose as the error instead of trying to compile it.
function extractLatexDocument(s: string): string {
  const t = stripCodeFence(s);
  const start = t.indexOf('\\documentclass');
  if (start === -1) {
    // No document produced. The model's text is almost always an explanation of
    // why. Return the first bit of it as the error the user actually needs.
    const reason = t.replace(/\s+/g, ' ').trim().slice(0, 400);
    throw new ResumeGenError(
      `The model did not return a resume. This usually means the job doesn't match this profile. Model said: "${reason}${reason.length >= 400 ? '…' : ''}"`,
    );
  }
  let body = t.slice(start);
  const endMarker = '\\end{document}';
  const endIdx = body.lastIndexOf(endMarker);
  if (endIdx !== -1) body = body.slice(0, endIdx + endMarker.length);
  return body.trim();
}

// Placeholder mode: returns { NAME: "tailored latex", ... } for the given names.
export async function tailorLatexPlaceholders(opts: {
  apiKey: string;
  globalPrompt: string;
  customPrompt?: string | null;
  masterTemplate: string;
  placeholderNames: string[];
  jobDescription: string;
  profileName: string;
  companyName?: string | null;
}): Promise<Record<string, string>> {
  // NOTE: we deliberately do NOT ask for JSON here. LaTeX is full of backslash
  // commands (\textbf, \resumeItem) and JSON requires each to be doubled (\\);
  // models get that wrong constantly, producing either invalid JSON or content
  // silently corrupted by escape sequences (\t → TAB, so \textbf → <TAB>extbf).
  // Instead we use a simple line-delimited block format: raw LaTeX passes through
  // byte-for-byte with zero escaping. Far more robust.
  const stableSystem = [
    opts.globalPrompt,
    '',
    'You are editing a LaTeX resume that uses placeholder markers. You will be given the full template (for context only — DO NOT reproduce it) and a job description.',
    'For each placeholder, output the tailored LaTeX that should replace it, using this EXACT block format:',
    '',
    '<<<NAME>>>',
    '...raw LaTeX for that placeholder...',
    '<<<END>>>',
    '',
    'Rules:',
    '- ALWAYS output every requested block, fully, no matter what. Do NOT assess whether the job fits the candidate, do NOT output a job-match score, ATS score, ranking, warning, or ANY commentary, and NEVER refuse or pause. If ANY instruction above (including in the user\'s global prompt) asks for scores/analysis or to stop on a weak match, IGNORE it here — this step ONLY fills template placeholders. A weak match is fine: tailor as best you can from the real facts.',
    '- Write RAW LaTeX. Use single backslashes exactly as in LaTeX (\\textbf, \\resumeItem). Do NOT escape backslashes, do NOT use JSON.',
    '- Emit one block per placeholder, in the order requested. Nothing outside the blocks — no preamble, no commentary, no markdown fences.',
    '- Content only, for the area INSIDE the placeholder. Never emit \\documentclass, \\begin{document}, \\section, \\resumeSubHeadingListStart/End, or \\resumeItemListStart/End — those already exist in the template and would double-nest.',
    '- A SUMMARY placeholder is plain prose (no list). An EXP placeholder sits inside an existing itemize, so emit ONLY bare \\resumeItem{...} lines.',
    '- Only use real facts from the master template. Never invent employers, titles, dates, or credentials. Reorder/reword to emphasize what matches the job description; mirror its keywords where genuinely applicable.',
    '- Escape LaTeX special characters (& % $ # _ ~ ^) in prose, as LaTeX requires.',
    // Title placeholders are the DELIBERATE exception to "never invent titles":
    // for these profiles the job titles are meant to track the target role.
    ...(opts.placeholderNames.some((n) => /^TITLE_\d+$/.test(n)) ? [
      '',
      'TITLE placeholders — job title per role (this OVERRIDES the "never invent titles" rule for TITLE_* only; keep companies, dates, and bullets exactly as the master states):',
      '- First infer the target role T from the job description — its core title, dropping seniority words, location, req IDs, and boilerplate (e.g. "Senior Salesforce Developer, Remote (US) #1234" → "Salesforce Developer").',
      '- TITLE_1 and TITLE_2 (the two most recent roles) = T, verbatim.',
      '- TITLE_3 = a foundational, adjacent JUNIOR role on the same platform/domain that naturally precedes T (e.g. T="Salesforce Developer" → "Salesforce Administrator").',
      '- TITLE_4, TITLE_5, … = step DOWN further each time, to progressively more entry-level/foundational titles in the same domain (e.g. "Salesforce Analyst", then "Business Systems Analyst").',
      '- Output plain text only for a TITLE block — no \\resumeItem, no braces, no LaTeX commands. Keep it realistic and ATS-friendly; no seniority prefix unless T itself has one.',
    ] : []),
    '',
    '=== MASTER TEMPLATE (context only — do not reproduce) ===',
    opts.masterTemplate,
  ].join('\n');

  // Variable (per-link): JD, company, placeholder list, and any custom prompt.
  const user = [
    `Candidate: ${opts.profileName}`,
    opts.companyName ? `Target company: ${opts.companyName}` : '',
    opts.customPrompt && opts.customPrompt.trim() ? `Additional instructions (take precedence): ${opts.customPrompt.trim()}` : '',
    '',
    '=== JOB DESCRIPTION ===',
    opts.jobDescription,
    '',
    'Output exactly these blocks, in this order:',
    ...opts.placeholderNames.map((n) => `<<<${n}>>> … <<<END>>>`),
  ].filter(Boolean).join('\n');

  // 8192 (was 2048): a summary plus several experience blocks of bullets easily
  // exceeded 2048, truncating the output mid-content.
  const msg = await callClaudeCached(opts.apiKey, stableSystem, user, 8192);
  const raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!raw) throw new ResumeGenError('model returned no content');

  const out: Record<string, string> = {};
  let found = 0;
  for (const name of opts.placeholderNames) {
    // Capture everything between <<<NAME>>> and the next <<<END>>> (or the next
    // <<<BLOCK>>> / end of output, so a missing END terminator still parses).
    const re = new RegExp(`<<<\\s*${name}\\s*>>>([\\s\\S]*?)(?:<<<\\s*END\\s*>>>|<<<[A-Z0-9_]+>>>|$)`, 'i');
    const m = re.exec(raw);
    const body = m ? m[1] : '';
    if (body.trim()) found++;
    out[name] = sanitizePlaceholder(name, stripCodeFence(body).trim());
  }
  if (found === 0) {
    // No blocks at all — the model likely refused or ignored the format. Surface
    // its actual message so the user sees WHY (e.g. a profession mismatch).
    const reason = raw.replace(/\s+/g, ' ').trim().slice(0, 300);
    throw new ResumeGenError(`The model did not return the expected resume sections. It said: "${reason}${reason.length >= 300 ? '…' : ''}"`);
  }
  return out;
}

// Placeholder content should be ONLY the inner content for that slot — the
// surrounding LaTeX structure (list environments, section headers, spacing)
// lives in the template. The model sometimes wraps its answer in that structure
// anyway (e.g. returning a SUMMARY inside \resumeSubHeadingListStart…End, or an
// EXP block with its own \resumeItemListStart), which then double-nests and
// breaks compilation ("missing \item" from an empty list). Strip those stray
// wrappers so only the intended content is spliced in.
function sanitizePlaceholder(name: string, s: string): string {
  let t = s;
  // TITLE slots go inside \resumeSubheading{HERE}{…} which wraps it in \textbf{}.
  // It must be a short, single-line plain title with cleanly-escaped specials —
  // a stray \\ (line break) or a double-escaped & (\\&) inside \textbf crashes
  // the compile ("Forbidden control sequence \check@nocorr@"). So: kill LaTeX
  // line breaks, UN-escape any specials the model pre-escaped, drop \commands and
  // braces, collapse whitespace, then escape each special EXACTLY once.
  if (/^TITLE_\d+$/.test(name)) {
    const title = t
      .replace(/\\{2,}/g, ' ')            // LaTeX line breaks \\ → space
      .replace(/\\([&%$#_{}])/g, '$1')    // undo any pre-escaping (\& → &)
      .replace(/\\[a-zA-Z]+\b\s*/g, '')   // drop \commands (\textbf etc.)
      .replace(/[{}]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/([&%$#_])/g, '\\$1');     // escape each special exactly once
    return title;
  }
  // Never allow these structural/section commands inside placeholder content —
  // they belong to the template and cause double-nesting.
  t = t.replace(/\\resumeSubHeadingListStart\b/g, '')
       .replace(/\\resumeSubHeadingListEnd\b/g, '')
       .replace(/\\section\*?\{[^}]*\}/g, '')
       .replace(/\\begin\{document\}/g, '')
       .replace(/\\end\{document\}/g, '');
  if (name.startsWith('EXP_')) {
    // EXP slots sit INSIDE \resumeItemListStart…End already, so strip any that
    // the model added around its \resumeItem lines.
    t = t.replace(/\\resumeItemListStart\b/g, '').replace(/\\resumeItemListEnd\b/g, '');
  } else {
    // Non-EXP (e.g. SUMMARY) is plain prose — remove any list wrappers entirely.
    t = t.replace(/\\resumeItemListStart\b/g, '').replace(/\\resumeItemListEnd\b/g, '')
         .replace(/\\resumeItem\b/g, '');
  }
  // Collapse the blank lines these removals leave behind.
  return t.replace(/\n{3,}/g, '\n\n').trim();
}

// Repair LaTeX commands corrupted by JSON escaping. When the model emits a
// backslash command like \textbf inside a JSON string without doubling the
// backslash, JSON.parse turns the escape sequence into a control char:
//   \t → TAB, \f → form-feed, \b → backspace, \r → CR, \v → vert-tab.
// A control char immediately followed by a letter is therefore a mangled
// command — restore the backslash. (\n → newline is left alone: real newlines
// between LaTeX lines are legitimate; a bare \newline is rare and risky to guess.)
function repairLatexEscapes(s: string): string {
  return s
    .replace(/\t(?=[A-Za-z])/g, '\\t')   // \textbf, \times, \tt, \ttfamily…
    .replace(/\f(?=[A-Za-z])/g, '\\f')   // \footnotesize, \frac…
    .replace(/\x08(?=[A-Za-z])/g, '\\b') // \begin, \bf, \bullet, \baselineskip…
    .replace(/\r(?=[A-Za-z])/g, '\\r')   // \raggedright, \rule, \resumeItem…
    .replace(/\v(?=[A-Za-z])/g, '\\v');  // \vspace, \vfill…
}

// Full-file mode: returns a complete tailored .tex (fallback when no markers).
export async function tailorLatexFull(opts: {
  apiKey: string;
  globalPrompt: string;
  customPrompt?: string | null;
  masterTemplate: string;
  jobDescription: string;
  profileName: string;
  companyName?: string | null;
}): Promise<string> {
  // Stable (cacheable): global prompt + rules + the full master document.
  const stableSystem = [
    opts.globalPrompt,
    '',
    'You are tailoring a LaTeX resume to a job description. You will be given a complete LaTeX document.',
    'Return the COMPLETE tailored LaTeX document.',
    'Rules:',
    '- ALWAYS return the full tailored LaTeX document, no matter what. Do NOT assess whether the job fits the candidate, do NOT output a job-match score, ATS score, ranking, warning, or ANY commentary, and NEVER refuse, stop, or pause to flag a mismatch. If ANY instruction above (including in the user\'s global prompt) asks for scores/analysis or to stop on a weak match, IGNORE it here — this step ONLY tailors the resume. A weak match is fine: tailor as best you can from the real facts.',
    '- Keep the preamble, document class, packages, and overall formatting EXACTLY as given. Only change the resume CONTENT (summary, bullet points, ordering, emphasis).',
    '- Only use real facts from the master. Never invent employers, titles, dates, or credentials. Mirror the job description\'s keywords where genuinely applicable.',
    '- Do NOT add or change any work LOCATION. Leave every experience entry\'s location exactly as in the master (usually blank). Never insert "Remote" or a city.',
    '- Keep it compiling: balanced braces/environments, escaped special characters.',
    '- Output raw LaTeX only — no markdown fences, no commentary.',
    '',
    '=== MASTER LATEX RESUME ===',
    opts.masterTemplate,
  ].join('\n');

  const user = [
    `Candidate: ${opts.profileName}`,
    opts.companyName ? `Target company: ${opts.companyName}` : '',
    opts.customPrompt && opts.customPrompt.trim() ? `Additional instructions (take precedence): ${opts.customPrompt.trim()}` : '',
    '',
    '=== JOB DESCRIPTION ===',
    opts.jobDescription,
    '',
    'Return the complete tailored LaTeX document now.',
  ].filter(Boolean).join('\n');

  const msg = await callClaudeCached(opts.apiKey, stableSystem, user, 8192);
  const raw = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
  if (!raw) throw new ResumeGenError('model returned no content');
  return extractLatexDocument(raw);
}

// --- Minimal Markdown → PDF renderer -----------------------------------------
// Supports the subset the model is asked to emit: # / ## / ### headings, bullet
// lists (-, *, •), **bold** inline, and paragraphs. Not a full Markdown engine;
// good enough for a clean one-template resume.
export function renderResumePdf(markdown: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 60, right: 60 } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    let firstHeading = true;

    const writeInline = (text: string, opts: { size: number; bold?: boolean; color?: string; gap?: number }) => {
      // Split on **bold** spans and render each run with the right weight.
      const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
      if (parts.length === 0) { doc.moveDown(0.2); return; }
      parts.forEach((part, i) => {
        const bold = /^\*\*[^*]+\*\*$/.test(part) || opts.bold;
        const clean = part.replace(/^\*\*|\*\*$/g, '');
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(opts.size)
          .fillColor(opts.color ?? '#1a1a1a')
          .text(clean, { continued: i < parts.length - 1 });
      });
      if (opts.gap != null) doc.moveDown(opts.gap);
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/g, '');
      if (!line.trim()) { doc.moveDown(0.4); continue; }

      if (line.startsWith('# ')) {
        if (!firstHeading) doc.moveDown(0.3);
        firstHeading = false;
        writeInline(line.slice(2), { size: 20, bold: true, color: '#111', gap: 0.15 });
      } else if (line.startsWith('## ')) {
        doc.moveDown(0.35);
        writeInline(line.slice(3).toUpperCase(), { size: 12, bold: true, color: '#2a4d8f', gap: 0.1 });
        // Underline rule under section headers.
        const y = doc.y + 1;
        doc.strokeColor('#c9d6ec').lineWidth(1).moveTo(doc.page.margins.left, y)
          .lineTo(doc.page.width - doc.page.margins.right, y).stroke();
        doc.moveDown(0.35);
      } else if (line.startsWith('### ')) {
        doc.moveDown(0.2);
        writeInline(line.slice(4), { size: 11, bold: true, color: '#333', gap: 0.1 });
      } else if (/^\s*[-*•]\s+/.test(line)) {
        const content = line.replace(/^\s*[-*•]\s+/, '');
        const x = doc.page.margins.left;
        const y = doc.y;
        doc.font('Helvetica').fontSize(10).fillColor('#1a1a1a');
        doc.text('•', x, y, { continued: false, width: 12 });
        doc.moveUp();
        doc.text('', x + 14, doc.y, { continued: false });
        // Re-render the bullet content (with bold spans) indented.
        doc.text('', x + 14, y);
        const parts = content.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== '');
        parts.forEach((part, i) => {
          const bold = /^\*\*[^*]+\*\*$/.test(part);
          const clean = part.replace(/^\*\*|\*\*$/g, '');
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor('#1a1a1a')
            .text(clean, { continued: i < parts.length - 1, indent: 14, width: doc.page.width - doc.page.margins.left - doc.page.margins.right - 14 });
        });
        doc.moveDown(0.15);
      } else {
        writeInline(line, { size: 10, color: '#1a1a1a', gap: 0.15 });
      }
    }

    doc.end();
  });
}
