// Play vs bots: setup screen + game screen with coach, hints and takebacks.
import { Chess } from '../vendor/chess.js';
import { Board, destsFrom, checkSquare } from './board.js';
import { engine } from './engine.js';
import { BOTS, botById, botMove } from './bots.js';
import { loadOpenings, lookupOpening, isBook } from './openings.js';
import { explainMove as explainEngineMove, mistakeReason } from './explain.js';
import {
  $, el, esc, store, sound, modal, confirmBox, toast, sleep, getSettings, setSetting,
  pieceImg, PIECE_VALUE, uciToMove, winPct, scoreToCp, fmtScore, classify, CLASS_LABEL,
} from './util.js';

const COACH_DEPTH = 11;
const PIECE_NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// ======================= Setup screen =======================
export function renderPlaySetup(view) {
  const saved = store.get('game', null);
  const stats = store.get('stats', { byBot: {} });
  let sel = store.get('lastBot', 'theo');
  let color = store.get('lastColor', 'w');
  const s = getSettings();

  view.innerHTML = `
    ${saved && !saved.result ? `
      <a class="tile accent" href="#/game">
        <div class="ico" style="background:#3c5c43">${botById(saved.botId).avatar}</div>
        <div><div class="t">Continue game</div><div class="s">vs ${esc(botById(saved.botId).name)} · move ${Math.floor(saved.moves.length / 2) + 1}</div></div>
        <div class="go">›</div>
      </a>` : ''}
    <div class="section-title">Choose your opponent</div>
    <div class="bot-list">${BOTS.map(b => {
      const r = stats.byBot?.[b.id];
      return `<button class="bot" data-id="${b.id}">
        ${r && r.w ? `<span class="won">✓ ${r.w}</span>` : ''}
        <div class="avatar">${b.avatar}</div>
        <div class="bname">${esc(b.name)}</div>
        <div class="brating">~${b.rating}</div>
      </button>`;
    }).join('')}</div>
    <div class="card bot-desc" id="botDesc"></div>

    <div class="section-title">Play as</div>
    <div class="seg" id="colorSeg">
      <button data-c="w"><img src="${pieceImg('w', 'k')}" alt="">White</button>
      <button data-c="r">🎲 Random</button>
      <button data-c="b"><img src="${pieceImg('b', 'k')}" alt="">Black</button>
    </div>

    <div class="card" style="margin-top:12px">
      <label class="toggle-row"><div><div class="label">Coach</div><div class="desc">Comments on every move and explains mistakes</div></div>
        <span class="switch"><input type="checkbox" id="coachT" ${s.coach ? 'checked' : ''}><span></span></span></label>
      <label class="toggle-row"><div><div class="label">Evaluation bar</div><div class="desc">Shows who is better</div></div>
        <span class="switch"><input type="checkbox" id="evalT" ${s.evalBar ? 'checked' : ''}><span></span></span></label>
    </div>
    <div style="margin-top:16px"><button class="btn primary big" id="startBtn">Play</button></div>
  `;

  const paint = () => {
    view.querySelectorAll('.bot').forEach(b => b.classList.toggle('sel', b.dataset.id === sel));
    const b = botById(sel);
    const r = stats.byBot?.[b.id] || { w: 0, l: 0, d: 0 };
    $('#botDesc', view).innerHTML = `<div class="row"><div class="avatar">${b.avatar}</div><div class="grow">
      <div style="font-weight:750">${esc(b.name)} <span class="muted small">~${b.rating} · ${esc(b.style)}</span></div>
      <div class="muted small">${esc(b.desc)}</div>
      ${r.w + r.l + r.d ? `<div class="small" style="margin-top:4px">Your score: <b>${r.w}</b> W · <b>${r.d}</b> D · <b>${r.l}</b> L</div>` : ''}
    </div></div>`;
    view.querySelectorAll('#colorSeg button').forEach(x => x.classList.toggle('on', x.dataset.c === color));
  };
  paint();

  view.querySelector('.bot-list').addEventListener('click', e => {
    const b = e.target.closest('.bot'); if (!b) return;
    sel = b.dataset.id; paint();
  });
  $('#colorSeg', view).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    color = b.dataset.c; paint();
  });
  $('#coachT', view).addEventListener('change', e => setSetting('coach', e.target.checked));
  $('#evalT', view).addEventListener('change', e => setSetting('evalBar', e.target.checked));
  $('#startBtn', view).addEventListener('click', async () => {
    const cur = store.get('game', null);
    if (cur && !cur.result && cur.moves.length > 1) {
      const ok = await confirmBox('Start a new game?', '<p class="muted">Your unfinished game will be abandoned.</p>', 'New game');
      if (!ok) return;
    }
    store.set('lastBot', sel); store.set('lastColor', color);
    const pc = color === 'r' ? (Math.random() < .5 ? 'w' : 'b') : color;
    store.set('game', newGameData(sel, pc));
    location.hash = '#/game';
  });
}

