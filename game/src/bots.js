// The Sentinels: four bots that hold Deadlock Yard as a squad, not four
// strangers. Each one has a role — Warden anchors Foundry, Bastion anchors
// Silo, Sentry rotates between the sites, Vigil roams mid — and the squad
// shares one blackboard: a seen player is reported after a short radio delay,
// a heard shot is only an approximate position, and a planted bomb sends the
// nearest bot to defuse while the next one covers him. Vision runs on a
// staggered 10 Hz tick per bot (movement and firing stay on the 60 Hz sim),
// smoke blocks sight but not bullets, and a flash blinds a bot that was
// looking at it. One mover per bot, one raycaster shared through combat, no
// per-frame allocation.
import * as THREE from 'three';
import { colour } from './palette.js';
import { createMover } from './mover.js';
import { range, int, chance } from './rng.js';

const HEALTH = 100;
const BOT_DEFS = [
  { name: 'Warden', kind: 'rifle', role: 'anchorA', route: [9, 8, 16], speed: 3.6, react: 0.35 },
  { name: 'Bastion', kind: 'rifle', role: 'anchorB', route: [14, 13, 17], speed: 3.6, react: 0.4 },
  { name: 'Sentry', kind: 'smg', role: 'rotator', route: [4, 3, 5], speed: 4.0, react: 0.3 },
  { name: 'Vigil', kind: 'shotgun', role: 'roamer', route: [10, 5, 15], speed: 3.4, react: 0.45 },
];
const BOT_GUNS = {
  rifle: { damage: 34, headMul: 2.95, gap: 0.13, spread: 0.02 },
  smg: { damage: 22, headMul: 2.5, gap: 0.1, spread: 0.026 },
  shotgun: { damage: 12, headMul: 2.5, gap: 0.9, spread: 0.05, pellets: 9 },
};
// Site centres, for the anchors' rule: an anchor only leaves his site for a
// sighting close to it; the rotator and the roamer chase any shared sighting.
const SITE_CENTERS = { anchorA: [-16, -9], anchorB: [16, -9] };

