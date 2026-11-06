// Small shared helpers: DOM, storage, modal, toast, sounds.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- Storage ----------
const PREFIX = 'knightly.';
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
  remove(key) { try { localStorage.removeItem(PREFIX + key); } catch { } },
  clearAll() {
    try { Object.keys(localStorage).filter(k => k.startsWith(PREFIX)).forEach(k => localStorage.removeItem(k)); } catch { }
  },
  /** Everything the app has stored, as { key: raw JSON string }. */
  exportAll() {
    const data = {};
    for (const k of Object.keys(localStorage)) if (k.startsWith(PREFIX)) data[k.slice(PREFIX.length)] = localStorage.getItem(k);
    return data;
  },
  /** Replaces all stored data. Puts the old data back and rethrows if it does not fit. */
  importAll(data) {
    const old = this.exportAll();
    const write = d => { this.clearAll(); for (const [k, v] of Object.entries(d)) localStorage.setItem(PREFIX + k, v); };
    try { write(data); } catch (e) { write(old); throw e; }
  },
};

// ---------- Settings ----------
const DEFAULT_SETTINGS = {
  board: 'forest', coords: true, sound: true, dests: true, autoQueen: false,
  coach: true, evalBar: false, moveList: true, animation: true,
};
export function getSettings() { return { ...DEFAULT_SETTINGS, ...store.get('settings', {}) }; }
export function setSetting(k, v) { const s = getSettings(); s[k] = v; store.set('settings', s); applySettings(); }
export function applySettings() {
  const s = getSettings();
  document.body.dataset.board = s.board;
  document.body.classList.toggle('no-coords', !s.coords);
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- Modal ----------
// actions: [{label, cls, value}] -> resolves with value (or null if dismissed)
export function modal({ title = '', body = '', actions = [{ label: 'OK', cls: 'primary', value: true }], dismissable = true }) {
  return new Promise(resolve => {
    const root = $('#modalRoot');
    const node = el(`<div class="modal-backdrop"><div class="modal" role="dialog">
      ${title ? `<h2>${title}</h2>` : ''}<div class="modal-body">${body}</div>
      <div class="actions">${actions.map((a, i) => `<button class="btn ${a.cls || ''}" data-i="${i}">${a.label}</button>`).join('')}</div>
    </div></div>`);
    const close = v => { node.remove(); resolve(v); };
    node.addEventListener('click', e => {
      const b = e.target.closest('button[data-i]');
      if (b) return close(actions[+b.dataset.i].value);
      if (e.target === node && dismissable) close(null);
    });
    root.appendChild(node);
  });
}
export const confirmBox = (title, body, yes = 'Yes', no = 'Cancel') =>
  modal({ title, body, actions: [{ label: yes, cls: 'primary', value: true }, { label: no, cls: 'ghost', value: false }] });

// ---------- Sound (synthesized, no assets) ----------
let ctx;
function audio() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
function knock(freq, dur, gain, when = 0) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + when;
  // short filtered noise burst = wooden click
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
  const src = a.createBufferSource(); src.buffer = buf;
  const f = a.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
  const g = a.createGain(); g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}
function tone(freq, dur, gain, when = 0, type = 'sine') {
  const a = audio(); if (!a) return;
  const t = a.currentTime + when;
  const o = a.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = a.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const sound = {
  play(kind) {
    if (!getSettings().sound) return;
    switch (kind) {
      case 'move': knock(1800, 0.06, 1.6); break;
      case 'capture': knock(900, 0.09, 2.2); knock(1600, 0.05, 1, 0.02); break;
      case 'check': knock(1500, 0.06, 1.6); tone(880, 0.15, 0.06, 0.03, 'triangle'); break;
      case 'castle': knock(1800, 0.05, 1.4); knock(1700, 0.05, 1.4, 0.09); break;
      case 'success': tone(660, 0.12, 0.08); tone(880, 0.12, 0.08, 0.1); tone(1320, 0.2, 0.07, 0.2); break;
      case 'error': tone(220, 0.18, 0.09, 0, 'square'); break;
      case 'end': tone(523, 0.18, 0.08); tone(659, 0.18, 0.08, 0.15); tone(784, 0.3, 0.08, 0.3); break;
    }
  },
  forMove(move, chess) {
    if (chess && chess.inCheck()) return this.play('check');
    if (move.flags && (move.flags.includes('k') || move.flags.includes('q'))) return this.play('castle');
    if (move.captured) return this.play('capture');
    this.play('move');
  },
};

// ---------- Chess helpers ----------
export const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
export function pieceImg(color, type) { return `assets/pieces/${color}${type.toUpperCase()}.svg`; }

export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}
export function moveToUci(m) { return m.from + m.to + (m.promotion || ''); }

// Win probability (0..100) for the side the cp score belongs to (Lichess model)
export function winPct(cp) {
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}
/** Classify a move by how much winning chance (in %) it threw away. */
export function classify(drop, isBest) {
  if (isBest || drop < 2) return 'best';
  if (drop < 7) return 'good';
  if (drop < 14) return 'inaccuracy';
  if (drop < 25) return 'mistake';
  return 'blunder';
}
export const CLASS_LABEL = { best: 'Best', good: 'Good', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', book: 'Book' };
export function moveAccuracy(drop) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * Math.max(0, drop)) - 3.1669));
}

export function scoreToCp(s) {
  if (!s) return 0;
  if (s.mate != null) return s.mate > 0 ? 10000 - s.mate * 10 : -10000 - s.mate * 10;
  return s.cp;
}
export function fmtScore(s) {
  if (!s) return '';
  if (s.mate != null) return (s.mate > 0 ? '#' : '#-') + Math.abs(s.mate);
  const v = s.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
