// Deterministic random + clock for test mode.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(str) { // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// Test mode: Math.random and Date.now become functions of seed and sim time only.
export function installTestMode(seed, simTime) {
  Math.random = mulberry32(seed);
  Date.now = () => 1700000000000 + Math.round(simTime() * 1000);
}
