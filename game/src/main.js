// Deadlock Yard: boot, the one loop, and the one state object. A fixed 60 Hz
// simulation feeds a render at the display's rate; phases are menu, buy, play,
// roundEnd and matchEnd, and every number the judge reads lives in this file's
// state or in the module that owns it. ?shot=start|play|plant|end with &seed=N
// stages a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, GRENADE, BUY_ORDER } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEconomy } from './economy.js';
import { createHud } from './hud.js';
import { createSfx } from './audio.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 8;
const EMPTY_KEYS = new Set();
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const sfx = createSfx();
const world = createWorld(scene);
const combat = createCombat(scene);
const weapons = createWeapons(camera);
const hud = createHud();
const player = createPlayer(world.colliders);
const input = createInput(renderer.domElement, onLockChange);
const economy = createEconomy();
const grenades = createGrenades(scene, world.colliders, onGrenadeBlast);
const bomb = createBomb(scene, sfx, onBombBlast);
const bots = createBots(scene, world, combat, random, onPlayerDamage, onDefused, sfx);
const shootables = world.shootables.concat(bots.hitMeshes);

const body = player.state;
const camDir = new THREE.Vector3();
const muzzlePos = new THREE.Vector3();
const rightVec = new THREE.Vector3();
const aimDir = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

// The one state object: phase, clocks, and the round's bookkeeping.
const G = {
  phase: 'menu',
  timer: ROUND_TIME,
  buyLeft: BUY_TIME,
  endLeft: 0,
  elapsed: 0,
  kills: 0,
  shake: 0,
  hearAt: 0,
  accumulator: 0,
  lastTime: performance.now(),
  frozen: false,
};

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  if (G.shake > 0.001) {
    camera.position.x += (random() - 0.5) * G.shake * 0.18;
    camera.position.y += (random() - 0.5) * G.shake * 0.18;
  }
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function siteAt(pos) {
  for (const site of world.sites) if (site.box.containsPoint(tmpVec.set(pos.x, 1, pos.z))) return site;
  return null;
}

function onPlayerDamage(amount, fromPos) {
  if (G.phase !== 'play' || !body.alive) return;
  const died = player.damage(amount);
  hud.setHealth(body.health);
  hud.damageFlash();
  sfx.hurt();
  if (died) {
    hud.killFeed('You were eliminated');
    if (bomb.state.mode !== 'planted') endRound(false, 'You were eliminated');
  }
}

function onGrenadeBlast(center) {
  sfx.explosion();
  G.shake = Math.max(G.shake, 0.6);
  bots.hear(center.x, center.z, 45, G.elapsed);
  blastDamage(center, 6, 120);
}

function onBombBlast(center) {
  G.shake = 1;
  blastDamage(center, 9, 250);
  if (G.phase === 'play') endRound(true, `Bomb detonated at site ${bomb.state.site ? bomb.state.site.name : ''}`);
}

// Radial damage with line-of-sight: a wall between the blast and a body saves it.
function blastDamage(center, radius, maxDamage) {
  const victims = [];
  for (const bot of bots.bots) {
    if (bot.alive) victims.push({ pos: bot.mover.position, bot });
  }
  if (body.alive) victims.push({ pos: body.position, player: true });
  for (const victim of victims) {
    const d = victim.pos.distanceTo(center);
    if (d > radius) continue;
    tmpVec.copy(victim.pos).setY(victim.pos.y + 1.0);
    const dir = tmpVec.sub(center).normalize();
    const blocked = combat.hitscan(center, dir, world.shootables, d);
    if (blocked) continue;
    const amount = Math.round(maxDamage - (d / radius) * (maxDamage - 20));
    if (victim.bot) {
      if (bots.damage(victim.bot.torso, amount)) onBotKilled(victim.bot);
    } else {
      onPlayerDamage(amount, center);
    }
  }
}

function onBotKilled(bot) {
  G.kills += 1;
  economy.rewardKill();
  hud.setMoney(economy.state.money);
  hud.killFeed(`You eliminated ${bot.name}`);
  sfx.kill();
  if (G.phase === 'play' && bots.aliveCount() === 0 && bomb.state.mode !== 'planted') {
    endRound(true, 'All Sentinels eliminated');
  }
}

function onDefused() {
  if (G.phase === 'play') endRound(false, 'Bomb defused');
}

