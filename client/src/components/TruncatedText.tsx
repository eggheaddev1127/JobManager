import { useState } from 'react';
import Modal from './Modal';

const DEFAULT_LIMIT = 60;

export default function TruncatedText({
  value,
  limit = DEFAULT_LIMIT,
  title,
  className,
}: {
  value: string | null | undefined;
  limit?: number;
  title?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!value || !value.trim()) return <span className="dash">—</span>;
  const text = value.trim();
  const truncated = text.length > limit;
  return (
    <>
      <span className="trunc-cell">
        <span className={'trunc-text' + (className ? ' ' + className : '')} title={truncated ? text : undefined}>
          {truncated ? text.slice(0, limit).trimEnd() + '…' : text}
        </span>
        {truncated && (
          <button type="button" className="trunc-more" onClick={(e) => { e.stopPropagation(); setOpen(true); }} title="View full">
            …
          </button>
        )}
      </span>
      {open && (
        <Modal title={title || 'Details'} onClose={() => setOpen(false)}>
          <div className="trunc-full">{text}</div>
        </Modal>
      )}
    </>
  );
}
