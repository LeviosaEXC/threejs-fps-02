// Actors: the player controller (accel/friction movement, crouch, jump)
// and the bot brain — five named plans, roles, states (escort, anchor,
// rotation, post-plant, retake, defuse, saving), vision/hearing, BFS
// waypoint navigation, burst fire with reaction delays.
import * as THREE from 'three';
import { clamp, angleDiff } from './rng.js';
import { moveCollide, groundHeight, nearestWaypoint, findPath, segBlocked2D } from './world.js';
import { fireWeapon, reloadWeapon, finishReload, WEAPONS, freshLoadout, smokeBlocks } from './weapons.js';

export const ALLY_NAMES = ['SAGE', 'ORION', 'VEGA', 'NOVA'];
export const ENEMY_NAMES = ['ASH', 'CINDER', 'FLINT', 'SLAG', 'PYRE'];

// Attacker plans: routes are waypoint id chains from the spawn area.
export const PLANS = {
  'A RUSH': { site: 'A', speed: 4.3, route: [3, 6, 10, 12], pace: 0.4 },
  'A DEFAULT': { site: 'A', speed: 3.1, route: [3, 6, 10, 12], pace: 2.2 },
  'MID CONTROL': { site: 'A', speed: 3.4, route: [4, 7, 9, 21, 12], pace: 1.2 },
  'B RUSH': { site: 'B', speed: 4.3, route: [5, 8, 11, 14, 13], pace: 0.4 },
  'B LURK': { site: 'B', speed: 2.6, route: [5, 8, 11, 15, 14, 13], pace: 2.8 },
};
export const PLAN_NAMES = Object.keys(PLANS);

const CORAL = 0xff5a3c, TEAL = 0x4fd8c0;

export class Actor {
  constructor(id, name, team, isPlayer, x, z) {
    this.id = id; this.name = name; this.team = team; this.isPlayer = isPlayer;
    this.pos = new THREE.Vector3(x, 0, z);
    this.yaw = team === 'atk' ? 0 : Math.PI; this.pitch = 0; // attackers face north (-z, toward the sites)
    this.hp = 100; this.alive = true;
    this.loadout = freshLoadout();
    this.money = 800;
    this.speed2d = 0; this.crouching = false; this.onGround = true;
    this.vy = 0; this.blindUntil = 0; this.flashMul = 1;
    this.kills = 0; this.deaths = 0; this.assists = 0;
    this.shots = 0; this.hits = 0; this.headshots = 0;
    this.lastDamagedBy = null; this.lastDamagedAt = -99;
    this.lastDamagedByAt = 0;
    // Bot brain.
    this.state = 'move'; this.plan = null; this.role = 'rifle';
    this.path = []; this.pathIdx = 0; this.holdUntil = 0;
    this.target = null; this.reactAt = 0; this.burstLeft = 0; this.nextShotAt = 0;
    this.senseAt = 0; this.stuckAt = 0; this.lastX = x; this.lastZ = z; this.stuckTime = 0;
    this.aimErr = 0.02; this.investigateUntil = 0; this.investigateWp = -1;
    this.mesh = null; this.gunMesh = null;
    this.stepAt = 0; this.wasMoving = false;
  }

  get blinded() { return false; } // replaced by G.time check in brain

  resetForRound(x, z, team) {
    this.team = team;
    this.pos.set(x, groundHeight(x, z), z);
    this.yaw = team === 'atk' ? 0 : Math.PI; this.pitch = 0;
    this.hp = 100; this.alive = true;
    this.blindUntil = 0;
    this.state = 'move'; this.target = null; this.burstLeft = 0;
    this.path = []; this.pathIdx = 0; this.holdUntil = 0;
    this.stuckTime = 0; this.investigateUntil = 0;
    this.loadout.bloom = 0; this.loadout.reloadUntil = 0; this.loadout.pendingReload = false;
    this.loadout.ads = false;
    if (this.mesh) {
      this.mesh.visible = true;
      this.mesh.rotation.set(0, 0, 0);
      this.mesh.position.copy(this.pos);
    }
  }

