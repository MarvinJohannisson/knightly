// Plain-language reasons why an engine move is strong, built from simple board
// heuristics (captures, forks, pins, threats, safety, development) plus the engine's main line.
import { Chess } from '../vendor/chess.js';
import { esc, PIECE_VALUE, uciToMove, scoreToCp, fmtScore, winPct, classify, CLASS_LABEL } from './util.js';

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const FILES = 'abcdefgh';
const DIAGONALS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const STRAIGHTS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const LINES = { b: DIAGONALS, r: STRAIGHTS, q: [...DIAGONALS, ...STRAIGHTS] };
const CENTER_PUSHES = ['c4', 'd4', 'e4', 'f4', 'c5', 'd5', 'e5', 'f5'];
const val = t => (t === 'k' ? 100 : PIECE_VALUE[t]);
const other = c => (c === 'w' ? 'b' : 'w');
const tryMove = (fen, uci) => { try { return new Chess(fen).move(uciToMove(uci)); } catch { return null; } };
const step = (sq, [df, dr]) => {
  const f = FILES.indexOf(sq[0]) + df, r = +sq[1] + dr;
  return f >= 0 && f < 8 && r >= 1 && r <= 8 ? FILES[f] + r : null;
};

function pieces(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === color) out.push(p);
  return out;
}

/** A piece is in danger if it is attacked and either undefended or attacked by something cheaper. */
function inDanger(chess, sq) {
  const p = chess.get(sq);
  if (!p || p.type === 'k') return false;
  const att = chess.attackers(sq, other(p.color));
  if (!att.length) return false;
  const def = chess.attackers(sq, p.color);
  if (!def.length || att.length > def.length) return true;
  return Math.min(...att.map(s => val(chess.get(s).type))) < val(p.type);
}

/** A checkmate the side NOT to move would have if it could move now (null-move threat). */
function mateThreat(chess) {
  if (chess.inCheck()) return null;
  const f = chess.fen().split(' ');
  f[1] = other(f[1]); f[3] = '-';
  let c;
  try { c = new Chess(f.join(' ')); } catch { return null; }
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    const mate = c.isCheckmate();
    c.undo();
    if (mate) return m.san;
  }
  return null;
}

/** The first two pieces a bishop, rook or queen on `from` looks at along each of its lines. */
function lineUps(chess, from, type) {
  const out = [];
  for (const d of LINES[type] || []) {
    const seen = [];
    for (let sq = step(from, d); sq && seen.length < 2; sq = step(sq, d)) {
      const p = chess.get(sq);
      if (p) seen.push({ type: p.type, color: p.color, square: sq });
    }
    if (seen.length === 2) out.push({ front: seen[0], back: seen[1] });
  }
  return out;
}

/** Own bishops and queens whose diagonal was blocked by the piece on `m.from` and opens up once it leaves. */
function unblocked(before, m, me) {
  const out = [];
  for (const p of pieces(before, me)) {
    if (!'bq'.includes(p.type) || p.square === m.from || out.includes(p.type)) continue;
    for (const d of DIAGONALS) {
      let sq = step(p.square, d);
      while (sq && !before.get(sq)) sq = step(sq, d);
      if (sq !== m.from) continue;
      let gained = 1;
      for (sq = step(sq, d); sq && sq !== m.to && !before.get(sq); sq = step(sq, d)) gained++;
      if (gained >= 3) { out.push(p.type); break; }
    }
  }
  // A queen's diagonal alone is rarely the point of a move, so it is only named next to a bishop.
  return out.includes('b') ? out.sort() : [];
}

/** How many squares the piece on `sq` attacks or defends. */
function reach(chess, sq, color) {
  let n = 0;
  for (const f of FILES) for (let r = 1; r <= 8; r++) {
    const t = f + r;
    if (t !== sq && chess.attackers(t, color).includes(sq)) n++;
  }
  return n;
}

/** A square in the opponent's half that one of `me`'s pawns guards and no enemy pawn can ever attack. */
function isOutpost(chess, sq, me) {
  const r = +sq[1], f = FILES.indexOf(sq[0]), dir = me === 'w' ? 1 : -1;
  if (me === 'w' ? r < 4 || r > 6 : r > 5 || r < 3) return false;
  const guarded = chess.attackers(sq, me).some(s => chess.get(s).type === 'p');
  const chasers = pieces(chess, other(me)).some(p => p.type === 'p'
    && Math.abs(FILES.indexOf(p.square[0]) - f) === 1 && (+p.square[1] - r) * dir > 0);
  return guarded && !chasers;
}

/**
 * A list of UCI moves as plain words (HTML): "you play Rb1, they reply Kg8, then you play dxc6".
 * `me` is the side called "you"; it defaults to the side to move.
 */
export function movesInWords(fen, pv, max = 4, me = null) {
  const c = new Chess(fen);
  const you = me || c.turn();
  const out = [];
  for (const uci of pv.slice(0, max)) {
    const who = c.turn() === you ? 'you' : 'they';
    let m;
    try { m = c.move(uciToMove(uci)); } catch { break; }
    const i = out.length;
    out.push(`${i === 2 ? 'then ' : ''}${who} ${i % 2 ? 'reply' : 'play'} <b>${esc(m.san)}</b>`);
  }
  return out.join(', ');
}

// ---------- material ----------
function census(chess) {
  const n = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') n[p.color][p.type]++;
  return n;
}
const points = side => Object.entries(side).reduce((s, [t, k]) => s + k * PIECE_VALUE[t], 0);
const balance = (n, color) => points(n[color]) - points(n[other(color)]);

const COUNT = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
function listPieces(types) {
  const out = [];
  for (const t of ['q', 'r', 'b', 'n', 'p']) {
    const k = types.filter(x => x === t).length;
    if (k) out.push(`${COUNT[k]} ${NAMES[t]}${k > 1 ? 's' : ''}`);
  }
  return out.length > 1 ? `${out.slice(0, -1).join(', ')} and ${out.at(-1)}` : out[0] || '';
}

