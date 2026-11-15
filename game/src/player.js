// The player: one body that moves, crouches, jumps and takes damage. Movement physics
// lives in mover.js; this file only turns keys into a wish, tracks the eye and the
// health, and knows the spawn. A weapon slows the player down through speedMod.
import { createMover } from './mover.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;

export function createPlayer(colliders) {
  const mover = createMover(colliders, RADIUS, STAND_HEIGHT);
  const player = {
    position: mover.position,
    velocity: mover.velocity,
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    crouching: false,
    health: 100,
    alive: true,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    player.yaw -= dx * sensitivity;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    player.pitch = Math.min(1.45, player.pitch + pitchKick);
    player.yaw += yawKick;
  }

  function step(dt, keys, speedMod) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !player.crouching) {
      player.crouching = true;
      mover.setHeight(CROUCH_HEIGHT);
    } else if (!crouching && player.crouching) {
      // Only stand up when the standing crown is clear, not just the crouched one.
      if (!mover.blockedAt(player.position.x, player.position.y, player.position.z, 0.02, STAND_HEIGHT)) {
        player.crouching = false;
        mover.setHeight(STAND_HEIGHT);
      }
    }
    const eyeTarget = player.crouching ? CROUCH_EYE : STAND_EYE;
    player.eye += (eyeTarget - player.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const wishX = -sin * forward + cos * strafe;
    const wishZ = -cos * forward - sin * strafe;
    const speed = player.crouching ? CROUCH_SPEED : WALK_SPEED * speedMod;
    const accel = mover.onGround ? GROUND_ACCEL : AIR_ACCEL;
    mover.move(dt, wishX, wishZ, speed, accel, FRICTION, keys.has('Space'));
  }

  function damage(amount) {
    if (!player.alive) return false;
    player.health = Math.max(0, player.health - amount);
    if (player.health <= 0) {
      player.alive = false;
      return true;
    }
    return false;
  }

  function reset(spawn) {
    mover.setHeight(STAND_HEIGHT);
    mover.reset(spawn.x, 0, spawn.z);
    player.yaw = spawn.yaw;
    player.pitch = 0;
    player.eye = STAND_EYE;
    player.crouching = false;
    player.health = 100;
    player.alive = true;
  }

  return {
    state: player,
    step,
    look,
    recoil,
    damage,
    reset,
    groundSpeed() {
      return mover.groundSpeed();
    },
  };
}
