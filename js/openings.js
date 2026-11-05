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

/** Is this exact sequence a named, sound position in the database? */
export function isBook(sans) {
  const line = sans.join(' ');
  return !!(db && db[line]) && !DUBIOUS.some(d => line === d || line.startsWith(d + ' '));
}