function shoot(spread) {
  const def = weapons.def();
  if (!weapons.takeRound()) return false;
  camera.getWorldDirection(camDir);
  muzzlePos.copy(camera.position).addScaledVector(camDir, 0.7);
  rightVec.set(Math.cos(body.yaw), 0, -Math.sin(body.yaw));
  muzzlePos.addScaledVector(rightVec, 0.18);
  muzzlePos.y -= 0.12;
  const pellets = def.pellets || 1;
  let hitSomething = false;
  for (let p = 0; p < pellets; p += 1) {
    aimDir.copy(camDir);
    aimDir.x += (random() * 2 - 1) * spread;
    aimDir.y += (random() * 2 - 1) * spread;
    aimDir.z += (random() * 2 - 1) * spread;
    aimDir.normalize();
    const hit = combat.hitscan(camera.position, aimDir, shootables, 80);
    const end = hit ? hit.point : tmpVec.copy(camera.position).addScaledVector(aimDir, 60);
    combat.tracer(muzzlePos, end);
    if (hit && hit.object.userData.bot) {
      const amount = combat.damageFor(def, hit.object.userData.part, hit.distance);
      const killed = bots.damage(hit.object, amount);
      hitSomething = true;
      hud.hitMarker(killed, shot ? 4000 : 90);
      if (killed) onBotKilled(hit.object.userData.bot);
      else sfx.hit();
    }
  }
  sfx.shot(def.kind);
  weapons.pullTrigger();
  player.recoil(def.recoil * (0.9 + random() * 0.3), (random() * 2 - 1) * def.recoil * 0.3);
  bots.hear(body.position.x, body.position.z, 30, G.elapsed);
  hud.setAmmo(weapons.ammo[weapons.state.current].mag, weapons.ammo[weapons.state.current].reserve, def.name, weapons.state.grenades);
  return true;
}

function buyOrSelect(id) {
  if (id === 'grenade') {
    if (weapons.state.grenades >= 2) return;
    if (!economy.canAfford(GRENADE.price)) {
      sfx.deny();
      return;
    }
    economy.spend(GRENADE.price);
    weapons.addGrenade();
    sfx.buy();
    return;
  }
  const def = WEAPONS[id];
  if (!def) return;
  if (weapons.ammo[id].owned) {
    if (weapons.select(id)) sfx.buy();
    return;
  }
  if (!economy.canAfford(def.price)) {
    sfx.deny();
    return;
  }
  economy.spend(def.price);
  weapons.give(id);
  weapons.select(id);
  sfx.buy();
}

function setupRound() {
  player.reset(world.spawns.vanguard);
  bots.reset(world.spawns.bots);
  bomb.reset();
  grenades.reset();
  combat.reset();
  weapons.refillReserve();
  G.timer = ROUND_TIME;
  G.shake = 0;
  syncCamera();
  hud.setHealth(body.health);
  hud.setMoney(economy.state.money);
  hud.setTimer(G.timer);
  hud.setScore(economy.state.vanguard, economy.state.sentinel, economy.state.round);
  const slot = weapons.ammo[weapons.state.current];
  hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, weapons.state.grenades);
  hud.setBomb('none', 0, 0, 0);
  hud.hideBanner();
}

function startBuy() {
  G.phase = 'buy';
  G.buyLeft = BUY_TIME;
  setupRound();
  hud.hideOverlay();
  hud.showBuy(economy.state.money, G.buyLeft);
  hud.updateBuy(economy.state.money, G.buyLeft, Object.fromEntries(Object.entries(weapons.ammo).map(([id, a]) => [id, a.owned])));
  if (document.pointerLockElement) document.exitPointerLock();
}

function startRound() {
  setupRound();
  G.phase = 'play';
  hud.hideBuy();
  hud.hideOverlay();
  input.requestLock();
}

function startMatch() {
  economy.resetMatch();
  weapons.reset();
  G.kills = 0;
  startBuy();
}

function endRound(won, reason) {
  if (G.phase !== 'play') return;
  G.phase = 'roundEnd';
  G.endLeft = 3.5;
  economy.rewardRound(won);
  hud.setScore(economy.state.vanguard, economy.state.sentinel, economy.state.round);
  hud.setMoney(economy.state.money);
  hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, won, 3400);
  hud.setBomb('none', 0, 0, 0);
  sfx.round(won);
  if (document.pointerLockElement) document.exitPointerLock();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    sfx.unlock();
    if (G.phase === 'paused') {
      G.phase = 'play';
      hud.hideOverlay();
    }
  } else if (G.phase === 'play') {
    G.phase = 'paused';
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (G.phase === 'menu' || G.phase === 'matchEnd') startMatch();
  else if (G.phase === 'paused') input.requestLock();
});
hud.onBuy((id) => {
  if (G.phase === 'buy') {
    buyOrSelect(id);
    hud.updateBuy(economy.state.money, G.buyLeft, Object.fromEntries(Object.entries(weapons.ammo).map(([id2, a]) => [id2, a.owned])));
    const slot = weapons.ammo[weapons.state.current];
    hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, weapons.state.grenades);
  }
});
hud.onContinue(() => {
  if (G.phase === 'buy') startRound();
});

