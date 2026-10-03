// Small rendering helpers shared by the views.

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

const PALETTE = [
  { color: '#2563C9', soft: '#E1EAFA' },
  { color: '#B84F12', soft: '#FBE7DA' },
  { color: '#0F766E', soft: '#DAF0EC' },
  { color: '#6D3FC4', soft: '#EAE2FA' },
  { color: '#B4235F', soft: '#F9E0EA' },
  { color: '#3F6212', soft: '#E6F0D6' }
];

const HEX = /^#[0-9a-fA-F]{6}$/;

// Mixes a hex color toward white; used when a person has a color but no soft tint.
function tint(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.round(c + (255 - c) * amount));
  return '#' + ch.map(c => c.toString(16).padStart(2, '0')).join('');
}

// Gives each person a safe color pair, falling back to the palette by position.
export function colorsFor(person, index) {
  const base = PALETTE[index % PALETTE.length];
  const color = HEX.test(person.color || '') ? person.color : base.color;
  const soft = HEX.test(person.soft || '') ? person.soft : (color === base.color ? base.soft : tint(color, 0.86));
  return { color, soft };
}

export function avatar(person, size) {
  const initial = (person.name || '?').trim().charAt(0).toUpperCase();
  return `<div class="avatar" aria-hidden="true" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px;background:${person.color}">${esc(initial)}</div>`;
}

export const icons = {
  home: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/></svg>',
  gift: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v9H5v-9"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>',
  lock: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  signOut: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 16l-4-4 4-4"/><path d="M6 12h10"/></svg>',
  calendar: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  star: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  flame: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21c-3.9 0-7-2.7-7-6.5 0-3.3 2.4-5.4 3.6-8.5.4 2 1.6 3.2 2.9 3.7C11.6 6.6 13 4.2 15.5 3c-.6 3 1 4.8 2.3 6.6 1 1.4 1.2 2.8 1.2 4.9 0 3.8-3.1 6.5-7 6.5z"/></svg>'
};
