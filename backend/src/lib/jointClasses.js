// Pairings confirmed by the project owner. Unpaired registrations study alone.
const APPROVED_PAIRS = {
  '30000-1501': [['G1', 'G2']],
  '30000-1202': [['G1', 'G2']],
  '30000-2004': [['G1', 'G2']],
  '30000-1201': [['G3', 'G4']],
  '30000-1404': [['G3', 'G4']],
  '30000-2002': [['G3', 'G4']],
};

function jointPolicy(tables) {
  const registrations = new Map();
  for (const row of tables.register || []) {
    const sid = String(row.subject_id);
    if (!registrations.has(sid)) registrations.set(sid, new Set());
    registrations.get(sid).add(String(row.group_id));
  }
  const jointPairs = {};
  for (const [sid, pairs] of Object.entries(APPROVED_PAIRS)) {
    const present = registrations.get(sid);
    if (!present) continue;
    const active = pairs.filter((pair) => pair.every((g) => present.has(g)));
    if (active.length) jointPairs[sid] = active.map((pair) => [...pair]);
  }
  return { jointMode: 'pairs', jointPairs };
}

module.exports = { jointPolicy };
