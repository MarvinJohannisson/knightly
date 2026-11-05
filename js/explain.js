// Plain-language reasons why an engine move is strong, built from simple board
// heuristics (captures, forks, threats, safety, development) plus the engine's main line.
import { Chess } from '../vendor/chess.js';
import { esc, PIECE_VALUE, uciToMove, scoreToCp, fmtScore } from './util.js';

const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const val = t => (t === 'k' ? 100 : PIECE_VALUE[t]);
const other = c => (c === 'w' ? 'b' : 'w');

function pieces(chess, color) {
  const out = [];
  for (const row of chess.board()) for (const p of row) if (p && p.color === color) out.push(p);
  return out;
}

function material(chess, color) {
  let n = 0;
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') n += (p.color === color ? 1 : -1) * PIECE_VALUE[p.type];
  return n;
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

/** SAN for a list of UCI moves, with move numbers. */
/** A list of UCI moves as plain words (HTML): "you play Rb1, they reply Kg8, then you play dxc6". */
export function movesInWords(fen, pv, max = 4) {
  const c = new Chess(fen);
  const out = [];
  for (const uci of pv.slice(0, max)) {
    let m;
    try { m = c.move(uciToMove(uci)); } catch { break; }
    const i = out.length;
    out.push(`${i === 2 ? 'then ' : ''}${i % 2 ? 'they reply' : 'you play'} <b>${esc(m.san)}</b>`);
  }
  return out.join(', ');
}

/** Material the mover gains over the engine line (measured after the opponent's replies). */
function lineGain(fen, pv, me) {
  const c = new Chess(fen);
  const base = material(c, me);
  let gain = 0, plies = 0;
  for (let i = 0; i < Math.min(pv.length, 6); i++) {
    try { c.move(uciToMove(pv[i])); } catch { break; }
    if (i % 2 === 1) {
      const g = material(c, me) - base;
      if (g !== gain) plies = i + 1; // shortest line that shows the final gain
      gain = g;
    }
  }
  return { gain, plies };
}

function gainText(g) {
  if (g === 1) return 'a pawn';
  if (g === 2) return 'two pawns';
  if (g === 3) return 'a piece';
  return `material (+${g})`;
}

/**
 * Why a played move went wrong: one plain sentence (HTML), or '' when no simple reason shows.
 * `replyUci` is the opponent's best answer; `mateAgainst` and `hadMate` come from the engine scores.
 */
export function mistakeReason(fen, uci, { bestUci, replyUci, mateAgainst, hadMate } = {}) {
  const play = (f, u) => { try { return new Chess(f).move(uciToMove(u)); } catch { return null; } };
  const played = play(fen, uci);
  const best = play(fen, bestUci);
  const reply = played && play(played.after, replyUci);
  if (mateAgainst) return `It allows a forced checkmate${reply ? `, starting with <b>${esc(reply.san)}</b>` : ''}.`;
  if (hadMate && best) return `You had a forced checkmate starting with <b>${esc(best.san)}</b>!`;
  if (reply && reply.captured && PIECE_VALUE[reply.captured] >= 3) return `Your ${NAMES[reply.captured]} on ${reply.to} can now be taken with <b>${esc(reply.san)}</b>.`;
  if (best && best.captured && PIECE_VALUE[best.captured] >= 3) return `You could have captured the ${NAMES[best.captured]} on ${best.to}.`;
  if (reply && reply.san.includes('+')) return `It allows <b>${esc(reply.san)}</b> with a strong check.`;
  return '';
}

/**
 * explainMove(fen, uci, analysis) -> { san, reasons: string[] (HTML), line, eval }
 * `analysis` is the engine result for `fen` ({ score, lines: [{ pv }] }); scores are White's POV.
 */
export function explainMove(fen, uci, analysis = {}) {
  const c = new Chess(fen);
  const me = c.turn(), opp = other(me);
  const sign = me === 'w' ? 1 : -1;
  const fullmove = +fen.split(' ')[5] || 1;
  const wasCheck = c.inCheck();
  const matBefore = material(c, me);

  const dangerBefore = pieces(c, me).map(p => p.square).filter(sq => inDanger(c, sq));
  const threatBefore = mateThreat(c);
  const pv = analysis.lines?.[0]?.pv?.[0] === uci ? analysis.lines[0].pv : [uci];
  const score = analysis.score;
  const m = c.move(uciToMove(uci));
  const moved = m.promotion || m.piece;
  const reasons = [];
  const add = r => { if (r && !reasons.includes(r)) reasons.push(r); };

  // --- Decisive stuff first ---
  if (c.isCheckmate()) return { san: m.san, reasons: ['It\'s <b>checkmate</b>, the game is over!'], line: '', eval: '' };
  if (score?.mate != null && Math.sign(score.mate) === sign) {
    const n = Math.abs(score.mate);
    add(`It starts a <b>forced checkmate</b> in ${n} move${n > 1 ? 's' : ''}, whatever they reply.`);
  }
  if (m.promotion) add(`It <b>promotes</b> your pawn to a ${NAMES[m.promotion]}.`);

  // --- Captures ---
  let explainedGain = 0;
  if (m.captured) {
    const cv = PIECE_VALUE[m.captured], mv = PIECE_VALUE[m.piece];
    const defended = c.attackers(m.to, opp).length > 0;
    if (!defended) { add(`It wins the ${NAMES[m.captured]} on ${m.to} <b>for free</b>: nothing can take back.`); explainedGain = cv; }
    else if (cv > mv) { add(`It wins material: your ${NAMES[m.piece]} takes a more valuable ${NAMES[m.captured]}.`); explainedGain = cv - mv; }
    else if (matBefore < 0) add(`It <b>takes back</b> the ${NAMES[m.captured]}, winning back the material.`);
    else if (cv === mv) add(`It trades off the ${NAMES[m.captured]} on ${m.to}.`);
  }

  // --- Escaping check ---
  if (wasCheck) {
    if (m.piece === 'k') add('It gets your king out of check to a safe square.');
    else if (m.captured) add('It deals with the check by capturing the attacker.');
    else add('It blocks the check.');
  }

  // --- Forks and threats made by the moved piece ---
  const targets = pieces(c, opp).filter(p => {
    if (!c.attackers(p.square, me).includes(m.to)) return false;
    if (p.type === 'k') return true;
    const undefended = !c.attackers(p.square, opp).length;
    return p.type !== 'p' && (undefended || val(p.type) > val(moved));
  });
  const safeHere = !inDanger(c, m.to) || m.piece === 'k';
  if (targets.length >= 2 && safeHere) {
    const list = targets.map(p => (p.type === 'k' ? 'the king' : `the ${NAMES[p.type]} on ${p.square}`));
    add(`It's a <b>fork</b>: your ${NAMES[moved]} attacks ${list.slice(0, -1).join(', ')} and ${list.at(-1)} at once.`);
  } else if (targets.length === 1 && targets[0].type !== 'k' && safeHere) {
    add(`It <b>attacks</b> the ${NAMES[targets[0].type]} on ${targets[0].square}.`);
  }
  if (m.san.includes('+') && !reasons.some(r => r.includes('fork'))) add('It gives <b>check</b>, so they have to deal with that first.');

  // --- Stopping their threats ---
  if (threatBefore && !c.isCheck()) {
    const c2 = new Chess(c.fen());
    let still = false;
    try { c2.move(threatBefore); still = c2.isCheckmate(); } catch { }
    if (!still) add(`It <b>stops the threat</b> of ${esc(threatBefore)}, which would be checkmate.`);
  }

  // --- Safety of your own pieces ---
  if (dangerBefore.includes(m.from) && !inDanger(c, m.to)) add(`It moves your ${NAMES[m.piece]} <b>out of danger</b>.`);
  const saved = dangerBefore.filter(sq => sq !== m.from && c.get(sq)?.color === me && !inDanger(c, sq));
  if (saved.length) add(`It protects your ${NAMES[c.get(saved[0]).type]} on ${saved[0]}, which was under attack.`);

  // --- Follow-up in the engine line ---
  const { gain, plies } = lineGain(fen, pv, me);
  const hasTactic = reasons.some(r => r.includes('fork') || r.includes('checkmate'));
  const showsLine = !hasTactic && gain > explainedGain && gain >= 1 && pv.length >= 2;
  if (showsLine) {
    add(`It sets up a tactic: ${movesInWords(fen, pv, plies)}, and you've won ${gainText(gain)}.`);
  }

  // --- Positional ideas ---
  if (m.flags.includes('k') || m.flags.includes('q')) add('<b>Castling</b> tucks your king into safety and brings a rook toward the center.');
  const backRank = me === 'w' ? '1' : '8';
  if ((m.piece === 'n' || m.piece === 'b') && m.from[1] === backRank && fullmove <= 15) add(`It <b>develops</b> your ${NAMES[m.piece]}, bringing another piece into the game.`);
  if (m.piece === 'p' && !m.captured && ['d4', 'e4', 'd5', 'e5'].includes(m.to) && fullmove <= 15) add('It grabs space in the <b>center</b>.');
  if (m.piece === 'n' && ['c3', 'd4', 'e4', 'f3', 'c6', 'd5', 'e5', 'f6'].includes(m.to) && !reasons.some(r => r.includes('develops'))) add('Knights are strongest near the center.');
  if (m.piece === 'r') {
    const file = m.to[0];
    const pawnOnFile = c.board().some(row => row.some(p => p && p.type === 'p' && p.square[0] === file));
    if (!pawnOnFile) add('It puts your rook on an <b>open file</b>.');
    else if (m.to[1] === (me === 'w' ? '7' : '2')) add('A rook on the 7th rank attacks pawns and hems in the king.');
  }
  if (m.piece === 'p' && !m.captured) {
    const f = m.to.charCodeAt(0), r = +m.to[1], dir = me === 'w' ? 1 : -1;
    const blocked = pieces(c, opp).some(p => p.type === 'p' && Math.abs(p.square.charCodeAt(0) - f) <= 1 && (+p.square[1] - r) * dir > 0);
    if (!blocked && (me === 'w' ? r >= 5 : r <= 4)) add('It pushes a <b>passed pawn</b>: nothing can stop it with a pawn, so it heads toward promotion.');
  }

  // --- Fallback ---
  const cp = sign * scoreToCp(score);
  if (!reasons.length) {
    if (cp > 150) add('A calm move that keeps your advantage and leaves your opponent without counterplay.');
    else if (cp < -150) add('It\'s the toughest defense in a difficult position: other moves lose faster.');
    else add('A quiet improving move: no tactics yet, but it makes your position a bit better and keeps things balanced.');
  }

  let evalText = '';
  if (score) {
    if (score.mate != null) evalText = Math.sign(score.mate) === sign ? `you mate in ${Math.abs(score.mate)}` : `they mate in ${Math.abs(score.mate)}`;
    else {
      const s = fmtScore({ cp }); // from your point of view
      evalText = cp > 300 ? `you're clearly better (${s})` : cp > 100 ? `you're better (${s})` : cp > 40 ? `you're slightly better (${s})`
        : cp < -300 ? `you're clearly worse (${s})` : cp < -100 ? `you're worse (${s})` : cp < -40 ? `you're slightly worse (${s})` : `about equal (${s})`;
    }
  }
  return { san: m.san, reasons: reasons.slice(0, 3), line: pv.length > 1 && !showsLine ? movesInWords(fen, pv, 4) : '', eval: evalText }; // no line when the tactic reason already spells it out
}
