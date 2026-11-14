// Seeded randomness for the simulation. Every random draw in the game comes
// from one of these streams, so a seed plus the same inputs always replays the
// same round. Nothing in the simulation calls Math.random or Date.now.
export function makeRng(seed) {
  let x = (seed >>> 0) || 0x9e3779b9;
  let y = 0x85ebca6b;
  let z = 0xc2b2ae35;
  let w = 0x27d4eb2f;
  function next() {
    const t = x ^ (x << 11);
    x = y;
    y = z;
    z = w;
    w = (w ^ (w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return w / 4294967296;
  }
  return {
    next,
    range(lo, hi) {
      return lo + (hi - lo) * next();
    },
    int(lo, hi) {
      return Math.floor(lo + (hi - lo + 1) * next());
    },
    pick(list) {
      return list[Math.floor(next() * list.length)];
    },
    chance(p) {
      return next() < p;
    },
  };
}
