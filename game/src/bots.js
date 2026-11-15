// The Sentinels: four bots that hold Deadlock Yard. Each one walks a patrol route
// on the world's waypoint graph, scans its sector, and reacts to what it sees and
// hears: a seen player is engaged with aimed bursts and strafing, a heard shot or
// blast is investigated, and a planted bomb sends the nearest bot to defuse it.
// One mover per bot, one raycaster shared through combat, no per-frame allocation.
import * as THREE from 'three';
import { colour } from './palette.js';
import { createMover } from './mover.js';
import { range, int, chance } from './rng.js';

const HEALTH = 100;
const BOT_DEFS = [
  { name: 'Warden', kind: 'rifle', route: [9, 8, 16], speed: 3.6 },
  { name: 'Bastion', kind: 'rifle', route: [14, 13, 17], speed: 3.6 },
  { name: 'Sentry', kind: 'smg', route: [4, 3, 5], speed: 4.0 },
  { name: 'Vigil', kind: 'shotgun', route: [10, 5, 15], speed: 3.4 },
];
const BOT_GUNS = {
  rifle: { damage: 34, headMul: 2.95, gap: 0.13, spread: 0.02 },
  smg: { damage: 22, headMul: 2.5, gap: 0.1, spread: 0.026 },
  shotgun: { damage: 12, headMul: 2.5, gap: 0.9, spread: 0.05, pellets: 9 },
};

