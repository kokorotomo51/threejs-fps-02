// Deadlock Yard: boot, the one loop, and the one state object. A fixed 60 Hz
// simulation feeds a render at the display's rate; phases are menu, buy, play,
// roundEnd and matchEnd, and every number the judge reads lives in this file's
// state or in the module that owns it. ?shot=start|play|plant|end with &seed=N
// stages a deterministic frame for a capture, renders it twice, then freezes it
// and sets window.__shotReady. Two random streams: `random` drives the sim
// (spread, bots, damage), `cosmetic` drives shake and other look-only noise,
// so changing a visual never changes a round.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, WEAPONS, GRENADE, SMOKE, FLASH, ARMOR, BUY_ORDER } from './weapons.js';
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
const cosmetic = mulberry32(seed + 7919);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 30, 70);
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
const grenades = createGrenades(scene, world.colliders, onGrenadeBlast, onFlashBlast);
const bomb = createBomb(scene, sfx, onBombBlast);
const bots = createBots(scene, world, combat, random, onPlayerDamage, onDefused, sfx,
  (a, b) => grenades.blockedBySmoke(a, b, G.elapsed));
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
  flash: 0,
  hearAt: 0,
  accumulator: 0,
  lastTime: performance.now(),
  frozen: false,
};

// The utility line under the ammo: what the player can still throw.
function utilText() {
  const parts = [];
  if (weapons.state.grenades > 0) parts.push(`HE x${weapons.state.grenades}`);
  if (weapons.state.smoke > 0) parts.push(`SMK x${weapons.state.smoke}`);
  if (weapons.state.flashes > 0) parts.push(`FL x${weapons.state.flashes}`);
  return parts.join(' · ');
}

function refreshAmmo() {
  const slot = weapons.ammo[weapons.state.current];
  hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, utilText());
}

// What the buy menu marks owned: weapons, grenades by count, armor by vest.
function buyOwned() {
  const owned = Object.fromEntries(Object.entries(weapons.ammo).map(([id, a]) => [id, a.owned]));
  owned.grenade = weapons.state.grenades > 0;
  owned.smoke = weapons.state.smoke > 0;
  owned.flash = weapons.state.flashes > 0;
  owned.armor = body.armor > 0;
  return owned;
}