  eyeY() { return this.pos.y + (this.crouching ? 1.2 : 1.62); }

  buildMesh(scene) {
    if (this.isPlayer) return;
    const g = new THREE.Group();
    // Enemies read coral, allies sea-glass teal — from the player's side.
    const isEnemy = this.team !== 'atk';
    const col = isEnemy ? CORAL : TEAL;
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.7, emissive: col, emissiveIntensity: isEnemy ? 0.3 : 0.12 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x23282c, roughness: 0.8 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.38), bodyMat);
    torso.position.y = 1.05; torso.castShadow = true; g.add(torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.42), darkMat);
    chest.position.y = 1.15; g.add(chest);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), bodyMat);
    head.position.y = 1.68; head.castShadow = true; g.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.05), darkMat);
    visor.position.set(0, 1.7, 0.18); g.add(visor);
    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), darkMat);
      leg.position.set(s * 0.18, 0.31, 0); leg.castShadow = true; g.add(leg);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.6, 0.18), bodyMat);
      arm.position.set(s * 0.45, 1.1, 0.12); g.add(arm);
    }
    const gun = new THREE.Group();
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.7), darkMat);
    barrel.position.z = 0.3; gun.add(barrel);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.4), darkMat);
    gun.add(body);
    gun.position.set(0.28, 1.25, 0.25);
    g.add(gun);
    this.gunMesh = gun;
    g.position.copy(this.pos);
    scene.add(g);
    this.mesh = g;
  }

  setSideColor(playerTeam) {
    if (!this.mesh || this.isPlayer) return;
    const isEnemy = this.team !== playerTeam;
    const col = isEnemy ? CORAL : TEAL;
    this.mesh.traverse((o) => {
      if (o.isMesh && o.material && o.material.emissive) {
        o.material.color.setHex(col);
        o.material.emissive.setHex(col);
        o.material.emissiveIntensity = isEnemy ? 0.3 : 0.12;
      }
    });
  }
}

