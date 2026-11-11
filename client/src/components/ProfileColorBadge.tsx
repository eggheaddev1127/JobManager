import { useEffect, useRef, useState } from 'react';
import { PROFILE_PRESETS, textOn } from '../util/profileColors';

// Colored profile chip. For admins it's a button that opens a color picker
// (preset swatches + a native custom color input + Auto). Devs see a plain chip.
export default function ProfileColorBadge({ name, color, canEdit, onPick }: {
  name: string;
  color: string;                 // effective hex color (custom or auto)
  canEdit: boolean;
  onPick: (color: string | null) => void; // null = reset to auto
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const style = { background: color, color: textOn(color) };

  if (!canEdit) {
    return <span className="profile-tag" style={style}>{name}</span>;
  }

  return (
    <span className="profile-tag-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="profile-tag profile-tag-btn" style={style}
              title="Click to change this profile's color" onClick={() => setOpen((o) => !o)}>
        {name}
      </button>
      {open && (
        <div className="color-pop">
          {PROFILE_PRESETS.map((c) => (
            <button key={c} type="button"
                    className={'color-swatch' + (c.toLowerCase() === color.toLowerCase() ? ' active' : '')}
                    style={{ background: c }} title={c} onClick={() => { onPick(c); setOpen(false); }} />
          ))}
          {/* Native custom color picker */}
          <label className="color-swatch color-custom" title="Custom color…">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#7c3aed'}
                   onChange={(e) => { onPick(e.target.value); setOpen(false); }} />
          </label>
          <button type="button" className="color-swatch color-auto" title="Auto (default color)"
                  onClick={() => { onPick(null); setOpen(false); }}>A</button>
        </div>
      )}
    </span>
  );
}
