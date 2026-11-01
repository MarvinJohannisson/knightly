// Puzzle trainer: rated puzzles (Lichess puzzle database, CC0) and practice by theme.
import { Chess } from '../vendor/chess.js';
import { Board, destsFrom, checkSquare } from './board.js';
import { $, esc, store, sound, sleep, toast, getSettings, uciToMove } from './util.js';
import { THEMES, themeInfo } from './themes.js';

let puzzleDb = null;
let loading = null;
function loadPuzzles() {
  if (puzzleDb) return Promise.resolve(puzzleDb);
  if (!loading) loading = fetch('data/puzzles.json').then(r => r.json()).then(j => (puzzleDb = j));
  return loading;
}

export function getPuzzleStats() {
  return { rating: 800, solved: 0, failed: 0, streak: 0, bestStreak: 0, games: 0, seen: [], history: [], ...store.get('puzzles', {}) };
}

// ======================= Puzzle hub =======================
export function renderPuzzleHub(view) {
  const ps = getPuzzleStats();
  const recent = ps.history.slice(-20);
  view.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="v">${Math.round(ps.rating)}</div><div class="l">Puzzle rating</div></div>
      <div class="stat"><div class="v">${ps.solved}</div><div class="l">Solved</div></div>
      <div class="stat"><div class="v">${ps.bestStreak}</div><div class="l">Best streak</div></div>
    </div>
    ${recent.length ? `<div class="card" style="margin-top:12px"><div class="small muted" style="margin-bottom:6px">Last ${recent.length} puzzles</div>
      <div class="row wrap" style="gap:4px">${recent.map(h => `<span title="${h.r}" style="width:14px;height:14px;border-radius:4px;background:${h.ok ? 'var(--accent)' : 'var(--bad)'}"></span>`).join('')}</div></div>` : ''}
    <div style="margin-top:14px"><a class="btn primary big" href="#/puzzle">Solve rated puzzles</a></div>
    <p class="small muted center" style="margin:8px 0 0">Puzzles adapt to your rating. Each one is a real position from a real game.</p>

    <div class="section-title">Practice a theme</div>
    <div class="lesson-list">${THEMES.map(t => `
      <a class="lesson-item" href="#/puzzle/${t.key}">
        <div class="n" style="background:#2f3a30">${t.icon}</div>
        <div class="grow"><div class="t">${esc(t.name)}</div><div class="s">${esc(t.short)}</div></div>
        <div class="muted">›</div>
      </a>`).join('')}</div>`;
}

// ======================= Puzzle solving =======================
export function renderPuzzle(view, theme) {
  const ti = theme ? themeInfo(theme) : null;
  view.innerHTML = `
    <div class="puzzle-head">
      <div class="puzzle-rating" id="pRating"></div>
      <div class="small muted" id="pInfo" style="text-align:right"></div>
    </div>
    <div class="board-wrap" id="boardWrap"></div>
    <div class="status" id="status"><div class="dot"></div><div class="grow" id="statusText">Loading puzzles…</div></div>
    <div class="puzzle-actions" id="actions"></div>
    ${ti ? `<div class="card small" style="margin-top:12px;max-width:560px;margin-inline:auto"><b>${ti.icon} ${esc(ti.name)}</b><div class="muted" style="margin-top:4px">${ti.explain}</div></div>` : ''}`;

  const board = new Board($('#boardWrap', view), { onMove: (f, t) => onMove(f, t) });
  let destroyed = false;
  let st = null; // current puzzle state

  const ps = getPuzzleStats();
  const rated = !theme;

  function renderHeader(delta) {
    $('#pRating', view).innerHTML = `${Math.round(ps.rating)}${delta ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '+' : ''}${delta}</span>` : ''}<small>${rated ? 'Puzzle rating' : 'Practice · unrated'}${ps.streak > 1 ? ` · 🔥 ${ps.streak}` : ''}</small>`;
  }

  function setStatus(kind, html) {
    const s = $('#status', view);
    s.className = 'status' + (kind === 'ok' ? ' ok' : kind === 'fail' ? ' fail' : '');
    const dot = s.querySelector('.dot');
    dot.className = 'dot' + (kind === 'turn' ? (st.color === 'w' ? ' turn-w' : ' turn-b') : '');
    dot.textContent = kind === 'ok' ? '✓' : kind === 'fail' ? '✕' : '';
    $('#statusText', view).innerHTML = html;
  }

  function setActions(btns) {
    const a = $('#actions', view);
    a.innerHTML = btns.map((b, i) => `<button class="btn ${b.cls || ''} ${btns.length === 1 || b.wide ? 'wide' : ''}" data-i="${i}">${b.label}</button>`).join('');
    a.onclick = e => { const b = e.target.closest('[data-i]'); if (b) btns[+b.dataset.i].fn(); };
  }

  function choose(db) {
    const seen = new Set(ps.seen);
    let pool = theme ? db.filter(p => p.th.includes(theme)) : db;
    if (!pool.length) return null;
    const target = ps.rating;
    for (let w = 100; w <= 1500; w += 100) {
      const cand = pool.filter(p => !seen.has(p.id) && Math.abs(p.r - target) <= w);
      if (cand.length) return cand[Math.floor(Math.random() * cand.length)];
    }
    // everything seen: allow repeats
    const near = pool.slice().sort((a, b) => Math.abs(a.r - target) - Math.abs(b.r - target)).slice(0, 30);
    return near[Math.floor(Math.random() * near.length)];
  }

  async function next() {
    const db = await loadPuzzles().catch(() => null);
    if (destroyed) return;
    if (!db) { $('#statusText', view).textContent = 'Could not load puzzles.'; return; }
    const p = choose(db);
    if (!p) { $('#statusText', view).textContent = 'No puzzles for this theme.'; return; }
    start(p);
  }

  async function start(p) {
    // Format: fen = position before the opponent's move; m = "opp sol1 reply sol2 ..." (UCI)
    let chess, last = null;
    try {
      const ms = p.m.trim().split(/\s+/);
      chess = new Chess(p.fen);
      last = chess.move(uciToMove(ms[0]));
      if (!p.sol) p.sol = ms.slice(1);
    } catch (e) { console.warn('bad puzzle', p.id, e); next(); return; }
    st = {
      p, chess, step: 0, failed: false, hinted: false, done: false, color: chess.turn(),
      startFen: last.before, lastSetup: last,
    };
    board.setArrows([]); board.setMarks({});
    board.setOrientation(st.color);
    // Show the position before the opponent's last move, then play it.
    board.setPosition(last.before, { animate: false });
    board.setMovable(null);
    renderHeader();
    $('#pInfo', view).innerHTML = `Puzzle ${esc(p.id)}<br>Rating ${p.r}`;
    setStatus('turn', `<b>${st.color === 'w' ? 'White' : 'Black'} to move</b><div class="small muted">Find the best move${p.sol.length > 1 ? ' (and keep going)' : ''}.</div>`);
    setActions([
      { label: '💡 Hint', fn: hint },
      { label: 'Show solution', cls: 'ghost', fn: showSolution },
    ]);
    await sleep(450);
    if (destroyed || st.p !== p) return;
    board.setPosition(chess.fen(), { lastMove: [last.from, last.to], check: checkSquare(chess) });
    sound.forMove(last, chess);
    board.setMovable(st.color, destsFrom(chess));
  }

  async function onMove(from, to) {
    if (!st || st.done) return;
    const { chess, p } = st;
    const piece = chess.get(from);
    let promotion;
    if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = getSettings().autoQueen ? 'q' : await board.promote(piece.color);
      if (!promotion) { board.setPosition(chess.fen(), { animate: false, check: checkSquare(chess) }); board.setMovable(st.color, destsFrom(chess)); return; }
    }
    const expected = p.sol[st.step];
    const uci = from + to + (promotion || '');
    let move;
    try { move = chess.move({ from, to, promotion }); } catch { return; }
    // Any checkmate is accepted, as in Lichess.
    const correct = uci === expected || chess.isCheckmate();
    if (!correct) {
      chess.undo();
      sound.play('error');
      board.setPosition(move.after, { lastMove: [from, to], animate: true });
      board.setMarks({ [to]: 'wrong' });
      board.setMovable(null);
      if (!st.failed) { st.failed = true; recordResult(false); }
      setStatus('fail', `<b>That's not it.</b><div class="small">Try again, or view the solution.</div>`);
      await sleep(700);
      if (destroyed || !st || st.p !== p) return;
      board.setMarks({});
      board.setPosition(chess.fen(), { lastMove: lastSquares(), check: checkSquare(chess) });
      board.setMovable(st.color, destsFrom(chess));
      return;
    }
    sound.forMove(move, chess);
    board.setMarks({ [to]: 'good' });
    board.setArrows([]);
    board.setPosition(chess.fen(), { lastMove: [from, to], check: checkSquare(chess) });
    board.setMarks({ [to]: 'good' });
    st.step++;
    if (st.step >= p.sol.length || chess.isCheckmate()) return solved();
    // opponent reply
    board.setMovable(null);
    setStatus('ok', `<b>Best move!</b><div class="small">Keep going…</div>`);
    await sleep(500);
    if (destroyed || st.p !== p) return;
    const reply = chess.move(uciToMove(p.sol[st.step]));
    st.step++;
    sound.forMove(reply, chess);
    board.setMarks({});
    board.setPosition(chess.fen(), { lastMove: [reply.from, reply.to], check: checkSquare(chess) });
    board.setMovable(st.color, destsFrom(chess));
    setStatus('turn', `<b>Your move</b><div class="small muted">${st.color === 'w' ? 'White' : 'Black'} to play. Find the follow-up.</div>`);
  }

  function lastSquares() {
    const h = st.chess.history({ verbose: true });
    const m = h[h.length - 1];
    return m ? [m.from, m.to] : null;
  }

  function hint() {
    if (!st || st.done) return;
    const m = uciToMove(st.p.sol[st.step]);
    if (!st.hinted) { st.hinted = true; if (!st.failed) { st.failed = true; recordResult(false, true); } }
    if (!st.hintShown) {
      board.setMarks({ [m.from]: 'hint' });
      st.hintShown = true;
      setStatus('turn', `<b>Hint:</b> move the highlighted piece.<div class="small muted">Hints count as a miss for your rating.</div>`);
    } else {
      board.setArrows([{ from: m.from, to: m.to, color: 'blue' }]);
    }
  }

  async function showSolution() {
    if (!st || st.done) return;
    if (!st.failed) { st.failed = true; recordResult(false); }
    st.done = true;
    board.setMovable(null);
    const { chess, p } = st;
    const g = st;
    while (st.step < p.sol.length) {
      const mv = chess.move(uciToMove(p.sol[st.step]));
      st.step++;
      sound.forMove(mv, chess);
      board.setArrows([]);
      board.setPosition(chess.fen(), { lastMove: [mv.from, mv.to], check: checkSquare(chess) });
      await sleep(800);
      if (destroyed || st !== g) return;
    }
    finishScreen(false);
  }

  function solved() {
    st.done = true;
    board.setMovable(null);
    sound.play('success');
    if (!st.failed) recordResult(true);
    finishScreen(!st.failed);
  }

  function finishScreen(ok) {
    const themes = st.p.th.map(t => themeInfo(t)).filter(Boolean).filter(t => !t.hidden);
    const lesson = themes.find(t => t.explain);
    setStatus(ok ? 'ok' : 'fail', `<b>${ok ? pick(['Puzzle solved!', 'Well done!', 'Excellent!', 'Great find!']) : 'Puzzle complete'}</b>
      <div class="small">${themes.length ? 'Themes: ' + themes.map(t => esc(t.name)).join(', ') : ''}</div>
      ${lesson ? `<div class="small muted" style="margin-top:4px">${lesson.icon} ${lesson.explain}</div>` : ''}`);
    setActions([
      { label: 'Next puzzle', cls: 'primary', fn: next, wide: true },
      { label: 'Retry', cls: 'ghost', fn: () => start(st.p) },
      { label: 'Analyse', cls: 'ghost', fn: analyse },
    ]);
  }

  function analyse() {
    // Simple step-through of the solution line
    const p = st.p;
    const c = new Chess(st.startFen);
    const line = [];
    line.push(c.move(st.lastSetup.san));
    for (const u of p.sol) { try { line.push(c.move(uciToMove(u))); } catch { break; } }
    let i = line.length;
    const show = () => {
      const pos = new Chess(st.startFen);
      for (let k = 0; k < i; k++) pos.move(line[k].san);
      const m = line[i - 1];
      board.setPosition(pos.fen(), { lastMove: m ? [m.from, m.to] : null, check: checkSquare(pos) });
      setStatus('', `<b>Solution:</b> ${line.slice(1).map((m, k) => k + 1 === i - 1 ? `<u>${esc(m.san)}</u>` : esc(m.san)).join(' ')}`);
    };
    setActions([
      { label: '◀ Back', fn: () => { i = Math.max(0, i - 1); show(); } },
      { label: 'Forward ▶', fn: () => { i = Math.min(line.length, i + 1); show(); } },
      { label: 'Next puzzle', cls: 'primary', fn: next, wide: true },
    ]);
    show();
  }

  function recordResult(ok, fromHint = false) {
    const p = st.p;
    if (!ps.seen.includes(p.id)) ps.seen.push(p.id);
    if (ps.seen.length > 4000) ps.seen = ps.seen.slice(-4000);
    let delta = 0;
    if (rated) {
      const expected = 1 / (1 + Math.pow(10, (p.r - ps.rating) / 400));
      const k = ps.games < 15 ? 40 : ps.games < 50 ? 24 : 16;
      delta = Math.round(k * ((ok ? 1 : 0) - expected));
      if (!ok && fromHint) delta = Math.round(delta / 2);
      ps.rating = Math.max(100, ps.rating + delta);
      ps.games++;
    }
    if (ok) { ps.solved++; ps.streak++; ps.bestStreak = Math.max(ps.bestStreak, ps.streak); }
    else { ps.failed++; ps.streak = 0; }
    ps.history.push({ id: p.id, ok, r: p.r });
    if (ps.history.length > 200) ps.history = ps.history.slice(-200);
    store.set('puzzles', ps);
    renderHeader(rated ? delta : 0);
  }

  renderHeader();
  next();
  return () => { destroyed = true; };
}

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
