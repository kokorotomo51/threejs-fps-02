// The bomb: carried, planted, then a fuse the Sentinels race to beat. Planting
// takes 3 s holding E inside a site; leaving the site cancels it. Once planted
// the fuse runs 35 s with beeps that quicken, and the blast is the shared effect
// from grenades.js at double power. Defusing is the bots' job, in bots.js.
import * as THREE from 'three';
import { colour } from './palette.js';
import { createBlastFx } from './grenades.js';

const PLANT_TIME = 3;
const FUSE_TIME = 35;

export function createBomb(scene, sfx, onExploded) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: colour('hairline'), roughness: 0.6, metalness: 0.3 }),
  );
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 10, 8),
    new THREE.MeshBasicMaterial({ color: colour('accent') }),
  );
  lamp.position.set(0, 0.14, 0);
  const light = new THREE.PointLight(colour('accent'), 0, 4);
  light.position.set(0, 0.4, 0);
  group.add(box, lamp, light);
  group.visible = false;
  scene.add(group);
  const blast = createBlastFx(scene, 1);

  const state = { mode: 'carried', site: null, pos: new THREE.Vector3(), plantT: 0, fuse: FUSE_TIME, beepAt: 0, tickAt: 0 };

  return {
    state,
    plantStart(site, pos) {
      state.mode = 'planting';
      state.site = site;
      state.pos.copy(pos);
      state.plantT = 0;
      state.tickAt = 0;
    },
    // ok = still holding E, inside the site and on the ground. Returns true the
    // moment the plant completes; cancelling returns the bomb to 'carried'.
    plantStep(dt, now, ok) {
      if (state.mode !== 'planting') return false;
      if (!ok) {
        state.mode = 'carried';
        state.plantT = 0;
        return false;
      }
      state.plantT += dt;
      if (now >= state.tickAt) {
        sfx.plantTick();
        state.tickAt = now + 0.3;
      }
      if (state.plantT >= PLANT_TIME) {
        state.mode = 'planted';
        state.fuse = FUSE_TIME;
        state.beepAt = now;
        // Sit on the floor, not sunk halfway into it.
        group.position.set(state.pos.x, 0.1, state.pos.z);
        group.visible = true;
        return true;
      }
      return false;
    },
    // Runs the fuse; returns true the moment the bomb goes off.
    step(dt, now) {
      blast.step(dt);
      if (state.mode !== 'planted') return false;
      state.fuse -= dt;
      const interval = state.fuse > 20 ? 1.0 : state.fuse > 10 ? 0.55 : 0.3;
      if (now >= state.beepAt) {
        sfx.beep(state.fuse <= 10);
        state.beepAt = now + interval;
      }
      const blink = Math.sin(now * (state.fuse > 10 ? 6 : 14)) > 0;
      lamp.visible = blink;
      light.intensity = blink ? 2.5 : 0;
      if (state.fuse <= 0) {
        state.mode = 'done';
        group.visible = false;
        blast.burst(state.pos, 2.2);
        sfx.explosion();
        onExploded(state.pos);
        return true;
      }
      return false;
    },
    reset() {
      state.mode = 'carried';
      state.site = null;
      state.plantT = 0;
      state.fuse = FUSE_TIME;
      group.visible = false;
      blast.reset();
    },
  };
}