/** What `color` came out ahead by between two piece counts: "a knight", "a rook for a bishop". */
function swapText(a, b, color) {
  const made = ['q', 'r', 'b', 'n'].find(t => b[color][t] > a[color][t]);
  if (made) return `a new ${NAMES[made]}`;
  const lost = side => ['q', 'r', 'b', 'n', 'p'].flatMap(t => Array(Math.max(0, a[side][t] - b[side][t])).fill(t));
  const won = lost(other(color)), paid = lost(color);
  // Like-for-like trades cancel out, and a bishop for a knight counts as even.
  const cancel = (x, y) => {
    const i = won.indexOf(x), j = paid.indexOf(y);
    if (i < 0 || j < 0) return false;
    won.splice(i, 1); paid.splice(j, 1);
    return true;
  };
  for (const t of ['q', 'r', 'b', 'n', 'p']) while (cancel(t, t));
  while (cancel('b', 'n') || cancel('n', 'b'));
  if (!won.length) return 'material';
  if (!paid.length) return listPieces(won);
  if (won.join() === 'r' && paid.length === 1 && 'bn'.includes(paid[0])) return `the exchange (a rook for a ${NAMES[paid[0]]})`;
  return `${listPieces(won)} for ${listPieces(paid)}`;
}

/**
 * Material `color` comes out ahead by along a line of UCI moves. It is counted only once the
 * other side has had its reply, so a capture that gets taken back is not a gain.
 * -> { gain (points), plies (the shortest part of the line that shows it), text }
 */
export function lineGain(fen, pv, color, max = 6) {
  const c = new Chess(fen);
  const start = census(c);
  const res = { gain: 0, plies: 0, text: '' };
  const measure = n => {
    const now = census(c);
    const g = balance(now, color) - balance(start, color);
    if (g !== res.gain) { res.gain = g; res.plies = n; res.text = g > 0 ? swapText(start, now, color) : ''; }
  };
  let last = null, n = 0;
  for (const uci of (pv || []).slice(0, max)) {
    try { last = c.move(uciToMove(uci)); } catch { break; }
    n++;
    if (c.turn() === color) measure(n);
  }
  // A line that ends on a capture nobody can take back still counts.
  if (last && last.color === color && last.captured && !c.moves({ verbose: true }).some(m => m.to === last.to)) measure(n);
  return res;
}