// ---- player movement: acceleration + friction, crouch, jump ----
export function updatePlayer(G, p, input, dt) {
  if (!p.alive) return;
  const L = p.loadout;
  const crouchKey = input.keys.has('ControlLeft') || input.keys.has('KeyC');
  p.crouching = crouchKey;
  const speedMax = p.crouching ? 2.6 : (L.ads ? 3.0 : 5.2);
  let fx = 0, fz = 0;
  if (input.keys.has('KeyW')) fz -= 1;
  if (input.keys.has('KeyS')) fz += 1;
  if (input.keys.has('KeyA')) fx -= 1;
  if (input.keys.has('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz) || 1;
  fx /= len; fz /= len;
  const sin = Math.sin(p.yaw), cos = Math.cos(p.yaw);
  const wx = (fx * cos - fz * sin), wz = (fx * sin + fz * cos);
  const accel = 42;
  p.vx = (p.vx || 0) + wx * accel * dt;
  p.vz = (p.vz || 0) + wz * accel * dt;
  // Friction.
  const fr = Math.exp(-9 * dt);
  p.vx *= fr; p.vz *= fr;
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > speedMax) { p.vx *= speedMax / sp; p.vz *= speedMax / sp; }
  moveCollide(p.pos, p.vx * dt, p.vz * dt, 0.4, G.colliders);
  p.speed2d = Math.hypot(p.vx, p.vz);
  // Jump / gravity.
  if (input.jumpQueued && p.onGround) {
    p.vy = 6.8; p.onGround = false; input.jumpQueued = false;
  }
  if (!p.onGround) {
    p.vy -= 18 * dt;
    p.pos.y += p.vy * dt;
    const gh = groundHeight(p.pos.x, p.pos.z);
    if (p.pos.y <= gh) { p.pos.y = gh; p.vy = 0; p.onGround = true; }
  } else {
    p.pos.y = groundHeight(p.pos.x, p.pos.z);
  }
  // Footsteps (bots hear them).
  if (p.speed2d > 1.2 && G.time - p.stepAt > (p.crouching ? 0.62 : 0.36)) {
    p.stepAt = G.time;
    G.audio.footstep(p.speed2d > 4);
    G.hearSound(p.pos.x, p.pos.z, p.crouching ? 4 : 11, 'step');
  }
  // Recoil recovery on the camera pitch.
  L.recoilPitch = Math.max(0, L.recoilPitch - dt * 0.09);
}

// ---- bot helpers ----
function canSee(G, a, b) {
  const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 34) return false;
  const ang = Math.atan2(-dx, -dz);
  let diff = Math.abs(((ang - a.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  if (diff > 1.05 && dist > 4) return false; // ~120 deg FOV
  if (segBlocked2D(a.pos.x, a.pos.z, b.pos.x, b.pos.z, G.colliders)) return false;
  if (smokeBlocks(G, a.pos.x, a.eyeY(), a.pos.z, b.pos.x, b.eyeY(), b.pos.z)) return false;
  return true;
}

function setPathTo(G, bot, wpId) {
  const from = nearestWaypoint(G.world.waypoints, bot.pos.x, bot.pos.z);
  bot.path = findPath(G.world.waypoints, from, wpId);
  bot.pathIdx = 0;
}

function moveAlongPath(G, bot, dt, speed) {
  if (!bot.path.length || bot.pathIdx >= bot.path.length) return true;
  const wp = G.world.waypoints[bot.path[bot.pathIdx]];
  const dx = wp.x - bot.pos.x, dz = wp.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.7) { bot.pathIdx++; return bot.pathIdx >= bot.path.length; }
  // Move directly toward the waypoint, not along the yaw: the yaw is
  // owned by combat when the bot has a target, so driving movement off
  // the yaw made the bot zigzag between its path and its target instead
  // of reaching the waypoint.
  const step = speed * dt;
  moveCollide(bot.pos, (dx / dist) * step, (dz / dist) * step, 0.4, G.colliders);
  bot.pos.y = groundHeight(bot.pos.x, bot.pos.z);
  bot.speed2d = speed;
  // Face the movement direction when not engaging; combat overrides the
  // yaw afterward when the bot has a target.
  if (!bot.target) {
    const wantYaw = Math.atan2(-dx, -dz);
    bot.yaw += clamp(angleDiff(bot.yaw, wantYaw), -3.2 * dt, 3.2 * dt);
  }
  // Stuck detection: barely moved while trying to move.
  const moved = Math.hypot(bot.pos.x - bot.lastX, bot.pos.z - bot.lastZ);
  if (moved < 0.02) {
    bot.stuckTime += dt;
    if (bot.stuckTime > 2) {
      bot.stuckTime = 0;
      setPathTo(G, bot, bot.path[bot.path.length - 1]);
      bot.pathIdx = 0;
    }
  } else bot.stuckTime = 0;
  bot.lastX = bot.pos.x; bot.lastZ = bot.pos.z;
  return false;
}

function botFire(G, bot, dt) {
  const t = bot.target;
  if (!t || !t.alive) return;
  const L = bot.loadout;
  const w = WEAPONS[L.weapon];
  if (G.time < L.reloadUntil) return;
  if (L.mag <= 0) { reloadWeapon(G, bot); return; }
  if (G.time < bot.nextShotAt) return;
  if (bot.burstLeft <= 0) {
    bot.burstLeft = 3 + Math.floor(G.rng.next() * 3);
    bot.nextShotAt = G.time + 0.4 + G.rng.next() * 0.5;
    return;
  }
  const dx = t.pos.x - bot.pos.x, dz = t.pos.z - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  const aimYaw = Math.atan2(-dx, -dz) + (G.rng.next() - 0.5) * 2 * bot.aimErr;
  const dy = (t.pos.y + 1.2) - bot.eyeY();
  const aimPitch = Math.atan2(dy, dist) + (G.rng.next() - 0.5) * 2 * bot.aimErr;
  bot.yaw = aimYaw;
  const res = fireWeapon(G, bot, aimYaw, aimPitch, {});
  if (res) {
    bot.shots += w.pellets;
    bot.burstLeft--;
    bot.nextShotAt = G.time + w.interval;
    G.audio.distantShot(w.id);
    G.hearSound(bot.pos.x, bot.pos.z, 22, 'shot');
    for (const r of res.results) {
      G.fx.tracer(res.origin, { x: r.x, y: r.y, z: r.z });
      if (!r.victim && r.wall) G.fx.impact({ x: r.x, y: r.y, z: r.z });
    }
  }
}

// Bots buy with their own money each buy phase.
export function botBuy(G, bot) {
  const L = bot.loadout;
  const m = bot.money;
  const want = m >= 2600 ? 'rifle' : m >= 1500 ? (G.rng.chance(0.5) ? 'shotgun' : 'smg') : m >= 1100 ? 'smg' : 'pistol';
  if (want !== 'pistol' && !L.owned[want]) {
    bot.money -= WEAPONS[want].price;
    L.owned[want] = true;
    L.weapon = want;
    L.mag = WEAPONS[want].mag; L.reserve = WEAPONS[want].reserve;
  } else if (L.owned.rifle && bot.money >= 0) {
    L.weapon = 'rifle'; L.mag = WEAPONS.rifle.mag; L.reserve = WEAPONS.rifle.reserve;
  }
  if (bot.money >= 650 && L.armor < 100) { bot.money -= 650; L.armor = 100; }
  if (bot.team === 'def' && bot.money >= 400 && !L.kit) { bot.money -= 400; L.kit = true; }
  const nades = ['flash', 'smoke', 'frag'];
  for (const n of nades) {
    if (bot.money >= 200 && (L.nades[n] || 0) < 1 && G.rng.chance(0.6)) {
      bot.money -= n === 'flash' ? 200 : 300;
      L.nades[n] = (L.nades[n] || 0) + 1;
    }
  }
}

// Assign plans + roles at round start. Returns the plan name.
export function assignRound(G, planName) {
  const attackers = G.actors.filter((a) => a.team === 'atk' && !a.isPlayer);
  const defenders = G.actors.filter((a) => a.team === 'def' && !a.isPlayer);
  const plan = PLANS[planName];
  // Carrier: the first attacker bot (or the player if they are the only one).
  const carrier = attackers[0] || G.player;
  G.spike.carrier = carrier;
  attackers.forEach((b, i) => {
    b.plan = planName;
    b.role = b === carrier ? 'carrier' : i === 1 ? 'escort' : 'rifle';
    b.state = 'move';
    setPathTo(G, b, plan.route[0]);
    b.holdUntil = 0;
  });
  defenders.forEach((b, i) => {
    b.plan = 'SITE HOLD';
    b.role = i < 2 ? 'anchor-a' : i < 4 ? 'anchor-b' : 'roam';
    b.state = 'move';
    const dest = b.role === 'anchor-a' ? 10 : b.role === 'anchor-b' ? 11 : 9;
    setPathTo(G, b, dest);
  });
  return planName;
}

export function squadRotate(G, site) {
  const allies = G.actors.filter((a) => a.team === G.player.team && !a.isPlayer && a.alive);
  const dest = site === 'A' ? 10 : 11;
  for (const b of allies) {
    if (b.state === 'defuse' || b.state === 'plant') continue;
    b.state = 'rotate';
    setPathTo(G, b, dest);
  }
  return allies.length;
}

// ---- the bot brain, one tick per bot ----
export function updateBot(G, bot, dt) {
  if (!bot.alive) return;
  const L = bot.loadout;
  if (L.pendingReload && G.time >= L.reloadUntil) finishReload(bot);
  if (G.time < bot.blindUntil) {
    bot.aimErr = 0.35;
    bot.speed2d = 0;
    return; // flashed: frozen, no accuracy, no reaction
  }
  bot.aimErr = 0.02;
  // Sensing at ~8 Hz, staggered.
  if (G.time >= bot.senseAt) {
    bot.senseAt = G.time + 0.12 + (bot.id % 5) * 0.02;
    let best = null, bd = Infinity;
    for (const o of G.actors) {
      if (o.team === bot.team || !o.alive) continue;
      const d = Math.hypot(o.pos.x - bot.pos.x, o.pos.z - bot.pos.z);
      if (d < bd && canSee(G, bot, o)) { best = o; bd = d; }
    }
    if (best && !bot.target) bot.reactAt = G.time + 0.25 + G.rng.next() * 0.25;
    if (!best && bot.target) bot.target = null;
    if (best) bot.target = best;
  }
  // A bot's plan can be 'SITE HOLD' (defenders); after a side swap it may
  // attack with that plan, which has no entry in PLANS — default to A RUSH
  // instead of crashing on an undefined plan (a throw here would kill the
  // whole render loop, since updateBot runs inside frame()).
  const plan = PLANS[bot.plan] || PLANS['A RUSH'];
  const spike = G.spike;
  const mySite = bot.team === 'atk' ? (spike.planted ? spike.site : plan.site) : null;

  // --- objective states ---
  if (bot.team === 'atk' && spike.planted) {
    // Post-plant: hold near the site, watch angles.
    if (bot.state !== 'postplant') {
      bot.state = 'postplant';
      setPathTo(G, bot, spike.site === 'A' ? 10 : 11);
    }
  } else if (bot.team === 'def' && spike.planted) {
    // Retake: converge on the site; defuse when the site is clear.
    if (bot.state !== 'retake' && bot.state !== 'defuse') {
      bot.state = 'retake';
      setPathTo(G, bot, spike.site === 'A' ? 12 : 13);
    }
    if (bot.state === 'retake') {
      const s = G.world.sites[spike.site];
      const d = Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z);
      if (d < s.r && !bot.target) {
        bot.state = 'defuse';
        bot.defuseT = 0;
      }
    }
    if (bot.state === 'defuse') {
      bot.defuseT += dt;
      if (bot.target) { bot.state = 'retake'; } // interrupted: fight first
      else if (bot.defuseT >= (L.kit ? 3.5 : 7)) G.completeDefuse(bot);
      return;
    }
  } else if (bot.team === 'atk' && spike.carrier === bot && !spike.planted) {
    const s = G.world.sites[plan.site];
    const d = Math.hypot(bot.pos.x - s.x, bot.pos.z - s.z);
    // Plant when on the site and no enemy is at point-blank range. A
    // distant visible enemy is a threat the carrier's teammates cover,
    // not a reason to never plant: requiring no visible enemy at all
    // meant the carrier never planted while any defender was alive and
    // in line of sight. The 6 m band is the range a defender can kill
    // the planter before the 4 s channel finishes.
    const t = bot.target;
    const tDist = t ? Math.hypot(t.pos.x - bot.pos.x, t.pos.z - bot.pos.z) : Infinity;
    if (d < s.r && (!t || tDist > 6)) {
      bot.state = 'plant';
      bot.plantT = (bot.plantT || 0) + dt;
      if (bot.plantT >= 4) G.completePlant(bot);
      return;
    }
    bot.plantT = 0;
    if (bot.state === 'plant') bot.state = 'move';
  } else if (bot.team === 'atk' && spike.dropped && !spike.carrier) {
    // Recover the dropped spike.
    if (bot.state !== 'recover') {
      bot.state = 'recover';
      setPathTo(G, bot, nearestWaypoint(G.world.waypoints, spike.x, spike.z));
    }
    const d = Math.hypot(bot.pos.x - spike.x, bot.pos.z - spike.z);
    if (d < 1.2) G.pickupSpike(bot);
  }

  // Combat runs at the end of this function, after movement: the bot
  // advances along its objective path first, then aims and fires.
  // (It used to chase its target and return early, which abandoned the
  // objective path entirely — a bot with any visible enemy never
  // recovered the spike, rotated, or planted.)

  // --- investigation of heard sounds ---
  if (G.time < bot.investigateUntil && bot.investigateWp >= 0 && bot.state !== 'defuse') {
    if (moveAlongPath(G, bot, dt, 3.4)) { bot.investigateUntil = 0; }
    return;
  }

  // --- plan movement / holding ---
  if (bot.team === 'atk') {
    if (bot.state === 'move' || bot.state === 'rotate' || bot.state === 'postplant' || bot.state === 'recover') {
      const done = moveAlongPath(G, bot, dt, plan.speed);
      if (done) {
        bot.state = 'hold';
        bot.holdUntil = G.time + plan.pace;
        // Anchor: face the site / likely approach.
        const s = G.world.sites[plan.site];
        bot.yaw = Math.atan2(-(s.x - bot.pos.x), -(s.z - bot.pos.z));
      }
    } else if (bot.state === 'hold') {
      bot.speed2d = 0;
      if (G.time >= bot.holdUntil) {
        // Advance to the next waypoint along the plan route; hold again
        // once the route's final waypoint (the site) is reached.
        const route = plan.route;
        const cur = nearestWaypoint(G.world.waypoints, bot.pos.x, bot.pos.z);
        const idx = route.indexOf(cur);
        const next = idx >= 0 && idx < route.length - 1 ? route[idx + 1] : route[route.length - 1];
        if (next === cur) bot.holdUntil = G.time + plan.pace;
        else { setPathTo(G, bot, next); bot.state = 'move'; }
      }
    }
  } else {
    // Defenders: move to anchor, then hold the angle. Retake uses the
    // same walk; arriving at the site keeps the retake state so the
    // distance check above can start the defuse.
    if (bot.state === 'move' || bot.state === 'rotate' || bot.state === 'retake') {
      const done = moveAlongPath(G, bot, dt, 3.2);
      if (done) {
        if (bot.state === 'retake') bot.holdUntil = G.time + 0.5;
        else {
          bot.state = 'hold';
          bot.holdUntil = G.time + 6 + G.rng.next() * 4;
          bot.yaw = bot.role === 'anchor-a' ? Math.atan2(14, 8) : bot.role === 'anchor-b' ? Math.atan2(-14, 8) : G.rng.next() * Math.PI * 2;
        }
      }
    } else if (bot.state === 'hold') {
      bot.speed2d = 0;
      bot.yaw += Math.sin(G.time * 0.4 + bot.id) * 0.15 * dt; // slow scan
      if (G.time >= bot.holdUntil && bot.role === 'roam') {
        setPathTo(G, bot, G.rng.chance(0.5) ? 10 : 11);
        bot.state = 'move';
      }
    }
  }

  // Saving: outnumbered late round, fall back to spawn and keep the gun.
  const aliveAllies = G.actors.filter((a) => a.team === bot.team && a.alive).length;
  const aliveFoes = G.actors.filter((a) => a.team !== bot.team && a.alive).length;
  if (bot.state !== 'save' && aliveAllies <= 1 && aliveFoes >= 3 && G.roundTime < 25 && !spike.planted) {
    bot.state = 'save';
    setPathTo(G, bot, bot.team === 'atk' ? 0 : 20);
  }
  if (bot.state === 'save') moveAlongPath(G, bot, dt, 3.0);

  // --- combat: engage a visible target once reaction delay passes ---
  // The bot fires while following its objective path; it does not chase
  // the target. Aiming last leaves the model facing its target.
  if (bot.target && G.time >= bot.reactAt) {
    const t = bot.target;
    const dist = Math.hypot(t.pos.x - bot.pos.x, t.pos.z - bot.pos.z);
    bot.aimErr = 0.015 + dist * 0.0011 + (t.speed2d > 3 ? 0.02 : 0) + (bot.speed2d > 1 ? 0.015 : 0);
    const wantYaw = Math.atan2(-(t.pos.x - bot.pos.x), -(t.pos.z - bot.pos.z));
    bot.yaw += clamp(angleDiff(bot.yaw, wantYaw), -3.2 * dt, 3.2 * dt);
    botFire(G, bot, dt);
  }
}

// A bot heard a sound: investigate its nearest waypoint for a few seconds.
export function hearInvestigate(G, bot, x, z) {
  if (!bot.alive || bot.state === 'defuse' || bot.state === 'plant') return;
  if (G.time < bot.blindUntil) return;
  bot.investigateWp = nearestWaypoint(G.world.waypoints, x, z);
  bot.investigateUntil = G.time + 4;
  setPathTo(G, bot, bot.investigateWp);
}
