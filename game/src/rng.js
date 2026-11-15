// One deterministic random source for the whole game: seeded mulberry32 plus the
// small helpers bots, spread and spawns need. No Math.random anywhere in the sim,
// so a ?shot= scene with a fixed seed plays out the same way every time.
export function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(random, min, max) {
  return min + random() * (max - min);
}

export function int(random, min, max) {
  return Math.floor(range(random, min, max + 1));
}

export function chance(random, p) {
  return random() < p;
}
