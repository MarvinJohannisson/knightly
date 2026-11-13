// Bot personalities. All bots open from a book of named openings, as far as their level "knows"
// them. After that, weak bots sample from Stockfish's candidate moves, leaning toward moves that
// look natural to a person; strong bots use Stockfish's built-in Skill Level. Ratings are rough
// estimates: the top five are spaced by bot-vs-bot matches (tests/calibrate.html), none are
// measured against people.
import { Chess } from '../vendor/chess.js';
import { engine } from './engine.js';
import { loadOpenings, bookMoves } from './openings.js';
import { scoreToCp, PIECE_VALUE } from './util.js';

// cfg.book: how many plies of opening theory the bot follows.
// cfg.random: how often a weak bot plays a natural-looking move without checking it; cfg.temp: how
// far from the engine's best it strays otherwise. Both were set by matches against the bots as
// they were before the book and the natural-looking moves, so each kept its strength.
export const BOTS = [
  { id: 'pip', name: 'Pip', avatar: '🐣', rating: 400, style: 'Beginner',
    desc: 'Just learned how the pieces move. Often leaves pieces hanging, so look for free captures!',
    cfg: { depth: 1, multipv: 40, temp: 400, random: 0.7, book: 2 } },
  { id: 'rosa', name: 'Rosa', avatar: '🌷', rating: 600, style: 'Beginner',
    desc: 'Plays for fun and makes plenty of careless moves. Look for what she leaves undefended.',
    cfg: { depth: 2, multipv: 30, temp: 250, random: 0.32, book: 4 } },
  { id: 'theo', name: 'Theo', avatar: '🦉', rating: 800, style: 'Novice',
    desc: 'Knows the basic rules and spots simple threats, but misses tactics.',
    cfg: { depth: 3, multipv: 20, temp: 150, random: 0.19, book: 6 } },
  { id: 'mila', name: 'Mila', avatar: '🦊', rating: 1000, style: 'Novice',
    desc: 'Sees simple tactics now and then. Watch out for forks.',
    cfg: { depth: 4, multipv: 12, temp: 90, random: 0.11, book: 8 } },
  { id: 'viktor', name: 'Viktor', avatar: '🐻', rating: 1200, style: 'Intermediate',
    desc: 'A solid club newcomer. Rarely gives away pieces for free.',
    cfg: { depth: 6, multipv: 8, temp: 60, random: 0.03, book: 10 } },
  { id: 'ingrid', name: 'Ingrid', avatar: '🦢', rating: 1400, style: 'Intermediate',
    desc: 'Steady and careful. Punishes loose pieces.',
    cfg: { depth: 8, multipv: 6, temp: 40, random: 0, book: 12 } },
  { id: 'kasper', name: 'Kasper', avatar: '🐺', rating: 1850, style: 'Advanced',
    desc: 'Sharp at tactics. You will need to calculate.',
    cfg: { skill: 12, depth: 13, book: 14 } },
  { id: 'selma', name: 'Selma', avatar: '🦅', rating: 2000, style: 'Expert',
    desc: 'Strong club player. Good luck in the endgame.',
    cfg: { skill: 13, movetime: 700, book: 16 } },
  { id: 'orion', name: 'Orion', avatar: '🐉', rating: 2200, style: 'Master',
    desc: 'Master strength. Every mistake gets punished.',
    cfg: { skill: 18, movetime: 1000, book: 20 } },
  { id: 'titan', name: 'Titan', avatar: '🤖', rating: 2600, style: 'Engine',
    desc: 'Full-strength Stockfish (as strong as your phone allows). For the brave.',
    cfg: { skill: 20, movetime: 1500, book: 30 } },
];

export const botById = id => BOTS.find(b => b.id === id) || BOTS[2];

function sample(items, weight) {
  const w = items.map(weight);
  let x = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < items.length; i++) { x -= w[i]; if (x <= 0) return items[i]; }
  return items[0];
}

