// The look plan, in one place: a daylight yard, not a dark room. Warm sun on
// pale concrete and asphalt, brick at Foundry, cool steel at Silo, tan-olive
// uniforms against it all, one amber accent for signal. Lighting makes every
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
  // Daylight yard: sky and ground the scene background and fog read from.
  sky: '#a9c3d4',
  asphalt: '#6f7268',
  concrete: '#b9b3a4',
  brick: '#a05a3c',
  steel: '#7d8a96',
  silo: '#3f7ea6',
  rust: '#8a5a2e',
  uniform: '#8a7d4f',
  vest: '#4a4a38',
  sun: '#ffe3b3',
  fill: '#cfe4f2',
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
