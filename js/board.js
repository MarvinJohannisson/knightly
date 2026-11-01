// Touch-friendly chessboard: tap-to-move and drag-and-drop, animations, arrows, highlights.
import { pieceImg, getSettings } from './util.js';

const FILES = 'abcdefgh';

export function parseFen(fen) {
  const map = {};
  const rows = fen.split(' ')[0].split('/');
  for (let r = 0; r < 8; r++) {
    let f = 0;
    for (const ch of rows[r]) {
      if (/\d/.test(ch)) { f += +ch; continue; }
      const color = ch === ch.toUpperCase() ? 'w' : 'b';
      map[FILES[f] + (8 - r)] = color + ch.toLowerCase();
      f++;
    }
  }
  return map;
}

export class Board {
  constructor(container, opts = {}) {
    this.opts = opts;
    this.orientation = opts.orientation || 'w';
    this.pieces = {};          // square -> element
    this.position = {};        // square -> 'wp'
    this.movableColor = null;  // 'w' | 'b' | null
    this.getDests = () => [];
    this.selected = null;
    this.dests = [];
    this.lastMove = null;
    this.checkSq = null;
    this.marks = {};
    this.arrows = [];

    this.root = document.createElement('div');
    this.root.className = 'board';
    this.root.innerHTML = '<div class="squares"></div><div class="pieces"></div><svg class="arrows" viewBox="0 0 8 8"></svg>';
    container.appendChild(this.root);
    this.sqLayer = this.root.querySelector('.squares');
    this.pcLayer = this.root.querySelector('.pieces');
    this.arrowLayer = this.root.querySelector('.arrows');
    this._buildSquares();
    this._bindInput();
  }