// ---------- opening book ----------
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/**
 * A move from a named opening, null once the bot is past what it knows or the game has left
 * the book, or undefined if the engine was stopped. Well-travelled lines are chosen more often,
 * so the bots open the way people do, and differently from game to game.
 */
async function bookMove(bot, chess, eng) {
  const played = chess.history();
  if (played.length >= (bot.cfg.book || 0)) return null;
  // The book goes by the moves played, so it only applies to a game from the normal start.
  const first = chess.history({ verbose: true })[0];
  if ((first ? first.before : chess.fen()) !== START) return null;
  await loadOpenings();
  const all = bookMoves(played);
  const total = all.reduce((s, m) => s + m.weight, 0);
  // Rare sidelines are left out, and early on so is anything with only a line or two to its
  // name (1.h3 h5 has one). Among the rest the main lines are favoured.
  const usual = all.filter(m => m.weight >= total * 0.05 && (played.length >= 6 || m.weight >= 3));
  if (!usual.length) return null;
  let move;
  try { move = new Chess(chess.fen()).move(sample(usual, m => Math.pow(m.weight, 1.5)).san); } catch { return null; }
  // Named does not mean sound. Past the first moves, the engine vetoes a line that loses ground.
  if (played.length >= 4) {
    const r = await eng.analyse(chess.fen(), { depth: 8, multipv: 5 });
    if (r.cancelled) return undefined;
    const sign = chess.turn() === 'w' ? 1 : -1;
    const line = r.lines.find(l => l.move === move.lan);
    if (!line || sign * (scoreToCp(r.lines[0].score) - scoreToCp(line.score)) > 70) return null;
  }
  return move.lan;
}

// ---------- natural-looking moves ----------
const FILES = 'abcdefgh';
const CENTER = ['d4', 'e4', 'd5', 'e5'];
const val = t => (t === 'k' ? 100 : PIECE_VALUE[t]);
const fromMiddle = sq => Math.max(Math.abs(FILES.indexOf(sq[0]) - 3.5), Math.abs(sq[1] - 4.5));

/** Can the piece on `sq` be taken by something cheaper, or taken for free? */
function loose(chess, sq, color) {
  const p = chess.get(sq);
  const att = chess.attackers(sq, color === 'w' ? 'b' : 'w');
  if (!p || !att.length) return false;
  return !chess.attackers(sq, color).length || Math.min(...att.map(s => val(chess.get(s).type))) < val(p.type);
}

/**
 * How much a move looks like one a person would play, whatever its real merit: captures, checks,
 * castling and developing moves attract; king walks, rook shuffles and wing pawn pushes in the
 * opening do not. Weak players choose among what looks natural and overlook the rest, which is
 * what makes their mistakes look human rather than random. It deliberately knows nothing about
 * safety: whether a natural-looking move hangs a piece is for the engine search to notice, at the
 * depth the bot has.
 * -> a score in log units (0 is neutral)
 */
function natural(m, ctx) {
  const me = m.color, home = me === 'w' ? '1' : '8';
  const opening = ctx.fullmove <= 10;
  const threatened = ctx.loose.has(m.from); // a piece under attack wants to move
  if (m.flags.includes('k') || m.flags.includes('q')) return 1.6;
  let n = 0;
  if (m.promotion) n += m.promotion === 'q' ? 2 : -1;
  if (m.captured) n += 0.7 + 0.15 * PIECE_VALUE[m.captured] + (ctx.last && ctx.last.to === m.to ? 0.8 : 0);
  if (m.san.includes('+') || m.san.includes('#')) n += 0.6;

  if (m.piece === 'k' && !ctx.inCheck && ctx.queens) n -= 2.5;
  if (m.piece === 'p' && !m.captured) {
    if (CENTER.includes(m.to)) n += opening ? 1.1 : 0.3;
    else if (opening && 'ah'.includes(m.to[0])) n -= 0.9;
    else if (opening && 'bg'.includes(m.to[0])) n -= Math.abs(m.to[1] - m.from[1]) === 2 ? 0.9 : 0.3;
    else if (opening && m.to[0] === 'f') n -= 0.5;
  }
  if (m.piece === 'n' || m.piece === 'b') {
    if (opening && m.from[1] === home) n += 1;
    if (m.piece === 'n' && 'ah'.includes(m.to[0])) n -= 0.8;
    if (m.to[1] === home && m.from[1] !== home && !threatened) n -= 0.6;
  }
  if (opening && !m.captured) {
    if (m.piece === 'r') n -= 1.2;
    if (m.piece === 'q' && ctx.fullmove <= 6 && ctx.rating >= 800) n -= 0.8; // beginners do bring her out early
    if (ctx.mine && ctx.mine.to === m.from && !threatened) n -= 0.7; // the same piece again
  }
  if ('nbq'.includes(m.piece)) n += 0.15 * (fromMiddle(m.from) - fromMiddle(m.to));
  return n;
}

