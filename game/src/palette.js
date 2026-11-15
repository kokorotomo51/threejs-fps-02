// The look plan, in one place: six values and one accent hue. Lighting makes every
// shade the game needs, so no other colour appears in the code or the CSS.
// colour(name) returns one cached THREE.Color per name, never a fresh object.
import * as THREE from 'three';

export const PALETTE = {
  canvas: '#14161a',
  surface: '#1e2228',
  hairline: '#2c323a',
  ink: '#e9e6df',
  muted: '#98a0a8',
  accent: '#f0a830',
};

const cache = new Map();

export function colour(name) {
  let found = cache.get(name);
  if (!found) {
    found = new THREE.Color(PALETTE[name]);
    cache.set(name, found);
  }
  return found;
}