export function createBots(scene, world, combat, random, onPlayerDamage, onDefused, sfx) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: colour('hairline'), roughness: 0.7, metalness: 0.15 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: colour('surface'), roughness: 0.85, metalness: 0.05 });
  const visorMaterial = new THREE.MeshStandardMaterial({ color: colour('accent'), roughness: 0.4, metalness: 0.2, emissive: colour('accent'), emissiveIntensity: 0.25 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.55, 0.22);
  const gunGeometry = new THREE.BoxGeometry(0.07, 0.09, 0.55);
  const visorGeometry = new THREE.BoxGeometry(0.3, 0.05, 0.05);

  const bots = [];
  const hitMeshes = [];
  const eye = new THREE.Vector3();
  const toPlayer = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const muzzle = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const pelletDir = new THREE.Vector3();
  const pelletSpread = new THREE.Vector3();
  const endPoint = new THREE.Vector3();

  // The player's body as the bots see it: two meshes that draw nothing but still
  // catch rays, moved onto the player every step by syncPlayerBody.
  const ghostMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.3), ghostMaterial);
  const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), ghostMaterial);
  playerTorso.userData.part = 'torso';
  playerHead.userData.part = 'head';
  scene.add(playerTorso, playerHead);
  const playerHitMeshes = [playerTorso, playerHead];
  // The bot's raycast list, built once: walls plus the player's body.
  const botTargets = world.shootables.concat(playerHitMeshes);

  for (let i = 0; i < BOT_DEFS.length; i += 1) {
    const def = BOT_DEFS[i];
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeometry, bodyMaterial.clone());
    torso.position.y = 1.0;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, darkMaterial);
    head.position.y = 1.53;
    head.userData.part = 'head';
    const visor = new THREE.Mesh(visorGeometry, visorMaterial);
    visor.position.set(0, 1.55, -0.14);
    const legL = new THREE.Mesh(legGeometry, darkMaterial);
    legL.position.set(-0.14, 0.28, 0);
    const legR = new THREE.Mesh(legGeometry, darkMaterial);
    legR.position.set(0.14, 0.28, 0);
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.18, 1.15, -0.3);
    group.add(torso, head, visor, legL, legR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh && mesh.material !== ghostMaterial) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      name: def.name, gun: BOT_GUNS[def.kind], kind: def.kind, speed: def.speed,
      mover: createMover(world.colliders, 0.34, 1.72),
      group, torso, head, legL, legR,
      health: HEALTH, alive: true, fall: 0, flash: 0,
      state: 'patrol', route: def.route, routePos: 0, path: [], pathPos: 0,
      holdUntil: 0, lastSeen: new THREE.Vector3(), lastSeenAt: -99, reactAt: 0,
      burstLeft: 0, pauseUntil: 0, shootAt: 0, strafeDir: 1, strafeAt: 0,
      yaw: 0, scanPhase: random() * 6, defuseT: 0, order: 'defend', walkPhase: 0,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
  }

  function reset(spawnPoints) {
    for (let i = 0; i < bots.length; i += 1) {
      const bot = bots[i];
      const [x, z] = spawnPoints[i % spawnPoints.length];
      bot.mover.reset(x, 0, z);
      bot.group.position.copy(bot.mover.position);
      bot.group.rotation.set(0, 0, 0);
      bot.health = HEALTH;
      bot.alive = true;
      bot.fall = 0;
      bot.flash = 0;
      bot.state = 'patrol';
      bot.routePos = i % bot.route.length;
      bot.path = [];
      bot.pathPos = 0;
      bot.holdUntil = 0;
      bot.lastSeenAt = -99;
      bot.reactAt = 0;
      bot.burstLeft = 0;
      bot.pauseUntil = 0;
      bot.shootAt = 0;
      bot.defuseT = 0;
      bot.order = 'defend';
      bot.yaw = Math.PI;
      bot.group.rotation.y = bot.yaw;
      bot.torso.material.emissiveIntensity = 0;
    }
  }

  function damage(mesh, amount) {
    const bot = mesh.userData.bot;
    if (!bot || !bot.alive) return false;
    bot.health -= amount;
    bot.flash = 0.09;
    bot.torso.material.emissive = colour('accent');
    bot.torso.material.emissiveIntensity = 0.7;
    if (bot.health > 0) {
      // A hit bot turns on the shooter at once.
      bot.lastSeenAt = -1;
      return false;
    }
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    return true;
  }

  function canSee(bot, playerPos, playerEyeY, now) {
    eye.set(bot.mover.position.x, bot.mover.position.y + 1.5, bot.mover.position.z);
    toPlayer.set(playerPos.x - eye.x, playerEyeY - eye.y, playerPos.z - eye.z);
    const dist = toPlayer.length();
    if (dist > 38) return 0;
    toPlayer.divideScalar(dist);
    forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (forward.dot(toPlayer) < 0.5 && dist > 6) return 0;
    dir.copy(toPlayer);
    const hit = combat.hitscan(eye, dir, world.shootables, dist);
    if (hit) return 0;
    return dist;
  }

  function steer(bot, tx, tz, dt, speed) {
    const dx = tx - bot.mover.position.x;
    const dz = tz - bot.mover.position.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    bot.mover.move(dt, dx / len, dz / len, speed, 30, 8, false);
    if (bot.state !== 'engage') bot.yaw = Math.atan2(-dx, -dz);
    return len < 0.6;
  }

  function followPath(bot, dt, now) {
    if (bot.pathPos >= bot.path.length) return true;
    const node = world.nodes[bot.path[bot.pathPos]];
    if (steer(bot, node[0], node[1], dt, bot.speed)) bot.pathPos += 1;
    return bot.pathPos >= bot.path.length;
  }

  function goTo(bot, nodeIdx) {
    const from = world.nearestNode(bot.mover.position.x, bot.mover.position.z);
    bot.path = world.findPath(from, nodeIdx);
    bot.pathPos = 0;
  }

  function shoot(bot, playerPos, playerEyeY, now) {
    if (now < bot.shootAt) return;
    if (bot.burstLeft <= 0) {
      if (now < bot.pauseUntil) return;
      bot.burstLeft = 3 + int(random, 0, 2);
      bot.pauseUntil = now + 0.55 + random() * 0.55;
    }
    bot.burstLeft -= 1;
    bot.shootAt = now + bot.gun.gap;
    // One quiet crack per trigger pull, louder the closer the bot is.
    if (sfx) sfx.distantShot(bot.mover.position.distanceTo(playerPos));
    muzzle.set(bot.mover.position.x, bot.mover.position.y + 1.35, bot.mover.position.z);
    muzzle.addScaledVector(forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw)), 0.5);
    // Aim at the chest, sometimes the head; spread grows with range and speed.
    const dist = bot.mover.position.distanceTo(playerPos);
    aim.set(playerPos.x, playerPos.y + (chance(random, 0.22) ? 1.5 : 1.05), playerPos.z);
    dir.copy(aim).sub(muzzle).normalize();
    const spread = bot.gun.spread + dist * 0.0006;
    dir.x += (random() * 2 - 1) * spread;
    dir.y += (random() * 2 - 1) * spread;
    dir.z += (random() * 2 - 1) * spread;
    dir.normalize();
    const pellets = bot.gun.pellets || 1;
    for (let p = 0; p < pellets; p += 1) {
      let d = dir;
      if (pellets > 1) {
        pelletSpread.set((random() * 2 - 1) * 0.03, (random() * 2 - 1) * 0.03, (random() * 2 - 1) * 0.03);
        d = pelletDir.copy(dir).add(pelletSpread).normalize();
      }
      const hit = combat.hitscan(muzzle, d, botTargets, 60);
      const end = hit ? hit.point : endPoint.copy(muzzle).addScaledVector(d, 40);
      combat.tracer(muzzle, end);
      if (hit && hit.object.userData.part) {
        const amount = combat.damageFor(bot.gun, hit.object.userData.part, hit.distance);
        onPlayerDamage(amount, bot.mover.position);
      }
    }
  }

  function step(dt, now, player, bombPlanted, bombPos) {
    const playerPos = player.position;
    const playerEyeY = playerPos.y + player.eye;
    for (const bot of bots) {
      if (!bot.alive) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
        continue;
      }
      if (bot.flash > 0) {
        bot.flash -= dt;
        if (bot.flash <= 0) bot.torso.material.emissiveIntensity = 0;
      }
      // Vision: a visible, living player is engaged after a short reaction.
      const dist = player.alive ? canSee(bot, playerPos, playerEyeY, now) : 0;
      if (dist > 0) {
        bot.lastSeen.set(playerPos.x, playerPos.y, playerPos.z);
        bot.lastSeenAt = now;
        if (bot.state !== 'engage' && now >= bot.reactAt) {
          bot.state = 'engage';
          bot.burstLeft = 0;
          bot.pauseUntil = now + 0.1;
        }
      }
      if (bot.state === 'engage' && !(bot.order === 'defuse' && bombPlanted && !player.alive)) {
        // Face the player, strafe across the sightline, fire in bursts.
        const dx = playerPos.x - bot.mover.position.x;
        const dz = playerPos.z - bot.mover.position.z;
        bot.yaw = Math.atan2(-dx, -dz);
        if (now > bot.strafeAt) {
          bot.strafeDir = chance(random, 0.5) ? 1 : -1;
          bot.strafeAt = now + 0.8 + random() * 0.7;
        }
        const px = -Math.cos(bot.yaw) * bot.strafeDir;
        const pz = Math.sin(bot.yaw) * bot.strafeDir;
        bot.mover.move(dt, px, pz, 2.2, 30, 8, false);
        if (dist > 0) shoot(bot, playerPos, playerEyeY, now);
        else if (now - bot.lastSeenAt > 3) {
          bot.state = 'chase';
          goTo(bot, world.nearestNode(bot.lastSeen.x, bot.lastSeen.z));
        }
      } else if (bot.order === 'defuse' && bombPlanted) {
        // Nearest bot runs to the bomb and channels the defuse.
        const d = bot.mover.position.distanceTo(bombPos);
        if (d > 2.5) {
          // Re-path only when the current path is spent, not every step.
          if (bot.pathPos >= bot.path.length) goTo(bot, world.nearestNode(bombPos.x, bombPos.z));
          if (followPath(bot, dt, now)) {
            // Walk the last metres straight at the bomb.
            steer(bot, bombPos.x, bombPos.z, dt, bot.speed);
          }
          bot.defuseT = 0;
        } else {
          bot.defuseT += dt;
          bot.yaw = Math.atan2(-(bombPos.x - bot.mover.position.x), -(bombPos.z - bot.mover.position.z));
          if (bot.defuseT >= 5) onDefused();
        }
      } else if (bot.state === 'chase') {
        if (followPath(bot, dt, now)) {
          bot.state = 'hold';
          bot.holdUntil = now + 3;
        }
      } else if (bot.state === 'hold') {
        bot.scanPhase += dt * 0.5;
        bot.yaw += Math.sin(bot.scanPhase) * 0.3 * dt;
        if (now >= bot.holdUntil) {
          bot.state = 'patrol';
          bot.path = [];
        }
      } else {
        // Patrol: walk the route, one node at a time.
        if (bot.pathPos >= bot.path.length) {
          bot.routePos = (bot.routePos + 1) % bot.route.length;
          goTo(bot, bot.route[bot.routePos]);
        }
        if (followPath(bot, dt, now)) {
          bot.state = 'hold';
          bot.holdUntil = now + 2 + random() * 2;
        }
      }
      // Keep the mesh on the body; legs swing with the walk.
      bot.group.position.copy(bot.mover.position);
      bot.group.rotation.y = bot.yaw;
      bot.group.rotation.x = 0;
      bot.walkPhase += dt * bot.mover.groundSpeed() * 2.2;
      const swing = Math.sin(bot.walkPhase) * 0.45 * Math.min(1, bot.mover.groundSpeed() / 3);
      bot.legL.rotation.x = swing;
      bot.legR.rotation.x = -swing;
    }
  }

  function hear(x, z, radius, now) {
    for (const bot of bots) {
      if (!bot.alive || bot.state === 'engage' || bot.order === 'defuse') continue;
      const dx = bot.mover.position.x - x;
      const dz = bot.mover.position.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      bot.state = 'chase';
      bot.lastSeen.set(x, 0, z);
      bot.lastSeenAt = now;
      goTo(bot, world.nearestNode(x, z));
    }
  }

  return {
    bots,
    hitMeshes,
    playerHitMeshes,
    reset,
    damage,
    step,
    hear,
    aliveCount() {
      return bots.filter((b) => b.alive).length;
    },
    // 0..1 progress of the bot currently channelling a defuse, for the HUD.
    defuseProgress() {
      let best = 0;
      for (const b of bots) if (b.alive && b.defuseT > best) best = b.defuseT;
      return Math.min(1, best / 5);
    },
    aimPoint(index) {
      const bot = bots[index % bots.length];
      return new THREE.Vector3(bot.mover.position.x, bot.mover.position.y + 1.0, bot.mover.position.z);
    },
    syncPlayerBody(player) {
      const crouch = player.crouching;
      playerTorso.position.set(player.position.x, player.position.y + (crouch ? 0.62 : 1.0), player.position.z);
      playerHead.position.set(player.position.x, player.position.y + (crouch ? 0.95 : 1.5), player.position.z);
    },
  };
}
