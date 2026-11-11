// Profile badge colors. A profile stores an explicit hex color when chosen;
// otherwise it falls back to one of the auto-assigned palette colors.

// Auto-assigned palette — soft Google-Sheets-style pastels in cool hues (so they
// don't clash with the status red/amber/green row tints). Used when a profile
// has no explicit color.
export const PROFILE_PALETTE = ['#9fc5e8', '#b4a7d6', '#a2c4c9', '#d5a6bd', '#6fa8dc', '#8e7cc3', '#76a5af'];

// Soft pastel preset palette (Google Sheets light tints) shown in the picker,
// alongside a native custom color input.
export const PROFILE_PRESETS = [
  '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#9fc5e8',
  '#b4a7d6', '#d5a6bd', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3',
  '#d0e0e3', '#cfe2f3', '#d9d2e9', '#ead1dc', '#e06666', '#6fa8dc',
];

// Black or white text for legibility on a given background.
export function textOn(hex: string): string {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return '#fff';
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#1c1917' : '#fff';
}

// Auto color for a profile when it has no explicit color, by list position (or
// a name hash as a fallback) so each candidate is consistently distinct.
export function autoProfileColor(name: string, names: string[]): string {
  const idx = names.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  if (idx >= 0) return PROFILE_PALETTE[idx % PROFILE_PALETTE.length];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return PROFILE_PALETTE[Math.abs(h) % PROFILE_PALETTE.length];
}
