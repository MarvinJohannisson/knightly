// Play vs bots: setup screen + game screen with coach, hints and takebacks.
import { Chess } from '../vendor/chess.js';
import { Board, destsFrom, checkSquare } from './board.js';
import { engine, analyser } from './engine.js';
import { BOTS, botById, botMove, thinkTime } from './bots.js';
import { loadOpenings, lookupOpening, isBook } from './openings.js';
import {
  explainMove as explainEngineMove, mistakeReason, whatIfMove, compareMoves, hintIdea, runnerUp, shiftWords, reasonList, footnote,
} from './explain.js';
import {
  $, el, esc, store, sound, modal, confirmBox, toast, sleep, getSettings, setSetting,
  pieceImg, PIECE_VALUE, uciToMove, winPct, scoreToCp, fmtScore, classify, CLASS_LABEL,
} from './util.js';

const COACH_DEPTH = 11;
// Hints and comparisons look deeper and keep the three best moves. The time cap is for slow phones.
const HELP = { depth: 14, multipv: 3, movetime: 2500 };
const WHATIF = { depth: 13, movetime: 2000 };
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
      <label class="toggle-row"><div><div class="label">Move history</div><div class="desc">Shows the list of moves</div></div>
        <span class="switch"><input type="checkbox" id="moveListT" ${s.moveList ? 'checked' : ''}><span></span></span></label>
    </div>
    <div style="margin-top:16px"><button class="btn primary big" id="startBtn">Play</button></div>
  `;

  const paint = () => {
    view.querySelectorAll('.bot').forEach(b => b.classList.toggle('sel', b.dataset.id === sel));
    const b = botById(sel);
    const r = { w: 0, l: 0, d: 0, h: 0, ...stats.byBot?.[b.id] };
    $('#botDesc', view).innerHTML = `<div class="row"><div class="avatar">${b.avatar}</div><div class="grow">
      <div style="font-weight:750">${esc(b.name)} <span class="muted small">~${b.rating} · ${esc(b.style)}</span></div>
      <div class="muted small">${esc(b.desc)}</div>
      ${r.w + r.h + r.l + r.d ? `<div class="small" style="margin-top:4px">Your score: <b>${r.w}</b> W · <b>${r.d}</b> D · <b>${r.l}</b> L${r.h ? ` · <b>${r.h}</b> won with help` : ''}</div>` : ''}
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
  $('#moveListT', view).addEventListener('change', e => setSetting('moveList', e.target.checked));
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
  let innerCleanup = null;
  function start(botId, color) {
    if (botId) {
      store.set('game', newGameData(botId, color));
      store.set('lastBot', botId);
    }
    if (innerCleanup) { innerCleanup(); innerCleanup = null; }
    innerCleanup = mountGame(view, start) || null;
  }
  start();
  return () => { if (innerCleanup) { innerCleanup(); innerCleanup = null; } };
}

