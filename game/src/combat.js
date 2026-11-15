// Shared shooting plumbing: one raycaster for every hitscan shot in the game, a
// pool of tracer bolts, and the damage table. The player and the bots both shoot
// through here, so a shot behaves the same no matter who pulls the trigger.
import * as THREE from 'three';
import { colour } from './palette.js';

const TRACER_LIFE = 0.09;
const TRACER_SLOTS = 16;

export function createCombat(scene) {
  const raycaster = new THREE.Raycaster();
  const tracers = [];
  const tracerGeometry = new THREE.BoxGeometry(0.02, 0.02, 1);
  for (let i = 0; i < TRACER_SLOTS; i += 1) {
    const mesh = new THREE.Mesh(tracerGeometry, new THREE.MeshBasicMaterial({
      color: colour('accent'), transparent: true, opacity: 0, depthWrite: false,
    }));
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, t: 0, active: false });
  }
  const mid = new THREE.Vector3();

  return {
    // First hit among meshes, or null. dir must already be normalised.
    hitscan(origin, dir, meshes, far) {
      raycaster.set(origin, dir);
      raycaster.far = far;
      const hit = raycaster.intersectObjects(meshes, false)[0];
      return hit || null;
    },
    tracer(start, end) {
      const slot = tracers.find((t) => !t.active) || tracers[0];
      slot.active = true;
      slot.t = 0;
      mid.copy(end).sub(start);
      const length = mid.length() || 0.001;
      slot.mesh.position.copy(start).addScaledVector(mid, 0.5);
      slot.mesh.lookAt(end);
      slot.mesh.scale.set(1, 1, length);
      slot.mesh.visible = true;
      slot.mesh.material.opacity = 0.9;
    },
    step(dt) {
      for (const slot of tracers) {
        if (!slot.active) continue;
        slot.t += dt;
        const k = Math.min(1, slot.t / TRACER_LIFE);
        slot.mesh.material.opacity = 0.9 * (1 - k);
        if (k >= 1) {
          slot.active = false;
          slot.mesh.visible = false;
        }
      }
    },
    reset() {
      for (const slot of tracers) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    },
    // Damage for one pellet: headshots pay more, long shots pay less.
    damageFor(def, part, dist) {
      const base = def.damage * (part === 'head' ? def.headMul : 1);
      const falloff = dist > 30 ? 0.75 : 1;
      return Math.round(base * falloff);
    },
  };
}
