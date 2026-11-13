// Post-game review: engine analysis of every move, accuracy, mistakes and best moves.
import { Chess } from '../vendor/chess.js';
import { Board, destsFrom, checkSquare } from './board.js';
import { engine } from './engine.js';
import { botById } from './bots.js';
import { loadOpenings, isBook, lookupOpening } from './openings.js';
import { explainMove, mistakeReason, lineGain, evalWords, shiftWords, reasonList } from './explain.js';
import {
  $, esc, store, sound, getSettings, uciToMove, winPct, scoreToCp, classify, CLASS_LABEL, moveAccuracy,
} from './util.js';

const REVIEW_DEPTH = 10;
const RETRY_DEPTH = 12; // at depth 10, noise can reject sound moves
// Moves flagged by the quick pass get a second, deeper look with the three best moves, so a
// "mistake" is not just search noise and the better moves shown are the real ones.
const DEEP = { depth: 13, multipv: 3, movetime: 1800 };
const DEEP_AFTER = { depth: 12, movetime: 1200 };
const BAD = ['inaccuracy', 'mistake', 'blunder'];
const SYM = { inaccuracy: '?!', mistake: '?', blunder: '??' };
const MATE_CP = 9000; // scoreToCp puts forced mates beyond this

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
    <div class="card review-head" id="summary"><div class="small muted">Analysing with Stockfish…</div><div class="loading-bar" style="margin-top:8px"><div id="prog"></div></div></div>
    <div class="board-wrap" id="boardWrap"></div>
    <div class="coach" id="coach"><div class="avatar">🎓</div><div class="grow"><div class="msg" id="comment"></div><div class="opening" id="openingName"></div></div></div>
    <div class="puzzle-actions" id="retryActions" hidden></div>
    <div class="moves" id="moves"></div>
    <div class="review-more" id="reviewLinks">
      <div id="retrySlot"></div>
      <div class="card" id="details" hidden></div>
      <a class="btn block" href="#/play">New game</a>
    </div>
    <div class="navbar bottom-bar">
      <button class="btn" data-nav="first" aria-label="First move">⏮</button><button class="btn" data-nav="prev" aria-label="Previous move">◀</button>
      <button class="btn" data-nav="next" aria-label="Next move">▶</button><button class="btn" data-nav="last" aria-label="Last move">⏭</button>
      <button class="btn" id="nextMistake">Next mistake</button>
    </div>`;

  const board = new Board($('#boardWrap', view), { orientation: data.playerColor, onMove: (f, t) => onRetryMove(f, t) });
  board.setMovable(null);

  // ---------- analysis ----------
  async function analyse() {
    await loadOpenings();
    if (destroyed) return false;
    if (data.review && data.review.lines && data.review.cps.length === N + 1) return true;
    const cps = [], best = [], lines = [];
    for (let i = 0; i <= N; i++) {
      if (destroyed) return false;
      const c = new Chess(fens[i]);
      if (c.isCheckmate()) { cps.push(c.turn() === 'w' ? -10000 : 10000); best.push(null); lines.push(null); }
      else if (c.isDraw()) { cps.push(0); best.push(null); lines.push(null); }
      else {
        const r = await engine.analyse(fens[i], { depth: REVIEW_DEPTH });
        if (destroyed || r.cancelled) return false;
        cps.push(scoreToCp(r.score));
        best.push(r.bestmove);
        lines.push({ score: r.score, pv: (r.lines[0]?.pv || []).slice(0, 6) });
      }
      const p = $('#prog', view); if (p) p.style.width = ((i + 1) / (N + 1) * 100) + '%';
    }
    data.review = { cps, best, lines };
    saveBack();
    return true;
  }

  function computeMoves(useDeep = true) {
    const { cps, best } = data.review;
    const sans = verbose.map(m => m.san);
    return verbose.map((m, i) => {
      const sign = m.color === 'w' ? 1 : -1;
      const before = sign * cps[i], after = sign * cps[i + 1];
      let drop = Math.max(0, winPct(before) - winPct(after));
      let bestUci = best[i];
      const d = useDeep ? data.review.deep?.[i] : null;
      if (d) {
        // Both sides of the move were searched again, deeper. A move the engine ranked itself is
        // also graded by that ranking, whichever is kinder.
        const pct = s => winPct(sign * scoreToCp(s));
        const ranked = d.lines.find(l => l.move === m.lan);
        drop = pct(d.lines[0].score) - pct(d.after.score);
        if (ranked) drop = Math.min(drop, pct(d.lines[0].score) - pct(ranked.score));
        drop = Math.max(0, drop);
        bestUci = d.lines[0].move;
      }
      let cls = classify(drop, bestUci === m.lan);
      if (i < 24 && isBook(sans.slice(0, i + 1))) cls = 'book';
      return { ...m, idx: i, drop, cls, bestUci, cpAfter: d ? scoreToCp(d.after.score) : cps[i + 1] };
    });
  }

  // ---------- second look at the flagged moves ----------
  const me = data.playerColor;
  let deepRun = 0, deepLeft = 0;

  function flagged() {
    return computeMoves(false).filter(m => m.color === me && BAD.includes(m.cls) && m.bestUci);
  }

  async function deepen() {
    const run = ++deepRun;
    data.review.deep = data.review.deep || {};
    const todo = flagged().filter(m => !data.review.deep[m.idx]);
    deepLeft = todo.length;
    for (const m of todo) {
      const r = await engine.analyse(fens[m.idx], DEEP);
      if (destroyed || run !== deepRun || r.cancelled) return;
      const pos = new Chess(fens[m.idx + 1]);
      const a = pos.isGameOver() ? { score: { cp: 0 }, lines: [], bestmove: null } : await engine.analyse(fens[m.idx + 1], DEEP_AFTER);
      if (destroyed || run !== deepRun || a.cancelled) return;
      if (r.lines.length) {
        data.review.deep[m.idx] = {
          lines: r.lines.map(l => ({ move: l.move, score: l.score, pv: l.pv.slice(0, 6) })),
          after: { score: a.score, pv: (a.lines[0]?.pv || []).slice(0, 6) },
        };
        saveBack();
      }
      deepLeft--;
      moves = computeMoves();
      if (!retry) { renderSummary(); renderPos(); }
    }
    deepLeft = 0;
    if (!retry) renderSummary();
  }

  let moves = null;

  function renderSummary() {
    const side = c => moves.filter(m => m.color === c);
    const acc = c => { const s = side(c); return s.length ? Math.round(s.reduce((a, m) => a + moveAccuracy(m.drop), 0) / s.length) : 0; };
    const cnt = (c, k) => side(c).filter(m => m.cls === k).length;
    const them = me === 'w' ? 'b' : 'w';
    const r = data.result;
    const resultTxt = !r ? 'Unfinished game' : !r.winner ? `Draw by ${r.reason}` : r.winner === me ? `You won by ${r.reason}` : `${bot.name} won by ${r.reason}`;
    const rows = ['book', 'best', 'good', 'inaccuracy', 'mistake', 'blunder'].map(k =>
      `<span><span class="tag ${k}">${SYM[k] || (k === 'best' ? '★' : k === 'book' ? '📖' : '✓')}</span> ${CLASS_LABEL[k]}</span><span class="c">${cnt(me, k)}</span><span class="c">${cnt(them, k)}</span>`).join('');
    const list = retryList();
    const last = data.review.retried;
    $('#summary', view).innerHTML = `
      <div class="small muted center">${esc(resultTxt)} · vs ${esc(bot.name)} (~${bot.rating})</div>
      <div class="review-summary">
        <div class="acc"><div class="v">${acc(me)}%</div><div class="who">You</div></div>
        <svg class="graph" id="graph" viewBox="0 0 ${Math.max(N, 1)} 100" preserveAspectRatio="none" role="img" aria-label="Who was better, move by move"></svg>
        <div class="acc"><div class="v">${acc(them)}%</div><div class="who">${esc(bot.name)}</div></div>
      </div>`;
    // The retry list waits for the second look, so it only holds moves that really were mistakes.
    $('#retrySlot', view).innerHTML = deepLeft ? `<div class="small muted center">Double-checking your mistakes… ${deepLeft} to go</div>`
      : list.length ? `<button class="btn primary block" id="retryBtn">Learn from your mistakes (${list.length})</button>
        ${last ? `<div class="small muted center" style="margin-top:6px">Last time you found ${last.found} of ${last.total}</div>` : ''}` : '';
    const details = $('#details', view);
    details.hidden = false;
    details.innerHTML = `<div class="counts"><span></span><span class="c small muted">You</span><span class="c small muted">${esc(bot.name)}</span>${rows}</div>`;
    const retryBtn = $('#retryBtn', view);
    if (retryBtn) retryBtn.addEventListener('click', () => startRetry(retryList()));
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

  const tryMove = (fen, uci) => { try { return new Chess(fen).move(uciToMove(uci)); } catch { return null; } };
  const arrowOf = (m, color) => ({ from: m.from, to: m.to, color });

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
      others: d ? d.lines.slice(1) : [],
    };
  }

  /** Why `uci`, played instead of the best move in `mm`'s position, goes wrong. cpAfter is White's POV. */
  function reasonFor(mm, uci, cpAfter, pvAfter) {
    const sign = mm.color === 'w' ? 1 : -1;
    const cpBefore = data.review.cps[mm.idx];
    return mistakeReason(mm.before, uci, {
      bestUci: mm.bestUci, pvBest: linesFor(mm).best.lines?.[0]?.pv, pvAfter,
      mateAgainst: sign * cpAfter <= -MATE_CP,
      hadMate: sign * cpBefore >= MATE_CP,
    }) || shiftWords(sign * cpBefore, sign * cpAfter);
  }

  /** Reasons a move is strong, as a list for the coach box. */
  function whyHtml(i, uci, analysis = analysisAt(i)) {
    let ex = null;
    try { ex = explainMove(fens[i], uci, analysis, verbose[i - 1]); } catch (e) { console.error('explain failed', e); }
    if (!ex) return '';
    return `${reasonList(ex.reasons)}${ex.line ? `<div class="small muted">Likely next: ${ex.line}</div>` : ''}`;
  }

  /** How the position after ply `ply` stands for the player, in words. */
  function standing(ply) {
    if (new Chess(fens[ply]).isGameOver()) return '';
    const words = evalWords(data.review.deep?.[ply - 1]?.after.score || data.review.lines[ply]?.score, me);
    return words ? `<div class="small muted">Now ${words}.</div>` : '';
  }

  function renderPos() {
    const m = verbose[cur - 1];
    board.setPosition(fens[cur], { lastMove: m ? [m.from, m.to] : null, check: checkSquare(new Chess(fens[cur])) });
    const arrows = [];
    let comment = cur === 0 ? 'Starting position. Step through the game with the arrows below.' : '';
    if (moves && cur > 0) {
      const mm = moves[cur - 1];
      const moveNo = `${Math.ceil(cur / 2)}.${mm.color === 'b' ? '..' : ''}`;
      const mine = mm.color === me;
      const sign = mm.color === 'w' ? 1 : -1;
      const best = mm.bestUci && mm.bestUci !== mm.lan ? tryMove(fens[cur - 1], mm.bestUci) : null;
      const bad = BAD.includes(mm.cls) && best;
      const { best: bestLine, pvAfter, others } = linesFor(mm);
      if (best) arrows.push(arrowOf(best, 'green'));
      comment = `<span class="tag ${mm.cls}">${CLASS_LABEL[mm.cls]}</span> ${esc(mine ? 'You' : bot.name)} played <b>${moveNo} ${esc(mm.san)}</b>.`;
      if (bad && mine) {
        const reason = reasonFor(mm, mm.lan, mm.cpAfter, pvAfter);
        const reply = tryMove(fens[cur], pvAfter[0]); // their best answer to the move played
        if (reply) arrows.push(arrowOf(reply, 'red'));
        comment += ` ${reason}`;
        // When only the drop in the position is known, at least show how they punish it.
        if (reply && (!reason || reason.startsWith('It takes you'))) comment += ` Their best answer is <b>${esc(reply.san)}</b> (red arrow).`;
        comment += ` Better was <b>${esc(best.san)}</b> (green arrow).${whyHtml(cur - 1, mm.bestUci, bestLine)}`;
        // Other moves the engine rated close to its first choice.
        const pct = s => winPct(sign * scoreToCp(s));
        const close = others.map(l => ({ l, mv: tryMove(fens[cur - 1], l.move) }))
          .filter(x => x.mv && x.l.move !== mm.lan && pct(bestLine.score) - pct(x.l.score) < 7);
        if (close.length) comment += `<div class="small muted">Also good: ${close.map(x => `<b>${esc(x.mv.san)}</b>`).join(', ')}.</div>`;
        if (deepLeft && !data.review.deep?.[mm.idx]) comment += '<div class="small muted">Double-checking this move…</div>';
      } else if (bad) {
        comment += ` Better was <b>${esc(best.san)}</b> (green arrow).`;
        // What the bot's slip offered the player.
        const chance = tryMove(fens[cur], pvAfter[0]);
        const score = data.review.lines[cur]?.score;
        if (chance && score?.mate != null && Math.sign(score.mate) === -sign) {
          comment += ` It let you force checkmate, starting with <b>${esc(chance.san)}</b> (blue arrow).`;
          arrows.push(arrowOf(chance, 'blue'));
        } else if (chance && lineGain(fens[cur], pvAfter, me, 4).gain >= 1) {
          comment += ` It gave you the chance to win ${lineGain(fens[cur], pvAfter, me, 4).text} with <b>${esc(chance.san)}</b> (blue arrow).`;
          arrows.push(arrowOf(chance, 'blue'));
        }
      } else if (mm.cls === 'good' && best) comment += ` <span class="muted">The engine preferred ${esc(best.san)}.</span>`;
      comment += standing(cur);
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
    if (n === cur || retry) return;
    const m = verbose[n - 1];
    cur = n;
    renderPos();
    if (m && n > 0) sound.forMove(m, new Chess(fens[n]));
  }

  // ---------- learn from your mistakes ----------
  // Replays your worst moves so you can find the better move yourself.
  let retry = null; // { list, i, found, missed, tries, hinted, token }

  function retryList() {
    const mine = moves.filter(m => m.color === me && m.bestUci && m.bestUci !== m.lan);
    const big = mine.filter(m => m.cls === 'mistake' || m.cls === 'blunder');
    return big.length ? big : mine.filter(m => m.cls === 'inaccuracy');
  }

  function setRetryUi(on) {
    for (const id of ['#summary', '#moves', '#reviewLinks']) $(id, view).hidden = on;
    view.querySelector('.navbar').hidden = on;
    $('#retryActions', view).hidden = !on;
  }

  function setRetryActions(btns) {
    const a = $('#retryActions', view);
    a.innerHTML = btns.map((b, i) => `<button class="btn ${b.cls || ''} ${btns.length === 1 || b.wide ? 'wide' : ''}" data-i="${i}">${b.label}</button>`).join('');
    a.onclick = e => { const b = e.target.closest('[data-i]'); if (b) btns[+b.dataset.i].fn(); };
  }

  function startRetry(list) {
    retry = { list, i: 0, found: 0, missed: [], tries: 0, hinted: false, token: 0 };
    setRetryUi(true);
    $('#openingName', view).textContent = '';
    window.scrollTo(0, 0);
    showRetry();
  }

  function exitRetry() {
    retry = null;
    engine.stop();
    setRetryUi(false);
    board.setMovable(null);
    renderSummary();
    renderPos();
  }

  function showRetry() {
    const m = retry.list[retry.i];
    const prev = verbose[m.idx - 1];
    const c = new Chess(fens[m.idx]);
    const best = uciToMove(m.bestUci);
    retry.token++;
    board.setArrows([]);
    board.setMarks(retry.hinted ? { [best.from]: 'hint' } : {});
    board.setPosition(fens[m.idx], { lastMove: prev ? [prev.from, prev.to] : null, check: checkSquare(c), animate: false });
    board.setMovable(data.playerColor, destsFrom(c));
    $('#comment', view).innerHTML = `<b>${retry.i + 1} of ${retry.list.length}.</b> You played <span class="tag ${m.cls}">${esc(m.san)}</span> here. Find a better move.
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
    return engine.analyse(c.fen(), { depth: RETRY_DEPTH });
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
    deepLeft = flagged().filter(m => !data.review.deep?.[m.idx]).length;
    renderSummary();
    cur = 0;
    renderPos();
    deepen();
  });

  // Arrow keys step through the game on a computer.
  const onKey = e => {
    if (retry || e.target.closest('input, select, textarea')) return;
    const to = { ArrowLeft: cur - 1, ArrowRight: cur + 1, Home: 0, End: N }[e.key];
    if (to != null) { e.preventDefault(); go(to); }
  };
  window.addEventListener('keydown', onKey);

  return () => { destroyed = true; engine.stop(); window.removeEventListener('keydown', onKey); };
}