function mountGame(view, onStartNew) {
  const data = store.get('game', null);
  if (!data) { location.hash = '#/play'; return null; }
  const settings = getSettings();
  const bot = botById(data.botId);
  const chess = new Chess();
  for (const u of data.moves) { try { chess.move(uciToMove(u)); } catch { break; } }
  data.moves = chess.history({ verbose: true }).map(m => m.lan);
  // Plies where the player chose the bot's move, in a game started while the app still had a
  // "Bot move" button. Such a game stays out of the stats; new games never have any.
  data.picked = data.picked || {};
  delete data.pickBot;

  const st = {
    gen: 0, thinking: false, turnAnalysis: null,
    hint: null,    // { uci, analysis, step } for the position on the board
    help: null,    // the deeper analysis behind hints and comparisons, one per position
    helped: false, // has this position already been counted as a hint?
    why: null,     // the better move the coach just pointed out, for "Why?"
    coachHtml: '', coachTag: '', destroyed: false,
    sandbox: null, // the "What if?" board: a scratch position that never touches the game
    asking: false,
    viewPly: null, // null = live game; 0..N-1 = viewing an earlier move
    liveArrows: [],
    liveMarks: {},
  };
  const browsing = () => !st.sandbox && st.viewPly != null;
  const shownPly = () => (browsing() ? st.viewPly : chess.history().length);
  const verboseHist = () => chess.history({ verbose: true });
  const moveAt = ply => (ply > 0 ? verboseHist()[ply - 1] || null : null);
  function fenAt(ply) {
    const h = verboseHist();
    if (ply <= 0) return h.length ? h[0].before : chess.fen();
    return h[ply - 1] ? h[ply - 1].after : chess.fen();
  }
  function chessAt(ply) {
    const h = verboseHist();
    return ply >= h.length ? chess : new Chess(fenAt(ply));
  }
  const pos = () => (st.sandbox ? st.sandbox.chess : browsing() ? chessAt(st.viewPly) : chess);

  view.innerHTML = `
    <div class="player-bar" id="oppBar"></div>
    <div class="board-wrap" id="boardWrap"><div class="evalbar" id="evalBar" ${settings.evalBar ? '' : 'hidden'}><div class="fill"></div><div class="num"></div></div></div>
    <div class="player-bar" id="meBar"></div>
    <div class="hist-bar" id="histBar">
      <button class="hist-btn" id="histPrev" type="button" aria-label="Previous move">◀</button>
      <div class="hist-scrub"><input type="range" id="histRange" min="0" max="0" value="0" step="1" aria-label="Move history"></div>
      <span class="hist-pos" id="histPos">0/0</span>
      <button class="hist-btn" id="histNext" type="button" aria-label="Next move">▶</button>
      <button class="hist-btn live" id="histLive" type="button">Live</button>
    </div>
    <div class="coach" id="coach"><div class="avatar">🎓</div><div class="grow"><div class="msg" id="coachMsg"></div><div class="opening" id="openingName"></div></div></div>
    <div class="moves" id="moves" ${settings.moveList ? '' : 'hidden'}></div>
    <div class="controls bottom-bar">
      <button class="ctl" id="hintBtn"><svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.8V16h5v-.3c0-.7.4-1.4 1-1.8A6 6 0 0 0 12 3z"/></svg>Hint</button>
      <button class="ctl" id="undoBtn"><svg viewBox="0 0 24 24"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg><span>Takeback</span></button>
      <button class="ctl" id="whatIfBtn" title="Try out moves for both sides without changing the game" aria-pressed="false"><svg viewBox="0 0 24 24"><path d="M9 9a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1.2-1.5 2.4"/><path d="M12 18h.01"/><circle cx="12" cy="12" r="9"/></svg><span>What if?</span></button>
      <button class="ctl" id="reviewBtn" hidden><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>Review</button>
      <button class="ctl" id="resignBtn"><svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg><span>Resign</span></button>
    </div>
  `;

  const board = new Board($('#boardWrap', view), {
    orientation: data.playerColor,
    onMove: (from, to) => onUserMove(from, to),
  });

  // ---------- rendering ----------
  function sans() { return chess.history(); }
  function setLiveArrows(a) { st.liveArrows = a; if (!browsing()) board.setArrows(a); }
  function setLiveMarks(m) { st.liveMarks = m; if (!browsing()) board.setMarks(m); }

  function material() {
    const counts = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
    for (const row of pos().board()) for (const p of row) if (p && p.type !== 'k') counts[p.color][p.type]++;
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

  function barHtml(name, sub, avatar, color, thinking) {
    const m = material();
    const caps = m.capturedBy[color];
    const adv = color === 'w' ? m.diff : -m.diff;
    const opp = color === 'w' ? 'b' : 'w';
    return `<div class="avatar">${avatar}</div><div class="grow">
      <div><span class="name">${esc(name)}</span><span class="rating">${esc(sub)}</span>${thinking ? '<span class="thinking"><i></i><i></i><i></i></span>' : ''}</div>
      <div class="captured">${caps.map(t => `<img src="${pieceImg(opp, t)}" alt="">`).join('')}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</div>
    </div>`;
  }

  function renderBars() {
    const botColor = data.playerColor === 'w' ? 'b' : 'w';
    const topIsBot = board.orientation === data.playerColor;
    const botHtml = barHtml(bot.name, `~${bot.rating}`, bot.avatar, botColor, st.thinking);
    const meHtml = barHtml('You', '', '🙂', data.playerColor, false);
    $('#oppBar', view).innerHTML = topIsBot ? botHtml : meHtml;
    $('#meBar', view).innerHTML = topIsBot ? meHtml : botHtml;
  }

  function renderHistBar() {
    const bar = $('#histBar', view);
    bar.hidden = !!st.sandbox;
    if (bar.hidden) return;
    const n = chess.history().length;
    const shown = shownPly();
    const live = !browsing();
    bar.classList.toggle('browsing', !live);
    const range = $('#histRange', view);
    range.max = String(n);
    range.value = String(shown);
    range.disabled = n === 0;
    range.style.setProperty('--pct', n ? `${(shown / n) * 100}%` : '0%');
    $('#histPrev', view).disabled = n === 0 || shown <= 0;
    $('#histNext', view).disabled = n === 0 || live;
    const liveBtn = $('#histLive', view);
    liveBtn.disabled = live;
    liveBtn.classList.toggle('on', !live);
    $('#histPos', view).textContent = `${shown}/${n}`;
  }

  function renderMoves() {
    const mv = $('#moves', view);
    if (st.sandbox) {
      const line = st.sandbox.chess.history();
      mv.innerHTML = `<span class="num">What if:</span>${line.map((m, i) => `<span class="mv ${i === line.length - 1 ? 'cur' : ''}">${esc(m)}</span>`).join('')}`;
      mv.scrollLeft = mv.scrollWidth;
      return;
    }
    const hist = chess.history();
    const shown = shownPly();
    let html = '';
    for (let i = 0; i < hist.length; i++) {
      if (i % 2 === 0) html += `<span class="num">${i / 2 + 1}.</span>`;
      const mk = data.marks[i + 1];
      const picked = data.picked[i + 1] ? 'picked' : '';
      const sym = mk === 'blunder' ? '??' : mk === 'mistake' ? '?' : mk === 'inaccuracy' ? '?!' : '';
      const col = mk ? `style="color:var(--${mk === 'inaccuracy' ? 'inacc' : mk})"` : '';
      html += `<span class="mv ${i + 1 === shown ? 'cur' : ''} ${picked}" data-ply="${i + 1}" ${col}>${esc(hist[i])}<span class="sym">${sym}</span></span>`;
    }
    mv.innerHTML = html;
    const curEl = mv.querySelector('.cur');
    if (curEl) mv.scrollLeft = Math.max(0, curEl.offsetLeft - mv.clientWidth / 2 + curEl.offsetWidth / 2);
    else mv.scrollLeft = 0;
  }

  function renderEval() {
    const bar = $('#evalBar', view);
    bar.hidden = !getSettings().evalBar;
    if (bar.hidden) return;
    const ply = shownPly();
    let s = data.evals[ply];
    for (let p = ply; s == null && p >= 0; p--) s = data.evals[p];
    if (st.sandbox) s = st.sandbox.steps.findLast(x => x.analysis?.score)?.analysis.score ?? s;
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
    const o = st.sandbox ? null : lookupOpening(sans().slice(0, shownPly()));
    $('#openingName', view).textContent = o ? `${o.eco} · ${o.name}` : '';
  }

  function bindCoachActs() {
    const acts = {
      takeback: undo, whatif: openSandbox, compare: compareTop, why: whyBest,
      live: () => goHistory(chess.history().length),
    };
    for (const a of view.querySelectorAll('#coachMsg [data-act]')) {
      a.addEventListener('click', () => acts[a.dataset.act]?.());
    }
  }

  function setCoach(html) {
    st.coachHtml = html;
    if (browsing()) return;
    $('#coachMsg', view).innerHTML = html;
    bindCoachActs();
  }

  function renderLiveCoach() {
    $('#coachMsg', view).innerHTML = st.coachHtml;
    bindCoachActs();
  }

  function renderBrowseCoach() {
    const n = chess.history().length;
    const ply = st.viewPly;
    const m = moveAt(ply);
    let html;
    if (!m) {
      html = `<b>Starting position</b> <span class="muted">· 0/${n}</span>`;
    } else {
      const no = `${Math.ceil(ply / 2)}.${m.color === 'b' ? '..' : ''}`;
      const mk = data.marks[ply];
      const tag = mk ? `<span class="tag ${mk}">${CLASS_LABEL[mk]}</span> ` : '';
      html = `${tag}<b>${no} ${esc(m.san)}</b> <span class="muted">· move ${ply} of ${n}</span>`;
    }
    $('#coachMsg', view).innerHTML = `${html}<div class="coach-acts"><button data-act="live">Back to live</button></div>`;
    bindCoachActs();
  }

  function renderControls() {
    const over = !!data.result;
    const sb = st.sandbox;
    const myTurn = !over && !st.thinking && !browsing() && chess.turn() === data.playerColor;
    $('#hintBtn', view).disabled = !!sb || !myTurn;
    $('#undoBtn', view).disabled = sb ? sb.busy || sb.steps.length < 2
      : chess.history().length === 0 || (data.playerColor === 'b' && chess.history().length <= 1);
    $('#undoBtn span', view).textContent = sb ? 'Undo' : 'Takeback';
    const whatIf = $('#whatIfBtn', view);
    whatIf.hidden = over;
    whatIf.disabled = !sb && !myTurn;
    whatIf.classList.toggle('on', !!sb);
    whatIf.setAttribute('aria-pressed', String(!!sb));
    $('#whatIfBtn span', view).textContent = sb ? 'Back' : 'What if?';
    $('#reviewBtn', view).hidden = !over;
    $('#resignBtn', view).disabled = !!sb;
    $('#resignBtn span', view).textContent = over ? 'New game' : 'Resign';
  }

  function renderBoard(lastMove, animate = true) {
    const c = pos();
    board.setPosition(c.fen(), { lastMove, check: checkSquare(c), animate });
    if (st.sandbox) { board.setMovable(st.sandbox.busy || c.isGameOver() ? null : c.turn(), destsFrom(c)); return; }
    if (browsing()) { board.setMovable(null); return; }
    const myTurn = !data.result && chess.turn() === data.playerColor && !st.thinking;
    board.setMovable(myTurn ? data.playerColor : null, destsFrom(chess));
  }

  function renderAll(lastMove, animate) {
    renderBoard(lastMove, animate); renderBars(); renderHistBar(); renderMoves(); renderEval(); renderOpening(); renderControls();
  }

  function lastMoveSquares() {
    if (st.sandbox) {
      const m = st.sandbox.chess.history({ verbose: true }).at(-1);
      return m ? [m.from, m.to] : null;
    }
    const m = moveAt(shownPly());
    return m ? [m.from, m.to] : null;
  }

  // ---------- history browsing ----------
  function goHistory(ply, { animate = true, playSound = true } = {}) {
    if (st.sandbox) return;
    const n = chess.history().length;
    if (!n) return;
    const target = Math.max(0, Math.min(n, ply));
    const prev = shownPly();
    if (target === prev) return;
    const wasBrowsing = browsing();
    if (target === n) {
      st.viewPly = null;
      board.setArrows(st.liveArrows);
      board.setMarks(st.liveMarks);
      renderLiveCoach();
      renderAll(lastMoveSquares(), animate);
      if (playSound && target === prev + 1) {
        const m = moveAt(target);
        if (m) sound.forMove(m, chess);
      }
      return;
    }
    if (!wasBrowsing) {
      st.liveArrows = board.arrows;
      st.liveMarks = board.marks;
    }
    st.viewPly = target;
    board.setArrows([]);
    board.setMarks({});
    renderAll(lastMoveSquares(), animate);
    renderBrowseCoach();
    if (playSound && target > 0 && target === prev + 1) {
      const m = moveAt(target);
      if (m) sound.forMove(m, chessAt(target));
    }
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
    const wasBrowsing = browsing();
    if (wasBrowsing) {
      st.viewPly = null;
      board.setArrows(st.liveArrows);
      board.setMarks(st.liveMarks);
    }
    board.setMovable(null);
    const whatIf = isWhatIf();
    const helped = data.takebacks + data.hints > 0;
    if (!data.recorded && !whatIf) {
      data.recorded = true;
      const stats = store.get('stats', { games: 0, wins: 0, losses: 0, draws: 0, byBot: {} });
      stats.byBot = stats.byBot || {};
      const b = stats.byBot[bot.id] || { w: 0, l: 0, d: 0 };
      stats.games = (stats.games || 0) + 1;
      if (!r.winner) { stats.draws = (stats.draws || 0) + 1; b.d++; }
      else if (r.winner === data.playerColor && helped) { stats.helpedWins = (stats.helpedWins || 0) + 1; b.h = (b.h || 0) + 1; }
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
    if (wasBrowsing) renderAll(lastMoveSquares(), false);
    else { renderHistBar(); renderControls(); }
    sound.play('end');
    const won = r.winner === data.playerColor;
    const cleanWin = won && !whatIf && !helped;
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const help = [data.takebacks && plural(data.takebacks, 'takeback'), data.hints && plural(data.hints, 'hint')].filter(Boolean).join(' and ');
    const title = !r.winner ? 'Draw' : won ? 'You won! 🎉' : `${esc(bot.name)} won`;
    setCoach(`<b>${title}</b> by ${r.reason}. Review the game to see where it turned.`);
    setTimeout(async () => {
      if (st.destroyed) return;
      const v = await modal({
        title,
        body: `<p class="muted">${r.reason[0].toUpperCase() + r.reason.slice(1)} · vs ${esc(bot.name)} (~${bot.rating})</p>
          ${whatIf ? `<p>You chose moves for ${esc(bot.name)}, so this game does not count in your stats.</p>` : ''}
          ${won && !whatIf && helped ? `<p>You used ${help}, so this counts as a win with help. Try beating ${esc(bot.name)} on your own next!</p>` : ''}
          ${cleanWin && bot.id !== 'titan' ? `<p>Nice! Ready for the next opponent? Try <b>${esc(BOTS[BOTS.indexOf(bot) + 1].name)}</b>.</p>` : ''}
          ${!won && !whatIf && r.winner ? '<p>Every loss is a lesson. The game review shows your key mistakes.</p>' : ''}`,
        actions: [
          { label: 'Game review', cls: 'primary', value: 'review' },
          { label: 'Rematch', value: 'rematch' },
          ...(cleanWin && bot.id !== 'titan' ? [{ label: `Play ${esc(BOTS[BOTS.indexOf(bot) + 1].name)}`, value: 'next' }] : []),
          { label: 'Close', cls: 'ghost', value: null },
        ],
      });
      if (st.destroyed) return;
      if (v === 'review') location.hash = '#/review';
      else if (v === 'rematch') startNew(bot.id, data.playerColor === 'w' ? 'b' : 'w');
      else if (v === 'next') startNew(BOTS[BOTS.indexOf(bot) + 1].id, data.playerColor);
    }, 700);
  }

  function startNew(botId, color) { onStartNew(botId, color); }

  function startPlayerTurn() {
    st.hint = null; st.help = null; st.helped = false;
    setLiveMarks({});
    renderBoard(lastMoveSquares(), false);
    renderControls();
    const s = getSettings();
    if (s.coach || s.evalBar) {
      const g = st.gen;
      const ply = chess.history().length;
      st.turnAnalysis = analyser.analyse(chess.fen(), { depth: COACH_DEPTH }).then(r => {
        if (!st.destroyed && g === st.gen && !r.cancelled && r.score) { data.evals[ply] = r.score; renderEval(); }
        return r;
      }).catch(() => ({ bestmove: null, lines: [], score: null, cancelled: true }));
    } else st.turnAnalysis = null;
  }

  async function onUserMove(from, to) {
    if (st.sandbox) return sandboxMove(from, to);
    if (browsing()) return;
    const g = st.gen;
    const piece = chess.get(from);
    let promotion;
    if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = getSettings().autoQueen ? 'q' : await board.promote(piece.color);
      if (st.destroyed || g !== st.gen) return;
      if (!promotion) { renderBoard(lastMoveSquares(), false); return; }
    }
    let move;
    const fenBefore = chess.fen();
    try { move = chess.move({ from, to, promotion }); } catch { renderBoard(lastMoveSquares(), false); return; }
    sound.forMove(move, chess);
    setLiveArrows([]);
    setLiveMarks({});
    renderAll([move.from, move.to]);
    save();
    if (checkEnd()) return;
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
      if (st.destroyed || g !== st.gen) return;
      // After a hint or comparison the position was searched deeper, so the reply gets a deeper look too.
      const deep = (before?.lines?.[0]?.depth || 0) > COACH_DEPTH + 1;
      const after = await analyser.analyse(chess.fen(), deep ? WHATIF : { depth: COACH_DEPTH })
        .catch(() => ({ bestmove: null, lines: [], score: null, cancelled: true }));
      if (st.destroyed || g !== st.gen || after.cancelled) return;
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
    const sign = move.color === 'w' ? 1 : -1;
    const pct = s => winPct(sign * scoreToCp(s));
    const mates = s => s.mate != null && Math.sign(s.mate) === sign;
    let drop = pct(before.score) - pct(after.score);
    // A move the engine ranked itself is graded by that ranking too, so the verdict agrees with
    // what a hint or a comparison showed for this position.
    const ranked = before.lines.find(l => l.move === move.lan);
    if (ranked) drop = Math.min(drop, pct(before.lines[0].score) - pct(ranked.score));
    const bestUci = before.bestmove;
    const isBest = bestUci && bestUci === move.lan;
    let bestMove = null;
    try { bestMove = new Chess(fenBefore).move(uciToMove(bestUci)); } catch { }
    const bestSan = bestMove ? `<b>${esc(bestMove.san)}</b>` : 'Another move';
    const prev = chess.history({ verbose: true }).at(-2) || null;

    const cls = classify(drop, isBest);
    const bad = cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder';
    let label = CLASS_LABEL[cls], text, acts = '';
    st.why = null;
    if (cls === 'best') {
      label = isBest ? 'Best' : 'Excellent';
      text = isBest ? pick(['The top engine move!', 'Exactly what the engine wanted.', 'Spot on.']) : 'As good as the top move.';
      // Name the idea behind a tactic, so a good find is also understood.
      if (isBest) { try { const ex = explainEngineMove(fenBefore, move.lan, before, prev); if (ex.tactical) text = ex.reasons[0]; } catch { } }
    } else if (cls === 'good') text = `Solid. ${bestSan} was slightly better.`;
    if (!bad && !isBest && bestMove && mates(before.score) && !mates(after.score)) {
      text = `Still winning, but ${bestSan} was a forced checkmate in ${Math.abs(before.score.mate)}.`;
    }

    if (bad) {
      const why = mistakeReason(fenBefore, move.lan, {
        bestUci, replyUci: after.bestmove, pvBest: before.lines[0]?.pv, pvAfter: after.lines[0]?.pv,
        mateAgainst: after.score.mate != null && Math.sign(after.score.mate) === -sign,
        hadMate: mates(before.score),
      }) || shiftWords(sign * scoreToCp(before.score), sign * scoreToCp(after.score));
      // First what the played move does wrong, under its own name, then the better move.
      const said = why.replace(/^It /, `<b>${esc(move.san)}</b> `);
      const better = cls === 'inaccuracy' ? 'was better' : cls === 'mistake' ? 'was much better' : 'was the move';
      let idea = '';
      if (!why && bestMove) { try { const ex = explainEngineMove(fenBefore, bestUci, before, prev); if (!ex.generic) idea = ` ${ex.reasons[0]}`; } catch { } }
      text = bestMove && said.includes(bestSan) ? said : `${said} ${bestSan} ${better}.${idea}`.trim();
      acts = `<div class="coach-acts"><button data-act="takeback">Take back</button>${bestMove ? `<button data-act="why">Why ${esc(bestMove.san)}?</button>` : ''}</div>`;
      if (bestMove) {
        setLiveArrows([{ from: bestMove.from, to: bestMove.to, color: 'green' }]);
        st.why = { fen: fenBefore, uci: bestUci, analysis: before, prev };
      }
    }
    data.marks[ply] = bad ? cls : null;
    renderMoves();
    setCoach(`<span class="tag ${cls}">${label}</span> ${text}${acts}`);
  }

  /** What the better move would have done, after the coach pointed one out. */
  function whyBest() {
    const w = st.why;
    if (!w) return;
    let ex = null;
    try { ex = explainEngineMove(w.fen, w.uci, w.analysis, w.prev); } catch (e) { console.error('explain failed', e); }
    if (!ex) return;
    setCoach(`<b>${esc(ex.san)}</b> was the better move (green arrow).${reasonList(ex.reasons)}${footnote(ex.line, '')}
      <div class="coach-acts"><button data-act="takeback">Take back</button></div>`);
  }

  async function botTurn() {
    const g = st.gen;
    st.thinking = true; renderBars(); renderControls();
    board.setMovable(null);
    const t0 = Date.now();
    const info = {};
    const uci = await botMove(bot, chess, engine, info).catch(() => null);
    if (g !== st.gen || st.destroyed) return;
    const minDelay = uci ? thinkTime(chess, uci, info) : 0; // a person does not answer every move at the same speed
    const elapsed = Date.now() - t0;
    if (elapsed < minDelay) await sleep(minDelay - elapsed);
    if (g !== st.gen || st.destroyed) return;
    st.thinking = false;
    if (!uci) { renderAll(lastMoveSquares()); return; }
    let move;
    try { move = chess.move(uciToMove(uci)); } catch (e) { console.error('Bad bot move', uci, e); renderAll(lastMoveSquares()); return; }
    sound.forMove(move, chess);
    renderAll(lastMoveSquares(), !browsing());
    if (browsing()) renderBrowseCoach();
    save();
    if (checkEnd()) return;
    startPlayerTurn();
  }

  function undo() {
    if (st.sandbox) { sandboxBack(); return; }
    if (!chess.history().length) return;
    stopEngines();
    st.gen++;
    st.thinking = false;
    st.viewPly = null;
    do { chess.undo(); } while (chess.history().length > 0 && chess.turn() !== data.playerColor);
    const ply = chess.history().length;
    for (const k of Object.keys(data.marks)) if (+k > ply) delete data.marks[k];
    for (const k of Object.keys(data.evals)) if (+k > ply) delete data.evals[k];
    for (const k of Object.keys(data.picked)) if (+k > ply) delete data.picked[k];
    data.result = null; data.recorded = data.recorded; // a finished game stays recorded
    data.takebacks++;
    setLiveArrows([]);
    setLiveMarks({});
    setCoach('Move taken back. Try again!');
    renderAll(lastMoveSquares());
    save();
    if (chess.turn() !== data.playerColor) botTurn(); else startPlayerTurn();
  }

  // A hint comes in three steps: the idea, the piece, then the move with its reasons.
  async function hint() {
    if (chess.turn() !== data.playerColor || data.result || st.asking || st.thinking || browsing()) return;
    const g = st.gen, fen = chess.fen();
    if (!st.hint) {
      setCoach('Thinking about a hint…');
      st.asking = true;
      const res = await helpAnalysis().finally(() => { st.asking = false; });
      if (st.destroyed || g !== st.gen || chess.fen() !== fen) return;
      if (res.cancelled || !res.bestmove) { setCoach('No hint is ready yet. Tap Hint to try again.'); return; }
      st.hint = { uci: res.bestmove, analysis: res, step: 0 };
    }
    countHelp();
    const h = st.hint, m = uciToMove(h.uci);
    const prev = chess.history({ verbose: true }).at(-1) || null;
    try {
      if (h.step === 0) {
        setCoach(`💡 ${hintIdea(fen, h.uci, h.analysis, prev)} <span class="muted">(Tap Hint again for more.)</span>`);
      } else if (h.step === 1) {
        setLiveMarks({ [m.from]: 'hint' });
        setCoach(`💡 The move to find is with your <b>${PIECE_NAMES[chess.get(m.from).type]}</b> on ${m.from}. <span class="muted">(Tap Hint again to see it.)</span>`);
      } else {
        setLiveMarks({ [m.from]: 'hint' });
        setLiveArrows([{ from: m.from, to: m.to, color: 'blue' }]);
        const ex = explainEngineMove(fen, h.uci, h.analysis, prev);
        const alt = runnerUp(fen, h.analysis);
        setCoach(`💡 The engine suggests <b>${esc(ex.san)}</b>.${reasonList(ex.reasons)}${footnote(ex.line, ex.eval)}
          ${alt ? `<div class="small muted">${alt}</div>` : ''}${ASK_LINKS}`);
      }
    } catch (e) {
      console.error('hint failed', e);
      setLiveArrows([{ from: m.from, to: m.to, color: 'blue' }]);
      setCoach(`💡 The engine suggests the arrow move.${ASK_LINKS}`);
      h.step = 2;
    }
    h.step = Math.min(h.step + 1, 2);
  }

  /** Asking for the engine's view counts as one hint per position, however much is asked. */
  function countHelp() {
    if (st.helped) return false;
    st.helped = true;
    data.hints++;
    save();
    return true;
  }

  /** The engine's view of the current game position, reusing this turn's analysis when it finished. */
  async function positionAnalysis() {
    const r = st.turnAnalysis ? await st.turnAnalysis : null;
    return r && !r.cancelled && r.bestmove ? r
      : analyser.analyse(chess.fen(), { depth: COACH_DEPTH }).catch(() => ({ bestmove: null, lines: [], score: null, cancelled: true }));
  }

  /**
   * A deeper look at the game position with the three best moves. Hints, comparisons and the
   * coach's verdict on the next move all read this one result, so they never contradict each other.
   */
  function helpAnalysis() {
    const fen = chess.fen();
    if (st.help?.fen !== fen) {
      const entry = { fen }, ply = chess.history().length;
      entry.promise = analyser.analyse(fen, HELP).then(r => {
        if (r.cancelled || !r.bestmove) { if (st.help === entry) st.help = null; }
        else if (!st.destroyed && st.help === entry && chess.fen() === fen) { st.turnAnalysis = Promise.resolve(r); data.evals[ply] = r.score; renderEval(); }
        return r;
      }).catch(() => { if (st.help === entry) st.help = null; return { bestmove: null, lines: [], score: null, cancelled: true }; });
      st.help = entry;
    }
    return st.help.promise;
  }

  // ---------- "What if?" board ----------
  // Moves are played on a copy, for either side. The game, its stats and its saved state stay as they were.
  async function openSandbox() {
    if (st.sandbox || st.asking || data.result || st.thinking || browsing() || chess.turn() !== data.playerColor) return;
    const counted = countHelp(); // seeing the engine's view is help, like a hint
    const intro = `🔍 <b>What if?</b> Your game is paused. Play a move for either side to see what happens next.${counted ? ' <span class="muted">This counts as a hint.</span>' : ''}${COMPARE_LINK}`;
    const sb = st.sandbox = {
      chess: new Chess(chess.fen()), busy: true,
      steps: [{ analysis: null, html: intro, arrows: board.arrows }],
      restore: { coach: st.coachHtml, arrows: board.arrows, marks: board.marks },
    };
    setCoach(intro);
    renderAll(lastMoveSquares(), false);
    const r = await positionAnalysis();
    if (st.destroyed || st.sandbox !== sb) return;
    sb.steps[0].analysis = r;
    sb.busy = false;
    renderAll(lastMoveSquares(), false);
  }

  function closeSandbox() {
    const { restore } = st.sandbox;
    st.sandbox = null;
    setLiveMarks(restore.marks);
    setLiveArrows(restore.arrows);
    setCoach(restore.coach);
    renderAll(lastMoveSquares(), false);
  }

  async function sandboxMove(from, to) {
    const sb = st.sandbox;
    if (sb.busy) return;
    const piece = sb.chess.get(from);
    let promotion;
    if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
      promotion = getSettings().autoQueen ? 'q' : await board.promote(piece.color);
      if (st.destroyed || st.sandbox !== sb) return;
      if (!promotion) { renderBoard(lastMoveSquares(), false); return; }
    }
    const fenBefore = sb.chess.fen();
    let move;
    try { move = sb.chess.move({ from, to, promotion }); } catch { renderBoard(lastMoveSquares(), false); return; }
    sound.forMove(move, sb.chess);
    sb.busy = true;
    board.setArrows([]);
    board.setMarks({});
    setCoach('Looking at what happens…');
    renderAll([move.from, move.to]);
    const over = sb.chess.isGameOver();
    const after = over ? null : await analyser.analyse(sb.chess.fen(), WHATIF)
      .catch(() => ({ bestmove: null, lines: [], score: null, cancelled: true }));
    if (st.destroyed || st.sandbox !== sb) return;
    let shown = { html: 'The engine could not look at this position.', arrows: [] };
    try { shown = whatIfMove(fenBefore, move.lan, sb.steps.at(-1).analysis, after, data.playerColor); } catch (e) { console.error('what if failed', e); }
    sb.steps.push({ analysis: after, html: shown.html + (over ? '' : COMPARE_LINK), arrows: shown.arrows });
    showSandboxStep();
  }

  function showSandboxStep() {
    const sb = st.sandbox, step = sb.steps.at(-1);
    sb.busy = false;
    setCoach(step.html);
    board.setArrows(step.arrows);
    renderAll(lastMoveSquares(), false);
  }

  function sandboxBack() {
    const sb = st.sandbox;
    if (sb.busy || sb.steps.length < 2) return;
    sb.chess.undo();
    sb.steps.pop();
    showSandboxStep();
  }

  /** Show the top engine moves side by side, on the game or on the What if? board. */
  async function compareTop() {
    const sb = st.sandbox, c = pos(), fen = c.fen(), g = st.gen;
    if (st.asking || sb?.busy || (!sb && browsing()) || c.isGameOver()) return;
    st.asking = true;
    if (sb) { sb.busy = true; renderBoard(lastMoveSquares(), false); renderControls(); }
    setCoach('Comparing the top moves…');
    // The game position shares its analysis with the hint, so both name the same best move.
    const r = await (fen === chess.fen() ? helpAnalysis() : analyser.analyse(fen, HELP))
      .catch(() => ({ bestmove: null, lines: [], score: null, cancelled: true }))
      .finally(() => { st.asking = false; });
    if (st.destroyed || g !== st.gen || st.sandbox !== sb || (!sb && chess.fen() !== fen) || (sb && sb.chess.fen() !== fen)) return;
    if (r.cancelled || !r.lines.length) { if (sb) showSandboxStep(); else setCoach('The comparison is not ready. Tap Hint to try again.'); return; }
    const shown = compareMoves(fen, r, data.playerColor, c.history({ verbose: true }).at(-1) || null);
    if (sb) {
      Object.assign(sb.steps.at(-1), shown, { analysis: r });
      showSandboxStep();
    } else {
      setCoach(`${shown.html}<div class="coach-acts"><button data-act="whatif">What if…?</button></div>`);
      setLiveArrows(shown.arrows);
    }
  }

  // ---------- buttons & history inputs ----------
  $('#hintBtn', view).addEventListener('click', hint);
  $('#undoBtn', view).addEventListener('click', undo);
  $('#whatIfBtn', view).addEventListener('click', () => (st.sandbox ? closeSandbox() : openSandbox()));
  $('#reviewBtn', view).addEventListener('click', () => { location.hash = '#/review'; });
  $('#resignBtn', view).addEventListener('click', async () => {
    if (data.result) { location.hash = '#/play'; return; }
    const ok = await confirmBox('Resign?', `<p class="muted">${isWhatIf() ? 'You chose moves for the bot, so this game does not count in your stats.' : 'The game will count as a loss.'}</p>`, 'Resign');
    if (st.destroyed) return;
    if (ok && !data.result) {
      stopEngines(); st.gen++; st.thinking = false;
      finish({ winner: data.playerColor === 'w' ? 'b' : 'w', reason: 'resignation' });
      renderAll(lastMoveSquares(), false);
    }
  });

  $('#histPrev', view).addEventListener('click', () => goHistory(shownPly() - 1));
  $('#histNext', view).addEventListener('click', () => goHistory(shownPly() + 1));
  $('#histLive', view).addEventListener('click', () => goHistory(chess.history().length));
  $('#histRange', view).addEventListener('input', e => goHistory(+e.target.value, { animate: false, playSound: false }));
  $('#moves', view).addEventListener('click', e => {
    if (st.sandbox) return;
    const m = e.target.closest('[data-ply]');
    if (m) goHistory(+m.dataset.ply);
  });

  // Swipe left/right on the coach box to browse history.
  let swipe = null;
  const coachEl = $('#coach', view);
  coachEl.addEventListener('pointerdown', e => {
    if (st.sandbox || e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });
  coachEl.addEventListener('pointerup', e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    swipe = null;
    if (st.sandbox || Math.abs(dx) <= 40 || Math.abs(dx) <= Math.abs(dy)) return;
    goHistory(shownPly() + (dx < 0 ? 1 : -1));
  });
  coachEl.addEventListener('pointercancel', e => {
    if (swipe && e.pointerId === swipe.id) swipe = null;
  });

  // Arrow keys step through move history on a computer.
  const onKey = e => {
    if (st.destroyed || st.sandbox || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target?.closest?.('input, select, textarea') || $('#modalRoot')?.childElementCount) return;
    const n = chess.history().length;
    if (!n) return;
    if (e.key === 'Escape') {
      if (browsing()) { e.preventDefault(); goHistory(n); }
      return;
    }
    const to = { ArrowLeft: shownPly() - 1, ArrowRight: shownPly() + 1, Home: 0, End: n }[e.key];
    if (to != null) { e.preventDefault(); goHistory(to); }
  };
  window.addEventListener('keydown', onKey);

  // ---------- start ----------
  function destroy() {
    st.destroyed = true; st.gen++; st.sandbox = null;
    window.removeEventListener('keydown', onKey);
    stopEngines();
  }

  renderAll(lastMoveSquares(), false);
  loadOpenings().then(() => { if (!st.destroyed) renderOpening(); });
  Promise.all([engine.init(), analyser.init()]).catch(() => toast('Could not start the chess engine'));

  if (data.result) {
    const r = data.result;
    setCoach(`Game over: ${!r.winner ? 'draw' : r.winner === data.playerColor ? 'you won' : esc(bot.name) + ' won'} by ${esc(r.reason)}.`);
    board.setMovable(null);
  } else if (chess.history().length === 0) {
    setCoach(data.playerColor === 'w'
      ? `You have the white pieces. ${pick(OPENING_TIPS)}`
      : `You have the black pieces. ${esc(bot.name)} moves first.`);
    engine.newGame(); analyser.newGame();
    if (chess.turn() !== data.playerColor) botTurn(); else startPlayerTurn();
  } else {
    setCoach(chess.turn() === data.playerColor ? 'Welcome back! Your move.' : 'Welcome back!');
    if (chess.turn() !== data.playerColor) botTurn(); else startPlayerTurn();
  }

  return destroy;
}

const COMPARE_LINK = '<div class="coach-acts"><button data-act="compare">Compare top moves</button></div>';
const ASK_LINKS = '<div class="coach-acts"><button data-act="whatif">What if…?</button><button data-act="compare">Compare top moves</button></div>';

/** The bot's engine plays, the analyser coaches; both stop together. */
function stopEngines() { engine.stop(); if (analyser !== engine) analyser.stop(); }

const OPENING_TIPS = [
  'Start by taking the center with a pawn (e4 or d4).',
  'Remember: develop your knights and bishops early.',
  'Try to castle within the first 10 moves to keep your king safe.',
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