const joinList = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} and ${a.at(-1)}` : a[0] || '');

/**
 * What a sacrifice buys, as far as the board shows it. `before` is the position before the
 * sacrifice, `after` the one once `reply` has taken; `their` is "their" or "your" for the taker.
 * -> phrases such as "their pawns are doubled on the e-file"
 */
function compensation(before, after, reply, me, their) {
  const opp = other(me);
  const out = [];
  const doubled = ch => {
    const n = {};
    for (const p of pieces(ch, opp)) if (p.type === 'p') n[p.square[0]] = (n[p.square[0]] || 0) + 1;
    return Object.keys(n).filter(f => n[f] > 1);
  };
  const fresh = doubled(after).filter(f => !doubled(before).includes(f));
  if (fresh.length) out.push(`${their} pawns are doubled on the ${fresh[0]}-file`);

  const king = pieces(after, opp).find(p => p.type === 'k');
  const near = (a, b2) => Math.abs(FILES.indexOf(a[0]) - FILES.indexOf(b2[0])) <= 1 && Math.abs(a[1] - b2[1]) <= 1;
  if (reply.piece === 'k') out.push(`${their} king is drawn out into the open`);
  else if (reply.piece === 'p' && king && near(reply.from, king.square)) out.push(`${their} king has lost part of its pawn cover`);

  // A pawn that took toward the centre can leave the pawn behind it stuck, and a bishop behind that.
  if (reply.piece === 'p') {
    const home = opp === 'w' ? -1 : 1;
    const behind = step(reply.to, [0, home]);
    const stuck = behind && after.get(behind);
    if (stuck && stuck.type === 'p' && stuck.color === opp) {
      const bishop = [[1, home], [-1, home]].map(d => step(behind, d))
        .find(sq => sq && after.get(sq)?.type === 'b' && after.get(sq).color === opp);
      out.push(bishop ? `${their} pawn on ${behind} is stuck, which blocks ${their} bishop on ${bishop}` : `${their} pawn on ${behind} is stuck`);
    }
  }
  return out;
}

// ---------- evaluation in words ----------
const BANDS = [
  [700, 'winning', 'a winning position'], [350, 'clearly better', 'a clearly better position'],
  [150, 'better', 'a better position'], [60, 'slightly better', 'a slightly better position'],
  [-60, 'about equal', 'an equal position'], [-150, 'slightly worse', 'a slightly worse position'],
  [-350, 'worse', 'a worse position'], [-700, 'clearly worse', 'a clearly worse position'],
  [-Infinity, 'losing', 'a losing position'],
];
const band = cp => BANDS.findIndex(b => cp > b[0]);
/** A position in two or three words for the side `cp` belongs to: "slightly better", "losing". */
export const bandWord = cp => BANDS[band(cp)][1];

/** How the position stands for `me`, in words. `score` is from White's point of view. */
export function evalWords(score, me) {
  if (!score) return '';
  const sign = me === 'w' ? 1 : -1;
  if (score.mate != null) return Math.sign(score.mate) === sign ? `you mate in ${Math.abs(score.mate)}` : `they mate in ${Math.abs(score.mate)}`;
  const cp = sign * scoreToCp(score);
  const word = BANDS[band(cp)][1];
  return `${word === 'about equal' ? word : `you're ${word}`} (${fmtScore({ cp })})`;
}

/** What a move cost when no single tactic explains it. Both scores are from the mover's side. */
export function shiftWords(cpBefore, cpAfter) {
  const a = band(cpBefore), b = band(cpAfter);
  return b > a ? `It takes you from ${BANDS[a][2]} to ${BANDS[b][2]}.` : '';
}

/**
 * Why a played move went wrong: one plain sentence (HTML), or '' when no simple reason shows.
 * `replyUci` is the opponent's best answer; `mateAgainst` and `hadMate` come from the engine scores.
 * `pvBest` (the engine line starting with the best move) and `pvAfter` (its line after the played
 * move) let it follow a tactic for a few moves. `now` words it for a move not played yet, and
 * `player` is the side called "you" (the mover unless given).
 */
export function mistakeReason(fen, uci, { bestUci, replyUci, mateAgainst, hadMate, pvBest, pvAfter, now = false, player = null } = {}) {
  const played = tryMove(fen, uci);
  if (!played) return '';
  const me = played.color, opp = other(me);
  const you = player || me;
  const your = you === me ? 'your' : 'their';
  const best = bestUci ? tryMove(fen, bestUci) : null;
  const reply = tryMove(played.after, replyUci ?? pvAfter?.[0]);
  if (mateAgainst) return `It allows a forced checkmate${reply ? `, starting with <b>${esc(reply.san)}</b>` : ''}.`;
  if (hadMate && best) {
    return now ? `It misses the forced checkmate that starts with <b>${esc(best.san)}</b>.`
      : `You had a forced checkmate starting with <b>${esc(best.san)}</b>!`;
  }

  // A piece that can simply be taken. Retaking something at least as valuable makes it a trade, not a loss.
  if (reply && reply.captured && PIECE_VALUE[reply.captured] >= 3) {
    const canRetake = new Chess(reply.after).moves({ verbose: true }).some(m => m.to === reply.to);
    const trade = canRetake && val(reply.piece) >= PIECE_VALUE[reply.captured];
    if (!trade) {
      const piece = `${your} ${NAMES[reply.captured]}`, take = `<b>${esc(reply.san)}</b>`;
      if (reply.to === played.to) return `It puts ${piece} on ${reply.to} where it can be taken with ${take}.`;
      if (inDanger(new Chess(fen), reply.to)) return `It leaves ${piece} on ${reply.to} hanging: it was already under attack, and ${take} takes it.`;
      return `It leaves ${piece} on ${reply.to} unprotected, so ${take} wins it.`;
    }
  }

  // Follow both engine lines for two moves each: what the played move loses, and what the best
  // move wins. Further out the engine's line is too unsure to build a claim on.
  const theirs = pvAfter?.length ? lineGain(fen, [uci, ...pvAfter], opp, 5) : null;
  const mine = pvBest?.length ? lineGain(fen, pvBest, me, 4) : null;
  const lose = theirs ? theirs.gain : 0, win = mine ? mine.gain : 0;
  if (win + lose >= 1) {
    if (lose >= 1 && lose >= win) {
      return `It loses ${theirs.text}: ${movesInWords(played.after, pvAfter, theirs.plies - 1, you)}.`;
    }
    if (win >= 1) {
      if (now) return `It misses the chance to win ${mine.text}.`;
      const first = tryMove(fen, pvBest[0]);
      const how = mine.plies <= 2 && first ? ` with <b>${esc(first.san)}</b>` : ''; // a longer line is told with the better move
      return `You could have won ${lose < 0 ? 'even more, ' : ''}${mine.text}${how}.`;
    }
  }

  // Without engine lines, at least point out a capture that was there.
  if (!pvBest && best && best.captured && PIECE_VALUE[best.captured] >= 3 && played.to !== best.to) {
    return now ? `It passes up the ${NAMES[best.captured]} on ${best.to}.` : `You could have captured the ${NAMES[best.captured]} on ${best.to}.`;
  }
  if (reply && reply.san.includes('+')) return `It allows <b>${esc(reply.san)}</b> with a strong check.`;
  return '';
}

/**
 * explainMove(fen, uci, analysis) -> { san, reasons: string[] (HTML), line, eval, tags, tactical }
 * `analysis` is the engine result for `fen` ({ score, lines: [{ pv }] }); scores are White's POV.
 * `prev` is the verbose move that led to `fen`, used to spot recaptures. `player` is the side
 * called "you"; it defaults to the side that moves.
 */
export function explainMove(fen, uci, analysis = {}, prev = null, player = null) {
  const b = new Chess(fen); // the position before the move
  const c = new Chess(fen); // and after it
  const me = c.turn(), opp = other(me);
  const mine = !player || player === me;
  const your = mine ? 'your' : 'their', their = mine ? 'their' : 'your';
  const you = mine ? 'you' : 'they', they = mine ? 'they' : 'you';
  const sign = me === 'w' ? 1 : -1;
  const fullmove = +fen.split(' ')[5] || 1;
  const wasCheck = c.inCheck();

  const dangerBefore = pieces(c, me).map(p => p.square).filter(sq => inDanger(c, sq));
  const threatBefore = mateThreat(c);
  const pv = analysis.lines?.[0]?.pv?.[0] === uci ? analysis.lines[0].pv : [uci];
  const score = analysis.score;
  const m = c.move(uciToMove(uci));
  const moved = m.promotion || m.piece;
  const reasons = [], tags = new Set();
  const add = (r, tag) => { if (r && !reasons.includes(r)) { reasons.push(r); if (tag) tags.add(tag); } };
  const done = extra => ({ san: m.san, reasons: reasons.slice(0, 3), line: '', eval: '', tags: [...tags], tactical: true, ...extra });

  // --- Decisive stuff first ---
  if (c.isCheckmate()) { add('It\'s <b>checkmate</b>, the game is over!', 'checkmate'); return done(); }
  let mateIn = 0;
  if (score?.mate != null && Math.sign(score.mate) === sign) {
    mateIn = Math.abs(score.mate);
    add(`It starts a <b>forced checkmate</b> in ${mateIn} move${mateIn > 1 ? 's' : ''}, whatever ${they} reply.`, 'mate');
  }
  if (m.promotion) add(`It <b>promotes</b> ${your} pawn to a ${NAMES[m.promotion]}.`, 'promo');

  // --- Captures ---
  let explainedGain = 0;
  if (m.captured) {
    const cv = PIECE_VALUE[m.captured], mv = PIECE_VALUE[m.piece];
    const canRetake = c.moves({ verbose: true }).some(x => x.to === m.to);
    const sq = m.flags.includes('e') ? m.to[0] + m.from[1] : m.to; // en passant takes the pawn beside the mover
    explainedGain = canRetake ? Math.max(0, cv - mv) : cv;
    if (prev?.captured && prev.to === m.to) {
      const gave = PIECE_VALUE[prev.captured];
      if (cv > gave) add(`It <b>takes back</b> on ${m.to} and comes out ahead: ${you} get a ${NAMES[m.captured]} for a ${NAMES[prev.captured]}.`, 'wins');
      else if (cv === gave) add(`It <b>takes back</b> on ${m.to}, so the trade is even.`, 'recapture');
      else add(`It <b>takes back</b> on ${m.to}, so ${you} at least get a ${NAMES[m.captured]} for ${your} ${NAMES[prev.captured]}.`, 'recapture');
    } else if (!canRetake) add(`It wins the ${NAMES[m.captured]} on ${sq} <b>for free</b>: nothing can take back.`, 'free');
    else if (cv > mv) add(`It wins material: ${your} ${NAMES[m.piece]} takes a more valuable ${NAMES[m.captured]}.`, 'wins');
    else if (m.captured === m.piece) add(`It trades ${NAMES[m.piece]}s on ${sq}.`, 'trade');
    else if (cv === mv) add(`It trades ${your} ${NAMES[m.piece]} for the ${NAMES[m.captured]} on ${sq}.`, 'trade');
  }

  // --- Escaping check ---
  if (wasCheck) {
    tags.add('check');
    if (m.piece === 'k') add(`It moves ${your} king out of check.`);
    else if (m.captured) add('It deals with the check by capturing the attacker.');
    else add('It blocks the check.');
  }

  // --- Forks and threats made by the moved piece (only what it did not already attack) ---
  const safeHere = !inDanger(c, m.to) || m.piece === 'k';
  const targets = pieces(c, opp).filter(p => {
    if (!c.attackers(p.square, me).includes(m.to)) return false;
    if (p.type === 'k') return true;
    const undefended = !c.attackers(p.square, opp).length;
    return p.type !== 'p' && (undefended || val(p.type) > val(moved));
  });
  const fresh = targets.filter(p => m.promotion || !b.attackers(p.square, me).includes(m.from));
  if (targets.length >= 2 && fresh.length && safeHere) {
    const list = targets.map(p => (p.type === 'k' ? 'the king' : `the ${NAMES[p.type]} on ${p.square}`));
    add(`It's a <b>fork</b>: ${your} ${NAMES[moved]} attacks ${list.slice(0, -1).join(', ')} and ${list.at(-1)} at once.`, 'fork');
  } else if (targets.length === 1 && fresh.length && targets[0].type !== 'k' && safeHere) {
    const t = targets[0], what = `${their} ${NAMES[t.type]} on ${t.square}`;
    if (c.attackers(t.square, opp).length) add(`It <b>attacks</b> ${what} with a cheaper piece, so it has to move.`, 'attack');
    else add(`It <b>attacks</b> ${what}, which is undefended.`, 'attack');
  }

  // --- Pins and skewers along the moved piece's lines ---
  if (LINES[moved] && safeHere) {
    const had = new Set(m.promotion ? [] : lineUps(b, m.from, m.piece).map(l => l.front.square + l.back.square));
    for (const { front, back } of lineUps(c, m.to, moved)) {
      if (front.color !== opp || back.color !== opp || had.has(front.square + back.square)) continue;
      // A front piece that can take the newcomer at no loss is a trade offer, not a pin.
      const hitsBack = c.attackers(m.to, opp).includes(front.square) && val(front.type) <= val(moved);
      const backLoose = back.type !== 'p' && (!c.attackers(back.square, opp).length || val(back.type) > val(moved));
      const fn = NAMES[front.type], bn = `the ${NAMES[back.type]} on ${back.square}`;
      if (front.type === 'k') {
        if (backLoose) add(`It's a <b>skewer</b>: the king has to step out of check, and ${you} take ${bn} behind it.`, 'skewer');
      } else if (back.type === 'k') {
        if (front.type !== 'p' && !hitsBack) add(`It <b>pins</b> ${their} ${fn} on ${front.square} to the king, so it cannot move away.`, 'pin');
      } else if (val(front.type) > val(back.type)) {
        if (val(front.type) > val(moved) && backLoose) add(`It's a <b>skewer</b>: when ${their} ${fn} on ${front.square} moves, ${you} take ${bn} behind it.`, 'skewer');
      } else if (val(back.type) > val(front.type)) {
        if (front.type !== 'p' && val(back.type) > val(moved) && !hitsBack) add(`It <b>pins</b> ${their} ${fn} on ${front.square}: if it moves, ${you} take ${bn}.`, 'pin');
      }
    }
  }

  // --- Attacks uncovered by moving out of the way ---
  if (!m.flags.includes('k') && !m.flags.includes('q')) {
    for (const p of pieces(c, opp).sort((x, y) => val(y.type) - val(x.type))) {
      const from = c.attackers(p.square, me).find(s => s !== m.to && !b.attackers(p.square, me).includes(s));
      if (!from) continue;
      const a = c.get(from);
      if (p.type === 'k') add(`It uncovers a <b>discovered check</b> from ${your} ${NAMES[a.type]} on ${from}.`, 'discovered');
      else if (p.type !== 'p' && (!c.attackers(p.square, opp).length || val(p.type) > val(a.type))) {
        add(`It uncovers an attack on ${their} ${NAMES[p.type]} on ${p.square} from ${your} ${NAMES[a.type]}.`, 'discovered');
      } else continue;
      break;
    }
  }
  if (m.san.includes('+') && !['fork', 'skewer', 'discovered'].some(t => tags.has(t))) add(`It gives <b>check</b>, so ${they} have to deal with that first.`);

  // --- Stopping their threats ---
  if (threatBefore && !c.isCheck()) {
    const c2 = new Chess(c.fen());
    let still = false;
    try { c2.move(threatBefore); still = c2.isCheckmate(); } catch { }
    if (!still) add(`It <b>stops the threat</b> of ${esc(threatBefore)}, which would be checkmate.`, 'threat');
  }

  // --- Safety of your own pieces ---
  let danger = null;
  if (dangerBefore.includes(m.from) && !inDanger(c, m.to)) {
    danger = { type: m.piece, square: m.from };
    add(`It moves ${your} ${NAMES[m.piece]} <b>out of danger</b>.`, 'danger');
  }
  const saved = dangerBefore.filter(sq => sq !== m.from && c.get(sq)?.color === me && !inDanger(c, sq));
  if (saved.length) {
    danger = danger || { type: c.get(saved[0]).type, square: saved[0] };
    add(`It protects ${your} ${NAMES[c.get(saved[0]).type]} on ${saved[0]}, which was under attack.`, 'danger');
  }

  // --- Follow-up in the engine line ---
  const who = mine ? me : opp;
  const { gain, plies, text } = lineGain(fen, pv, me, 4);
  const showsLine = !mateIn && gain > explainedGain && gain >= 1 && plies >= 2;
  let toldLine = showsLine;
  if (showsLine) {
    add(`${m.captured ? 'It wins material' : 'It sets up a tactic'}: ${movesInWords(fen, pv, plies, who)}, and ${you}'ve won ${text}.`, 'tactic');
  }

  // --- Material given up on purpose ---
  // The engine expects the reply to take something. Without a word about it, a sacrifice or a
  // gambit looks like a blunder, so say that it is meant and what it buys.
  let reply = null;
  const afterReply = new Chess(c.fen());
  try { if (pv[1]) reply = afterReply.move(uciToMove(pv[1])); } catch { }
  const down = reply?.captured ? balance(census(b), me) - balance(census(afterReply), me) : 0;
  if (down >= 1 && !mateIn && !showsLine) {
    const what = swapText(census(b), census(afterReply), opp);
    const take = `<b>${esc(reply.san)}</b>`;
    if (gain >= 0 && pv.length >= 4) {
      // Taken and taken back at once is a trade, not a sacrifice. Only worth a word when the
      // moved piece itself is what gets traded; otherwise the usual line shows it.
      if (reply.to === m.to) { add(`It offers a trade: ${movesInWords(fen, pv, 3, who)}.`); toldLine = true; }
    } else if (sign * scoreToCp(score) >= -60) {
      const got = compensation(b, afterReply, reply, me, their);
      // Further out the engine's line is less sure, so a later recovery is only mentioned.
      const back = lineGain(fen, pv, me, 6).gain >= 0 ? ` The engine expects ${you} to get the material back within a few moves.` : '';
      add((got.length ? `It <b>gives up ${what}</b> on purpose. After ${take}, ${joinList(got)}.`
        : `It <b>gives up ${what}</b> on purpose: the engine rates the active play ${you} get after ${take} higher than the material.`) + back, 'sacrifice');
    } else add(`It lets ${what} go after ${take}, but holding on to it would cost more.`);
  }

  // --- Positional ideas ---
  const backRank = me === 'w' ? '1' : '8';
  if (m.flags.includes('k') || m.flags.includes('q')) add(`<b>Castling</b> tucks ${your} king into safety and brings a rook toward the center.`, 'castle');
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank && fullmove <= 15) {
    // Does it clear the last piece standing between king and rook?
    const rights = fen.split(' ')[2];
    const between = [[me === 'w' ? 'K' : 'k', ['f', 'g']], [me === 'w' ? 'Q' : 'q', ['b', 'c', 'd']]]
      .filter(([flag]) => rights.includes(flag)).map(([, files]) => files.map(f => f + backRank));
    const clears = between.some(sqs => sqs.includes(m.from) && sqs.every(sq => !c.get(sq)));
    add(`It <b>develops</b> ${your} ${NAMES[m.piece]}${clears ? ' and clears the way to castle' : ', bringing another piece into the game'}.`, 'develop');
  }
  if (m.piece === 'p' && !m.captured && ['d4', 'e4', 'd5', 'e5'].includes(m.to) && fullmove <= 15) add('It grabs space in the <b>center</b>.', 'develop');
  if (fullmove <= 15) {
    const opened = unblocked(b, m, me).map(t => NAMES[t]);
    if (opened.length) add(`It opens a line for ${your} ${opened.join(' and ')}.`, 'develop');
  }
  // A quiet move that backs up the pawn push the engine wants next.
  if (pv.length >= 3) {
    const t = new Chess(c.fen());
    let next = null;
    try { t.move(uciToMove(pv[1])); next = t.move(uciToMove(pv[2])); } catch { }
    if (next && next.piece === 'p' && !next.captured && next.from !== m.to && CENTER_PUSHES.includes(next.to)
      && c.attackers(next.to, me).includes(m.to) && !b.attackers(next.to, me).includes(m.from)) {
      add(`It prepares the pawn push <b>${esc(next.san)}</b>, which ${your} ${NAMES[moved]} now backs up.`, 'plan');
    }
  }
  if (m.piece === 'r') {
    const file = m.to[0];
    const pawnOnFile = c.board().some(row => row.some(p => p && p.type === 'p' && p.square[0] === file));
    if (!pawnOnFile && m.from[0] !== file) add(`It puts ${your} rook on an <b>open file</b>.`);
    else if (m.to[1] === (me === 'w' ? '7' : '2') && m.from[1] !== m.to[1]) add('A rook on the 7th rank attacks pawns and hems in the king.');
  }
  if (m.piece === 'p' && !m.captured && !m.promotion) {
    const f = m.to.charCodeAt(0), r = +m.to[1], dir = me === 'w' ? 1 : -1;
    const blocked = pieces(c, opp).some(p => p.type === 'p' && Math.abs(p.square.charCodeAt(0) - f) <= 1 && (+p.square[1] - r) * dir > 0);
    if (!blocked && (me === 'w' ? r >= 5 : r <= 4)) add('It pushes a <b>passed pawn</b>: no pawn can stop it, so it heads toward promotion.');
  }
  if (m.piece === 'k' && !wasCheck && !m.captured) {
    const big = [...pieces(c, 'w'), ...pieces(c, 'b')].filter(p => 'qrbn'.includes(p.type));
    const fromCenter = sq => Math.max(Math.abs(FILES.indexOf(sq[0]) - 3.5), Math.abs(+sq[1] - 4.5));
    if (big.length <= 4 && !big.some(p => p.type === 'q') && fromCenter(m.to) < fromCenter(m.from)) {
      add(`In the endgame the king is a strong piece: it brings ${your} king closer to the center.`);
    }
  }
  if (!reasons.length && 'nbrq'.includes(moved) && safeHere && c.attackers(m.to, me).length) {
    const rival = pieces(c, opp).find(p => p.type !== 'p' && p.type !== 'k' && val(p.type) === val(moved)
      && c.attackers(p.square, me).includes(m.to) && !b.attackers(p.square, me).includes(m.from));
    if (rival) add(`It challenges ${their} ${NAMES[rival.type]} on ${rival.square} and offers a trade.`);
  }
  const central = ['c3', 'd4', 'e4', 'f3', 'c6', 'd5', 'e5', 'f6'];
  if (!reasons.length && m.piece === 'n' && central.includes(m.to) && !central.includes(m.from)) add('It brings the knight toward the center, where it reaches the most squares.');

  // --- Better squares for pieces and king ---
  if ((m.piece === 'n' || m.piece === 'b') && !m.captured && isOutpost(c, m.to, me)) {
    add(`It puts ${your} ${NAMES[m.piece]} on an <b>outpost</b> on ${m.to}: a pawn guards it, and no pawn of ${their}s can chase it away.`, 'outpost');
  }
  const longDiag = me === 'w' ? { b2: 'c1', g2: 'f1' } : { b7: 'c8', g7: 'f8' };
  if (m.piece === 'b' && longDiag[m.to] === m.from) add(`It puts ${your} bishop on the <b>long diagonal</b>, aiming through the center.`, 'develop');
  if ('rq'.includes(m.piece) && !m.captured) {
    // Two heavy pieces on one file, nothing between them.
    const dir = +m.to[1] < 5 ? 1 : -1;
    for (const d of [dir, -dir]) {
      let sq = step(m.to, [0, d]);
      while (sq && !c.get(sq)) sq = step(sq, [0, d]);
      const p = sq && c.get(sq);
      if (p && p.color === me && 'rq'.includes(p.type) && sq !== m.from && m.from[0] !== m.to[0]) {
        add(p.type === 'r' && m.piece === 'r' ? `It <b>doubles</b> ${your} rooks on the ${m.to[0]}-file, so they back each other up.`
          : `It lines up ${your} queen and rook on the ${m.to[0]}-file.`, 'plan');
        break;
      }
    }
  }
  // Luft: a pawn step in front of the castled king gives it a square off the back rank.
  const king = pieces(c, me).find(p => p.type === 'k');
  if (m.piece === 'p' && !m.captured && king && king.square[1] === backRank && fullmove >= 10
    && Math.abs(FILES.indexOf(m.from[0]) - FILES.indexOf(king.square[0])) <= 1 && m.from[1] === (me === 'w' ? '2' : '7')
    && 'abcfgh'.includes(king.square[0])) {
    add(`It gives ${your} king an escape square (<b>luft</b>), so a check on the back rank cannot be mate.`, 'safety');
  }
  if ('nbrq'.includes(m.piece) && !m.captured && reasons.length < 2) {
    const was = reach(b, m.from, me), now = reach(c, m.to, me);
    if (now - was >= 4 && now >= 7) add(`It makes ${your} ${NAMES[m.piece]} much more active: it reaches ${now} squares instead of ${was}.`, 'activity');
  }
  // Trading down when ahead in material.
  if (m.captured && (tags.has('trade') || tags.has('recapture'))) {
    const ahead = balance(census(c), me);
    if (ahead >= 2) add(`Trading pieces when ${you}'re ahead in material brings ${you} closer to a won endgame.`);
  }

  // --- Fallback ---
  const cp = sign * scoreToCp(score);
  const generic = !reasons.length;
  if (generic) {
    // Even a quiet move has a purpose: the move the engine wants to play next.
    let next = null;
    if (pv.length >= 3) { const t = new Chess(c.fen()); try { t.move(uciToMove(pv[1])); next = t.move(uciToMove(pv[2])); } catch { } }
    const plan = next ? ` The plan is <b>${esc(next.san)}</b> next.` : '';
    if (cp > 150) add(`A calm move that keeps ${your} advantage.${plan}`);
    else if (cp < -150) add(`The toughest defense in a difficult position: other moves lose faster.${plan}`);
    else if (next && next.from !== m.to) add(`A quiet move that gets ready for <b>${esc(next.san)}</b>.`);
    else if (next) add(`A quiet move. The plan is <b>${esc(next.san)}</b> next.`);
    else add(`A quiet move that improves ${your} position. There is no tactic to find here.`);
  }

  const tactical = ['mate', 'promo', 'free', 'wins', 'fork', 'skewer', 'pin', 'discovered', 'tactic', 'threat', 'sacrifice'].some(t => tags.has(t));
  // No line when a reason already spells it out.
  return done({ line: pv.length > 1 && !toldLine ? movesInWords(fen, pv, 4, who) : '', eval: evalWords(score, who), tactical, generic, mateIn, danger });
}