function newGameData(botId, playerColor) {
  return { botId, playerColor, moves: [], evals: {}, marks: {}, result: null, recorded: false, hints: 0, takebacks: 0, started: Date.now() };
}

// ======================= Game screen =======================
export function renderGame(view) {
  const data = store.get('game', null);
  if (!data) { location.hash = '#/play'; return; }
  const settings = getSettings();
  const bot = botById(data.botId);
  const chess = new Chess();
  for (const u of data.moves) { try { chess.move(uciToMove(u)); } catch { break; } }
  data.moves = chess.history({ verbose: true }).map(m => m.lan);
  data.picked = data.picked || {}; // plies where the player chose the bot's move

  const st = {
    gen: 0, thinking: false, picking: false, turnAnalysis: null, hintStep: 0, hintMove: null,
    coachHtml: '', coachTag: '', destroyed: false,
  };

  view.innerHTML = `
    <div class="player-bar" id="oppBar"></div>
    <div class="board-wrap" id="boardWrap"><div class="evalbar" id="evalBar" ${settings.evalBar ? '' : 'hidden'}><div class="fill"></div><div class="num"></div></div></div>
    <div class="player-bar" id="meBar"></div>
    <div class="coach" id="coach"><div class="avatar">🎓</div><div class="grow"><div class="msg" id="coachMsg"></div><div class="opening" id="openingName"></div></div></div>
    <div class="moves" id="moves"></div>
    <div class="controls">
      <button class="ctl" id="hintBtn"><svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/></svg>Hint</button>
      <button class="ctl" id="undoBtn"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>Takeback</button>
      <button class="ctl" id="pickBtn" title="Choose the bot's moves yourself" aria-pressed="false"><svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 8V4M10 13h.01M14 13h.01M9 19v2M15 19v2"/></svg>Bot move</button>
      <button class="ctl" id="flipBtn"><svg viewBox="0 0 24 24"><path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/></svg>Flip</button>
      <button class="ctl" id="reviewBtn"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>Review</button>
      <button class="ctl" id="resignBtn"><svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg><span>Resign</span></button>
    </div>
  `;

  const board = new Board($('#boardWrap', view), {
    orientation: data.playerColor,
    onMove: (from, to) => onUserMove(from, to),
  });

  // ---------- rendering ----------
  function sans() { return chess.history(); }

  function material() {
    const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') counts[p.color][p.type]++;
    const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
    const capturedBy = { w: [], b: [] }; // pieces captured BY color
    let score = { w: 0, b: 0 };
    for (const c of ['w', 'b']) {
      const opp = c === 'w' ? 'b' : 'w';
      for (const t of ['q', 'r', 'b', 'n', 'p']) {
        const missing = Math.max(0, start[t] - counts[opp][t]);
        for (let i = 0; i < missing; i++) capturedBy[c].push(t);
        score[c] += counts[c][t] * PIECE_VALUE[t];
      }
    }
    return { capturedBy, diff: score.w - score.b };
  }

  function barHtml(name, sub, avatar, color, thinking, picking) {
    const m = material();
    const caps = m.capturedBy[color];
    const adv = color === 'w' ? m.diff : -m.diff;
    const opp = color === 'w' ? 'b' : 'w';
    return `<div class="avatar">${avatar}</div><div class="grow">
      <div><span class="name">${esc(name)}</span><span class="rating">${esc(sub)}</span>${thinking ? '<span class="thinking"><i></i><i></i><i></i></span>' : ''}${picking ? '<span class="pick-tag">Choose a move</span>' : ''}</div>
      <div class="captured">${caps.map(t => `<img src="${pieceImg(opp, t)}" alt="">`).join('')}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</div>
    </div>`;
  }

  function renderBars() {
    const botColor = data.playerColor === 'w' ? 'b' : 'w';
    const topIsBot = board.orientation === data.playerColor;
    const botHtml = barHtml(bot.name, `~${bot.rating}`, bot.avatar, botColor, st.thinking, st.picking);
    const meHtml = barHtml('You', '', '🙂', data.playerColor, false);
    $('#oppBar', view).innerHTML = topIsBot ? botHtml : meHtml;
    $('#meBar', view).innerHTML = topIsBot ? meHtml : botHtml;
  }

  function renderMoves() {
    const hist = chess.history();
    let html = '';
    for (let i = 0; i < hist.length; i++) {
      if (i % 2 === 0) html += `<span class="num">${i / 2 + 1}.</span>`;
      const mk = data.marks[i + 1];
      const picked = data.picked[i + 1] ? 'picked' : '';
      const sym = mk === 'blunder' ? '??' : mk === 'mistake' ? '?' : mk === 'inaccuracy' ? '?!' : '';
      const col = mk ? `style="color:var(--${mk === 'inaccuracy' ? 'inacc' : mk})"` : '';
      html += `<span class="mv ${i === hist.length - 1 ? 'cur' : ''} ${picked}" ${col}>${esc(hist[i])}<span class="sym">${sym}</span></span>`;
    }
    const mv = $('#moves', view);
    mv.innerHTML = html;
    mv.scrollLeft = mv.scrollWidth;
  }

  function renderEval() {
    const bar = $('#evalBar', view);
    bar.hidden = !getSettings().evalBar;
    if (bar.hidden) return;
    const ply = chess.history().length;
    let s = data.evals[ply];
    for (let p = ply; s == null && p >= 0; p--) s = data.evals[p];
    const cp = s ? scoreToCp(s) : 0;
    const pct = winPct(cp);
    bar.classList.toggle('flipped', board.orientation === 'b');
    bar.querySelector('.fill').style.height = pct + '%';
    const num = bar.querySelector('.num');
    num.textContent = s ? fmtScore(s).replace('+', '') : '';
    const whiteWinning = cp >= 0;
    const atBottom = (board.orientation === 'w') === whiteWinning;
    num.style.top = atBottom ? '' : '3px';
    num.style.bottom = atBottom ? '3px' : '';
    num.style.color = whiteWinning ? '#333' : '#eee';
  }

  function renderOpening() {
    const o = lookupOpening(sans());
    $('#openingName', view).textContent = o ? `${o.eco} · ${o.name}` : '';
  }

  function setCoach(html) {
    st.coachHtml = html;
    $('#coachMsg', view).innerHTML = html;
    const tb = $('#coachMsg [data-act="takeback"]', view);
    if (tb) tb.addEventListener('click', () => undo());
  }

  function renderControls() {
    const over = !!data.result;
    $('#hintBtn', view).disabled = over || st.thinking || chess.turn() !== data.playerColor;
    $('#undoBtn', view).disabled = chess.history().length === 0 || (data.playerColor === 'b' && chess.history().length <= 1 && !data.pickBot);
    const pick = $('#pickBtn', view);
    pick.disabled = over;
    pick.classList.toggle('on', !!data.pickBot);
    pick.setAttribute('aria-pressed', String(!!data.pickBot));
    $('#reviewBtn', view).disabled = !over;
    $('#resignBtn span', view).textContent = over ? 'New game' : 'Resign';
  }

  function renderBoard(lastMove, animate = true) {
    board.setPosition(chess.fen(), { lastMove, check: checkSquare(chess), animate });
    const myTurn = !data.result && chess.turn() === data.playerColor && !st.thinking;
    const mover = st.picking && !data.result ? chess.turn() : myTurn ? data.playerColor : null;
    board.setMovable(mover, destsFrom(chess));
  }

  function renderAll(lastMove, animate) {
    renderBoard(lastMove, animate); renderBars(); renderMoves(); renderEval(); renderOpening(); renderControls();
  }

  function lastMoveSquares() {
    const h = chess.history({ verbose: true });
    const m = h[h.length - 1];
    return m ? [m.from, m.to] : null;
  }

  // A game with chosen bot moves is an experiment, so it never counts in the stats.
  function isWhatIf() { return Object.keys(data.picked).length > 0; }

  function save() { data.moves = chess.history({ verbose: true }).map(m => m.lan); store.set('game', data); }

  // ---------- game flow ----------
  function checkEnd() {
    let r = null;
    if (chess.isCheckmate()) r = { winner: chess.turn() === 'w' ? 'b' : 'w', reason: 'checkmate' };
    else if (chess.isStalemate()) r = { winner: null, reason: 'stalemate' };
    else if (chess.isInsufficientMaterial()) r = { winner: null, reason: 'insufficient material' };
    else if (chess.isThreefoldRepetition()) r = { winner: null, reason: 'threefold repetition' };
    else if (chess.isDrawByFiftyMoves()) r = { winner: null, reason: '50-move rule' };
    if (r) finish(r);
    return !!r;
  }

  function finish(r) {
    data.result = r;
    st.picking = false;
    board.setMovable(null);
    const whatIf = isWhatIf();
    if (!data.recorded && !whatIf) {
      data.recorded = true;
      const stats = store.get('stats', { games: 0, wins: 0, losses: 0, draws: 0, byBot: {} });
      stats.byBot = stats.byBot || {};
      const b = stats.byBot[bot.id] || { w: 0, l: 0, d: 0 };
      stats.games = (stats.games || 0) + 1;
      if (!r.winner) { stats.draws = (stats.draws || 0) + 1; b.d++; }
      else if (r.winner === data.playerColor) { stats.wins = (stats.wins || 0) + 1; b.w++; }
      else { stats.losses = (stats.losses || 0) + 1; b.l++; }
      stats.byBot[bot.id] = b;
      store.set('stats', stats);
      // keep the last few finished games for review
      const archive = store.get('archive', []);
      archive.unshift({ ...data, moves: chess.history({ verbose: true }).map(m => m.lan), ended: Date.now() });
      store.set('archive', archive.slice(0, 10));
    }
    save();
    renderControls();
    sound.play('end');
    const won = r.winner === data.playerColor;
    const title = !r.winner ? 'Draw' : won ? 'You won! 🎉' : `${esc(bot.name)} won`;
    setCoach(`<b>${title}</b> by ${r.reason}. Review the game to see where it turned.`);
    setTimeout(async () => {
      if (st.destroyed) return;
      const v = await modal({
        title,
        body: `<p class="muted">${r.reason[0].toUpperCase() + r.reason.slice(1)} · vs ${esc(bot.name)} (~${bot.rating})</p>
          ${whatIf ? `<p>You chose moves for ${esc(bot.name)}, so this game does not count in your stats.</p>` : ''}
          ${won && !whatIf && bot.id !== 'titan' ? `<p>Nice! Ready for the next opponent? Try <b>${esc(BOTS[BOTS.indexOf(bot) + 1].name)}</b>.</p>` : ''}
          ${!won && !whatIf && r.winner ? '<p>Every loss is a lesson. The game review shows your key mistakes.</p>' : ''}`,
        actions: [
          { label: 'Game review', cls: 'primary', value: 'review' },
          { label: 'Rematch', value: 'rematch' },
          ...(won && !whatIf && bot.id !== 'titan' ? [{ label: `Play ${esc(BOTS[BOTS.indexOf(bot) + 1].name)}`, value: 'next' }] : []),
          { label: 'Close', cls: 'ghost', value: null },
        ],
      });
      if (v === 'review') location.hash = '#/review';
      else if (v === 'rematch') startNew(bot.id, data.playerColor === 'w' ? 'b' : 'w');
      else if (v === 'next') startNew(BOTS[BOTS.indexOf(bot) + 1].id, data.playerColor);
    }, 700);
  }

  function startNew(botId, color) {
    store.set('game', newGameData(botId, color));
    store.set('lastBot', botId);
    destroy();
    renderGame(view);
  }

  function startPlayerTurn() {
    st.hintStep = 0; st.hintMove = null;
    board.setMarks({});
    renderBoard(lastMoveSquares(), false);
    renderControls();
    const s = getSettings();
    if (s.coach || s.evalBar) {
      const g = st.gen;
      const ply = chess.history().length;
      st.turnAnalysis = engine.analyse(chess.fen(), { depth: COACH_DEPTH }).then(r => {
        if (g === st.gen && !r.cancelled && r.score) { data.evals[ply] = r.score; renderEval(); }
        return r;
      });
    } else st.turnAnalysis = null;
  }

  async function onUserMove(from, to) {
    const picking = st.picking;
    const piece = chess.get(from);
    let promotion;
    if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = getSettings().autoQueen ? 'q' : await board.promote(piece.color);
      if (!promotion || picking !== st.picking) { renderBoard(lastMoveSquares(), false); return; }
    }
    let move;
    const fenBefore = chess.fen();
    try { move = chess.move({ from, to, promotion }); } catch { renderBoard(lastMoveSquares(), false); return; }
    sound.forMove(move, chess);
    if (picking) { st.picking = false; data.picked[chess.history().length] = true; }
    board.setArrows([]);
    board.setMarks({});
    renderAll([move.from, move.to]);
    save();
    if (checkEnd()) return;
    if (picking) { startPlayerTurn(); return; }
    await coachAndReply(move, fenBefore);
  }

  async function coachAndReply(move, fenBefore) {
    const g = st.gen;
    const s = getSettings();
    const ply = chess.history().length;
    const book = isBook(sans());
    board.setMovable(null);

    if (s.coach || s.evalBar) {
      const before = st.turnAnalysis ? await st.turnAnalysis : null;
      if (g !== st.gen) return;
      const after = await engine.analyse(chess.fen(), { depth: COACH_DEPTH });
      if (g !== st.gen || after.cancelled) return;
      if (after.score) data.evals[ply] = after.score;
      renderEval();
      if (s.coach) {
        if (book) {
          const o = lookupOpening(sans());
          setCoach(`<span class="tag book">Book</span> A known opening move${o ? ` – <b>${esc(o.name)}</b>` : ''}.`);
        } else if (before && !before.cancelled && before.score && after.score) {
          explainMove(move, fenBefore, before, after, ply);
        }
      }
      save();
    }
    await botTurn();
  }

  function explainMove(move, fenBefore, before, after, ply) {
    const me = move.color;
    const sign = me === 'w' ? 1 : -1;
    const cpBefore = sign * scoreToCp(before.score);
    const cpAfter = sign * scoreToCp(after.score);
    const drop = winPct(cpBefore) - winPct(cpAfter);
    const bestUci = before.bestmove;
    const isBest = bestUci && bestUci === move.lan;
    const tmp = new Chess(fenBefore);
    let bestSan = '';
    let bestMove = null;
    try { bestMove = tmp.move(uciToMove(bestUci)); bestSan = bestMove.san; } catch { }

    const cls = classify(drop, isBest);
    let label = CLASS_LABEL[cls], text;
    if (cls === 'best') { label = isBest ? 'Best' : 'Excellent'; text = isBest ? pick(['The top engine move!', 'Exactly what the engine wanted.', 'Spot on.']) : 'As good as the top move.'; }
    else if (cls === 'good') text = bestSan ? `Solid. <b>${esc(bestSan)}</b> was slightly better.` : 'Solid move.';
    else if (cls === 'inaccuracy') text = `<b>${esc(bestSan)}</b> was better.`;
    else if (cls === 'mistake') text = `<b>${esc(bestSan)}</b> was much better.`;
    else text = `<b>${esc(bestSan)}</b> was the move.`;

    // Reasons for bad moves
    if (cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder') {
      text += ' ' + mistakeReason(fenBefore, move.lan, {
        bestUci, replyUci: after.bestmove,
        mateAgainst: after.score.mate != null && Math.sign(after.score.mate) === -sign,
        hadMate: before.score.mate != null && Math.sign(before.score.mate) === sign,
      });
      text += ` <a href="javascript:void 0" data-act="takeback">Take back</a>`;
      if (bestMove) board.setArrows([{ from: bestMove.from, to: bestMove.to, color: 'green' }]);
    }
    data.marks[ply] = cls === 'best' || cls === 'good' ? null : cls;
    renderMoves();
    setCoach(`<span class="tag ${cls}">${label}</span> ${text}`);
  }

  async function botTurn() {
    if (data.pickBot) { st.picking = true; renderAll(lastMoveSquares(), false); return; }
    const g = st.gen;
    st.thinking = true; renderBars(); renderControls();
    board.setMovable(null);
    const t0 = Date.now();
    const uci = await botMove(bot, chess);
    if (g !== st.gen || st.destroyed) return;
    const minDelay = 350 + Math.random() * 450;
    const elapsed = Date.now() - t0;
    if (elapsed < minDelay) await sleep(minDelay - elapsed);
    if (g !== st.gen || st.destroyed) return;
    st.thinking = false;
    if (!uci) { renderAll(lastMoveSquares()); return; }
    let move;
    try { move = chess.move(uciToMove(uci)); } catch (e) { console.error('Bad bot move', uci, e); renderAll(lastMoveSquares()); return; }
    sound.forMove(move, chess);
    renderAll([move.from, move.to]);
    save();
    if (checkEnd()) return;
    startPlayerTurn();
  }

  function undo() {
    if (!chess.history().length) return;
    engine.stop();
    st.gen++;
    st.thinking = false;
    st.picking = false;
    // While choosing the bot's moves, step back one move at a time so either side can be replayed.
    do { chess.undo(); } while (!data.pickBot && chess.history().length > 0 && chess.turn() !== data.playerColor);
    const ply = chess.history().length;
    for (const k of Object.keys(data.marks)) if (+k > ply) delete data.marks[k];
    for (const k of Object.keys(data.evals)) if (+k > ply) delete data.evals[k];
    for (const k of Object.keys(data.picked)) if (+k > ply) delete data.picked[k];
    data.result = null; data.recorded = data.recorded; // a finished game stays recorded
    data.takebacks++;
    board.setArrows([]);
    setCoach('Move taken back. Try again!');
    renderAll(lastMoveSquares());
    save();
    if (chess.turn() !== data.playerColor) botTurn(); else startPlayerTurn();
  }

  function togglePick() {
    if (data.result) return;
    data.pickBot = !data.pickBot;
    toast(data.pickBot ? `You choose ${bot.name}'s moves. Takeback now goes back one move at a time.` : `${bot.name} plays on its own again`);
    if (data.pickBot && st.thinking) {
      engine.stop(); st.gen++; st.thinking = false;
      botTurn();
    } else if (!data.pickBot && st.picking) {
      st.picking = false;
      botTurn();
    }
    renderControls();
    save();
  }

  async function hint() {
    if (chess.turn() !== data.playerColor || data.result) return;
    const g = st.gen;
    if (!st.hintMove) {
      setCoach('Thinking about a hint…');
      const r = st.turnAnalysis ? await st.turnAnalysis : await engine.analyse(chess.fen(), { depth: COACH_DEPTH });
      if (g !== st.gen) return;
      let res = r;
      if (!res || res.cancelled || !res.bestmove) res = await engine.analyse(chess.fen(), { depth: COACH_DEPTH });
      if (g !== st.gen || !res.bestmove) return;
      st.hintMove = uciToMove(res.bestmove);
      st.hintUci = res.bestmove;
      st.hintAnalysis = res;
    }
    const m = st.hintMove;
    const p = chess.get(m.from);
    data.hints++;
    if (st.hintStep === 0) {
      board.setMarks({ [m.from]: 'hint' });
      setCoach(`💡 Look at your <b>${PIECE_NAMES[p.type]}</b> on ${m.from}. What is the best square for it? <span class="muted">(Tap Hint again to see the move.)</span>`);
      st.hintStep = 1;
    } else {
      board.setArrows([{ from: m.from, to: m.to, color: 'blue' }]);
      let ex = null;
      try { ex = explainEngineMove(chess.fen(), st.hintUci, st.hintAnalysis); } catch (e) { console.error('explain failed', e); }
      if (!ex) { setCoach('💡 The engine suggests the arrow move.'); return; }
      setCoach(`💡 The engine suggests <b>${esc(ex.san)}</b>.
        <ul class="why">${ex.reasons.map(r => `<li>${r}</li>`).join('')}</ul>
        ${ex.line || ex.eval ? `<div class="small muted">${ex.line ? `Likely next: ${ex.line}` : ''}${ex.line && ex.eval ? ' · ' : ''}${ex.eval ? `${ex.line ? 'Then' : 'Overall'} ${ex.eval}` : ''}</div>` : ''}`);
    }
  }

  // ---------- buttons ----------
  $('#hintBtn', view).addEventListener('click', hint);
  $('#undoBtn', view).addEventListener('click', undo);
  $('#pickBtn', view).addEventListener('click', togglePick);
  $('#flipBtn', view).addEventListener('click', () => { board.flip(); renderBars(); renderEval(); });
  $('#reviewBtn', view).addEventListener('click', () => { location.hash = '#/review'; });
  $('#resignBtn', view).addEventListener('click', async () => {
    if (data.result) { location.hash = '#/play'; return; }
    const ok = await confirmBox('Resign?', '<p class="muted">The game will count as a loss.</p>', 'Resign');
    if (ok && !data.result) {
      engine.stop(); st.gen++; st.thinking = false;
      finish({ winner: data.playerColor === 'w' ? 'b' : 'w', reason: 'resignation' });
      renderAll(lastMoveSquares(), false);
    }
  });

  // ---------- start ----------
  function destroy() { st.destroyed = true; st.gen++; engine.stop(); }

  renderAll(lastMoveSquares(), false);
  loadOpenings().then(() => { if (!st.destroyed) renderOpening(); });
  engine.init().catch(() => toast('Could not start the chess engine'));

  if (data.result) {
    const r = data.result;
    setCoach(`Game over: ${!r.winner ? 'draw' : r.winner === data.playerColor ? 'you won' : bot.name + ' won'} by ${r.reason}.`);
    board.setMovable(null);
  } else if (chess.history().length === 0) {
    setCoach(data.playerColor === 'w'
      ? `You have the white pieces. ${pick(OPENING_TIPS)}`
      : `You have the black pieces. ${esc(bot.name)} moves first.`);
    engine.newGame();
    if (chess.turn() !== data.playerColor) botTurn(); else startPlayerTurn();
  } else {
    setCoach(chess.turn() === data.playerColor ? 'Welcome back! Your move.' : 'Welcome back!');
    if (chess.turn() !== data.playerColor) botTurn(); else startPlayerTurn();
  }

  return destroy;
}

const OPENING_TIPS = [
  'Start by taking the center with a pawn (e4 or d4).',
  'Remember: develop your knights and bishops early.',
  'Try to castle within the first 10 moves to keep your king safe.',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
