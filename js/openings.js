// Opening name lookup (Lichess chess-openings database, CC0).
let db = null;
let loading = null;

export function loadOpenings() {
  if (db) return Promise.resolve(db);
  if (!loading) loading = fetch(new URL('../data/openings.json', import.meta.url)).then(r => r.json()).then(j => (db = j)).catch(() => (db = {}));
  return loading;
}

/** sans: array of SAN moves from the start position. Returns {eco, name, ply, inBook} or null */
export function lookupOpening(sans) {
  if (!db) return null;
  for (let i = sans.length; i > 0; i--) {
    const hit = db[sans.slice(0, i).join(' ')];
    if (hit) return { eco: hit[0], name: hit[1], ply: i, inBook: i === sans.length };
  }
  return null;
}

// Named in the database but unsound, so they should be graded rather than praised as book.
// A list because a shallow engine search can't judge this: it also marks down good lines like the Alekhine.
const DUBIOUS = [
  'f3', 'g4', 'Na3', 'Nh3', 'a4', 'h4',
  'e4 f5', 'e4 f6', 'e4 g5', 'd4 e5', 'd4 f6', 'd4 g5',
  'e4 e5 f3', 'e4 e5 Ke2', 'e4 e5 Qh5',
  'e4 e5 Nf3 f5', 'e4 e5 Nf3 f6', 'e4 e5 Nf3 Qe7', 'e4 e5 Nf3 Qf6',
];

const dubious = line => DUBIOUS.some(d => line === d || line.startsWith(d + ' '));

// The same database as a book for the bots: for every position reached by a named line, the moves
// that named lines continue with, and how many lines go through each. Mainstream moves have
// hundreds of named lines behind them, oddities one or two.
let tree = null;
function buildTree() {
  tree = new Map();
  for (const line of Object.keys(db)) {
    if (dubious(line) || line.includes('#')) continue; // no unsound lines, no lines that walk into mate
    let prefix = '';
    for (const move of line.split(' ')) {
      let next = tree.get(prefix);
      if (!next) tree.set(prefix, next = {});
      next[move] = (next[move] || 0) + 1;
      prefix = prefix ? `${prefix} ${move}` : move;
    }
  }
}

/** Moves that continue a named opening from this move list, most travelled first: [{ san, weight }] */
export function bookMoves(sans) {
  if (!db) return [];
  if (!tree) buildTree();
  const next = tree.get(sans.join(' '));
  return next ? Object.entries(next).map(([san, weight]) => ({ san, weight })).sort((a, b) => b.weight - a.weight) : [];
}

/** Is this exact sequence a named, sound position in the database? */
export function isBook(sans) {
  const line = sans.join(' ');
  return !!(db && db[line]) && !dubious(line);
}
