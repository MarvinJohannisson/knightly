// Post-game review: engine analysis of every move, accuracy, mistakes and best moves.
import { Chess } from '../vendor/chess.js';
import { Board, checkSquare } from './board.js';
import { engine } from './engine.js';
import { botById } from './bots.js';
import { loadOpenings, isBook, lookupOpening } from './openings.js';
import {
  $, esc, store, sound, uciToMove, winPct, scoreToCp, classify, CLASS_LABEL, moveAccuracy,
} from './util.js';

const REVIEW_DEPTH = 10;
const SYM = { inaccuracy: '?!', mistake: '?', blunder: '??' };

export function renderReview(view, param) {
  let data, saveBack;
  if (param && param.startsWith('a')) {
    const archive = store.get('archive', []);
    const i = +param.slice(1);
    data = archive[i];
    saveBack = () => { archive[i] = data; store.set('archive', archive); };
  } else {
    data = store.get('game', null);
    saveBack = () => {
      const cur = store.get('game', null);
      if (cur && cur.started === data.started) store.set('game', data);
      const archive = store.get('archive', []);
      const ai = archive.findIndex(a => a.started === data.started);
      if (ai >= 0) { archive[ai].review = data.review; store.set('archive', archive); }
    };
  }
  if (!data || !data.moves.length) {
    view.innerHTML = `<div class="card center"><p>No game to review yet.</p><a class="btn primary" href="#/play">Play a game</a></div>`;
    return;
  }

  const bot = botById(data.botId);
  const chess = new Chess();
  const verbose = [];
  for (const u of data.moves) { try { verbose.push(chess.move(uciToMove(u))); } catch { break; } }
  const fens = [verbose.length ? verbose[0].before : chess.fen(), ...verbose.map(m => m.after)];
  const N = verbose.length;
  let destroyed = false;
  let cur = N;

  view.innerHTML = `
    <div class="card" id="summary"><div class="small muted">Analysing with Stockfish…</div><div class="loading-bar" style="margin-top:8px"><div id="prog"></div></div></div>
    <div style="height:10px"></div>
    <div class="board-wrap" id="boardWrap"></div>
    <div class="coach" id="coach"><div class="avatar">🎓</div><div class="grow"><div class="msg" id="comment"></div><div class="opening" id="openingName"></div></div></div>
    <div class="moves" id="moves"></div>
    <div class="navbar">
      <button class="btn" data-nav="first">⏮</button><button class="btn" data-nav="prev">◀</button>
      <button class="btn" data-nav="next">▶</button><button class="btn" data-nav="last">⏭</button>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px;max-width:560px;margin-inline:auto">
      <button class="btn" id="nextMistake">Next mistake</button>
      <a class="btn" href="#/play">New game</a>
    </div>`;

  const board = new Board($('#boardWrap', view), { orientation: data.playerColor });
  board.setMovable(null);

  // ---------- analysis ----------
  async function analyse() {
    if (data.review && data.review.cps && data.review.cps.length === N + 1) return true;
    await loadOpenings();
    const cps = [], best = [];
    for (let i = 0; i <= N; i++) {
      if (destroyed) return false;
      const c = new Chess(fens[i]);
      if (c.isCheckmate()) { cps.push(c.turn() === 'w' ? -10000 : 10000); best.push(null); }
      else if (c.isDraw()) { cps.push(0); best.push(null); }
      else {
        const r = await engine.analyse(fens[i], { depth: REVIEW_DEPTH });
        if (destroyed || r.cancelled) return false;
        cps.push(scoreToCp(r.score));
        best.push(r.bestmove);
      }
      const p = $('#prog', view); if (p) p.style.width = ((i + 1) / (N + 1) * 100) + '%';
    }
    data.review = { cps, best };
    saveBack();
    return true;
  }

  function computeMoves() {
    const { cps, best } = data.review;
    const sans = verbose.map(m => m.san);
    return verbose.map((m, i) => {
      const sign = m.color === 'w' ? 1 : -1;
      const before = sign * cps[i], after = sign * cps[i + 1];
      const drop = Math.max(0, winPct(before) - winPct(after));
      let cls = classify(drop, best[i] === m.lan);
      if (i < 24 && isBook(sans.slice(0, i + 1))) cls = 'book';
      return { ...m, drop, cls, bestUci: best[i], cpAfter: cps[i + 1] };
    });
  }

  let moves = null;

  function renderSummary() {
    const me = data.playerColor;
    const side = c => moves.filter(m => m.color === c);
    const acc = c => { const s = side(c); return s.length ? Math.round(s.reduce((a, m) => a + moveAccuracy(m.drop), 0) / s.length) : 0; };
    const cnt = (c, k) => side(c).filter(m => m.cls === k).length;
    const them = me === 'w' ? 'b' : 'w';
    const r = data.result;
    const resultTxt = !r ? 'Unfinished game' : !r.winner ? `Draw by ${r.reason}` : r.winner === me ? `You won by ${r.reason}` : `${bot.name} won by ${r.reason}`;
    const rows = ['book', 'best', 'good', 'inaccuracy', 'mistake', 'blunder'].map(k =>
      `<span><span class="tag ${k}">${SYM[k] || (k === 'best' ? '★' : k === 'book' ? '📖' : '✓')}</span> ${CLASS_LABEL[k]}</span><span class="c">${cnt(me, k)}</span><span class="c">${cnt(them, k)}</span>`).join('');
    $('#summary', view).innerHTML = `
      <div class="small muted center" style="margin-bottom:8px">${esc(resultTxt)} · vs ${esc(bot.name)} (~${bot.rating})</div>
      <div class="review-summary">
        <div class="acc"><div class="v">${acc(me)}%</div><div class="who">Your accuracy</div></div>
        <div class="acc"><div class="v">${acc(them)}%</div><div class="who">${esc(bot.name)}</div></div>
      </div>
      <div style="margin:12px 0 4px"><svg class="graph" id="graph" viewBox="0 0 ${Math.max(N, 1)} 100" preserveAspectRatio="none"></svg></div>
      <div class="counts" style="margin-top:10px"><span></span><span class="c small muted">You</span><span class="c small muted">${esc(bot.name)}</span>${rows}</div>`;
    drawGraph();
  }

  function drawGraph() {
    const g = $('#graph', view); if (!g) return;
    const cps = data.review.cps;
    const pts = cps.map((cp, i) => `${i},${100 - winPct(cp)}`);
    const area = `M0,100 L${pts.join(' L')} L${N},100 Z`;
    const dots = moves.map((m, i) => (m.cls === 'mistake' || m.cls === 'blunder')
      ? `<circle cx="${i + 1}" cy="${100 - winPct(cps[i + 1])}" r="${Math.max(N / 80, 0.6)}" fill="var(--${m.cls})" />` : '').join('');
    g.innerHTML = `<path d="${area}" fill="#f1eee9"/><line x1="0" x2="${N}" y1="50" y2="50" stroke="#888" stroke-width="0.6" vector-effect="non-scaling-stroke"/>
      <line id="gcur" x1="${cur}" x2="${cur}" y1="0" y2="100" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>${dots}`;
    g.onclick = e => {
      const r = g.getBoundingClientRect();
      go(Math.round((e.clientX - r.left) / r.width * N));
    };
  }

  function renderMoves() {
    let html = '';
    verbose.forEach((m, i) => {
      if (i % 2 === 0) html += `<span class="num">${i / 2 + 1}.</span>`;
      const mm = moves && moves[i];
      const k = mm && mm.cls;
      const col = k && SYM[k] ? `style="color:var(--${k === 'inaccuracy' ? 'inacc' : k})"` : '';
      html += `<span class="mv ${i + 1 === cur ? 'cur' : ''}" data-ply="${i + 1}" ${col}>${esc(m.san)}<span class="sym">${(k && SYM[k]) || ''}</span></span>`;
    });
    const el = $('#moves', view);
    el.innerHTML = html;
    const c = el.querySelector('.cur');
    if (c) el.scrollLeft = c.offsetLeft - el.clientWidth / 2;
  }

  function fmtCp(cp) {
    if (Math.abs(cp) >= 9000) return cp > 0 ? 'White mates' : 'Black mates';
    const v = cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(1);
  }

  function renderPos() {
    const m = verbose[cur - 1];
    board.setPosition(fens[cur], { lastMove: m ? [m.from, m.to] : null, check: checkSquare(new Chess(fens[cur])) });
    const arrows = [];
    let comment = cur === 0 ? 'Starting position. Use the arrows to step through the game.' : '';
    if (moves && cur > 0) {
      const mm = moves[cur - 1];
      const moveNo = `${Math.ceil(cur / 2)}.${mm.color === 'b' ? '..' : ''}`;
      const who = mm.color === data.playerColor ? 'You' : bot.name;
      let bestSan = '';
      if (mm.bestUci && mm.bestUci !== mm.lan) {
        try { const b = new Chess(fens[cur - 1]).move(uciToMove(mm.bestUci)); bestSan = b.san; arrows.push({ from: b.from, to: b.to, color: 'green' }); } catch { }
      }
      const label = CLASS_LABEL[mm.cls];
      comment = `<span class="tag ${mm.cls}">${label}</span> ${esc(who)} played <b>${moveNo} ${esc(mm.san)}</b>.`;
      if (['inaccuracy', 'mistake', 'blunder'].includes(mm.cls) && bestSan) comment += ` Better was <b>${esc(bestSan)}</b> (green arrow).`;
      else if (mm.cls === 'good' && bestSan) comment += ` <span class="muted">Engine preferred ${esc(bestSan)}.</span>`;
      comment += ` <span class="muted small">Eval: ${fmtCp(mm.cpAfter)}</span>`;
      board.setMarks({ [mm.to]: mm.cls === 'blunder' || mm.cls === 'mistake' ? 'wrong' : mm.cls === 'best' ? 'good' : undefined });
    } else board.setMarks({});
    board.setArrows(arrows);
    $('#comment', view).innerHTML = comment || `${esc(verbose[cur - 1]?.san || '')}`;
    const o = lookupOpening(verbose.slice(0, cur).map(x => x.san));
    $('#openingName', view).textContent = o ? `${o.eco} · ${o.name}` : '';
    renderMoves();
    const gc = $('#gcur', view); if (gc) { gc.setAttribute('x1', cur); gc.setAttribute('x2', cur); }
  }

  function go(ply) {
    const n = Math.max(0, Math.min(N, ply));
    if (n === cur) return;
    const m = verbose[n - 1];
    cur = n;
    renderPos();
    if (m && n > 0) sound.forMove(m, new Chess(fens[n]));
  }

  view.querySelector('.navbar').addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    ({ first: () => go(0), prev: () => go(cur - 1), next: () => go(cur + 1), last: () => go(N) })[b.dataset.nav]();
  });
  $('#moves', view).addEventListener('click', e => { const m = e.target.closest('[data-ply]'); if (m) go(+m.dataset.ply); });
  $('#nextMistake', view).addEventListener('click', () => {
    if (!moves) return;
    for (let k = 1; k <= N; k++) {
      const i = (cur + k - 1) % N; // index into moves (ply i+1)
      const m = moves[i];
      if (m.color === data.playerColor && ['inaccuracy', 'mistake', 'blunder'].includes(m.cls)) { go(i + 1); return; }
    }
    $('#comment', view).innerHTML = 'No mistakes found for you in this game. Well played! 🎉';
  });

  // Swipe left/right on the comment area to navigate
  let sx = null;
  const coach = $('#coach', view);
  coach.addEventListener('pointerdown', e => { sx = e.clientX; });
  coach.addEventListener('pointerup', e => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1)); });

  renderPos();
  loadOpenings().then(() => !destroyed && renderPos());
  analyse().then(ok => {
    if (!ok || destroyed) return;
    moves = computeMoves();
    renderSummary();
    cur = 0;
    renderPos();
  });

  return () => { destroyed = true; engine.stop(); };
}
