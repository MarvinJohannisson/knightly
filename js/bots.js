// Bot personalities. Weak bots sample from Stockfish's candidate moves with "noise";
// strong bots use Stockfish's built-in Skill Level. Ratings are rough estimates: the top five
// are spaced by bot-vs-bot matches (tests/calibrate.html), none are measured against people.
import { engine } from './engine.js';
import { scoreToCp } from './util.js';

export const BOTS = [
  { id: 'pip', name: 'Pip', avatar: '🐣', rating: 400, style: 'Beginner',
    desc: 'Just learned how the pieces move. Often leaves pieces hanging, so look for free captures!',
    cfg: { depth: 1, multipv: 40, temp: 400, random: 0.35 } },
  { id: 'rosa', name: 'Rosa', avatar: '🌷', rating: 600, style: 'Beginner',
    desc: 'Plays for fun and makes plenty of careless moves. Look for what she leaves undefended.',
    cfg: { depth: 2, multipv: 30, temp: 250, random: 0.18 } },
  { id: 'theo', name: 'Theo', avatar: '🦉', rating: 800, style: 'Novice',
    desc: 'Knows the basic rules and spots simple threats, but misses tactics.',
    cfg: { depth: 3, multipv: 20, temp: 150, random: 0.09 } },
  { id: 'mila', name: 'Mila', avatar: '🦊', rating: 1000, style: 'Novice',
    desc: 'Sees simple tactics now and then. Watch out for forks.',
    cfg: { depth: 4, multipv: 12, temp: 90, random: 0.04 } },
  { id: 'viktor', name: 'Viktor', avatar: '🐻', rating: 1200, style: 'Intermediate',
    desc: 'A solid club newcomer. Rarely gives away pieces for free.',
    cfg: { depth: 6, multipv: 8, temp: 55, random: 0.015 } },
  { id: 'ingrid', name: 'Ingrid', avatar: '🦢', rating: 1400, style: 'Intermediate',
    desc: 'Steady and careful. Punishes loose pieces.',
    cfg: { depth: 8, multipv: 6, temp: 32, random: 0 } },
  { id: 'kasper', name: 'Kasper', avatar: '🐺', rating: 1850, style: 'Advanced',
    desc: 'Sharp at tactics. You will need to calculate.',
    cfg: { skill: 12, depth: 13 } },
  { id: 'selma', name: 'Selma', avatar: '🦅', rating: 2000, style: 'Expert',
    desc: 'Strong club player. Good luck in the endgame.',
    cfg: { skill: 13, movetime: 700 } },
  { id: 'orion', name: 'Orion', avatar: '🐉', rating: 2200, style: 'Master',
    desc: 'Master strength. Every mistake gets punished.',
    cfg: { skill: 18, movetime: 1000 } },
  { id: 'titan', name: 'Titan', avatar: '🤖', rating: 2600, style: 'Engine',
    desc: 'Full-strength Stockfish (as strong as your phone allows). For the brave.',
    cfg: { skill: 20, movetime: 1500 } },
];

export const botById = id => BOTS.find(b => b.id === id) || BOTS[2];

/** Pick a move for the bot. Returns UCI string. */
export async function botMove(bot, chess, eng = engine) {
  const fen = chess.fen();
  const c = bot.cfg;
  const legal = chess.moves({ verbose: true });
  if (!legal.length) return null;

  if (c.skill != null) {
    const r = await eng.analyse(fen, { skill: c.skill, depth: c.depth, movetime: c.movetime });
    if (r.cancelled) return null;
    return r.bestmove;
  }

  // Occasional completely random move (only for the weakest bots)
  if (Math.random() < c.random) {
    const m = legal[Math.floor(Math.random() * legal.length)];
    return m.from + m.to + (m.promotion || '');
  }

  const r = await eng.analyse(fen, { depth: c.depth, multipv: Math.min(c.multipv, legal.length) });
  if (r.cancelled) return null;
  if (!r.lines.length) return r.bestmove;

  // Softmax over evaluations from the bot's perspective
  const sign = chess.turn() === 'w' ? 1 : -1;
  const scored = r.lines.filter(l => l.move).map(l => ({ move: l.move, v: sign * scoreToCp(l.score) }));
  const best = Math.max(...scored.map(s => s.v));
  // Never miss a forced mate-in-1/2 at these levels? Weak bots sometimes do - that's realistic.
  const weights = scored.map(s => Math.exp((Math.max(s.v - best, -3000)) / c.temp));
  const total = weights.reduce((a, b) => a + b, 0);
  let x = Math.random() * total;
  for (let i = 0; i < scored.length; i++) {
    x -= weights[i];
    if (x <= 0) return scored[i].move;
  }
  return scored[0].move;
}
