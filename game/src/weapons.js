// Arsenal, hitscan combat, grenades and pooled effects. All tuning numbers
// are the spec's canonical set (§2.4): no wall penetration, head/torso
// hitboxes, armor absorbs 35%, recoil/bloom/movement spread.
import * as THREE from 'three';
import { clamp, lerp } from './rng.js';
import { rayHitWalls, segHitsSphere, groundHeight } from './world.js';

export const WEAPONS = {
  pistol: { id: 'pistol', name: 'CINDER P9', role: 'SIDEARM', price: 0, dmg: 27, pellets: 1, head: 3, interval: 0.24, mag: 12, reserve: 48, reload: 1.35, spread: 0.011, recoil: 0.011, moveSpread: 0.02, auto: false, flavor: 'Standard issue. Always ready.' },
  smg: { id: 'smg', name: 'SPARK-9', role: 'SMG', price: 1100, dmg: 21, pellets: 1, head: 2.5, interval: 0.085, mag: 26, reserve: 104, reload: 1.7, spread: 0.016, recoil: 0.007, moveSpread: 0.012, auto: true, flavor: 'Fast hands, close quarters.' },
  rifle: { id: 'rifle', name: 'EMBER AR-7', role: 'RIFLE', price: 2600, dmg: 34, pellets: 1, head: 3, interval: 0.125, mag: 24, reserve: 72, reload: 2.15, spread: 0.008, recoil: 0.014, moveSpread: 0.026, auto: true, flavor: 'Hold still. Tap, don\u2019t spray.' },
  dmr: { id: 'dmr', name: 'DUSK DMR', role: 'MARKSMAN', price: 3400, dmg: 82, pellets: 1, head: 3, interval: 0.95, mag: 5, reserve: 20, reload: 2.7, spread: 0.002, recoil: 0.05, moveSpread: 0.06, auto: false, scoped: true, flavor: 'One breath. One shot.' },
  shotgun: { id: 'shotgun', name: 'COAL-12', role: 'SHOTGUN', price: 1500, dmg: 13, pellets: 8, head: 2.5, interval: 0.85, mag: 7, reserve: 28, reload: 2.4, spread: 0.045, recoil: 0.035, moveSpread: 0.03, auto: false, flavor: 'Eight pellets. No argument.' },
};
export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'dmr', 'shotgun'];

export const GEAR = {
  armor: { id: 'armor', name: 'CERAMIC PLATE', price: 650, effect: '100 armor. Absorbs 35% of damage while it lasts.' },
  kit: { id: 'kit', name: 'RELAY KIT', price: 400, effect: 'Defuse the spike in 3.5 s instead of 7 s.' },
  flash: { id: 'flash', name: 'FLASH', price: 200, effect: '2 s fuse. Blinds facing victims — bots too. Never global.' },
  smoke: { id: 'smoke', name: 'SMOKE', price: 300, effect: '1.6 s fuse. 14 s cloud, 3.3 m. Denies vision.' },
  frag: { id: 'frag', name: 'FRAG', price: 300, effect: '2.2 s fuse. 6 m radius. Falloff, blocked by cover.' },
};

export function freshLoadout() {
  return {
    weapon: 'pistol', mag: WEAPONS.pistol.mag, reserve: WEAPONS.pistol.reserve,
    owned: { pistol: true }, armor: 0, kit: false,
    nades: { flash: 1, smoke: 0, frag: 0 }, nadeSel: 'flash',
    bloom: 0, reloadUntil: 0, lastShot: -9, recoilPitch: 0, ads: false,
  };
}

// ---- hit geometry: head sphere + torso segment, ray vs both ----
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return Infinity;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return Infinity;
  return tca - Math.sqrt(r * r - d2);
}

function raySegment(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  // Closest distance between ray and segment; hit if < r. Sample-free
  // analytic solve on the two-parameter closest-point problem.
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = ox - ax, vy = oy - ay, vz = oz - az;
  const a = 1, b = dx * ux + dy * uy + dz * uz, c = ux * ux + uy * uy + uz * uz;
  const d = dx * vx + dy * vy + dz * vz, e = ux * vx + uy * vy + uz * vz;
  const den = a * c - b * b;
  let s = den > 1e-9 ? clamp((b * e - c * d) / den, 0, 200) : 0;
  let t = (e + b * s) / c; // closest point on the segment (t in [0,1])
  t = clamp(t, 0, 1);
  s = clamp(b * t - d, 0, 200); // ray parameter from s - b*t = -d
  const px = ox + dx * s - (ax + ux * t), py = oy + dy * s - (ay + uy * t), pz = oz + dz * s - (az + uz * t);
  const dist2 = px * px + py * py + pz * pz;
  return dist2 < r * r ? s : Infinity;
}