/** The first nudge of a hint: what kind of move to look for, without giving the move away. */
export function hintIdea(fen, uci, analysis = {}, prev = null) {
  const ex = explainMove(fen, uci, analysis, prev);
  const t = new Set(ex.tags);
  if (t.has('checkmate')) return 'You can give <b>checkmate</b> right now. Look at every check!';
  if (t.has('mate')) return `There is a forced <b>checkmate in ${ex.mateIn}</b>. Look at your checks first.`;
  if (t.has('threat')) return 'Careful: your opponent <b>threatens checkmate</b>. Find the move that stops it.';
  if (t.has('fork')) return 'A <b>double attack</b> is possible: one move that hits two things at once.';
  if (t.has('skewer') || t.has('pin')) return 'Two of their pieces stand on the same line. Can you <b>line up</b> against them?';
  if (t.has('discovered')) return 'One of your pieces is hiding an attack. Moving it out of the way <b>uncovers</b> something.';
  if (t.has('promo')) return 'One of your pawns can <b>promote</b>.';
  if (t.has('free')) return 'One of their pieces is <b>not defended</b>. Can you take it?';
  if (t.has('wins') || t.has('tactic')) return 'You can <b>win material</b> here. Look at every check and every capture.';
  if (t.has('sacrifice')) return 'The best move <b>gives something up</b> to get more in return. What could you offer?';
  if (t.has('check')) return 'You are in <b>check</b>. Find the safest way out.';
  if (t.has('danger') && ex.danger) return `Your <b>${NAMES[ex.danger.type]}</b> on ${ex.danger.square} is under attack. Deal with that first.`;
  if (t.has('recapture')) return 'They just captured something. Can you <b>take back</b>?';
  if (t.has('trade')) return 'There is a fair <b>trade</b> on offer. Count what you give and what you get.';
  if (t.has('castle')) return 'Nothing to win right now. How <b>safe</b> is your king?';
  if (t.has('develop')) return 'No tactics yet. Think <b>development</b>: bring out a new piece and fight for the center.';
  if (t.has('attack')) return 'You can <b>attack</b> one of their pieces and make it move.';
  return 'There is no tactic to find. Look for your least active piece and <b>improve</b> it.';
}