export function createBots(scene, world, combat, random, onPlayerDamage, onDefused, sfx, smokeBlocks) {
  const uniformMaterial = new THREE.MeshStandardMaterial({ color: colour('uniform'), roughness: 0.8, metalness: 0.05 });
  const vestMaterial = new THREE.MeshStandardMaterial({ color: colour('vest'), roughness: 0.85, metalness: 0.05 });
  const darkMaterial = new THREE.MeshStandardMaterial({ color: colour('surface'), roughness: 0.85, metalness: 0.05 });
  const visorMaterial = new THREE.MeshStandardMaterial({ color: colour('accent'), roughness: 0.4, metalness: 0.2, emissive: colour('accent'), emissiveIntensity: 0.25 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.62, 0.3);
  const vestGeometry = new THREE.BoxGeometry(0.56, 0.42, 0.34);
  const pelvisGeometry = new THREE.BoxGeometry(0.44, 0.22, 0.28);
  const headGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  const brimGeometry = new THREE.CylinderGeometry(0.19, 0.21, 0.05, 14);
  const legGeometry = new THREE.BoxGeometry(0.19, 0.55, 0.22);
  const kneeGeometry = new THREE.BoxGeometry(0.2, 0.12, 0.06);
  const armGeometry = new THREE.BoxGeometry(0.13, 0.5, 0.15);
  const forearmGeometry = new THREE.BoxGeometry(0.11, 0.42, 0.13);
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
  const targetPos = new THREE.Vector3();

  // The squad blackboard: the last reported enemy position, when it was
  // reported, and how much to trust it (1 = seen, 0.5 = heard).
  const squad = { x: 0, z: 0, at: -99, conf: 0 };

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
    // Upper body in its own group, so the torso can turn toward an aim target
    // while the legs keep walking their own way.
    const upper = new THREE.Group();
    upper.position.y = 0.82;
    const pelvis = new THREE.Mesh(pelvisGeometry, vestMaterial);
    pelvis.position.y = 0.72;
    const torso = new THREE.Mesh(torsoGeometry, uniformMaterial.clone());
    torso.position.y = 1.08;
    torso.userData.part = 'torso';
    const vest = new THREE.Mesh(vestGeometry, vestMaterial);
    vest.position.y = 1.06;
    const head = new THREE.Mesh(headGeometry, darkMaterial);
    head.position.y = 1.56;
    head.userData.part = 'head';
    const brim = new THREE.Mesh(brimGeometry, vestMaterial);
    brim.position.y = 1.64;
    const visor = new THREE.Mesh(visorGeometry, visorMaterial);
    visor.position.set(0, 1.58, -0.14);
    const armL = new THREE.Group();
    armL.position.set(-0.32, 1.32, 0);
    const armLMesh = new THREE.Mesh(armGeometry, uniformMaterial);
    armLMesh.position.y = -0.25;
    const armLFore = new THREE.Mesh(forearmGeometry, vestMaterial);
    armLFore.position.y = -0.62;
    armL.add(armLMesh, armLFore);
    const armR = new THREE.Group();
    armR.position.set(0.32, 1.32, 0);
    const armRMesh = new THREE.Mesh(armGeometry, uniformMaterial);
    armRMesh.position.y = -0.25;
    const armRFore = new THREE.Mesh(forearmGeometry, vestMaterial);
    armRFore.position.y = -0.62;
    armR.add(armRMesh, armRFore);
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.18, 1.15, -0.3);
    upper.add(torso, vest, head, brim, visor, armL, armR);
    const legL = new THREE.Mesh(legGeometry, uniformMaterial);
    legL.position.set(-0.14, 0.28, 0);
    const kneeL = new THREE.Mesh(kneeGeometry, vestMaterial);
    kneeL.position.set(-0.14, 0.32, -0.12);
    const legR = new THREE.Mesh(legGeometry, uniformMaterial);
    legR.position.set(0.14, 0.28, 0);
    const kneeR = new THREE.Mesh(kneeGeometry, vestMaterial);
    kneeR.position.set(0.14, 0.32, -0.12);
    group.add(pelvis, upper, legL, kneeL, legR, kneeR, gun);
    group.traverse((mesh) => {
      if (mesh.isMesh && mesh.material !== ghostMaterial) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      name: def.name, gun: BOT_GUNS[def.kind], kind: def.kind, role: def.role, speed: def.speed, react: def.react,
      mover: createMover(world.colliders, 0.34, 1.72),
      group, upper, torso, head, legL, legR, armL, armR,
      health: HEALTH, alive: true, fall: 0, flash: 0,
      state: 'patrol', route: def.route, routePos: 0, path: [], pathPos: 0,
      holdUntil: 0, lastSeen: new THREE.Vector3(), lastSeenAt: -99, reactAt: 0,
      burstLeft: 0, pauseUntil: 0, shootAt: 0, strafeDir: 1, strafeAt: 0,
      yaw: 0, scanPhase: random() * 6, defuseT: 0, order: 'defend', walkPhase: 0,
      nextPerceive: random() * 0.1, seenDist: 0, blindUntil: 0, coverNode: -1, aimYaw: 0,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    bots.push(bot);
  }

  function reset(spawnPoints) {
    squad.at = -99;
    squad.conf = 0;
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
      bot.nextPerceive = 0;
      bot.seenDist = 0;
      bot.blindUntil = 0;
      bot.coverNode = -1;
      bot.aimYaw = bot.yaw;
      bot.upper.rotation.y = 0;
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
      // A hit bot turns on the shooter at once, no reaction delay.
      bot.state = 'engage';
      bot.reactAt = 0;
      bot.lastSeenAt = -1;
      return false;
    }
    bot.alive = false;
    bot.fall = 0;
    bot.state = 'dead';
    return true;
  }

  // A flash grenade blinds a bot that could see it: closer and facing it
  // means longer blind; a wall between saves him entirely.
  function flash(pos, now) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      eye.set(bot.mover.position.x, bot.mover.position.y + 1.5, bot.mover.position.z);
      dir.copy(pos).sub(eye);
      const dist = dir.length();
      if (dist > 22) continue;
      dir.divideScalar(dist || 1);
      if (combat.hitscan(eye, dir, world.shootables, dist)) continue;
      forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      const facing = forward.dot(dir) > 0 ? 1 : 0.45;
      bot.blindUntil = Math.max(bot.blindUntil, now + Math.max(0.4, 2.2 - dist * 0.07) * facing);
    }
  }

  function canSee(bot, playerPos, playerEyeY) {
    eye.set(bot.mover.position.x, bot.mover.position.y + 1.5, bot.mover.position.z);
    toPlayer.set(playerPos.x - eye.x, playerEyeY - eye.y, playerPos.z - eye.z);
    const dist = toPlayer.length();
    if (dist > 38) return 0;
    toPlayer.divideScalar(dist);
    forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    if (forward.dot(toPlayer) < 0.5 && dist > 6) return 0;
    dir.copy(toPlayer);
    if (combat.hitscan(eye, dir, world.shootables, dist)) return 0;
    // Smoke blocks sight, never bullets: a ray through the cloud sees nothing.
    if (smokeBlocks) {
      targetPos.set(playerPos.x, playerEyeY, playerPos.z);
      if (smokeBlocks(eye, targetPos)) return 0;
    }
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

  function followPath(bot, dt) {
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
    for (let bi = 0; bi < bots.length; bi += 1) {
      const bot = bots[bi];
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
      const blinded = now < bot.blindUntil;
      if (blinded && bot.state === 'engage') {
        bot.state = 'hold';
        bot.holdUntil = now + 1.5;
      }
      // Vision on a staggered 10 Hz tick: one raycast per bot per tick, not
      // one per simulation step. The cached distance drives this step.
      if (!blinded && player.alive && now >= bot.nextPerceive) {
        bot.nextPerceive = now + 0.09 + bi * 0.02;
        bot.seenDist = canSee(bot, playerPos, playerEyeY);
      } else if (!player.alive) {
        bot.seenDist = 0;
      }
      const dist = blinded ? 0 : bot.seenDist;
      if (dist > 0) {
        bot.lastSeen.set(playerPos.x, playerPos.y, playerPos.z);
        bot.lastSeenAt = now;
        // Report to the squad after the radio delay, not instantly.
        if (now - squad.at > 0.35) {
          squad.x = playerPos.x;
          squad.z = playerPos.z;
          squad.at = now;
          squad.conf = 1;
        }
        if (bot.state !== 'engage') {
          if (bot.reactAt === 0) bot.reactAt = now + bot.react;
          if (now >= bot.reactAt) {
            bot.state = 'engage';
            bot.burstLeft = 0;
            bot.pauseUntil = now + 0.1;
          }
        }
      }
      if (bot.state === 'engage' && !(bot.order === 'defuse' && bombPlanted && !player.alive)) {
        // Face the player, strafe across the sightline, fire in bursts.
        const dx = playerPos.x - bot.mover.position.x;
        const dz = playerPos.z - bot.mover.position.z;
        bot.yaw = Math.atan2(-dx, -dz);
        bot.aimYaw = bot.yaw;
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
          bot.reactAt = 0;
          goTo(bot, world.nearestNode(bot.lastSeen.x, bot.lastSeen.z));
        }
      } else if (bot.order === 'defuse' && bombPlanted) {
        // Nearest bot runs to the bomb and channels the defuse.
        const d = bot.mover.position.distanceTo(bombPos);
        if (d > 2.5) {
          // Re-path only when the current path is spent, not every step.
          if (bot.pathPos >= bot.path.length) goTo(bot, world.nearestNode(bombPos.x, bombPos.z));
          if (followPath(bot, dt)) {
            // Walk the last metres straight at the bomb.
            steer(bot, bombPos.x, bombPos.z, dt, bot.speed);
          }
          bot.defuseT = 0;
        } else {
          bot.defuseT += dt;
          bot.yaw = Math.atan2(-(bombPos.x - bot.mover.position.x), -(bombPos.z - bot.mover.position.z));
          if (bot.defuseT >= 5) onDefused();
        }
      } else if (bot.order === 'cover' && bombPlanted) {
        // Second bot holds a covered angle on the site while his mate defuses.
        if (bot.coverNode < 0) {
          let best = -1;
          let bestD = Infinity;
          for (let i = 0; i < world.nodes.length; i += 1) {
            const n = world.nodes[i];
            const dSite = Math.hypot(n[0] - bombPos.x, n[1] - bombPos.z);
            if (dSite < 6 || dSite > 14) continue;
            const dBot = Math.hypot(n[0] - bot.mover.position.x, n[1] - bot.mover.position.z);
            if (dBot < bestD) {
              bestD = dBot;
              best = i;
            }
          }
          bot.coverNode = best < 0 ? world.nearestNode(bombPos.x, bombPos.z) : best;
          goTo(bot, bot.coverNode);
        }
        if (followPath(bot, dt)) {
          bot.state = 'hold';
          bot.holdUntil = now + 30;
        }
      } else if (bot.state === 'chase') {
        if (followPath(bot, dt)) {
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
        // Patrol: walk the route, one node at a time. A fresh shared sighting
        // pulls the rotator and the roamer off their route; an anchor only
        // leaves his site for a sighting close to it.
        if (now - squad.at < 6 && squad.conf > 0.7 && bot.state === 'patrol') {
          const site = SITE_CENTERS[bot.role];
          const nearSite = site ? Math.hypot(squad.x - site[0], squad.z - site[1]) < 12 : true;
          if (nearSite) {
            bot.state = 'chase';
            bot.reactAt = 0;
            goTo(bot, world.nearestNode(squad.x, squad.z));
          }
        }
        if (bot.state === 'patrol') {
          if (bot.pathPos >= bot.path.length) {
            bot.routePos = (bot.routePos + 1) % bot.route.length;
            goTo(bot, bot.route[bot.routePos]);
          }
          if (followPath(bot, dt)) {
            bot.state = 'hold';
            bot.holdUntil = now + 2 + random() * 2;
          }
        }
      }
      // Keep the mesh on the body; legs and arms swing with the walk, the
      // upper body turns toward the aim while the legs walk their own way.
      bot.group.position.copy(bot.mover.position);
      bot.group.rotation.y = bot.yaw;
      bot.group.rotation.x = 0;
      let aimOff = bot.aimYaw - bot.yaw;
      while (aimOff > Math.PI) aimOff -= Math.PI * 2;
      while (aimOff < -Math.PI) aimOff += Math.PI * 2;
      bot.upper.rotation.y += (Math.max(-0.6, Math.min(0.6, aimOff)) - bot.upper.rotation.y) * Math.min(1, dt * 8);
      bot.walkPhase += dt * bot.mover.groundSpeed() * 2.2;
      const swing = Math.sin(bot.walkPhase) * 0.45 * Math.min(1, bot.mover.groundSpeed() / 3);
      bot.legL.rotation.x = swing;
      bot.legR.rotation.x = -swing;
      if (bot.state === 'engage') {
        bot.armR.rotation.x = -1.35;
        bot.armL.rotation.x = -0.9;
      } else {
        bot.armL.rotation.x = -swing * 0.7;
        bot.armR.rotation.x = swing * 0.7;
      }
    }
  }

  function hear(x, z, radius, now) {
    for (const bot of bots) {
      if (!bot.alive || bot.state === 'engage' || bot.order === 'defuse') continue;
      const dx = bot.mover.position.x - x;
      const dz = bot.mover.position.z - z;
      if (dx * dx + dz * dz > radius * radius) continue;
      // Hearing is approximate: the squad gets a position a few metres off.
      const jx = x + (random() * 2 - 1) * 3;
      const jz = z + (random() * 2 - 1) * 3;
      bot.state = 'chase';
      bot.lastSeen.set(jx, 0, jz);
      bot.lastSeenAt = now;
      if (now - squad.at > 0.35) {
        squad.x = jx;
        squad.z = jz;
        squad.at = now;
        squad.conf = 0.5;
      }
      goTo(bot, world.nearestNode(jx, jz));
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
    flash,
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
    // On a plant the retake is a pair: the nearest bot defuses, the next one
    // covers the site from a held angle. Called once, by the planter.
    assignRetake(bombPos) {
      const alive = bots.filter((b) => b.alive);
      alive.sort((a, b) => a.mover.position.distanceTo(bombPos) - b.mover.position.distanceTo(bombPos));
      if (alive[0]) alive[0].order = 'defuse';
      if (alive[1]) {
        alive[1].order = 'cover';
        alive[1].coverNode = -1;
      }
    },
    syncPlayerBody(player) {
      const crouch = player.crouching;
      playerTorso.position.set(player.position.x, player.position.y + (crouch ? 0.62 : 1.0), player.position.z);
      playerHead.position.set(player.position.x, player.position.y + (crouch ? 0.95 : 1.5), player.position.z);
    },
  };
}
