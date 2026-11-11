import { useState } from 'react';

// Clicking copies the value (URL OR notes/text) to the clipboard. No navigation.
export default function LinkIcon({ href, label, title }: { href: string | null | undefined; label: string; title?: string }) {
  const [copied, setCopied] = useState(false);
  // No link → a subtle dashed placeholder that holds the slot, so Meeting / JD /
  // Recording icons stay in fixed, consistent positions.
  if (!href || !href.trim()) {
    return <span className="link-icon link-icon-empty" title={`No ${title || label} link`} aria-hidden="true">·</span>;
  }

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(href);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = href;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      type="button"
      className={'link-icon' + (copied ? ' copied' : '')}
      onClick={copy}
      title={copied ? 'Copied!' : `Copy ${title || label} link`}
      aria-label={`Copy ${title || label} link`}
    >
      {copied ? '✓' : label}
    </button>
  );
}