/** How the engine's second choice compares with its first, for the end of a hint. */
export function runnerUp(fen, analysis) {
  const c = new Chess(fen);
  if (c.moves().length === 1) return 'It is the only legal move.';
  const [top, second] = analysis.lines || [];
  const m2 = second && tryMove(fen, second.move);
  if (!top || !m2) return '';
  const sign = c.turn() === 'w' ? 1 : -1;
  const pct = l => winPct(sign * scoreToCp(l.score));
  const mates = l => l.score.mate != null && Math.sign(l.score.mate) === sign;
  const san = `<b>${esc(m2.san)}</b>`;
  if (mates(top) && !mates(second)) return pct(second) > 90 ? `${san} also wins, but more slowly.` : 'It is the only move that wins.';
  const gap = pct(top) - pct(second);
  if (gap >= 14) return 'It is the only good move here.';
  if (gap < 2) return `${san} is just as good.`;
  if (gap < 7) return `${san} is nearly as good.`;
  return '';
}

export const reasonList = reasons => (reasons.length ? `<ul class="why">${reasons.map(r => `<li>${r}</li>`).join('')}</ul>` : '');
export const footnote = (line, ev) => (line || ev ? `<div class="small muted">${line ? `Likely next: ${line}` : ''}${line && ev ? ' · ' : ''}${ev ? `${line ? 'Then' : 'Overall'} ${ev}` : ''}</div>` : '');

