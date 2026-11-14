// First-person movement: acceleration, friction, gravity, crouch and jump,
// resolved as a standing box against the world's colliders one axis at a time,
// so a wall never swallows the player and a floor never reads as a wall.
// Scratch vectors live on the module, never allocated per step.
import * as THREE from 'three';

const RADIUS = 0.34;
const HEIGHT_STAND = 1.72;
const HEIGHT_CROUCH = 1.12;
const EYE_STAND = 1.6;
const EYE_CROUCH = 1.02;
const SPEED_WALK = 5.2;
const SPEED_CROUCH = 2.4;
const ACCEL_GROUND = 42;
const ACCEL_AIR = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP = 6.2;

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 12.6),
    velocity: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    eye: EYE_STAND,
    height: HEIGHT_STAND,
    onGround: true,
    crouching: false,
    moving: false,
  };
  const probe = new THREE.Box3();
  const wish = new THREE.Vector3();

  function hits(x, y, z, height, lift) {
    probe.min.set(x - RADIUS, y + lift, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return colliders[i];
    }
    return null;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function teleport(x, z, yaw) {
    state.position.set(x, 0, z);
    state.velocity.set(0, 0, 0);
    if (yaw !== undefined) state.yaw = yaw;
    state.pitch = 0;
  }

  function step(dt, keys) {
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch && !state.crouching) {
      state.crouching = true;
      state.height = HEIGHT_CROUCH;
    } else if (!wantCrouch && state.crouching && !hits(state.position.x, state.position.y, state.position.z, HEIGHT_STAND, 0.02)) {
      state.crouching = false;
      state.height = HEIGHT_STAND;
    }
    const eyeTarget = state.crouching ? EYE_CROUCH : EYE_STAND;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const fwd = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const str = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (fwd || str) {
      const s = Math.sin(state.yaw);
      const c = Math.cos(state.yaw);
      wish.set(-s * fwd + c * str, 0, -c * fwd - s * str).normalize();
    }
    state.moving = fwd !== 0 || str !== 0;

    const speed = state.crouching ? SPEED_CROUCH : SPEED_WALK;
    const blend = Math.min(1, ((state.onGround ? ACCEL_GROUND : ACCEL_AIR) * dt) / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !state.moving) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }

    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    if (state.velocity.y < -30) state.velocity.y = -30;

    const nx = state.position.x + state.velocity.x * dt;
    if (!hits(nx, state.position.y, state.position.z, state.height, 0.04)) state.position.x = nx;
    else state.velocity.x = 0;
    const nz = state.position.z + state.velocity.z * dt;
    if (!hits(state.position.x, state.position.y, nz, state.height, 0.04)) state.position.z = nz;
    else state.velocity.z = 0;

    state.position.y += state.velocity.y * dt;
    state.onGround = false;
    const under = hits(state.position.x, state.position.y, state.position.z, state.height, 0);
    if (under && state.velocity.y <= 0) {
      state.position.y = under.max.y;
      state.velocity.y = 0;
      state.onGround = true;
    } else if (under) {
      state.position.y = under.min.y - state.height;
      state.velocity.y = 0;
    }
    if (state.position.y < 0) {
      state.position.y = 0;
      state.velocity.y = 0;
      state.onGround = true;
    }
  }

  return {
    state,
    step,
    look,
    recoil,
    teleport,
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}
