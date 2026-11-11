import { useEffect, useRef, useState } from 'react';
import { formPartsToSlot, slotToFormParts, type SlotParts } from '../util/format';

type Props = {
  value: string;
  onChange: (slot: string) => void;
  disabled?: boolean;
};

type DigitKey = 'startH' | 'startM' | 'endH' | 'endM';
type MerKey = 'startMer' | 'endMer';

// Layout: [HH] : [MM] [AM/PM]  to  [HH] : [MM] [AM/PM]
// Numeric digit fields; when one fills to 2 chars, focus jumps to the next input.
export default function SlotInput({ value, onChange, disabled }: Props) {
  const [parts, setParts] = useState<SlotParts>(() => slotToFormParts(value || ''));

  const startHRef = useRef<HTMLInputElement | null>(null);
  const startMRef = useRef<HTMLInputElement | null>(null);
  const startMerRef = useRef<HTMLButtonElement | null>(null);
  const endHRef = useRef<HTMLInputElement | null>(null);
  const endMRef = useRef<HTMLInputElement | null>(null);
  const endMerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const ours = formPartsToSlot(parts);
    if (value !== ours) setParts(slotToFormParts(value || ''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const push = (next: SlotParts) => {
    setParts(next);
    onChange(formPartsToSlot(next));
  };

  const focusNextFor = (k: DigitKey) => {
    if (k === 'startH') startMRef.current?.focus();
    else if (k === 'startM') startMerRef.current?.focus();
    else if (k === 'endH') endMRef.current?.focus();
    else if (k === 'endM') endMerRef.current?.focus();
  };

  const onDigit = (k: DigitKey, raw: string) => {
    const cleaned = raw.replace(/\D/g, '').slice(0, 2);
    push({ ...parts, [k]: cleaned } as SlotParts);
    if (cleaned.length === 2) focusNextFor(k);
  };

  const toggleMer = (k: MerKey) => {
    push({ ...parts, [k]: parts[k] === 'AM' ? 'PM' : 'AM' });
  };

  const merClass = (k: MerKey) => 'meridian-toggle' + (parts[k] === 'PM' ? ' pm' : '');

  return (
    <div className="slot-field">
      <input
        ref={startHRef}
        type="text" inputMode="numeric" className="slot-num" placeholder="hh"
        value={parts.startH} maxLength={2} disabled={disabled}
        onChange={(e) => onDigit('startH', e.target.value)}
      />
      <span className="slot-sep">:</span>
      <input
        ref={startMRef}
        type="text" inputMode="numeric" className="slot-num" placeholder="mm"
        value={parts.startM} maxLength={2} disabled={disabled}
        onChange={(e) => onDigit('startM', e.target.value)}
      />
      <button
        ref={startMerRef}
        type="button" className={merClass('startMer')} disabled={disabled}
        title="Toggle AM / PM" aria-label={`Start meridian: ${parts.startMer}`}
        onClick={() => toggleMer('startMer')}
      >
        {parts.startMer}
      </button>
      <span className="slot-sep">to</span>
      <input
        ref={endHRef}
        type="text" inputMode="numeric" className="slot-num" placeholder="hh"
        value={parts.endH} maxLength={2} disabled={disabled}
        onChange={(e) => onDigit('endH', e.target.value)}
      />
      <span className="slot-sep">:</span>
      <input
        ref={endMRef}
        type="text" inputMode="numeric" className="slot-num" placeholder="mm"
        value={parts.endM} maxLength={2} disabled={disabled}
        onChange={(e) => onDigit('endM', e.target.value)}
      />
      <button
        ref={endMerRef}
        type="button" className={merClass('endMer')} disabled={disabled}
        title="Toggle AM / PM" aria-label={`End meridian: ${parts.endMer}`}
        onClick={() => toggleMer('endMer')}
      >
        {parts.endMer}
      </button>
    </div>
  );
}
