// Utility: one thrown object, three kinds. The HE Spark bursts on a fuse and
// hurts through the caller's onExplode; Smoke Veil blooms into a 3.5 m cloud
// that lives 14 s and blocks sight but never bullets; Flash Pop blinds anyone
// looking at it through the caller's onFlash. Projectiles fly in small
// substeps so a fast throw never tunnels through a wall; smoke clouds are
// pooled, three at most, and every position comes from the seeded stream, so a
// ?shot= scene with a fixed seed plays out the same way every time.
import * as THREE from 'three';
import { colour } from './palette.js';
import { mulberry32 } from './rng.js';

const GRAVITY = 12;
const FUSE = { he: 1.6, smoke: 0.9, flash: 1.5 };
const RADIUS = 0.09;
const SMOKE_RADIUS = 3.5;
const SMOKE_LIFE = 14;
const SMOKE_SLOTS = 3;
const SMOKE_PUFFS = 5;

// One pooled explosion effect, shared by grenades and the bomb: an expanding
// additive sphere and a point light that both fade out in half a second.
export function createBlastFx(scene, count = 2) {
  const fx = [];
  const blastGeometry = new THREE.SphereGeometry(1, 20, 14);
  for (let i = 0; i < count; i += 1) {
    const mesh = new THREE.Mesh(blastGeometry, new THREE.MeshBasicMaterial({
      color: colour('accent'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    mesh.visible = false;
    const light = new THREE.PointLight(colour('accent'), 0, 18);
    scene.add(mesh, light);
    fx.push({ mesh, light, t: 0, power: 1, active: false });
  }
  return {
    burst(center, power = 1) {
      const slot = fx.find((f) => !f.active) || fx[0];
      slot.active = true;
      slot.t = 0;
      slot.power = power;
      slot.mesh.position.copy(center);
      slot.mesh.visible = true;
      slot.light.position.copy(center);
    },
    step(dt) {
      for (const f of fx) {
        if (!f.active) continue;
        f.t += dt;
        const k = Math.min(1, f.t / 0.55);
        f.mesh.scale.setScalar(0.5 + k * 7 * f.power);
        f.mesh.material.opacity = 0.85 * (1 - k);
        f.light.intensity = 60 * f.power * (1 - k);
        if (k >= 1) {
          f.active = false;
          f.mesh.visible = false;
          f.light.intensity = 0;
        }
      }
    },
    reset() {
      for (const f of fx) {
        f.active = false;
        f.mesh.visible = false;
        f.light.intensity = 0;
      }
    },
  };
}

const KIND_COLORS = { he: 'accent', smoke: 'muted', flash: 'ink' };

export function createGrenades(scene, colliders, onExplode, onFlash) {
  const probe = new THREE.Box3();
  const projectiles = [];
  const blast = createBlastFx(scene);
  const ballGeometry = new THREE.SphereGeometry(RADIUS, 10, 8);
  const ballMaterials = {};
  for (const kind of Object.keys(KIND_COLORS)) {
    ballMaterials[kind] = new THREE.MeshStandardMaterial({ color: colour(KIND_COLORS[kind]), roughness: 0.4, metalness: 0.3 });
  }
  // Smoke clouds: three pooled slots of five soft spheres each.
  const puffGeometry = new THREE.SphereGeometry(1, 12, 9);
  const clouds = [];
  for (let i = 0; i < SMOKE_SLOTS; i += 1) {
    const material = new THREE.MeshBasicMaterial({ color: 0x9aa0a4, transparent: true, opacity: 0, depthWrite: false });
    const puffs = [];
    const jitter = mulberry32(1000 + i * 17);
    for (let j = 0; j < SMOKE_PUFFS; j += 1) {
      const mesh = new THREE.Mesh(puffGeometry, material);
      mesh.visible = false;
      scene.add(mesh);
      puffs.push({ mesh, dx: (jitter() - 0.5) * 3.4, dy: jitter() * 1.6 + 0.3, dz: (jitter() - 0.5) * 3.4, s: 1.4 + jitter() * 1.1 });
    }
    clouds.push({ puffs, material, active: false, center: new THREE.Vector3(), born: 0, until: 0 });
  }
  const closest = new THREE.Vector3();

  function overlaps(x, y, z) {
    probe.min.set(x - RADIUS, y - RADIUS, z - RADIUS);
    probe.max.set(x + RADIUS, y + RADIUS, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  function spawnSmoke(pos, now) {
    const slot = clouds.find((c) => !c.active) || clouds[0];
    slot.active = true;
    slot.center.copy(pos);
    slot.center.y = Math.max(0.9, pos.y);
    slot.born = now;
    slot.until = now + SMOKE_LIFE;
    for (const p of slot.puffs) p.mesh.visible = true;
  }

  return {
    throwFrom(origin, dir, inherit, kind = 'he') {
      // At most four live grenades: a throw is an event, but nothing may grow
      // the projectile list without bound.
      if (projectiles.length >= 4) return;
      const mesh = new THREE.Mesh(ballGeometry, ballMaterials[kind] || ballMaterials.he);
      mesh.castShadow = true;
      scene.add(mesh);
      projectiles.push({
        mesh,
        kind,
        pos: origin.clone(),
        vel: new THREE.Vector3(
          dir.x * 16 + (inherit ? inherit.x * 0.5 : 0),
          dir.y * 16 + 4.5 + (inherit ? inherit.y * 0.5 : 0),
          dir.z * 16 + (inherit ? inherit.z * 0.5 : 0),
        ),
        fuse: FUSE[kind] || FUSE.he,
        alive: true,
      });
    },
    // Staging hook for ?shot= captures: a smoke cloud without throwing one.
    spawnSmoke,
    // True when the segment from a to b crosses any live smoke cloud. Bots
    // ask this before trusting a sightline; bullets never ask it.
    blockedBySmoke(a, b, now) {
      for (const c of clouds) {
        if (!c.active || now > c.until) continue;
        const r = SMOKE_RADIUS * Math.min(1, (now - c.born) / 0.7);
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const lenSq = abx * abx + aby * aby + abz * abz || 1;
        const t = Math.max(0, Math.min(1, ((c.center.x - a.x) * abx + (c.center.y - a.y) * aby + (c.center.z - a.z) * abz) / lenSq));
        closest.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
        if (closest.distanceTo(c.center) < r) return true;
      }
      return false;
    },
    // True when the camera stands inside a live cloud, and how dense it is.
    smokeAt(pos, now) {
      let best = 0;
      for (const c of clouds) {
        if (!c.active || now > c.until) continue;
        const r = SMOKE_RADIUS * Math.min(1, (now - c.born) / 0.7);
        const d = pos.distanceTo(c.center);
        if (d < r) best = Math.max(best, 1 - d / r);
      }
      return best;
    },
    step(dt, now) {
      for (let i = projectiles.length - 1; i >= 0; i -= 1) {
        const p = projectiles[i];
        p.fuse -= dt;
        p.vel.y -= GRAVITY * dt;
        // Three substeps: a fast throw must not tunnel through a wall.
        for (let s = 0; s < 3; s += 1) {
          const stepDt = dt / 3;
          const nx = p.pos.x + p.vel.x * stepDt;
          if (!overlaps(nx, p.pos.y, p.pos.z)) p.pos.x = nx;
          else p.vel.x *= -0.45;
          const ny = p.pos.y + p.vel.y * stepDt;
          if (!overlaps(p.pos.x, ny, p.pos.z)) p.pos.y = ny;
          else p.vel.y *= -0.45;
          const nz = p.pos.z + p.vel.z * stepDt;
          if (!overlaps(p.pos.x, p.pos.y, nz)) p.pos.z = nz;
          else p.vel.z *= -0.45;
        }
        p.vel.multiplyScalar(Math.max(0, 1 - 0.12 * dt));
        if (p.pos.y < RADIUS) {
          p.pos.y = RADIUS;
          p.vel.y = Math.abs(p.vel.y) * 0.45;
        }
        p.mesh.position.copy(p.pos);
        if (p.fuse <= 0) {
          if (p.kind === 'smoke') spawnSmoke(p.pos, now);
          else if (p.kind === 'flash') {
            blast.burst(p.pos, 0.35);
            if (onFlash) onFlash(p.pos);
          } else {
            blast.burst(p.pos, 1);
            onExplode(p.pos);
          }
          scene.remove(p.mesh);
          projectiles.splice(i, 1);
        }
      }
      for (const c of clouds) {
        if (!c.active) continue;
        if (now > c.until) {
          c.active = false;
          for (const p of c.puffs) p.mesh.visible = false;
          continue;
        }
        const age = now - c.born;
        const grow = Math.min(1, age / 0.7);
        const fade = Math.min(1, (c.until - now) / 2);
        c.material.opacity = 0.38 * grow * fade;
        for (const p of c.puffs) {
          p.mesh.position.set(c.center.x + p.dx * grow, c.center.y + p.dy * grow, c.center.z + p.dz * grow);
          p.mesh.scale.setScalar(p.s * (0.5 + grow));
        }
      }
      blast.step(dt);
    },
    reset() {
      for (const p of projectiles) scene.remove(p.mesh);
      projectiles.length = 0;
      for (const c of clouds) {
        c.active = false;
        for (const p of c.puffs) p.mesh.visible = false;
      }
      blast.reset();
    },
  };
}
