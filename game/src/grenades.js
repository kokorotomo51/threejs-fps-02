// The HE Spark: a thrown grenade that bounces off the map on a fuse, then bursts.
// Projectiles fly in small substeps so a fast throw never tunnels through a wall;
// the blast is a pooled sphere and light, and the damage itself is decided by the
// caller through onExplode, so this file never needs to know who is standing where.
import * as THREE from 'three';
import { colour } from './palette.js';

const GRAVITY = 12;
const FUSE = 1.6;
const RADIUS = 0.09;

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

export function createGrenades(scene, colliders, onExplode) {
  const probe = new THREE.Box3();
  const projectiles = [];
  const blast = createBlastFx(scene);
  const ballGeometry = new THREE.SphereGeometry(RADIUS, 10, 8);
  const ballMaterial = new THREE.MeshStandardMaterial({ color: colour('accent'), roughness: 0.4, metalness: 0.3 });

  function overlaps(x, y, z) {
    probe.min.set(x - RADIUS, y - RADIUS, z - RADIUS);
    probe.max.set(x + RADIUS, y + RADIUS, z + RADIUS);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return true;
    return false;
  }

  return {
    throwFrom(origin, dir, inherit) {
      // At most four live grenades: a throw is an event, but nothing may grow
      // the projectile list without bound.
      if (projectiles.length >= 4) return;
      const mesh = new THREE.Mesh(ballGeometry, ballMaterial);
      mesh.castShadow = true;
      scene.add(mesh);
      projectiles.push({
        mesh,
        pos: origin.clone(),
        vel: new THREE.Vector3(
          dir.x * 16 + (inherit ? inherit.x * 0.5 : 0),
          dir.y * 16 + 4.5 + (inherit ? inherit.y * 0.5 : 0),
          dir.z * 16 + (inherit ? inherit.z * 0.5 : 0),
        ),
        fuse: FUSE,
        alive: true,
      });
    },
    step(dt) {
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
          blast.burst(p.pos, 1);
          onExplode(p.pos);
          scene.remove(p.mesh);
          projectiles.splice(i, 1);
        }
      }
      blast.step(dt);
    },
    reset() {
      for (const p of projectiles) scene.remove(p.mesh);
      projectiles.length = 0;
      blast.reset();
    },
  };
}