// Fire one trigger pull from shooter. Returns a hit report for effects/HUD.
// G is the game context: { actors, colliders, smokes, rng, time, onHit }.
export function fireWeapon(G, shooter, aimYaw, aimPitch, opts = {}) {
  const w = WEAPONS[shooter.loadout.weapon];
  const L = shooter.loadout;
  if (L.mag <= 0 || G.time < L.reloadUntil) return null;
  L.mag--;
  L.lastShot = G.time;
  L.bloom = Math.min(L.bloom + (w.id === 'dmr' ? 0.03 : 0.012), 0.05);
  const moving = shooter.speed2d > 0.6;
  const adsMul = L.ads ? (w.scoped ? 0.12 : 0.45) : 1;
  const crouchMul = shooter.crouching ? 0.7 : 1;
  const spread = (w.spread + L.bloom + (moving ? w.moveSpread : 0)) * adsMul * crouchMul;
  const eyeY = shooter.pos.y + (shooter.crouching ? 1.2 : 1.62);
  const ox = shooter.pos.x, oy = eyeY, oz = shooter.pos.z;
  const results = [];
  let bestWall = Infinity;
  const dirBase = { x: -Math.sin(aimYaw) * Math.cos(aimPitch), y: Math.sin(aimPitch), z: -Math.cos(aimYaw) * Math.cos(aimPitch) };
  for (let p = 0; p < w.pellets; p++) {
    const a = G.rng.next() * Math.PI * 2;
    const r = spread * Math.sqrt(G.rng.next());
    // Perturb direction by a small random cone around the aim vector.
    const dx = dirBase.x + Math.cos(a) * r, dy = dirBase.y + Math.sin(a) * r, dz = dirBase.z;
    const len = Math.hypot(dx, dy, dz);
    const d = { x: dx / len, y: dy / len, z: dz / len };
    const wallT = rayHitWalls(ox, oy, oz, d.x, d.y, d.z, 120, G.colliders);
    let hit = null;
    for (const other of G.actors) {
      if (other === shooter || !other.alive) continue;
      const headY = other.pos.y + (other.crouching ? 1.15 : 1.55);
      const th = raySphere(ox, oy, oz, d.x, d.y, d.z, other.pos.x, headY, other.pos.z, 0.24);
      const tt = raySegment(ox, oy, oz, d.x, d.y, d.z, other.pos.x, other.pos.y + 0.35, other.pos.z, other.pos.x, other.pos.y + 1.45, other.pos.z, 0.38);
      const t = Math.min(th, tt);
      if (t < wallT && t < 120 && (!hit || t < hit.t)) {
        hit = { t, victim: other, head: th <= tt, x: ox + d.x * t, y: oy + d.y * t, z: oz + d.z * t };
      }
    }
    if (hit) {
      const dmg = Math.round(w.dmg * (hit.head ? w.head : 1) * (opts.dmgMul || 1));
      results.push({ ...hit, dmg });
      if (wallT < bestWall) bestWall = wallT;
    } else {
      const t = Math.min(wallT, 120);
      results.push({ t, x: ox + d.x * t, y: oy + d.y * t, z: oz + d.z * t, wall: wallT < 120 });
      if (wallT < bestWall) bestWall = wallT;
    }
  }
  // Apply damage after all pellets (shotgun hits once per pellet).
  for (const res of results) {
    if (res.victim) G.applyDamage(res.victim, res.dmg, shooter, res.head, { x: res.x, y: res.y, z: res.z });
  }
  L.recoilPitch += w.recoil * (L.ads ? 0.7 : 1);
  return { weapon: w, origin: { x: ox, y: oy, z: oz }, results, spread };
}

export function reloadWeapon(G, actor) {
  const L = actor.loadout;
  const w = WEAPONS[L.weapon];
  if (L.mag >= w.mag || L.reserve <= 0 || G.time < L.reloadUntil) return false;
  L.reloadUntil = G.time + w.reload;
  L.pendingReload = true;
  return true;
}

