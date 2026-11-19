// Post-game review. A report first (accuracy, game rating, grades, phases), then the game move
// by move: the board with an eval bar and the grade on the moved piece, a short coach message,
// and the engine's lines played out on the board.
import { Chess } from '../vendor/chess.js';
import { Board, destsFrom, checkSquare } from './board.js';
import { analyser } from './engine.js';
import { botById } from './bots.js';
import { loadOpenings, isBook, lookupOpening } from './openings.js';
import { explainMove, mistakeReason, lineGain, evalWords, shiftWords, reasonList, bandWord } from './explain.js';
import {
  CLASSES, BAD, SYM, CLASS_PHRASE, gradeMoves, gameAccuracy, partAccuracy, gameRating,
} from './grading.js';
import {
  $, esc, store, sound, getSettings, uciToMove, winPct, scoreToCp, classify, CLASS_LABEL, fmtScore,
} from './util.js';

// Stockfish 19 (NNUE). Its depth 13 judges moves better than the old engine's depth 10 did, in a
// quarter of the time; two lines per position show when a move was the only good one.
const REVIEW_VERSION = 2; // reviews made with the old engine are redone
const REVIEW = { depth: 13, multipv: 2, movetime: 2500 };
const RETRY_DEPTH = 14;
// Key moves (your mistakes, possible great and brilliant moves) get a second, deeper look with
// the three best moves, so a grade is not search noise and the better moves shown are the real ones.
const DEEP = { depth: 17, multipv: 3, movetime: 2500 };
const DEEP_AFTER = { depth: 16, movetime: 1500 };
const BIG = ['mistake', 'miss', 'blunder'];
const MATE_CP = 9000; // scoreToCp puts forced mates beyond this
const LINE_STEP_MS = 900;

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
  const me = data.playerColor;
  const them = me === 'w' ? 'b' : 'w';
  const chess = new Chess();
  const verbose = [];
  for (const u of data.moves) { try { verbose.push(chess.move(uciToMove(u))); } catch { break; } }
  const fens = [verbose.length ? verbose[0].before : chess.fen(), ...verbose.map(m => m.after)];
  const N = verbose.length;
  let destroyed = false;
  let cur = 0;
  let mode = 'report'; // 'report' | 'moves' | 'retry'

  view.innerHTML = `
    <div class="card review-report" id="summary"></div>
    <div class="review-stage" id="stage" hidden>
      <div class="review-strip" id="strip">
        <button class="strip-btn" id="reportBtn" aria-label="Back to the report">📊</button>
        <svg class="graph mini" id="graphMini" preserveAspectRatio="none" role="img" aria-label="Who was better, move by move"></svg>
      </div>
      <div class="board-wrap" id="boardWrap"><div class="evalbar" id="evalBar"><div class="fill"></div><div class="num"></div></div></div>
      <div class="coach review-coach" id="coach"><div class="grow"><div class="msg" id="comment"></div><div class="opening" id="openingName"></div></div></div>
      <div class="puzzle-actions" id="retryActions" hidden></div>
      <div class="moves" id="moves"></div>
    </div>
    <div class="navbar bottom-bar" id="navbar" hidden>
      <button class="btn" data-nav="first" aria-label="First move">⏮</button><button class="btn" data-nav="prev" aria-label="Previous move">◀</button>
      <button class="btn" data-nav="next" aria-label="Next move">▶</button><button class="btn" data-nav="last" aria-label="Last move">⏭</button>
      <button class="btn" id="nextMistake">Next mistake</button>
    </div>
    <div class="bottom-bar report-bar" id="reportBar">
      <a class="btn" href="#/play">New game</a><button class="btn primary" id="startBtn" disabled>Start review</button>
    </div>`;

  const board = new Board($('#boardWrap', view), { orientation: me, onMove: (f, t) => onRetryMove(f, t) });
  board.setMovable(null);

  function setMode(m) {
    mode = m;
    $('#summary', view).hidden = m !== 'report';
    $('#reportBar', view).hidden = m !== 'report';
    $('#stage', view).hidden = m === 'report';
    $('#navbar', view).hidden = m !== 'moves';
    for (const id of ['#strip', '#moves', '#evalBar']) $(id, view).hidden = m === 'retry';
    $('#retryActions', view).hidden = m !== 'retry';
    window.scrollTo(0, 0);
  }

  // ---------- analysis ----------
  async function analyse() {
    await loadOpenings();
    if (destroyed) return false;
    const old = data.review;
    if (old && old.v === REVIEW_VERSION && old.cps.length === N + 1) return true;
    const cps = [], best = [], lines = [], alt = [];
    for (let i = 0; i <= N; i++) {
      if (destroyed) return false;
      const c = new Chess(fens[i]);
      if (c.isCheckmate()) { cps.push(c.turn() === 'w' ? -10000 : 10000); best.push(null); lines.push(null); alt.push(null); }
      else if (c.isDraw()) { cps.push(0); best.push(null); lines.push(null); alt.push(null); }
      else {
        const r = await analyser.analyse(fens[i], REVIEW);
        if (destroyed || r.cancelled) return false;
        cps.push(scoreToCp(r.score));
        best.push(r.bestmove);
        lines.push({ score: r.score, pv: (r.lines[0]?.pv || []).slice(0, 10) });
        alt.push(r.lines[1] ? { move: r.lines[1].move, score: r.lines[1].score } : null);
      }
      const p = $('#prog', view); if (p) p.style.width = ((i + 1) / (N + 1) * 100) + '%';
    }
    data.review = { v: REVIEW_VERSION, cps, best, lines, alt };
    saveBack();
    return true;
  }

  const sans = verbose.map(m => m.san);
  const bookAt = i => isBook(sans.slice(0, i + 1));
  const computeMoves = (useDeep = true) =>
    gradeMoves(verbose, fens, useDeep ? data.review : { ...data.review, deep: null }, bookAt);

  // ---------- second look at the key moves ----------
  let deepRun = 0, deepLeft = 0;

  const tried = new Set(); // positions already searched deeper this visit, found or not

  function deepTargets() {
    const deep = data.review.deep || {};
    return computeMoves().filter(m => !deep[m.idx] && !tried.has(m.idx) && m.bestUci && (
      (m.color === me && BAD.includes(m.cls))
      || ['great', 'brilliant'].includes(m.cls)
      // Your best moves where the next best was well behind may turn out to be great.
      || (m.color === me && m.cls === 'best' && m.bestUci === m.lan && gapAt(m.idx) >= 14)));
  }

  function gapAt(i) {
    const a = data.review.alt?.[i];
    if (!a) return 0;
    const sign = verbose[i].color === 'w' ? 1 : -1;
    return winPct(sign * data.review.cps[i]) - winPct(sign * scoreToCp(a.score));
  }

  async function deepen() {
    const run = ++deepRun;
    data.review.deep = data.review.deep || {};
    let todo = deepTargets();
    deepLeft = todo.length;
    while (todo.length) {
      const m = todo[0];
      tried.add(m.idx);
      const r = await analyser.analyse(fens[m.idx], DEEP);
      if (destroyed || run !== deepRun || r.cancelled) return;
      const pos = new Chess(fens[m.idx + 1]);
      // A mate already on the board scores as the review's first pass does: ±10000 for the winner.
      const a = pos.isGameOver()
        ? { score: { cp: pos.isCheckmate() ? (pos.turn() === 'w' ? -10000 : 10000) : 0 }, lines: [], bestmove: null }
        : await analyser.analyse(fens[m.idx + 1], DEEP_AFTER);
      if (destroyed || run !== deepRun || a.cancelled) return;
      if (r.lines.length) {
        data.review.deep[m.idx] = {
          lines: r.lines.map(l => ({ move: l.move, score: l.score, pv: l.pv.slice(0, 10) })),
          after: { score: a.score, pv: (a.lines[0]?.pv || []).slice(0, 10) },
        };
        saveBack();
      }
      moves = computeMoves();
      // A deeper look can turn up new candidates (a miss after a re-graded move), so ask again.
      todo = deepTargets();
      deepLeft = todo.length;
      refresh(m.idx);
    }
    deepLeft = 0;
    refresh();
  }

  /** Show new grades. On the move screen only the move on the board is redrawn, and only if it changed. */
  function refresh(idx = null) {
    if (mode !== 'retry') renderReport(); // kept current while hidden, for the way back
    if (mode !== 'moves') return;
    drawGraph($('#graphMini', view));
    if (line) return;
    if (idx === cur - 1) renderPos(); else renderMoves();
  }

  let moves = null;

  // ---------- key moments ----------
  const KEY = ['brilliant', 'great', 'miss', 'mistake', 'blunder'];

  /** The turning points: up to six, the most important ones, shown in game order. */
  function keyMoments() {
    const weight = m => (m.cls === 'brilliant' ? 100 : m.cls === 'great' ? 40 : m.drop);
    return moves.filter(m => KEY.includes(m.cls)).sort((a, b) => weight(b) - weight(a)).slice(0, 6).sort((a, b) => a.idx - b.idx);
  }

  /** What a key move did, in a few words, as [you-form, they-form]: ["lose a rook", "loses a rook"]. */
  function momentWords(mm) {
    const i = mm.idx, sign = mm.color === 'w' ? 1 : -1;
    const opp = mm.color === 'w' ? 'b' : 'w';
    const { best, pvAfter } = linesFor(mm);
    const bestMv = mm.bestUci && tryMove(fens[i], mm.bestUci);
    if (mm.cls === 'brilliant') return ['give up material, and it works', 'gives up material, and it works'];
    if (mm.cls === 'great') return ['find the only good move', 'finds the only good move'];
    if (mm.cls === 'miss') {
      const g = lineGain(fens[i], best.lines?.[0]?.pv || [], mm.color, 4);
      const tail = bestMv ? ` ${esc(bestMv.san)}${g.gain >= 1 ? `, which wins ${g.text}` : ''}` : ' the chance';
      return [`miss${tail}`, `misses${tail}`];
    }
    if (sign * mm.cpAfter <= -MATE_CP) return ['allow a forced mate', 'allows a forced mate'];
    const lost = lineGain(fens[i], [mm.lan, ...pvAfter], opp, 5);
    if (lost.gain >= 1) return [`lose ${lost.text}`, `loses ${lost.text}`];
    const from = bandWord(sign * data.review.cps[i]), to = bandWord(sign * mm.cpAfter);
    return [`go from ${from} to ${to}`, `goes from ${from} to ${to}`];
  }

  /** One or two sentences on how the game went. */
  function storyHtml(list) {
    const worst = c => moves.filter(m => m.color === c && ['mistake', 'miss', 'blunder'].includes(m.cls)).sort((a, b) => b.drop - a.drop)[0];
    const mine = worst(me), theirs = worst(them);
    const named = m => `<b>${moveNo(m.idx)} ${esc(m.san)}</b>`;
    let out;
    if (mine && theirs && theirs.idx < mine.idx && mine.drop >= theirs.drop / 2) {
      out = `${esc(bot.name)}'s ${named(theirs)} ${momentWords(theirs)[1]}, but then ${named(mine)}: you ${momentWords(mine)[0]}.`;
    } else if (mine && (!theirs || mine.drop >= theirs.drop)) {
      const sign = me === 'w' ? 1 : -1;
      const state = bandWord(sign * data.review.cps[mine.idx]);
      out = `${state === 'about equal' ? 'The game was about equal' : `You were ${state}`} until ${named(mine)}: you ${momentWords(mine)[0]}.`;
    } else if (theirs) {
      out = `The turning point was ${esc(bot.name)}'s ${named(theirs)}: it ${momentWords(theirs)[1]}.`;
    } else out = 'A clean game: neither side made a big mistake.';
    const proud = moves.filter(m => m.color === me && ['brilliant', 'great'].includes(m.cls)).sort((a, b) => (b.cls === 'brilliant') - (a.cls === 'brilliant'))[0];
    if (proud) out += ` Your best moment: ${named(proud)}, ${CLASS_PHRASE[proud.cls]}.`;
    return out;
  }

  function momentsHtml() {
    const list = keyMoments();
    const rows = list.map(m => `<button class="moment" data-ply="${m.idx + 1}"><span class="badge ${m.cls}">${SYM[m.cls]}</span>
      <span class="mn">${moveNo(m.idx)} ${esc(m.san)}</span><span class="mw">${m.color === me ? 'You' : esc(bot.name)} ${momentWords(m)[m.color === me ? 0 : 1]}</span></button>`).join('');
    return `<div class="moments"><div class="story">${storyHtml(list)}</div>${rows ? `<div class="small muted">Key moments</div>${rows}` : ''}</div>`;
  }

  // ---------- report ----------
  const band = a => (a == null ? '' : a >= 90 ? 'best' : a >= 80 ? 'good' : a >= 65 ? 'inaccuracy' : a >= 50 ? 'mistake' : 'blunder');
  const fmtAcc = a => (a == null ? '–' : a.toFixed(1));

  function renderReport() {
    const sum = $('#summary', view);
    const r = data.result;
    const title = !r ? 'Unfinished game' : !r.winner ? 'Draw' : r.winner === me ? 'You won' : 'You lost';
    const sub = `${r ? `by ${esc(r.reason)} · ` : ''}vs ${esc(bot.name)} (~${bot.rating})`;
    const head = `<div class="report-title"><b>${title}</b><span class="small muted">${sub}</span></div>`;
    if (!moves) {
      sum.innerHTML = `${head}<div class="small muted" style="margin-top:10px">Analysing with Stockfish 19…</div>
        <div class="loading-bar" style="margin-top:8px"><div id="prog"></div></div>`;
      return;
    }
    const side = c => moves.filter(m => m.color === c);
    const acc = c => gameAccuracy(moves, data.review.cps, c);
    const cnt = (c, k) => side(c).filter(m => m.cls === k).length;
    const rating = c => gameRating(moves, c);
    const player = (c, name, avatar) => `<div class="rp"><div class="avatar">${avatar}</div><div class="name">${esc(name)}</div></div>`;
    const rows = CLASSES.map(k => `<span class="cl"><span class="badge ${k}">${SYM[k]}</span>${CLASS_LABEL[k]}</span><span class="c ${cnt(me, k) ? k : 'zero'}">${cnt(me, k)}</span><span class="c ${cnt(them, k) ? k : 'zero'}">${cnt(them, k)}</span>`).join('');
    const phases = ['opening', 'middlegame', 'endgame'].map(ph => {
      const a = c => partAccuracy(side(c).filter(m => m.phase === ph && m.cls !== 'book'));
      const cell = v => `<span class="c"><span class="pill ${band(v)}">${v == null ? '–' : Math.round(v)}</span></span>`;
      return `<span class="cl">${ph[0].toUpperCase() + ph.slice(1)}</span>${cell(a(me))}${cell(a(them))}`;
    }).join('');
    const est = c => { const x = rating(c); return x ? `~${x}` : '–'; };
    const list = retryList();
    const last = data.review.retried;
    sum.innerHTML = `${head}
      <div class="report-players">
        ${player(me, 'You', '🙂')}<span></span>${player(them, bot.name, bot.avatar)}
        <div class="big">${fmtAcc(acc(me))}</div><div class="lbl">Accuracy</div><div class="big">${fmtAcc(acc(them))}</div>
        <div class="mid">${est(me)}</div><div class="lbl">Game rating</div><div class="mid">${est(them)}</div>
      </div>
      <svg class="graph" id="graph" preserveAspectRatio="none" role="img" aria-label="Who was better, move by move. Tap to jump there."></svg>
      ${momentsHtml()}
      <div id="retrySlot">${deepLeft ? `<div class="small muted center">Double-checking key moves… ${deepLeft} to go</div>`
        : list.length ? `<button class="btn primary block" id="retryBtn">Learn from your mistakes (${list.length})</button>
        ${last ? `<div class="small muted center" style="margin-top:6px">Last time you found ${last.found} of ${last.total}</div>` : ''}` : ''}</div>
      <div id="details">
        <div class="counts"><span></span><span class="c small muted">You</span><span class="c small muted">${esc(bot.name)}</span>${rows}</div>
        <div class="counts phases"><span class="small muted">By phase</span><span></span><span></span>${phases}</div>
        <div class="small muted">Game rating is a rough estimate from this one game.</div>
      </div>`;
    const retryBtn = $('#retryBtn', view);
    if (retryBtn) retryBtn.addEventListener('click', () => startRetry(retryList()));
    sum.querySelectorAll('.moment').forEach(b => b.addEventListener('click', () => startMoves(+b.dataset.ply)));
    drawGraph($('#graph', view));
  }

  function drawGraph(g) {
    if (!g || !moves) return;
    const cps = data.review.cps;
    const W = Math.max(N, 1);
    g.setAttribute('viewBox', `0 0 ${W} 100`);
    // White's chances fill from the bottom; flip for Black so your side is always at the bottom.
    const y = cp => (me === 'w' ? 100 - winPct(cp) : winPct(cp));
    const pts = cps.map((cp, i) => `${i},${y(cp)}`);
    const area = `M0,100 L${pts.join(' L')} L${N},100 Z`;
    // The chart is stretched to fit, so a round dot needs its radius in each axis's own units.
    const box = g.getBoundingClientRect();
    const px = g.classList.contains('mini') ? 3.5 : 4.5;
    const rx = box.width ? px * W / box.width : W / 70, ry = box.height ? px * 100 / box.height : 6;
    const dots = moves.map((m, i) => (['brilliant', 'great', 'miss', 'mistake', 'blunder'].includes(m.cls)
      ? `<ellipse cx="${i + 1}" cy="${y(cps[i + 1])}" rx="${rx}" ry="${ry}" fill="var(--${m.cls})" stroke="#1c1b19" stroke-width="1" vector-effect="non-scaling-stroke" />` : '')).join('');
    g.innerHTML = `<path d="${area}" fill="#f1eee9"/><line x1="0" x2="${N}" y1="50" y2="50" stroke="#888" stroke-width="0.6" vector-effect="non-scaling-stroke"/>
      ${mode === 'moves' ? `<line class="gcur" x1="${cur}" x2="${cur}" y1="0" y2="100" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>` : ''}${dots}`;
    g.onclick = e => {
      const b = g.getBoundingClientRect();
      startMoves(Math.round((e.clientX - b.left) / b.width * N));
    };
  }

  function renderMoves() {
    let html = '';
    verbose.forEach((m, i) => {
      if (i % 2 === 0) html += `<span class="num">${i / 2 + 1}.</span>`;
      const k = moves && moves[i] && moves[i].cls;
      const col = k && !['best', 'good', 'book'].includes(k) ? `style="color:var(--${k})"` : '';
      const sym = k && !['best', 'good', 'book'].includes(k) ? SYM[k] : '';
      html += `<span class="mv ${i + 1 === cur ? 'cur' : ''}" data-ply="${i + 1}" ${col}>${esc(m.san)}<span class="sym">${sym}</span></span>`;
    });
    const el = $('#moves', view);
    el.innerHTML = html;
    const c = el.querySelector('.cur');
    if (c) el.scrollLeft = c.offsetLeft - el.clientWidth / 2;
  }

  // ---------- engine lines and words ----------
  const tryMove = (fen, uci) => { try { return new Chess(fen).move(uciToMove(uci)); } catch { return null; } };
  const arrowOf = (m, color) => ({ from: m.from, to: m.to, color });
  const moveNo = i => `${Math.ceil((i + 1) / 2)}.${verbose[i].color === 'b' ? '..' : ''}`;

  function analysisAt(i) {
    const l = data.review.lines[i];
    return l ? { score: l.score, lines: [{ pv: l.pv }] } : {};
  }

  /** The engine's line starting with the best move in `mm`'s position, and its line after `mm` was played. */
  function linesFor(mm) {
    const d = data.review.deep?.[mm.idx];
    return {
      best: d ? { score: d.lines[0].score, lines: [d.lines[0]] } : analysisAt(mm.idx),
      pvAfter: d ? d.after.pv : data.review.lines[mm.idx + 1]?.pv || [],
      scoreAfter: d ? d.after.score : data.review.lines[mm.idx + 1]?.score,
      others: d ? d.lines.slice(1) : [],
    };
  }

  /** Why `uci`, played instead of the best move in `mm`'s position, goes wrong. cpAfter is White's POV. */
  function reasonFor(mm, uci, cpAfter, pvAfter, { now = false } = {}) {
    const sign = mm.color === 'w' ? 1 : -1;
    const cpBefore = data.review.cps[mm.idx];
    return mistakeReason(mm.before, uci, {
      bestUci: mm.bestUci, pvBest: linesFor(mm).best.lines?.[0]?.pv, pvAfter,
      mateAgainst: sign * cpAfter <= -MATE_CP,
      hadMate: sign * cpBefore >= MATE_CP,
      now, player: me,
    }) || (mm.color === me ? shiftWords(sign * cpBefore, sign * cpAfter) : '');
  }

  /** "Best was Nc3: it develops your knight…", so a mistake with no tactic still says what was better. */
  function betterWith(mm, best, bestLine) {
    const r = explain(mm.idx, mm.bestUci, bestLine)?.reasons?.[0] || '';
    const head = `Best was <b>${esc(best.san)}</b>`;
    if (!r) return `${head}.`;
    return r.startsWith('It ') ? `${head}: it ${r.slice(3)}` : `${head}. ${r}`;
  }

  function explain(i, uci, analysis) {
    try { return explainMove(fens[i], uci, analysis, verbose[i - 1], me); } catch (e) { console.error('explain failed', e); return null; }
  }

  /** Reasons a move is strong, as a list for the "Why?" box. */
  function whyHtml(i, uci, analysis = analysisAt(i)) {
    const ex = explain(i, uci, analysis);
    if (!ex) return '';
    return `${reasonList(ex.reasons)}${ex.line ? `<div class="small muted">Likely next: ${ex.line}</div>` : ''}`;
  }

  /** The engine's view of the move actually played, in the shape explainMove takes. */
  function playedAnalysis(mm) {
    const { best, pvAfter, scoreAfter } = linesFor(mm);
    return mm.lan === mm.bestUci ? best : { score: scoreAfter, lines: [{ pv: [mm.lan, ...pvAfter] }] };
  }

  /** The eval of the position after ply `ply`, White's view. */
  function scoreAt(ply) {
    if (ply === 0) return data.review?.lines[0]?.score || { cp: 0 };
    return data.review?.deep?.[ply - 1]?.after.score || data.review?.lines[ply]?.score || { cp: data.review?.cps[ply] || 0 };
  }

  function renderEval(ply) {
    const bar = $('#evalBar', view);
    const c = new Chess(fens[ply]);
    const s = scoreAt(ply);
    let cp = scoreToCp(s), text = fmtScore(s).replace('+', '');
    if (c.isCheckmate()) { cp = c.turn() === 'w' ? -10000 : 10000; text = c.turn() === 'w' ? '0-1' : '1-0'; } else if (c.isDraw()) { cp = 0; text = '½'; }
    bar.classList.toggle('flipped', me === 'b');
    bar.querySelector('.fill').style.height = winPct(cp) + '%';
    const num = bar.querySelector('.num');
    num.textContent = text;
    const atBottom = (me === 'w') === (cp >= 0);
    num.style.top = atBottom ? '' : '3px';
    num.style.bottom = atBottom ? '3px' : '';
    num.style.color = cp >= 0 ? '#333' : '#eee';
  }

  /** How the position after ply `ply` stands for the player, in words. */
  function standing(ply) {
    if (new Chess(fens[ply]).isGameOver()) return '';
    const words = evalWords(scoreAt(ply), me);
    return words ? `<div class="small muted">Now ${words}.</div>` : '';
  }

  // ---------- one move, in words ----------
  let acts = [];

  /** -> { body, why, whyLabel, arrows, acts } for move `mm`. */
  function describe(mm) {
    const i = mm.idx, ply = i + 1;
    const mine = mm.color === me;
    const sign = mm.color === 'w' ? 1 : -1;
    const best = mm.bestUci && mm.bestUci !== mm.lan ? tryMove(fens[i], mm.bestUci) : null;
    const { best: bestLine, pvAfter, others } = linesFor(mm);
    const bestPv = bestLine.lines?.[0]?.pv?.length ? bestLine.lines[0].pv : mm.bestUci ? [mm.bestUci] : [];
    const out = { body: '', why: '', whyLabel: 'Why?', arrows: [], acts: [] };
    const showBest = label => best && out.acts.push({ label, fn: () => openLine(fens[i], bestPv, `Best was ${best.san}`) });
    const firstReason = (uci, analysis) => explain(i, uci, analysis)?.reasons?.[0] || '';
    const pct = s => winPct(sign * scoreToCp(s));

    if (mm.cls === 'miss') {
      // They slipped first; what the best move would have done with it.
      const s = bestLine.score;
      let gainTxt = 'kept a winning advantage';
      if (s?.mate != null && Math.sign(s.mate) === sign) gainTxt = 'started a forced checkmate';
      else { const g = lineGain(fens[i], bestPv, mm.color, 4); if (g.gain >= 1) gainTxt = `won ${g.text}`; }
      out.body = `${mine ? `${esc(bot.name)}'s last move was a mistake, and` : 'Your last move gave them a chance:'} <b>${esc(best?.san || '')}</b> would have ${gainTxt}. This move lets the chance slip.`;
      if (best) out.arrows.push(arrowOf(best, 'green'));
      out.why = whyHtml(i, mm.bestUci, bestLine);
      out.whyLabel = `Why ${best?.san || 'that move'}?`;
      showBest('▶ Show the punishment');
    } else if (BAD.includes(mm.cls) && mine) {
      const reason = reasonFor(mm, mm.lan, mm.cpAfter, pvAfter);
      const reply = tryMove(fens[ply], pvAfter[0]); // their best answer to the move played
      if (reply) out.arrows.push(arrowOf(reply, 'red'));
      const vague = !reason || reason.startsWith('It takes you');
      out.body = reason;
      if (reply && vague) out.body += ` Their best answer is <b>${esc(reply.san)}</b>.`;
      if (best) {
        out.arrows.push(arrowOf(best, 'green'));
        out.body += ` ${vague ? betterWith(mm, best, bestLine) : `Best was <b>${esc(best.san)}</b>.`}`;
        // Other moves the engine rated close to its first choice.
        const close = others.map(l => ({ l, mv: tryMove(fens[i], l.move) }))
          .filter(x => x.mv && x.l.move !== mm.lan && pct(bestLine.score) - pct(x.l.score) < 7);
        out.why = whyHtml(i, mm.bestUci, bestLine)
          + (close.length ? `<div class="small muted">Also good: ${close.map(x => `<b>${esc(x.mv.san)}</b>`).join(', ')}.</div>` : '');
        out.whyLabel = `Why ${best.san}?`;
      }
      showBest('▶ Best line');
      if (reply) out.acts.push({ label: '▶ Their reply', fn: () => openLine(fens[ply], pvAfter, `After ${mm.san}`) });
      if (deepLeft && !data.review.deep?.[i]) out.body += '<div class="small muted">Double-checking this move…</div>';
    } else if (BAD.includes(mm.cls)) {
      // The bot slipped: why, and what it offered the player.
      const chance = tryMove(fens[ply], pvAfter[0]);
      const score = linesFor(mm).scoreAfter;
      const mates = chance && score?.mate != null && Math.sign(score.mate) === -sign;
      const reason = mates ? '' : reasonFor(mm, mm.lan, mm.cpAfter, pvAfter, { now: true });
      out.body = `${reason}${best ? ` Better was <b>${esc(best.san)}</b>.` : ''}`;
      if (best) out.arrows.push(arrowOf(best, 'green'));
      if (mates) {
        out.body += ` It let you force checkmate, starting with <b>${esc(chance.san)}</b> (blue arrow).`;
        out.arrows.push(arrowOf(chance, 'blue'));
        out.acts.push({ label: '▶ Show the mate', fn: () => openLine(fens[ply], pvAfter, `Mate after ${mm.san}`) });
      } else if (chance) {
        const g = lineGain(fens[ply], pvAfter, me, 4);
        if (g.gain >= 1) {
          // The reason may already tell the line; the arrow and the button still show it.
          if (!reason.includes(esc(chance.san))) out.body += ` It gave you the chance to win ${g.text} with <b>${esc(chance.san)}</b> (blue arrow).`;
          out.arrows.push(arrowOf(chance, 'blue'));
          out.acts.push({ label: '▶ How to punish it', fn: () => openLine(fens[ply], pvAfter, `Punishing ${mm.san}`) });
        }
      }
    } else if (mm.cls === 'book') {
      const o = lookupOpening(sans.slice(0, ply));
      out.body = `A known opening move${o ? ` of the <b>${esc(o.name)}</b>` : ''}.`;
    } else {
      const played = playedAnalysis(mm);
      const reason = firstReason(mm.lan, played);
      if (mm.cls === 'brilliant') {
        out.body = `${mine ? 'You give' : 'They give'} up material on purpose, and it works. ${reason}`;
      } else if (mm.cls === 'great') {
        const d = data.review.deep?.[i];
        const altUci = d ? d.lines[1]?.move : data.review.alt?.[i]?.move;
        const altMv = altUci && tryMove(fens[i], altUci);
        out.body = `The only good move here.${altMv ? ` Even the next best, <b>${esc(altMv.san)}</b>, is much worse.` : ''} ${reason}`;
      } else if (mm.cls === 'good' && best) {
        out.body = `${reason} The engine slightly preferred <b>${esc(best.san)}</b>.`;
        out.arrows.push(arrowOf(best, 'green'));
        showBest('▶ Engine line');
      } else out.body = reason;
      out.why = whyHtml(i, mm.lan, played);
      if (pvAfter.length && mm.cls !== 'good') out.acts.push({ label: '▶ How it goes on', fn: () => openLine(fens[ply], pvAfter, `After ${mm.san}`) });
    }
    return out;
  }

  function renderPos() {
    if (line) { renderLine(); return; }
    const m = verbose[cur - 1];
    board.setPosition(fens[cur], { lastMove: m ? [m.from, m.to] : null, check: checkSquare(new Chess(fens[cur])) });
    board.setMarks({});
    board.setBadge(null);
    acts = [];
    let html = '';
    let arrows = [];
    if (moves && data.review) renderEval(cur);
    if (cur === 0) html = 'Starting position. Tap ▶ to step through the game, or <b>Next mistake</b> to jump to the moves that mattered.';
    else if (moves) {
      const mm = moves[cur - 1];
      const mine = mm.color === me;
      board.setBadge({ square: mm.to, cls: mm.cls, sym: SYM[mm.cls] });
      const d = describe(mm);
      arrows = d.arrows;
      acts = d.acts;
      if (d.why) acts.push({ label: d.whyLabel, why: true });
      html = `<div class="rv-head"><span class="badge ${mm.cls}">${SYM[mm.cls]}</span>
          <div>${mine ? 'Your move' : `${esc(bot.name)}'s move`} <b>${moveNo(mm.idx)} ${esc(mm.san)}</b> is ${CLASS_PHRASE[mm.cls]}.</div></div>
        <div class="rv-body">${d.body}</div>${standing(cur)}
        ${actsHtml()}
        ${d.why ? `<div class="why-box" hidden>${d.why}</div>` : ''}`;
    } else html = esc(m.san);
    board.setArrows(arrows);
    $('#comment', view).innerHTML = html;
    const o = lookupOpening(sans.slice(0, cur));
    $('#openingName', view).textContent = o ? `${o.eco} · ${o.name}` : '';
    renderMoves();
    const gc = view.querySelector('#graphMini .gcur'); if (gc) { gc.setAttribute('x1', cur); gc.setAttribute('x2', cur); }
  }

  const actsHtml = () => (acts.length ? `<div class="coach-acts">${acts.map((a, k) => `<button data-act="${k}">${esc(a.label)}</button>`).join('')}</div>` : '');

  $('#comment', view).addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b) {
      const a = acts[+b.dataset.act];
      if (!a) return;
      if (a.why) {
        const box = $('#comment .why-box', view);
        box.hidden = !box.hidden;
        b.classList.toggle('on', !box.hidden);
      } else a.fn();
      return;
    }
    const li = e.target.closest('[data-li]');
    if (li && line) { stopAuto(); line.i = +li.dataset.li; renderLine(true); }
  });

  // ---------- engine lines on the board ----------
  let line = null; // { title, fens, moves, i, timer }

  function openLine(startFen, pv, title) {
    const c = new Chess(startFen);
    const mv = [], fs = [startFen];
    for (const u of (pv || []).slice(0, 10)) {
      let x;
      try { x = c.move(uciToMove(u)); } catch { break; }
      mv.push(x); fs.push(c.fen());
    }
    if (!mv.length) return;
    line = { title, fens: fs, moves: mv, i: 0, timer: null };
    $('#nextMistake', view).textContent = 'Close line';
    renderLine();
    line.timer = setInterval(() => {
      if (!line || line.i >= line.moves.length) { stopAuto(); return; }
      line.i++;
      renderLine(true);
    }, LINE_STEP_MS);
  }

  function stopAuto() { if (line?.timer) { clearInterval(line.timer); line.timer = null; } }

  function closeLine() {
    stopAuto();
    line = null;
    $('#nextMistake', view).textContent = 'Next mistake';
    renderPos();
  }

  function stepLine(to) {
    stopAuto();
    const n = Math.max(0, Math.min(line.moves.length, to));
    if (n === line.i) return;
    line.i = n;
    renderLine(true);
  }

  function renderLine(withSound = false) {
    const m = line.moves[line.i - 1];
    const c = new Chess(line.fens[line.i]);
    board.setPosition(line.fens[line.i], { lastMove: m ? [m.from, m.to] : null, check: checkSquare(c) });
    board.setArrows([]);
    board.setBadge(null);
    board.setMarks({});
    if (m && withSound) sound.forMove(m, c);
    const start = line.fens[0].split(' ');
    let no = +start[5] || 1, white = start[1] === 'w';
    let chips = '';
    line.moves.forEach((x, k) => {
      if (white) chips += `<span class="num">${no}.</span>`;
      else if (k === 0) chips += `<span class="num">${no}…</span>`;
      chips += `<span class="mv ${k + 1 === line.i ? 'cur' : ''}" data-li="${k + 1}">${esc(x.san)}</span>`;
      if (!white) no++;
      white = !white;
    });
    acts = [{ label: '✕ Back to the game', fn: closeLine }];
    $('#comment', view).innerHTML = `<div class="rv-head"><span class="badge line">▶</span><div><b>${esc(line.title)}</b>
      <span class="small muted">${line.i}/${line.moves.length}</span></div></div>
      <div class="line-moves">${chips}</div>${actsHtml()}`;
  }

  // ---------- navigation ----------
  function go(ply) {
    if (line) { stopAuto(); line = null; $('#nextMistake', view).textContent = 'Next mistake'; }
    const n = Math.max(0, Math.min(N, ply));
    if (mode === 'retry') return;
    if (n === cur && mode === 'moves') { renderPos(); return; }
    const m = verbose[n - 1];
    cur = n;
    if (mode !== 'moves') startMoves(n);
    else renderPos();
    if (m && n > 0) sound.forMove(m, new Chess(fens[n]));
  }

  function startMoves(ply = cur || 1) {
    if (!moves) return;
    cur = Math.max(0, Math.min(N, ply));
    setMode('moves');
    drawGraph($('#graphMini', view));
    renderPos();
  }

  function nextMistake() {
    if (line) { closeLine(); return; }
    if (!moves) return;
    for (let k = 1; k <= N; k++) {
      const i = (cur + k - 1) % N; // index into moves (ply i+1)
      const m = moves[i];
      if (m.color === me && BAD.includes(m.cls)) { line = null; cur = i + 1; startMoves(cur); return; }
    }
    if (mode !== 'moves') startMoves();
    $('#comment', view).innerHTML = 'No mistakes found for you in this game. Well played! 🎉';
  }

  // ---------- learn from your mistakes ----------
  // Replays your worst moves so you can find the better move yourself.
  let retry = null; // { list, i, found, missed, tries, hinted, token }

  function retryList() {
    const mine = moves.filter(m => m.color === me && m.bestUci && m.bestUci !== m.lan);
    const big = mine.filter(m => BIG.includes(m.cls));
    return big.length ? big : mine.filter(m => m.cls === 'inaccuracy');
  }

  function setRetryActions(btns) {
    const a = $('#retryActions', view);
    a.innerHTML = btns.map((b, i) => `<button class="btn ${b.cls || ''} ${btns.length === 1 || b.wide ? 'wide' : ''}" data-i="${i}">${b.label}</button>`).join('');
    a.onclick = e => { const b = e.target.closest('[data-i]'); if (b) btns[+b.dataset.i].fn(); };
  }

  function startRetry(list) {
    if (line) { stopAuto(); line = null; }
    retry = { list, i: 0, found: 0, missed: [], tries: 0, hinted: false, token: 0 };
    setMode('retry');
    $('#openingName', view).textContent = '';
    showRetry();
  }

  function exitRetry() {
    retry = null;
    analyser.stop();
    board.setMovable(null);
    setMode('report');
    renderReport();
  }

  function showRetry() {
    const m = retry.list[retry.i];
    const prev = verbose[m.idx - 1];
    const c = new Chess(fens[m.idx]);
    const best = uciToMove(m.bestUci);
    retry.token++;
    board.setArrows([]);
    board.setBadge(null);
    board.setMarks(retry.hinted ? { [best.from]: 'hint' } : {});
    board.setPosition(fens[m.idx], { lastMove: prev ? [prev.from, prev.to] : null, check: checkSquare(c), animate: false });
    board.setMovable(me, destsFrom(c));
    const lead = m.cls === 'miss' ? `${esc(bot.name)} just made a mistake, and you played` : 'You played';
    $('#comment', view).innerHTML = `<b>${retry.i + 1} of ${retry.list.length}.</b> ${lead} <span class="tag ${m.cls}">${esc(m.san)}</span> here. Find a better move.
      ${retry.hinted ? '<div class="small muted">💡 Look at the highlighted piece.</div>' : ''}`;
    setRetryActions([
      { label: 'Hint', fn: () => { retry.hinted = true; showRetry(); } },
      { label: 'Show answer', fn: revealRetry },
      { label: 'Stop', cls: 'ghost', wide: true, fn: exitRetry },
    ]);
  }

  function nextRetry() {
    retry.i++;
    retry.tries = 0;
    retry.hinted = false;
    if (retry.i < retry.list.length) showRetry(); else endRetry();
  }

  async function onRetryMove(from, to) {
    if (!retry) return;
    const m = retry.list[retry.i];
    const c = new Chess(fens[m.idx]);
    const piece = c.get(from);
    let promotion;
    if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = getSettings().autoQueen ? 'q' : await board.promote(piece.color);
      if (!retry) return;
      if (!promotion) { showRetry(); return; }
    }
    let mv;
    try { mv = c.move({ from, to, promotion }); } catch { showRetry(); return; }
    const token = ++retry.token;
    sound.forMove(mv, c);
    board.setMarks({});
    board.setPosition(c.fen(), { lastMove: [from, to], check: checkSquare(c) });
    board.setMovable(null);

    if (mv.lan === m.bestUci) { solveRetry(m, mv, linesFor(m).best, true); return; }
    if (c.isCheckmate()) { solveRetry(m, mv, {}, true); return; }
    if (mv.lan === m.lan) { failRetry(m, mv, m.cpAfter, linesFor(m).pvAfter, 'That is the move from the game.'); return; }

    $('#comment', view).textContent = 'Checking your move…';
    setRetryActions([]);
    const r = await evalAfter(c);
    const bestCp = await bestCpAfter(m);
    if (destroyed || !retry || token !== retry.token || r.cancelled || bestCp == null) return;
    const sign = m.color === 'w' ? 1 : -1;
    const cpAfter = scoreToCp(r.score);
    const bestWin = winPct(sign * bestCp);
    const drop = bestWin - winPct(sign * cpAfter);
    if (['best', 'good'].includes(classify(drop, false))) {
      solveRetry(m, mv, { score: r.score, lines: [{ pv: [mv.lan, ...(r.lines[0]?.pv || [])] }] }, false);
    } else {
      const improved = drop < (bestWin - winPct(sign * m.cpAfter)) / 2;
      failRetry(m, mv, cpAfter, r.lines[0]?.pv || [], improved ? 'Better than the game move, but there is something stronger.' : '');
    }
  }

  function evalAfter(c) {
    if (c.isCheckmate()) return { score: { mate: c.turn() === 'w' ? -1 : 1 }, bestmove: null, lines: [] };
    if (c.isDraw()) return { score: { cp: 0 }, bestmove: null, lines: [] };
    return analyser.analyse(c.fen(), { depth: RETRY_DEPTH });
  }

  // A try is compared with the position after the best move, so both scores come from
  // the same side to move at the same depth.
  async function bestCpAfter(m) {
    if (m.bestCp == null) {
      const c = new Chess(fens[m.idx]);
      c.move(uciToMove(m.bestUci));
      const r = await evalAfter(c);
      if (!r.cancelled) m.bestCp = scoreToCp(r.score);
    }
    return m.bestCp;
  }

  function solveRetry(m, mv, analysis, isBest) {
    retry.found++;
    let topSan = '';
    try { topSan = new Chess(fens[m.idx]).move(uciToMove(m.bestUci)).san; } catch { }
    $('#comment', view).innerHTML = `<span class="tag best">Found it</span> <b>${esc(mv.san)}</b> ${isBest ? 'is the best move here.' : `works well too. The engine's top choice was <b>${esc(topSan)}</b>.`}
      ${whyHtml(m.idx, mv.lan, analysis)}`;
    setRetryActions([{ label: 'Next', cls: 'primary', fn: nextRetry }]);
  }

  function failRetry(m, mv, cpAfter, pvAfter, lead) {
    retry.tries++;
    if (retry.tries >= 2) retry.hinted = true;
    let reply = null;
    try { reply = new Chess(mv.after).move(uciToMove(pvAfter[0])); } catch { }
    board.setArrows(reply ? [{ from: reply.from, to: reply.to, color: 'red' }] : []);
    const reason = reasonFor(m, mv.lan, cpAfter, pvAfter) || (reply ? `They can answer <b>${esc(reply.san)}</b> (red arrow).` : '');
    $('#comment', view).innerHTML = `<span class="tag mistake">Not quite</span> ${lead} ${reason}`;
    setRetryActions([
      { label: 'Try again', cls: 'primary', fn: showRetry },
      { label: 'Show answer', fn: revealRetry },
    ]);
  }

  function revealRetry() {
    const m = retry.list[retry.i];
    retry.token++;
    retry.missed.push(m);
    const c = new Chess(fens[m.idx]);
    const best = c.move(uciToMove(m.bestUci));
    board.setMarks({});
    board.setPosition(fens[m.idx], { check: checkSquare(new Chess(fens[m.idx])), animate: false });
    board.setMovable(null);
    board.setArrows([{ from: best.from, to: best.to, color: 'green' }]);
    const { best: bestLine, pvAfter } = linesFor(m);
    $('#comment', view).innerHTML = `The best move was <b>${esc(best.san)}</b>.${whyHtml(m.idx, m.bestUci, bestLine)}
      <div class="small muted">You played <b>${esc(m.san)}</b>. ${reasonFor(m, m.lan, m.cpAfter, pvAfter)}</div>`;
    setRetryActions([{ label: 'Next', cls: 'primary', fn: nextRetry }]);
  }

  function endRetry() {
    const { list, found, missed } = retry;
    if (list.length === retryList().length) { data.review.retried = { found, total: list.length }; saveBack(); }
    board.setArrows([]);
    $('#comment', view).innerHTML = `You found <b>${found}</b> of <b>${list.length}</b> on your own. ${missed.length ? 'Try the rest again while they are fresh.' : 'Well done! 🎉'}`;
    setRetryActions([
      ...(missed.length ? [{ label: `Retry the ${missed.length} you missed`, cls: 'primary', wide: true, fn: () => startRetry(missed) }] : []),
      { label: 'Back to review', wide: true, fn: exitRetry },
    ]);
  }

  // ---------- wiring ----------
  $('#navbar', view).addEventListener('click', e => {
    const b = e.target.closest('[data-nav]'); if (!b) return;
    if (line) {
      ({ first: () => stepLine(0), prev: () => stepLine(line.i - 1), next: () => stepLine(line.i + 1), last: () => stepLine(line.moves.length) })[b.dataset.nav]();
      return;
    }
    ({ first: () => go(0), prev: () => go(cur - 1), next: () => go(cur + 1), last: () => go(N) })[b.dataset.nav]();
  });
  $('#moves', view).addEventListener('click', e => { const m = e.target.closest('[data-ply]'); if (m) go(+m.dataset.ply); });
  $('#nextMistake', view).addEventListener('click', nextMistake);
  $('#startBtn', view).addEventListener('click', () => startMoves(cur || 1));
  $('#reportBtn', view).addEventListener('click', () => {
    if (line) { stopAuto(); line = null; $('#nextMistake', view).textContent = 'Next mistake'; }
    setMode('report');
    renderReport();
  });

  // Swipe left/right on the comment area to navigate
  let sx = null;
  const coach = $('#coach', view);
  coach.addEventListener('pointerdown', e => { sx = e.clientX; });
  coach.addEventListener('pointerup', e => {
    if (sx == null || mode !== 'moves') return;
    const dx = e.clientX - sx; sx = null;
    if (Math.abs(dx) <= 40) return;
    if (line) stepLine(line.i + (dx < 0 ? 1 : -1)); else go(cur + (dx < 0 ? 1 : -1));
  });

  renderReport();
  analyse().then(ok => {
    if (!ok || destroyed) return;
    moves = computeMoves();
    deepLeft = deepTargets().length;
    $('#startBtn', view).disabled = false;
    renderReport();
    deepen();
  });

  // Arrow keys step through the game on a computer.
  const onKey = e => {
    if (mode !== 'moves' || e.target.closest('input, select, textarea')) return;
    if (line) {
      const to = { ArrowLeft: line.i - 1, ArrowRight: line.i + 1, Home: 0, End: line.moves.length }[e.key];
      if (to != null) { e.preventDefault(); stepLine(to); } else if (e.key === 'Escape') closeLine();
      return;
    }
    const to = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: N }[e.key];
    if (to != null) { e.preventDefault(); go(to); }
  };
  window.addEventListener('keydown', onKey);

  return () => { destroyed = true; stopAuto(); analyser.stop(); window.removeEventListener('keydown', onKey); };
}
