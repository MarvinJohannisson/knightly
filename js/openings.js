// Opening name lookup (Lichess chess-openings database, CC0).
let db = null;
let loading = null;

export function loadOpenings() {
  if (db) return Promise.resolve(db);
  if (!loading) loading = fetch('data/openings.json').then(r => r.json()).then(j => (db = j)).catch(() => (db = {}));
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

/** Is this exact sequence a named position in the database? */
export function isBook(sans) {
  return !!(db && db[sans.join(' ')]);
}