/** The end of the game in words, or '' while it goes on. `c` has just had move `m` played. */
function endInWords(c, m, me) {
  if (c.isCheckmate()) return `<b>${esc(m.san)}</b> is checkmate, so ${m.color === me ? 'you win' : 'you would lose'}.`;
  if (c.isStalemate()) return `<b>${esc(m.san)}</b> is stalemate, so the game is a draw.`;
  if (c.isDraw()) return `<b>${esc(m.san)}</b> ends the game in a draw.`;
  return '';
}

/**
 * What a move tried out on the analysis board leads to.
 * `before` and `after` are engine results for the positions either side of the move; neither is
 * needed when the move ends the game. `me` is the player's colour, whichever side moved.
 * -> { html, arrows: [{from, to, color}] }
 */
export function whatIfMove(fen, uci, before, after, me) {
  const c = new Chess(fen);
  const m = c.move(uciToMove(uci));
  const end = endInWords(c, m, me);
  if (end) return { html: end, arrows: [] };

  const fenAfter = c.fen();
  const mine = m.color === me;
  const sign = m.color === 'w' ? 1 : -1;
  const pct = s => winPct(sign * scoreToCp(s));
  const ranked = before.lines?.find(l => l.move === uci);
  let drop = pct(before.score) - pct(after.score);
  if (ranked) drop = Math.min(drop, pct(before.lines[0].score) - pct(ranked.score));
  const cls = classify(drop, before.bestmove === uci);
  const best = tryMove(fen, before.bestmove);
  const san = `<b>${esc(m.san)}</b>`;
  const bestSan = best ? `<b>${esc(best.san)}</b>` : 'another move';
  const reply = after.bestmove && tryMove(fenAfter, after.bestmove);
  const pv = after.lines?.[0]?.pv || [];
  const arrows = reply ? [{ from: reply.from, to: reply.to, color: mine ? 'red' : 'green' }] : [];

  if (mine) {
    let text = `<span class="tag ${cls}">${CLASS_LABEL[cls]}</span> `;
    if (cls === 'best') text += `${san} is as good as anything here.`;
    else if (cls === 'good') text += `${san} is fine, but ${bestSan} is slightly better.`;
    else {
      text += `${san} is weaker than ${bestSan}. ` + (mistakeReason(fen, uci, {
        bestUci: before.bestmove, replyUci: after.bestmove, pvBest: before.lines?.[0]?.pv, pvAfter: pv,
        mateAgainst: after.score.mate != null && Math.sign(after.score.mate) === -sign,
        hadMate: before.score.mate != null && Math.sign(before.score.mate) === sign,
      }) || shiftWords(sign * scoreToCp(before.score), sign * scoreToCp(after.score)));
    }
    if (reply) text += ` Their best reply is <b>${esc(reply.san)}</b>.`;
    return { html: text + footnote(pv.length > 1 ? movesInWords(fenAfter, pv, 4, me) : '', evalWords(after.score, me)), arrows };
  }

  const verdict = cls === 'best' ? `${san} is their best move here.`
    : cls === 'good' ? `${san} is a reasonable try for them.`
      : `${san} would be a mistake by them: ${bestSan} is stronger.`;
  if (!reply) return { html: verdict, arrows };
  const ex = explainMove(fenAfter, after.bestmove, after, m);
  return { html: `${verdict} Your best answer is <b>${esc(ex.san)}</b>.${reasonList(ex.reasons)}${footnote(ex.line, ex.eval)}`, arrows };
}

