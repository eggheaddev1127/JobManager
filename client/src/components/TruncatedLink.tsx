import { useState } from 'react';
import Modal from './Modal';

const DEFAULT_LIMIT = 32;

export default function TruncatedLink({
  href,
  limit = DEFAULT_LIMIT,
  title,
}: {
  href: string | null | undefined;
  limit?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!href) return <span className="dash">—</span>;
  const text = href.trim();
  if (!text) return <span className="dash">—</span>;
  const truncated = text.length > limit;
  const linkHref = text.startsWith('http') ? text : `https://${text.replace(/^\/+/, '')}`;
  return (
    <>
      <span className="trunc-cell">
        <a
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="cell-link trunc-text"
          title={text}
        >
          {truncated ? text.slice(0, limit).trimEnd() + '…' : text}
        </a>
        {truncated && (
          <button type="button" className="trunc-more" onClick={(e) => { e.stopPropagation(); setOpen(true); }} title="View full URL">
            …
          </button>
        )}
      </span>
      {open && (
        <Modal title={title || 'URL'} onClose={() => setOpen(false)}>
          <div className="trunc-full">{text}</div>
        </Modal>
      )}
    </>
  );
}