export function finishReload(actor) {
  const L = actor.loadout;
  const w = WEAPONS[L.weapon];
  const need = w.mag - L.mag;
  const take = Math.min(need, L.reserve);
  L.mag += take;
  L.reserve -= take;
  L.pendingReload = false;
  L.bloom = 0;
}

// ---- grenades ----
export function throwGrenade(G, actor, type) {
  const L = actor.loadout;
  if ((L.nades[type] || 0) <= 0) return null;
  L.nades[type]--;
  const fuses = { flash: 2.0, smoke: 1.6, frag: 2.2 };
  const eyeY = actor.pos.y + 1.5;
  const dir = {
    x: -Math.sin(actor.yaw) * Math.cos(actor.pitch) * 0.7,
    y: Math.sin(actor.pitch) * 0.7 + 0.55,
    z: -Math.cos(actor.yaw) * Math.cos(actor.pitch) * 0.7,
  };
  const g = {
    type, x: actor.pos.x, y: eyeY, z: actor.pos.z,
    vx: dir.x * 14, vy: dir.y * 14 + 3, vz: dir.z * 14,
    fuse: fuses[type], owner: actor, mesh: null, bounced: 0,
  };
  G.grenades.push(g);
  return g;
}

export function updateGrenades(G, dt) {
  for (let i = G.grenades.length - 1; i >= 0; i--) {
    const g = G.grenades[i];
    g.vy -= 18 * dt;
    let nx = g.x + g.vx * dt, ny = g.y + g.vy * dt, nz = g.z + g.vz * dt;
    // Ground bounce.
    const gh = groundHeight(nx, nz);
    if (ny < gh + 0.12) { ny = gh + 0.12; g.vy = Math.abs(g.vy) * 0.45; g.vx *= 0.7; g.vz *= 0.7; g.bounced++; }
    // Wall bounce (axis-resolved, cheap).
    for (const c of G.colliders) {
      if (ny < c.y0 || ny > c.y1) continue;
      if (nx > c.x0 - 0.12 && nx < c.x1 + 0.12 && g.z > c.z0 && g.z < c.z1) { g.vx *= -0.45; nx = g.x; g.bounced++; }
      if (nz > c.z0 - 0.12 && nz < c.z1 + 0.12 && g.x > c.x0 && g.x < c.x1) { g.vz *= -0.45; nz = g.z; g.bounced++; }
    }
    g.x = nx; g.y = ny; g.z = nz;
    g.fuse -= dt;
    if (g.fuse <= 0) {
      G.grenades.splice(i, 1);
      detonateGrenade(G, g);
    }
  }
}

function detonateGrenade(G, g) {
  if (g.type === 'flash') {
    G.fx.flashBurst(g);
    for (const a of G.actors) {
      if (!a.alive) continue;
      const dx = g.x - a.pos.x, dy = (g.y - 0.3) - (a.pos.y + 1.5), dz = g.z - a.pos.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 26) continue;
      // Line of sight required: a flash around a corner never blinds.
      const wallT = rayHitWalls(a.pos.x, a.pos.y + 1.5, a.pos.z, dx / dist, dy / dist, dz / dist, dist, G.colliders);
      if (wallT < dist - 0.2) continue;
      const fwd = { x: -Math.sin(a.yaw), z: -Math.cos(a.yaw) };
      const facing = (fwd.x * dx + fwd.z * dz) / (dist || 1);
      const facingMul = facing > 0 ? 1 : facing > -0.5 ? 0.45 : 0.12;
      const dur = clamp(2.4 - dist * 0.08, 0.25, 2.2) * facingMul;
      if (dur > 0.15) {
        a.blindUntil = Math.max(a.blindUntil, G.time + dur);
        if (a.isPlayer) G.onPlayerFlashed(dur);
        else G.audio.flashRing();
      }
    }
  } else if (g.type === 'smoke') {
    G.smokes.push({ x: g.x, y: Math.max(g.y, groundHeight(g.x, g.z) + 1.1), z: g.z, r: 3.3, until: G.time + 14 });
    G.fx.smokeCloud(g.x, g.y, g.z);
  } else if (g.type === 'frag') {
    G.fx.fragBurst(g);
    for (const a of G.actors) {
      if (!a.alive) continue;
      const dx = a.pos.x - g.x, dy = (a.pos.y + 1) - g.y, dz = a.pos.z - g.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > 6) continue;
      const wallT = rayHitWalls(g.x, g.y, g.z, dx / dist, dy / dist, dz / dist, dist, G.colliders);
      if (wallT < dist - 0.2) continue; // cover blocks frag damage
      const dmg = Math.round(lerp(120, 12, dist / 6));
      G.applyDamage(a, dmg, g.owner, false, { x: a.pos.x, y: a.pos.y + 1.2, z: a.pos.z });
    }
  }
}