/**
 * The engine's top moves side by side: what each one does and how far it falls short of the first.
 * `analysis` needs several lines (multipv). `prev` is the move that led to `fen`.
 * -> { html, arrows: [{from, to, color}] }
 */
export function compareMoves(fen, analysis, me, prev = null) {
  const c = new Chess(fen);
  const mine = c.turn() === me;
  const sign = c.turn() === 'w' ? 1 : -1;
  const lines = (analysis.lines || []).map(l => ({ ...l, m: tryMove(fen, l.move) })).filter(l => l.m).slice(0, 3);
  if (!lines.length) return { html: 'No moves to compare here.', arrows: [] };

  const pct = l => winPct(sign * scoreToCp(l.score));
  const mates = l => (l.score.mate != null && Math.sign(l.score.mate) === sign ? Math.abs(l.score.mate) : 0);
  const top = lines[0];
  // A slower or missed mate is a step down even when the winning chances look the same.
  const gapOf = l => Math.max(pct(top) - pct(l), mates(top) && !mates(l) ? 2 : 0);
  const b = s => `<b>${esc(s)}</b>`;
  const topSan = b(top.m.san);
  const gap = lines[1] ? gapOf(lines[1]) : 0;
  const whose = mine ? '' : ' for them';
  const level = lines.filter(l => gapOf(l) < 2);
  const summary = c.moves().length === 1 ? `${topSan} is the only legal move.`
    : mates(top) && lines[1] && !mates(lines[1]) ? `${topSan} forces checkmate${whose}. Nothing else does.`
      : gap >= 14 ? `${topSan} is the only good move${whose}: everything else is clearly worse.`
        : gap >= 7 ? `${topSan} clearly stands out${whose}.`
          : gap >= 2 ? `${topSan} is a little better than the alternatives${whose}.`
            : level.length > 2 ? `These moves are all about equally good${whose}, so pick the plan you like best.`
              : `${topSan} and ${b(lines[1].m.san)} are about equally good${whose}.`;

  const rows = lines.map((l, i) => {
    const cls = classify(gapOf(l), i === 0);
    const label = i === 0 ? 'Best' : cls === 'best' ? 'As good' : CLASS_LABEL[cls];
    let note = '';
    if (i > 0 && ((cls !== 'best' && cls !== 'good') || (mates(top) && !mates(l)))) {
      note = mistakeReason(fen, l.move, {
        bestUci: top.move, replyUci: l.pv[1], pvBest: top.pv, pvAfter: l.pv.slice(1), now: true, player: me,
        mateAgainst: l.score.mate != null && Math.sign(l.score.mate) === -sign,
        hadMate: !!mates(top) && !mates(l),
      });
    }
    if (!note) {
      let ex = null;
      try { ex = explainMove(fen, l.move, { score: l.score, lines: [l] }, prev, me); } catch { }
      // "A quiet move" would be an odd thing to say about a mistake: say what it costs instead.
      const weak = i > 0 && cls !== 'best' && cls !== 'good';
      if (ex && !(weak && ex.generic)) note = ex.reasons[0] || '';
      else if (mine) note = shiftWords(sign * scoreToCp(top.score), sign * scoreToCp(l.score)).replace('It takes you', 'It would take you');
    }
    const next = l.pv.length > 1 ? movesInWords(l.m.after, l.pv.slice(1), 3, me) : '';
    return `<li><b>${esc(l.m.san)}</b> <span class="tag ${cls}">${label}</span> <span class="small muted">${evalWords(l.score, me)}</span>
      ${note ? `<div>${note}</div>` : ''}${next ? `<div class="small muted">Then ${next}</div>` : ''}</li>`;
  });
  const colors = ['green', 'blue', 'grey'];
  return { html: `${summary}<ol class="compare">${rows.join('')}</ol>`, arrows: lines.map((l, i) => ({ from: l.m.from, to: l.m.to, color: colors[i] })) };
}