  // ---------- geometry ----------
  _xy(sq) {
    const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
    return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r];
  }
  _sqAt(x, y) {
    const f = this.orientation === 'w' ? x : 7 - x;
    const r = this.orientation === 'w' ? 7 - y : y;
    if (f < 0 || f > 7 || r < 0 || r > 7) return null;
    return FILES[f] + (r + 1);
  }
  _eventSq(e) {
    const rect = this.root.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / rect.width * 8);
    const y = Math.floor((e.clientY - rect.top) / rect.height * 8);
    return this._sqAt(x, y);
  }

  _buildSquares() {
    this.sqLayer.innerHTML = '';
    this.sqEls = {};
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const sq = this._sqAt(x, y);
      const d = document.createElement('div');
      const f = FILES.indexOf(sq[0]), r = +sq[1] - 1;
      d.className = 'sq' + ((f + r) % 2 === 0 ? ' dark' : '');
      if (y === 7) d.insertAdjacentHTML('beforeend', `<span class="coord file">${sq[0]}</span>`);
      if (x === 0) d.insertAdjacentHTML('beforeend', `<span class="coord rank">${sq[1]}</span>`);
      this.sqLayer.appendChild(d);
      this.sqEls[sq] = d;
    }
    this._paintSquares();
  }

  _paintSquares() {
    for (const [sq, d] of Object.entries(this.sqEls)) {
      d.classList.toggle('last', !!this.lastMove && this.lastMove.includes(sq));
      d.classList.toggle('sel', this.selected === sq);
      d.classList.toggle('check', this.checkSq === sq);
      const isDest = this.dests.includes(sq);
      d.classList.toggle('dest', isDest && getSettings().dests);
      d.classList.toggle('occ', isDest && !!this.position[sq]);
      for (const c of ['hint', 'good', 'wrong', 'mark']) d.classList.toggle(c, this.marks[sq] === c);
    }
  }

  // ---------- public API ----------
  setOrientation(color) {
    if (color === this.orientation) return;
    this.orientation = color;
    this._buildSquares();
    for (const [sq, elx] of Object.entries(this.pieces)) this._place(elx, sq, false);
    this.renderArrows();
  }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

  /** setPosition(fen, {lastMove:['e2','e4'], check:'e8', animate}) */
  setPosition(fen, o = {}) {
    const next = parseFen(fen);
    const animate = o.animate !== false && getSettings().animation;
    const old = this.pieces;
    const used = new Set();
    const result = {};
    // 1. pieces that stay
    for (const [sq, p] of Object.entries(next)) {
      if (old[sq] && this.position[sq] === p) { result[sq] = old[sq]; used.add(sq); }
    }
    // 2. pieces that moved: nearest unused old element of same kind
    for (const [sq, p] of Object.entries(next)) {
      if (result[sq]) continue;
      let best = null, bestD = 99;
      for (const [osq, op] of Object.entries(this.position)) {
        if (used.has(osq) || op !== p || next[osq] === op) continue;
        const [x1, y1] = this._xy(osq), [x2, y2] = this._xy(sq);
        const d = Math.abs(x1 - x2) + Math.abs(y1 - y2);
        if (d < bestD) { bestD = d; best = osq; }
      }
      if (best) {
        used.add(best);
        const e = old[best];
        const instant = this._noAnim === sq;
        this._place(e, sq, animate && !instant);
        result[sq] = e;
      } else {
        result[sq] = this._createPiece(p, sq);
      }
    }
    // 3. remove captured/vanished
    for (const [osq, e] of Object.entries(old)) {
      if (!used.has(osq)) {
        if (animate) { e.classList.add('fade'); setTimeout(() => e.remove(), 160); } else e.remove();
      }
    }
    this._noAnim = null;
    this.pieces = result;
    this.position = next;
    this.lastMove = o.lastMove || null;
    this.checkSq = o.check || null;
    this.selected = null; this.dests = [];
    this._paintSquares();
  }

  setMovable(color, getDests) {
    this.movableColor = color;
    if (getDests) this.getDests = getDests;
    if (!color) { this.selected = null; this.dests = []; this._paintSquares(); }
  }

  setMarks(marks = {}) { this.marks = marks; this._paintSquares(); }

  /** arrows: [{from, to, color}] */
  setArrows(arrows = []) { this.arrows = arrows; this.renderArrows(); }

  renderArrows() {
    const colors = { green: '#4fa05e', blue: '#3c88d8', red: '#d6453b', yellow: '#e2b13c', grey: '#888' };
    let defs = '<defs>';
    let body = '';
    for (const [name, c] of Object.entries(colors)) {
      defs += `<marker id="ah-${name}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`;
    }
    defs += '</defs>';
    for (const a of this.arrows) {
      const [x1, y1] = this._xy(a.from), [x2, y2] = this._xy(a.to);
      const cx1 = x1 + .5, cy1 = y1 + .5, cx2 = x2 + .5, cy2 = y2 + .5;
      const len = Math.hypot(cx2 - cx1, cy2 - cy1);
      const shorten = 0.42;
      const ex = cx2 - (cx2 - cx1) / len * shorten, ey = cy2 - (cy2 - cy1) / len * shorten;
      const col = a.color || 'green';
      body += `<line x1="${cx1}" y1="${cy1}" x2="${ex}" y2="${ey}" stroke="${colors[col]}" stroke-width="0.17" stroke-linecap="round" opacity="0.85" marker-end="url(#ah-${col})"/>`;
    }
    this.arrowLayer.innerHTML = defs + body;
  }

  /** Show a promotion picker. Resolves 'q'|'r'|'b'|'n' or null. */
  promote(color) {
    return new Promise(resolve => {
      const ov = document.createElement('div');
      ov.className = 'promo';
      ov.innerHTML = `<div class="choices">${['q', 'r', 'b', 'n'].map(p =>
        `<button data-p="${p}" style="background-image:url(${pieceImg(color, p)})" aria-label="${p}"></button>`).join('')}</div>`;
      ov.addEventListener('pointerdown', e => {
        e.stopPropagation();
        const b = e.target.closest('button');
        ov.remove();
        resolve(b ? b.dataset.p : null);
      });
      this.root.appendChild(ov);
    });
  }

  // ---------- pieces ----------
  _createPiece(p, sq) {
    const e = document.createElement('div');
    e.className = 'piece';
    e.style.backgroundImage = `url(${pieceImg(p[0], p[1])})`;
    this._place(e, sq, false);
    this.pcLayer.appendChild(e);
    return e;
  }
  _place(e, sq, animate) {
    const [x, y] = this._xy(sq);
    if (!animate) {
      e.style.transition = 'none';
      e.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
      void e.offsetWidth;
      e.style.transition = '';
    } else {
      e.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
    }
  }

  // ---------- input ----------
  _select(sq) {
    this.selected = sq;
    this.dests = sq ? this.getDests(sq) : [];
    this._paintSquares();
  }

  _canMovePiece(sq) {
    const p = this.position[sq];
    return !!p && !!this.movableColor && p[0] === this.movableColor;
  }

  _tryMove(from, to, dropped) {
    if (!this.dests.includes(to)) return false;
    if (dropped) this._noAnim = to;
    this.selected = null; this.dests = [];
    this._paintSquares();
    this.opts.onMove && this.opts.onMove(from, to);
    return true;
  }

  _bindInput() {
    let drag = null;
    const rectOf = () => this.root.getBoundingClientRect();

    this.root.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      const sq = this._eventSq(e);
      if (!sq) return;
      this.opts.onTap && this.opts.onTap(sq);
      if (this.selected && this.selected !== sq && this.dests.includes(sq)) {
        this._tryMove(this.selected, sq, false);
        return;
      }
      if (this._canMovePiece(sq)) {
        const wasSelected = this.selected === sq;
        this._select(sq);
        const pe = this.pieces[sq];
        drag = { from: sq, el: pe, startX: e.clientX, startY: e.clientY, moved: false, wasSelected, pointerId: e.pointerId };
        try { this.root.setPointerCapture(e.pointerId); } catch { }
      } else {
        this._select(null);
      }
    });

    this.root.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      const r = rectOf();
      const size = r.width / 8;
      const px = e.clientX - r.left - size / 2, py = e.clientY - r.top - size / 2;
      if (drag.el) {
        drag.el.classList.add('dragging');
        drag.el.style.transform = `translate(${px}px, ${py}px) scale(1.15)`;
      }
      const over = this._eventSq(e);
      if (over !== drag.over) {
        if (drag.over && this.sqEls[drag.over]) this.sqEls[drag.over].classList.remove('hover');
        drag.over = over;
        if (over && this.sqEls[over] && this.dests.includes(over)) this.sqEls[over].classList.add('hover');
      }
    });

    const end = e => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      const d = drag; drag = null;
      if (d.over && this.sqEls[d.over]) this.sqEls[d.over].classList.remove('hover');
      if (d.el) d.el.classList.remove('dragging');
      if (d.moved) {
        const to = this._eventSq(e);
        if (to && to !== d.from && this._tryMove(d.from, to, true)) return;
        if (d.el) this._place(d.el, d.from, false);
      } else if (d.wasSelected) {
        this._select(null); // second tap on same piece deselects
      }
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', e => {
      if (!drag) return;
      if (drag.el) { drag.el.classList.remove('dragging'); this._place(drag.el, drag.from, false); }
      drag = null;
    });
  }
}

/** Build a dests function from a chess.js instance */
export function destsFrom(chess) {
  return sq => chess.moves({ square: sq, verbose: true }).map(m => m.to);
}

export function checkSquare(chess) {
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  const b = chess.board();
  for (const row of b) for (const p of row) if (p && p.type === 'k' && p.color === turn) return p.square;
  return null;
}