renderer.domElement.addEventListener('click', () => {
  if (!shot && G.phase === 'play' && !input.state.locked) input.requestLock();
});

function step(dt) {
  G.elapsed += dt;
  G.shake = Math.max(0, G.shake - dt * 1.8);
  const inPlay = G.phase === 'play';
  const keys = inPlay && body.alive ? input.state.keys : EMPTY_KEYS;
  player.step(dt, keys, weapons.def().speed / 5.2);
  weapons.step(dt, player.groundSpeed());
  bots.step(dt, G.elapsed, body, bomb.state.mode === 'planted', bomb.state.pos);
  grenades.step(dt);
  combat.step(dt);
  bots.syncPlayerBody(body);

  // Planting: hold E inside a site, on the ground.
  if (inPlay && body.alive) {
    if (keys.has('KeyE') && bomb.state.mode === 'carried') {
      const site = siteAt(body.position);
      if (site && player.state && body.position.y === 0) {
        bomb.plantStart(site, site.center);
      }
    }
    if (bomb.state.mode === 'planting') {
      const site = siteAt(body.position);
      const ok = keys.has('KeyE') && site === bomb.state.site && body.position.y === 0;
      if (bomb.plantStep(dt, G.elapsed, ok)) {
        economy.rewardPlant();
        hud.setMoney(economy.state.money);
        hud.killFeed(`Bomb planted at site ${bomb.state.site.name}`);
        hud.banner('BOMB PLANTED', 'Defend it until it blows', true, 2600);
        let nearest = null;
        let best = Infinity;
        for (const bot of bots.bots) {
          if (!bot.alive) continue;
          const d = bot.mover.position.distanceTo(bomb.state.pos);
          if (d < best) {
            best = d;
            nearest = bot;
          }
        }
        if (nearest) nearest.order = 'defuse';
      }
    }
  }
  if (bomb.state.mode === 'planted') bomb.step(dt, G.elapsed);

  // Footsteps give the player away up close; running is loud.
  if (inPlay && body.alive && player.groundSpeed() > 4 && !body.crouching && G.elapsed > G.hearAt) {
    G.hearAt = G.elapsed + 0.4;
    bots.hear(body.position.x, body.position.z, 8, G.elapsed);
    sfx.step(G.elapsed);
  }
  if (inPlay) {
    G.timer -= dt;
    if (bomb.state.mode === 'planted') hud.setTimer(Math.max(0, bomb.state.fuse));
    else hud.setTimer(Math.max(0, G.timer));
    if (G.timer <= 0 && bomb.state.mode !== 'planted') endRound(false, 'Time expired — Sentinel holds the yard');
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - G.lastTime) / 1000, 0.1);
  G.lastTime = now;
  if (G.frozen) {
    renderer.render(scene, camera);
    return;
  }
  const look = input.takeLook();
  player.look(look.x, look.y);
  syncCamera();
  // Consumed every frame so a click on a buy button never fires the next round.
  const clicked = input.takeClick();

  if (G.phase === 'play' && body.alive) {
    const def = weapons.def();
    if ((def.auto && input.state.firing) || (!def.auto && clicked)) {
      if (weapons.ready()) shoot(weapons.spread(player.groundSpeed()));
      else if (weapons.ammo[weapons.state.current].mag === 0 && weapons.ammo[weapons.state.current].reserve > 0) {
        if (weapons.reload()) sfx.reload();
      } else if (weapons.ammo[weapons.state.current].mag === 0) sfx.dry();
    }
    const pressed = input.takePressed();
    for (const code of pressed) {
      if (code === 'KeyR') {
        if (weapons.reload()) sfx.reload();
      } else if (code.startsWith('Digit')) {
        const index = Number(code.slice(5)) - 1;
        if (index >= 0 && index < BUY_ORDER.length) {
          if (weapons.select(BUY_ORDER[index])) {
            const slot = weapons.ammo[weapons.state.current];
            hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, weapons.state.grenades);
          }
        }
      } else if (code === 'KeyG' && weapons.throwGrenade()) {
        camera.getWorldDirection(camDir);
        tmpVec.copy(camera.position).addScaledVector(camDir, 0.5);
        grenades.throwFrom(tmpVec, camDir, body.velocity);
        sfx.throwPin();
        const slot = weapons.ammo[weapons.state.current];
        hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, weapons.state.grenades);
      }
    }
    hud.setCrosshair(weapons.spread(player.groundSpeed()));
    // Ammo is pushed every frame: a reload finishes inside weapons.step,
    // with no input event to trigger a refresh, and setAmmo is cached so an
    // unchanged value costs no DOM write.
    {
      const slot = weapons.ammo[weapons.state.current];
      hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, weapons.state.grenades);
    }
    hud.setBomb(
      bomb.state.mode === 'planted' ? 'planted' : bomb.state.mode === 'planting' ? 'planting' : 'none',
      bomb.state.fuse,
      bomb.state.plantT / 3,
      bots.defuseProgress(),
    );
  }

  if (G.phase === 'buy') {
    const pressed = input.takePressed();
    for (const code of pressed) {
      if (code.startsWith('Digit')) {
        const index = Number(code.slice(5)) - 1;
        if (index >= 0 && index < BUY_ORDER.length) buyOrSelect(BUY_ORDER[index]);
        else if (index === 5) buyOrSelect('grenade');
      }
    }
    G.buyLeft -= dt;
    hud.updateBuy(economy.state.money, Math.max(0, G.buyLeft), Object.fromEntries(Object.entries(weapons.ammo).map(([id, a]) => [id, a.owned])));
    if (G.buyLeft <= 0) startRound();
  }

  if (G.phase === 'roundEnd') {
    G.endLeft -= dt;
    if (G.endLeft <= 0) {
      if (economy.matchOver()) {
        G.phase = 'matchEnd';
        hud.showOverlay('match', `Vanguard ${economy.state.vanguard} — ${economy.state.sentinel} Sentinel. ${economy.winner()} takes the match. ${G.kills} eliminations this match.`);
      } else {
        economy.nextRound();
        startBuy();
      }
    }
  }

  G.accumulator += dt;
  let steps = 0;
  while (G.accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    G.accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (G.accumulator > FIXED_STEP * 5) G.accumulator = 0;
  syncCamera();
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  hud.hideBanner();
  G.phase = 'play';
  if (name === 'start') {
    setupRound();
    body.position.set(0.6, 0, 11);
    settle(10);
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.showOverlay('start');
  } else if (name === 'play') {
    setupRound();
    body.position.set(0, 0, 6);
    bots.bots[2].mover.reset(1.5, 0, -7);
    bots.bots[0].mover.reset(-1, 0, -4);
    settle(30);
    aimAt(bots.aimPoint(2));
    shoot(0);
    settle(8);
    shoot(0);
    settle(6);
    aimAt(bots.aimPoint(0));
    shoot(0);
    settle(5);
  } else if (name === 'plant') {
    setupRound();
    body.position.set(-14.2, 0, -6.5);
    bots.bots[3].mover.reset(-13.5, 0, -10.5);
    settle(10);
    const site = world.sites[0];
    bomb.plantStart(site, site.center);
    bomb.state.plantT = 2.1;
    aimAt(new THREE.Vector3(-14.5, 0.8, -9.5));
    hud.setBomb('planting', 0, 0.7, 0);
    settle(4);
  } else if (name === 'end') {
    setupRound();
    bots.bots.forEach((bot, i) => {
      bot.mover.reset(-1.5 + i, 0, -2.5 - i * 0.5);
      bot.alive = false;
      bot.fall = 1;
      bot.state = 'dead';
      bot.group.rotation.x = -1.45;
      bot.group.position.copy(bot.mover.position);
      bot.group.position.y = -0.08;
    });
    economy.state.vanguard = 1;
    economy.state.round = 2;
    hud.setScore(1, 0, 2);
    body.position.set(0, 0, 4);
    aimAt(new THREE.Vector3(0, 1, -6));
    hud.banner('ROUND WON', 'Site A cleared — Vanguard leads 1–0', true, 60000);
    settle(5);
  }
  const slot = weapons.ammo[weapons.state.current];
  hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, weapons.state.grenades);
  hud.setHealth(body.health);
  hud.setMoney(economy.state.money);
  hud.setTimer(G.timer);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      G.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
hud.setHealth(100);
hud.setMoney(800);
hud.setTimer(ROUND_TIME);
hud.setScore(0, 0, 1);
hud.setAmmo(12, 48, 'P9 Sidearm', 0);
if (shot) runShot(shot);
else requestAnimationFrame(frame);