// Smoke blocks line of sight when the segment passes through a live cloud.
export function smokeBlocks(G, ax, ay, az, bx, by, bz) {
  for (const s of G.smokes) {
    if (G.time > s.until) continue;
    if (segHitsSphere(ax, ay, az, bx, by, bz, s.x, s.y, s.z, s.r)) return true;
  }
  return false;
}

// ---- pooled effects (tracers, impacts, smoke visuals) ----
export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), this.tracerMat);
      m.visible = false;
      scene.add(m);
      this.tracers.push({ mesh: m, life: 0 });
    }
    this.impacts = [];
    const impMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), impMat.clone());
      m.visible = false;
      scene.add(m);
      this.impacts.push({ mesh: m, life: 0 });
    }
    this.smokeMat = new THREE.MeshStandardMaterial({ color: 0xb8b0a2, transparent: true, opacity: 0.5, roughness: 1, depthWrite: false });
    this.clouds = [];
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xfff2c8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
    this.flashMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 10), this.flashMat);
    this.flashMesh.visible = false;
    scene.add(this.flashMesh);
    this.flashLife = 0;
  }

  tracer(from, to) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.1) return;
    t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    t.mesh.scale.set(1, 1, len);
    t.mesh.lookAt(to.x, to.y, to.z);
    t.mesh.visible = true;
    t.life = 0.07;
  }

  impact(p) {
    const t = this.impacts.find((x) => x.life <= 0) || this.impacts[0];
    t.mesh.position.set(p.x, p.y, p.z);
    t.mesh.scale.setScalar(1);
    t.mesh.visible = true;
    t.life = 0.16;
  }

  smokeCloud(x, y, z) {
    const grp = new THREE.Group();
    const seeds = [[0, 0, 0], [1.6, 0.4, 0.8], [-1.4, 0.5, 0.9], [0.7, 0.9, -1.3], [-0.8, 0.3, -1.5]];
    for (const [ox, oy, oz] of seeds) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), this.smokeMat);
      s.position.set(ox, oy, oz);
      grp.add(s);
    }
    grp.position.set(x, y, z);
    this.scene.add(grp);
    this.clouds.push({ grp, until: performance.now() / 1000 + 14 });
  }

  flashBurst(g) {
    this.flashMesh.position.set(g.x, g.y, g.z);
    this.flashMesh.scale.setScalar(0.4);
    this.flashMesh.visible = true;
    this.flashLife = 0.12;
  }

  fragBurst(g) {
    this.flashMesh.position.set(g.x, g.y, g.z);
    this.flashMesh.scale.setScalar(2.2);
    this.flashMesh.visible = true;
    this.flashLife = 0.18;
    this.impact({ x: g.x, y: g.y, z: g.z });
  }

  update(dt, now) {
    for (const t of this.tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    for (const t of this.impacts) {
      if (t.life > 0) {
        t.life -= dt;
        t.mesh.scale.setScalar(1 + (0.16 - t.life) * 6);
        t.mesh.material.opacity = Math.max(0, t.life / 0.16) * 0.9;
        if (t.life <= 0) t.mesh.visible = false;
      }
    }
    if (this.flashLife > 0) {
      this.flashLife -= dt;
      this.flashMesh.material.opacity = Math.max(0, this.flashLife / 0.18);
      this.flashMesh.scale.multiplyScalar(1 + dt * 6);
      if (this.flashLife <= 0) this.flashMesh.visible = false;
    }
    for (let i = this.clouds.length - 1; i >= 0; i--) {
      const c = this.clouds[i];
      if (now > c.until) {
        this.scene.remove(c.grp);
        this.clouds.splice(i, 1);
      }
    }
  }
}
