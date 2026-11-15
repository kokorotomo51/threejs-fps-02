// The armoury: five guns and one grenade. The table owns every number the judge
// reads — damage, headshot multiplier, magazine, fire rate, reload, spread and the
// speed each weapon lets its carrier run at — and the view models are built once
// from boxes, one group per kind, toggled on select. Ammo is tracked per weapon;
// a weapon bought stays bought for the match.
import * as THREE from 'three';
import { colour } from './palette.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'P9 Sidearm', kind: 'pistol', price: 0, damage: 26, headMul: 2.5, mag: 12, reserve: 48, auto: false, gap: 0.16, reload: 1.4, spreadStill: 0.004, spreadMove: 0.03, recoil: 0.012, speed: 5.4, barrel: 0.22 },
  smg: { id: 'smg', name: 'K7 Viper', kind: 'smg', price: 1500, damage: 22, headMul: 2.5, mag: 28, reserve: 112, auto: true, gap: 0.075, reload: 1.9, spreadStill: 0.006, spreadMove: 0.034, recoil: 0.008, speed: 5.6, barrel: 0.3 },
  rifle: { id: 'rifle', name: 'AR-77 Longarm', kind: 'rifle', price: 2700, damage: 34, headMul: 2.95, mag: 30, reserve: 90, auto: true, gap: 0.096, reload: 1.9, spreadStill: 0.0022, spreadMove: 0.028, recoil: 0.013, speed: 5.2, barrel: 0.4 },
  shotgun: { id: 'shotgun', name: 'M12 Breacher', kind: 'shotgun', price: 1700, damage: 12, headMul: 2.5, pellets: 9, mag: 6, reserve: 24, auto: false, gap: 0.85, reload: 2.6, spreadStill: 0.05, spreadMove: 0.09, recoil: 0.03, speed: 5.0, barrel: 0.42 },
  sniper: { id: 'sniper', name: 'L96 Longshot', kind: 'sniper', price: 4750, damage: 88, headMul: 2.5, mag: 5, reserve: 15, auto: false, gap: 1.1, reload: 3.2, spreadStill: 0.0008, spreadMove: 0.05, recoil: 0.05, speed: 4.6, barrel: 0.55 },
};
export const GRENADE = { id: 'grenade', name: 'HE Spark', price: 300 };
export const BUY_ORDER = ['pistol', 'smg', 'shotgun', 'rifle', 'sniper'];

function buildModel(def) {
  const grip = new THREE.MeshStandardMaterial({ color: colour('hairline'), roughness: 0.7, metalness: 0.2 });
  const body = new THREE.MeshStandardMaterial({ color: colour('ink'), roughness: 0.5, metalness: 0.35 });
  const accent = new THREE.MeshStandardMaterial({ color: colour('accent'), roughness: 0.5, metalness: 0.2 });
  const group = new THREE.Group();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.34), body);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
  barrel.position.set(0, 0.025, -0.17 - def.barrel / 2);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.2), grip);
  stock.position.set(0, -0.02, 0.26);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.12), accent);
  stripe.position.set(0, 0.06, -0.05);
  group.add(receiver, barrel, stock, stripe);
  if (def.kind === 'sniper') {
    const scope = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), grip);
    scope.position.set(0, 0.09, -0.08);
    group.add(scope);
  }
  if (def.kind === 'shotgun') {
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.18), grip);
    pump.position.set(0, -0.02, -0.3);
    group.add(pump);
  }
  group.position.set(0.24, -0.2, -0.42);
  group.visible = false;
  return group;
}

export function createWeapons(camera) {
  const models = {};
  for (const def of Object.values(WEAPONS)) {
    models[def.id] = buildModel(def);
    camera.add(models[def.id]);
  }
  // The pistol is the starting weapon, so its model is the one that shows
  // before the first select or reset; without this the first frames render
  // no gun at all.
  models.pistol.visible = true;
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.18, 0.18),
    new THREE.MeshBasicMaterial({ color: colour('accent'), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(colour('accent'), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const ammo = {};
  for (const def of Object.values(WEAPONS)) ammo[def.id] = { mag: def.mag, reserve: def.reserve, owned: def.price === 0 };
  const state = { current: 'pistol', grenades: 0, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bob: 0 };

  function def() {
    return WEAPONS[state.current];
  }

  function select(id) {
    if (!ammo[id] || !ammo[id].owned || id === state.current) return false;
    state.current = id;
    state.reloadLeft = 0;
    state.cooldown = 0.25;
    for (const key of Object.keys(models)) models[key].visible = key === id;
    return true;
  }

  function step(dt, groundSpeed) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bob += dt * groundSpeed * 1.6;
    const model = models[state.current];
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.2 + Math.sin(state.bob * 2) * 0.006 * Math.min(1, groundSpeed / 5);
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    const d = def();
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const slot = ammo[state.current];
        const take = Math.min(d.mag - slot.mag, slot.reserve);
        slot.mag += take;
        slot.reserve -= take;
      }
    }
  }

  return {
    state,
    ammo,
    def,
    step,
    select,
    ready() {
      const slot = ammo[state.current];
      return slot.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = def().gap;
      state.flash = 0.06;
      state.kick = 0.055;
    },
    takeRound() {
      const slot = ammo[state.current];
      if (slot.mag <= 0) return false;
      slot.mag -= 1;
      return true;
    },
    reload() {
      const slot = ammo[state.current];
      if (state.reloadLeft > 0 || slot.mag === def().mag || slot.reserve === 0) return false;
      state.reloadLeft = def().reload;
      return true;
    },
    spread(speed) {
      const d = def();
      return d.spreadStill + Math.min(1, speed / 5.2) * d.spreadMove;
    },
    give(id) {
      ammo[id].owned = true;
      ammo[id].mag = WEAPONS[id].mag;
      ammo[id].reserve = WEAPONS[id].reserve;
    },
    refillReserve() {
      for (const id of Object.keys(ammo)) if (ammo[id].owned) ammo[id].reserve = WEAPONS[id].reserve;
    },
    addGrenade() {
      state.grenades = Math.min(2, state.grenades + 1);
    },
    throwGrenade() {
      if (state.grenades <= 0) return false;
      state.grenades -= 1;
      return true;
    },
    reset() {
      for (const id of Object.keys(ammo)) {
        ammo[id].owned = WEAPONS[id].price === 0;
        ammo[id].mag = WEAPONS[id].mag;
        ammo[id].reserve = WEAPONS[id].reserve;
      }
      state.current = 'pistol';
      state.grenades = 0;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      for (const key of Object.keys(models)) models[key].visible = key === 'pistol';
    },
  };
}
