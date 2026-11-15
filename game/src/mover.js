// A body that moves: acceleration, friction, gravity and jump, resolved as a box
// against the world's colliders one axis at a time, so a wall never swallows it.
// The player and every bot share this one mover; input and AI only feed it a wish.
import * as THREE from 'three';

const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createMover(colliders, radius, standHeight) {
  const position = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();
  let height = standHeight;
  let onGround = true;

  // lift keeps the feet and the crown out of the horizontal tests, so standing on
  // the floor is not read as walking into a wall. testHeight lets a caller ask
  // whether a different height fits — the crouch-stand check uses it.
  function overlaps(x, y, z, lift, testHeight = height) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + testHeight - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function move(dt, wishX, wishZ, speed, accel, friction, jump) {
    wish.set(wishX, 0, wishZ);
    if (wish.lengthSq() > 1) wish.normalize();
    const blend = Math.min(1, accel * dt / Math.max(speed, 0.01));
    velocity.x += (wish.x * speed - velocity.x) * blend;
    velocity.z += (wish.z * speed - velocity.z) * blend;
    if (onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - friction * dt);
      velocity.x *= damp;
      velocity.z *= damp;
    }
    if (jump && onGround) {
      velocity.y = JUMP_SPEED;
      onGround = false;
    }
    velocity.y -= GRAVITY * dt;

    const nextX = position.x + velocity.x * dt;
    if (!overlaps(nextX, position.y, position.z, 0.04)) position.x = nextX;
    else velocity.x = 0;
    const nextZ = position.z + velocity.z * dt;
    if (!overlaps(position.x, position.y, nextZ, 0.04)) position.z = nextZ;
    else velocity.z = 0;

    position.y += velocity.y * dt;
    onGround = false;
    const hit = overlaps(position.x, position.y, position.z, 0);
    if (hit && velocity.y <= 0) {
      position.y = hit.max.y;
      velocity.y = 0;
      onGround = true;
    } else if (hit) {
      position.y = hit.min.y - height;
      velocity.y = 0;
    }
    if (position.y < 0) {
      position.y = 0;
      velocity.y = 0;
      onGround = true;
    }
    velocity.y = Math.max(-30, velocity.y);
  }

  return {
    position,
    velocity,
    get onGround() {
      return onGround;
    },
    get height() {
      return height;
    },
    setHeight(value) {
      height = value;
    },
    move,
    reset(x, y, z) {
      position.set(x, y, z);
      velocity.set(0, 0, 0);
      onGround = true;
    },
    blockedAt(x, y, z, lift, testHeight) {
      return overlaps(x, y, z, lift, testHeight);
    },
    groundSpeed() {
      return Math.hypot(velocity.x, velocity.z);
    },
  };
}
