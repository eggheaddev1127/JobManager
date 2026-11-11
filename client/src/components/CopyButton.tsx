import { useState } from 'react';

export default function CopyButton({ value, label }: { value: string | null | undefined; label?: string }) {
  const [copied, setCopied] = useState(false);

  if (!value) return null;

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Fallback: select text via temp input
      const ta = document.createElement('textarea');
      ta.value = value;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 1200); }
      catch { /* ignore */ }
      document.body.removeChild(ta);
    }
  };

  return (
    <button
      type="button"
      className={'copy-btn' + (copied ? ' copied' : '')}
      onClick={copy}
      title={copied ? 'Copied!' : `Copy${label ? ' ' + label : ''}`}
      aria-label={`Copy${label ? ' ' + label : ''}`}
    >
      {copied ? '✓' : '⧉'}
    </button>
  );
}
