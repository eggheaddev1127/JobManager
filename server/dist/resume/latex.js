// LaTeX resume pipeline: detect a LaTeX master, splice Claude-tailored content
// into its placeholders (keeping the user's exact template/preamble), and
// compile to PDF with Tectonic. The master template never leaves the machine
// as anything but the finished PDF; Claude only writes the tailored content.
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileP = promisify(execFile);
export class LatexError extends Error {
}
// Heuristic: is this master a LaTeX document (vs. plain text / extracted PDF)?
export function isLatexMaster(text) {
    if (!text)
        return false;
    return /\\documentclass|\\begin\{document\}/.test(text);
}
// Strip zero-width / bidi / control characters that copy-paste sometimes leaves
// in phone numbers etc. (e.g. U+202A…U+202C around a number) — they break LaTeX.
function cleanField(s) {
    // Remove control chars (C0/C1 except normal space/tab/newline), zero-width
    // chars, and bidi marks (U+200B-200F, U+202A-202E, U+2066-2069, U+FEFF).
    // eslint-disable-next-line no-control-regex
    return (s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "").trim();
}
// Reduce a full mailing address to just "City, ST" for the resume header (a
// street address doesn't belong on a resume). Handles the common
// "street, City, ST ZIP" shape and degrades gracefully for odd inputs.
function shortLocation(full) {
    const s = cleanField(full);
    if (!s)
        return '';
    const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
        const city = parts[parts.length - 2];
        const st = parts[parts.length - 1].split(/\s+/)[0]; // "TX 75201" → "TX"
        return st ? `${city}, ${st}` : city;
    }
    // No commas, e.g. "Dallas TX 75201": take the token before the ZIP as state.
    const toks = s.split(/\s+/);
    const zipIdx = toks.findIndex((t) => /^\d{5}/.test(t));
    const end = zipIdx > 0 ? zipIdx : toks.length;
    if (end >= 2)
        return `${toks.slice(0, end - 1).join(' ')}, ${toks[end - 1]}`;
    return s;
}
// Escape the LaTeX special characters that appear in contact fields (emails have
// underscores, addresses have &, etc.). Backslash handled first.
function texEscape(s) {
    return s
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/([&%$#_{}])/g, '\\$1')
        .replace(/~/g, '\\textasciitilde{}')
        .replace(/\^/g, '\\textasciicircum{}');
}
// Build the LaTeX for the header CONTENT (goes inside \begin{center}…\end{center}).
// Uses the "Jake Gutierrez" header style so it drops into these templates. Only
// non-empty fields appear. This is generated from the CURRENT profile fields, so
// editing a profile (email/phone/…) flows into every future resume.
export function buildResumeHeader(p) {
    const name = texEscape(cleanField(p.name)) || 'Name';
    const email = cleanField(p.email);
    const phone = cleanField(p.phone);
    const address = shortLocation(p.address);
    const linkedin = cleanField(p.linkedin);
    // Contact items in order; each is a small LaTeX fragment.
    const items = [];
    if (phone)
        items.push(`\\small ${texEscape(phone)}`);
    if (address)
        items.push(`\\small ${texEscape(address)}`);
    // Email is NOT underlined (only LinkedIn is), per preference.
    if (email)
        items.push(`\\href{mailto:${email}}{${texEscape(email)}}`);
    if (linkedin) {
        const url = /^https?:\/\//i.test(linkedin) ? linkedin : `https://${linkedin}`;
        items.push(`\\href{${url}}{\\underline{LinkedIn}}`);
    }
    const contactLine = items.join(' $|$\n  ');
    return `\\textbf{\\Huge \\scshape ${name}} \\\\ \\vspace{1pt}\n  ${contactLine}`;
}
// Placeholder markers we understand, in priority order. Each returns the inner
// name (e.g. "EXPERIENCE") so we can map tailored content back onto it.
const PLACEHOLDER_PATTERNS = [
    /%%\s*([A-Z0-9_]+)\s*%%/g, // %%EXPERIENCE%%
    /\{\{\s*([A-Z0-9_]+)\s*\}\}/g, // {{EXPERIENCE}}
    /<<\s*([A-Z0-9_]+)\s*>>/g, // <<EXPERIENCE>>
];
// Find which placeholder style the template uses and list its markers.
export function scanPlaceholders(template) {
    for (let i = 0; i < PLACEHOLDER_PATTERNS.length; i++) {
        const re = new RegExp(PLACEHOLDER_PATTERNS[i].source, 'g');
        const names = [];
        let m;
        while ((m = re.exec(template)) !== null) {
            if (!names.includes(m[1]))
                names.push(m[1]);
        }
        if (names.length > 0)
            return { style: i, names };
    }
    return { style: -1, names: [] };
}
// For "title follows the target job" profiles: replace the TITLE slot (the first
// brace group) of each experience \resumeSubheading with a %%TITLE_n%% marker, so
// the generator fills job titles from the JD instead of the template's fixed ones.
// Only the Experience section is touched (bounded by \section{Experience} … the
// next \section), so Education/Projects titles stay intact. Returns the rewritten
// template and how many title slots were marked (0 = nothing to do).
export function injectTitlePlaceholders(template) {
    const sec = /\\section\s*\{[^}]*experience[^}]*\}/i.exec(template);
    if (!sec)
        return { template, count: 0 };
    const start = sec.index + sec[0].length;
    const rest = template.slice(start);
    const nextSec = /\\section\s*\{/i.exec(rest);
    const end = nextSec ? start + nextSec.index : template.length;
    const head = template.slice(0, start);
    const body = template.slice(start, end);
    const tail = template.slice(end);
    const subRe = /\\resumeSubheading(?=\s*\{)/g;
    let out = '';
    let last = 0;
    let n = 0;
    let m;
    while ((m = subRe.exec(body)) !== null) {
        // Skip whitespace to the opening brace of the title group.
        let j = m.index + m[0].length;
        while (j < body.length && /\s/.test(body[j]))
            j++;
        if (body[j] !== '{')
            continue;
        // Balanced-brace scan of the title group (handles nested {} inside a title).
        let depth = 0, i = j;
        for (; i < body.length; i++) {
            if (body[i] === '{')
                depth++;
            else if (body[i] === '}') {
                depth--;
                if (depth === 0) {
                    i++;
                    break;
                }
            }
        }
        n++;
        out += body.slice(last, j) + `{%%TITLE_${n}%%}`;
        last = i;
        subRe.lastIndex = i;
    }
    out += body.slice(last);
    return { template: head + out + tail, count: n };
}
// Replace each placeholder with the tailored content for that name. Names with
// no supplied content are cleared (so a stray marker never reaches LaTeX).
export function spliceTemplate(template, style, content) {
    if (style < 0)
        return template;
    const re = new RegExp(PLACEHOLDER_PATTERNS[style].source, 'g');
    return template.replace(re, (_full, name) => {
        const val = content[name];
        return typeof val === 'string' ? val : '';
    });
}
// Compile a .tex string to a PDF buffer using Tectonic. Throws LatexError with
// the (trimmed) compiler log on failure so the UI can show what went wrong.
export async function compileLatex(tex) {
    const dir = await mkdtemp(join(tmpdir(), 'jm-resume-'));
    const texPath = join(dir, 'resume.tex');
    const pdfPath = join(dir, 'resume.pdf');
    try {
        await writeFile(texPath, sanitizeForXetex(tex), 'utf8');
        try {
            // --keep-logs off, no shell-escape (safe), synctex off. 60s cap.
            await execFileP('tectonic', ['--outdir', dir, '--chatter', 'minimal', '-Z', 'search-path=.', texPath], {
                timeout: 60_000,
                maxBuffer: 8 * 1024 * 1024,
                cwd: dir,
            });
        }
        catch (e) {
            const err = e;
            const log = (err.stderr || err.stdout || err.message || 'unknown error').toString();
            throw new LatexError(trimLog(log));
        }
        try {
            return await readFile(pdfPath);
        }
        catch {
            throw new LatexError('Tectonic produced no PDF (check the template compiles).');
        }
    }
    finally {
        void rm(dir, { recursive: true, force: true }).catch(() => { });
    }
}
// Tectonic compiles with the XeTeX engine, which lacks a handful of pdfTeX-only
// primitives that common resume templates (e.g. the "Jake Gutierrez" template)
// include. These only affect PDF text extraction, never the visual layout, so
// stripping them lets the template compile unchanged. Best-effort and narrow —
// we only remove the exact known-incompatible lines.
export function sanitizeForXetex(tex) {
    // Match only within a single line (no \s, which would swallow the newline and
    // eat the following line, e.g. \begin{document}).
    const drops = [
        /^[^\n%]*\\input[ \t]*\{[ \t]*glyphtounicode[ \t]*\}[^\n]*$/gm, // \input{glyphtounicode}
        /^[^\n%]*\\pdfgentounicode[ \t]*=[ \t]*\d+[^\n]*$/gm, // \pdfgentounicode=1
        /^[^\n%]*\\input[ \t]+glyphtounicode\b[^\n]*$/gm, // \input glyphtounicode (no braces)
        // Other pdfTeX-only primitives some templates set at the top. All affect
        // low-level PDF output, not layout — safe to drop under XeTeX.
        /^[^\n%]*\\pdfpagewidth[ \t]*=[^\n]*$/gm,
        /^[^\n%]*\\pdfpageheight[ \t]*=[^\n]*$/gm,
    ];
    let out = tex;
    for (const re of drops)
        out = out.replace(re, '% [removed for XeTeX compatibility]');
    return out;
}
// Tectonic logs can be long; keep the last ~1200 chars where the real error is.
function trimLog(log) {
    const clean = log.replace(/\r/g, '').trim();
    if (clean.length <= 1200)
        return clean;
    return '…' + clean.slice(-1200);
}