/**
 * Pick a move for the bot. Returns a UCI string, or null if the search was stopped.
 * `info`, if given, is filled in with how the move came about ({ book }).
 */
export async function botMove(bot, chess, eng = engine, info = {}) {
  const fen = chess.fen();
  const c = bot.cfg;
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;

  info.book = false;
  const fromBook = await bookMove(bot, chess, eng);
  if (fromBook === undefined) return null;
  if (fromBook) { info.book = true; return fromBook; }

  if (c.skill != null) {
    const r = await eng.analyse(fen, { skill: c.skill, depth: c.depth, movetime: c.movetime });
    if (r.cancelled) return null;
    return r.bestmove;
  }

  const hist = chess.history({ verbose: true });
  const me = chess.turn();
  const ctx = {
    fullmove: +fen.split(' ')[5] || 1, rating: bot.rating, inCheck: chess.inCheck(),
    last: hist.at(-1) || null, mine: hist.at(-2) || null,
    queens: /q/i.test(fen.split(' ')[0]),
    loose: new Set(legal.map(m => m.from).filter(sq => chess.get(sq).type !== 'k' && loose(chess, sq, me))),
  };
  const looks = new Map(legal.map(m => [m.lan, natural(m, ctx)]));

  // Now and then the weakest bots play what looks natural without checking it at all.
  if (Math.random() < c.random) return sample(legal, m => Math.exp(looks.get(m.lan))).lan;

  const r = await eng.analyse(fen, { depth: c.depth, multipv: Math.min(c.multipv, legal.length) });
  if (r.cancelled) return null;
  if (!r.lines.length) return r.bestmove;

  // Otherwise: the better the engine rates a move and the more natural it looks, the likelier it is.
  const sign = me === 'w' ? 1 : -1;
  const scored = r.lines.filter(l => l.move).map(l => ({ move: l.move, v: sign * scoreToCp(l.score) }));
  const best = Math.max(...scored.map(s => s.v));
  return sample(scored, s => Math.exp(Math.max(s.v - best, -3000) / c.temp + (looks.get(s.move) || 0))).move;
}

/**
 * How long the bot should appear to think, in ms: quick for book moves, recaptures and forced
 * moves, longer when there is more to look at, and now and then a proper think.
 * `chess` is the position before the move.
 */
export function thinkTime(chess, uci, info = {}) {
  const legal = chess.moves({ verbose: true });
  const m = legal.find(x => x.lan === uci);
  const last = chess.history({ verbose: true }).at(-1);
  const between = (a, b) => a + Math.random() * (b - a);
  if (info.book) return between(400, 900);
  if (legal.length === 1 || (m && m.captured && last && last.captured && last.to === m.to)) return between(350, 700);
  const busy = legal.filter(x => x.captured || x.san.includes('+')).length;
  return between(600, 1300) + Math.min(busy, 6) * 70 + (Math.random() < 0.1 ? between(600, 1200) : 0);
}