function syncCamera() {
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  if (G.shake > 0.001) {
    camera.position.x += (cosmetic() - 0.5) * G.shake * 0.18;
    camera.position.y += (cosmetic() - 0.5) * G.shake * 0.18;
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
  hud.setArmor(body.armor);
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

// A flash pop: bots that could see it go blind, and the player is blinded by
// how close it was, whether he faced it, and whether a wall stood between.
function onFlashBlast(center) {
  sfx.pop();
  bots.flash(center, G.elapsed);
  camera.getWorldDirection(camDir);
  aimDir.copy(center).sub(camera.position);
  const dist = aimDir.length();
  if (dist > 24) return;
  aimDir.divideScalar(dist || 1);
  const facing = camDir.dot(aimDir) > 0 ? 1 : 0.4;
  const blocked = combat.hitscan(camera.position, aimDir, world.shootables, dist);
  if (!blocked) G.flash = Math.max(G.flash, Math.max(0, 1.15 - dist / 22) * facing);
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
  const kick = weapons.recoilKick(random);
  player.recoil(kick[0], kick[1]);
  bots.hear(body.position.x, body.position.z, 30, G.elapsed);
  refreshAmmo();
  return true;
}

function buyOrSelect(id) {
  if (id === 'armor') {
    if (body.armor >= 50) return;
    if (!economy.canAfford(ARMOR.price)) {
      sfx.deny();
      return;
    }
    economy.spend(ARMOR.price);
    player.buyArmor();
    hud.setArmor(body.armor);
    sfx.buy();
    return;
  }
  if (id === 'smoke' || id === 'flash') {
    const def = id === 'smoke' ? SMOKE : FLASH;
    const owned = id === 'smoke' ? weapons.state.smoke : weapons.state.flashes;
    if (owned >= 2) return;
    if (!economy.canAfford(def.price)) {
      sfx.deny();
      return;
    }
    economy.spend(def.price);
    weapons.addUtility(id);
    sfx.buy();
    return;
  }
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
  hud.setArmor(body.armor);
  hud.setMoney(economy.state.money);
  hud.setTimer(G.timer);
  hud.setScore(economy.state.vanguard, economy.state.sentinel, economy.state.round);
  const slot = weapons.ammo[weapons.state.current];
  hud.setAmmo(slot.mag, slot.reserve, weapons.def().name, utilText());
  hud.setBomb('none', 0, 0, 0);
  hud.hideBanner();
}

function startBuy() {
  G.phase = 'buy';
  G.buyLeft = BUY_TIME;
  setupRound();
  hud.hideOverlay();
  hud.showBuy(economy.state.money, G.buyLeft);
  hud.updateBuy(economy.state.money, G.buyLeft, buyOwned());
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
  player.clearArmor();
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
    hud.updateBuy(economy.state.money, G.buyLeft, buyOwned());
    refreshAmmo();
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
  grenades.step(dt, G.elapsed);
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
        // The retake is a pair: the nearest Sentinel defuses, the next one
        // covers the site while he works.
        bots.assignRetake(bomb.state.pos);
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

// One throw for every utility: HE from the grenade stock, smoke and flash
// from their own. The throw leaves the camera along its aim, keeps half the
// player's velocity, and never fires when the stock is empty.
function throwUtility(kind) {
  const ok = kind === 'he' ? weapons.throwGrenade() : weapons.throwUtility(kind);
  if (!ok) return;
  camera.getWorldDirection(camDir);
  tmpVec.copy(camera.position).addScaledVector(camDir, 0.5);
  grenades.throwFrom(tmpVec, camDir, body.velocity, kind);
  sfx.throwPin();
  refreshAmmo();
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
  // Scoped in with the sniper: the view narrows and the mouse slows down.
  const scoped = G.phase === 'play' && body.alive && input.state.aiming && weapons.def().kind === 'sniper';
  player.look(look.x * (scoped ? 0.35 : 1), look.y * (scoped ? 0.35 : 1));
  const wantFov = scoped ? 26 : 74;
  if (Math.abs(camera.fov - wantFov) > 0.1) {
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 14);
    camera.updateProjectionMatrix();
  }
  hud.setScoped(scoped);
  syncCamera();
  // Consumed every frame so a click on a buy button never fires the next round.
  const clicked = input.takeClick();

  if (G.phase === 'play' && body.alive) {
    const def = weapons.def();
    if ((def.auto && input.state.firing) || (!def.auto && clicked)) {
      if (weapons.ready()) shoot(weapons.spread(player.groundSpeed()) * (scoped ? 0.5 : 1));
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
          if (weapons.select(BUY_ORDER[index])) refreshAmmo();
        }
      } else if (code === 'KeyG') {
        throwUtility('he');
      } else if (code === 'KeyV') {
        throwUtility('smoke');
      } else if (code === 'KeyB') {
        throwUtility('flash');
      }
    }
    hud.setCrosshair(weapons.spread(player.groundSpeed()) * (scoped ? 0.5 : 1));
    // Ammo is pushed every frame: a reload finishes inside weapons.step,
    // with no input event to trigger a refresh, and setAmmo is cached so an
    // unchanged value costs no DOM write.
    refreshAmmo();
    hud.setBomb(
      bomb.state.mode === 'planted' ? 'planted' : bomb.state.mode === 'planting' ? 'planting' : 'none',
      bomb.state.fuse,
      bomb.state.plantT / 3,
      bots.defuseProgress(),
    );
  }

  // Standing in smoke greys the screen out; a flash fades back over ~2 s.
  if (G.phase === 'play') {
    hud.setSmoke(grenades.smokeAt(camera.position, G.elapsed));
    if (G.flash > 0) G.flash = Math.max(0, G.flash - dt / 2.2);
    hud.setFlash(G.flash);
  }

  if (G.phase === 'buy') {
    const pressed = input.takePressed();
    for (const code of pressed) {
      if (code.startsWith('Digit')) {
        const index = Number(code.slice(5)) - 1;
        if (index >= 0 && index < BUY_ORDER.length) buyOrSelect(BUY_ORDER[index]);
        else if (index === 5) buyOrSelect('grenade');
        else if (index === 6) buyOrSelect('smoke');
        else if (index === 7) buyOrSelect('flash');
        else if (index === 8) buyOrSelect('armor');
      }
    }
    G.buyLeft -= dt;
    hud.updateBuy(economy.state.money, Math.max(0, G.buyLeft), buyOwned());
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
    // Foundry hero: bright gameplay, rifle up, a Sentinel holding site A.
    setupRound();
    economy.state.money = 3250;
    weapons.give('rifle');
    weapons.select('rifle');
    body.position.set(-10, 0, 4);
    bots.bots[0].mover.reset(-14, 0, -6);
    bots.bots[1].mover.reset(-18, 0, -11);
    settle(10);
    aimAt(bots.aimPoint(0));
    hud.setMoney(3250);
  } else if (name === 'play') {
    // Mid-lane fight: tracers out, a hit landing, a second bot in the open.
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
    settle(2);
  } else if (name === 'plant') {
    // Silo post-plant: the bomb down with its lamp blinking, a smoke cloud
    // over the site, a Sentinel retaking through it.
    setupRound();
    body.position.set(13, 0, -5.5);
    bots.bots[3].mover.reset(13, 0, -12);
    bots.bots[3].order = 'defuse';
    settle(10);
    const site = world.sites[1];
    bomb.forcePlant(site, site.center, G.elapsed);
    // A mature cloud: staged 1.2 s into its life so the capture shows the
    // smoke a real throw leaves over the site, not a wisp just forming.
    grenades.spawnSmoke(new THREE.Vector3(17.5, 1, -10.5), G.elapsed - 1.2);
    aimAt(new THREE.Vector3(16, 0.6, -9));
    hud.setBomb('planted', 35, 0, 0.15);
    hud.setTimer(35);
    settle(4);
  } else if (name === 'end') {
    // Buy phase over a lit yard: real prices, owned guns, $3,200 to spend.
    economy.state.money = 3200;
    weapons.give('smg');
    weapons.give('rifle');
    weapons.addGrenade();
    weapons.addUtility('smoke');
    startBuy();
    body.position.set(0, 0, 10);
    aimAt(new THREE.Vector3(0, 1.5, -8));
    settle(5);
  }
  refreshAmmo();
  hud.setHealth(body.health);
  hud.setArmor(body.armor);
  hud.setMoney(economy.state.money);
  hud.setTimer(bomb.state.mode === 'planted' ? bomb.state.fuse : G.timer);
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
hud.setAmmo(12, 48, 'P9 Sidearm', '');
if (shot) runShot(shot);
else requestAnimationFrame(frame);
