// Cinderworks Yard: the builder's original 40x40 m map. Three longitudinal
// lanes (A west, mid, B east) divided by interrupted walls, lateral
// connectors, a central machinery block, site A at ground level west, site B
// on a raised platform east reached by a ramp. Oxide Hour palette: chalk
// concrete, petrol steel, copper at A, pale jade at B, warm dusk sky.
import * as THREE from 'three';
import { clamp } from './rng.js';

export const MAP = { half: 20, siteAR: 4.2, siteBR: 4.0 };

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const concreteTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#d3c8b4'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${105 + Math.random() * 50 | 0},${85 + Math.random() * 40 | 0},0.08)`;
    g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 8, 2 + Math.random() * 8);
  }
  g.strokeStyle = 'rgba(90,78,62,0.35)'; g.lineWidth = 2;
  g.strokeRect(1, 1, w - 2, h - 2);
  g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2, h); g.stroke();
});

const groundTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#c9bda6'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.05})`;
    g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 8 + Math.random() * 40, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(70,60,45,0.4)'; g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    g.beginPath(); g.moveTo(i * 128, 0); g.lineTo(i * 128, h); g.stroke();
    g.beginPath(); g.moveTo(0, i * 128); g.lineTo(w, i * 128); g.stroke();
  }
  g.strokeStyle = 'rgba(200,120,50,0.55)'; g.lineWidth = 5;
  g.setLineDash([18, 14]);
  g.beginPath(); g.moveTo(0, 300); g.lineTo(w, 300); g.stroke();
  g.setLineDash([]);
});

const crateTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#7a5a34'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#8a6a3e'; g.fillRect(6, 6, w - 12, h - 12);
  g.strokeStyle = '#4a3419'; g.lineWidth = 5; g.strokeRect(3, 3, w - 6, h - 6);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(w, h); g.moveTo(w, 0); g.lineTo(0, h); g.stroke();
});

const steelTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#24484a'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    g.fillRect(0, Math.random() * h, w, 1 + Math.random() * 3);
  }
  g.fillStyle = 'rgba(224,138,60,0.8)'; g.fillRect(0, h - 8, w, 8);
});

function signTex(text, fg, bg, sub) {
  return canvasTex(512, 256, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = fg; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = fg; g.font = '900 150px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, sub ? h / 2 - 24 : h / 2);
    if (sub) { g.font = '700 34px system-ui, sans-serif'; g.fillText(sub, w / 2, h - 52); }
  });
}

function hazardTex() {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#d8a03c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1c1a18';
    for (let i = -2; i < 6; i++) {
      g.beginPath();
      g.moveTo(i * 32, h); g.lineTo(i * 32 + 32, 0); g.lineTo(i * 32 + 64, 0); g.lineTo(i * 32 + 32, h);
      g.fill();
    }
  });
}

const skyTex = canvasTex(16, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#2c2140');
  gr.addColorStop(0.45, '#7a4a52');
  gr.addColorStop(0.72, '#e08a3c');
  gr.addColorStop(0.85, '#f7c46a');
  gr.addColorStop(1, '#8a5a3a');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
});

function flashTexSun() {
  return canvasTex(128, 128, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,230,170,1)');
    gr.addColorStop(0.35, 'rgba(255,170,80,0.7)');
    gr.addColorStop(1, 'rgba(255,140,60,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
}

// Waypoints: hand-placed, hand-linked. Links are clear paths by design;
// BFS over them is the bots' navigation. Coordinates are (x, z) metres.
const WP = [
  [0, 17], [-10, 17], [10, 17], [-13, 10], [0, 10], [13, 10],
  [-13, 0], [0, 4], [13, 0], [0, -7], [-13, -8], [13, -8],
  [-14.5, -12], [14.5, -12], [14, -6.5], [14, -4], [-6, 0], [6, 0],
  // Corner waypoints sit 2 m inside the walls, clear of the barrel at
  // (-18,-16.5) and the B-platform parapets: a bot whose spawn overlaps a
  // collider can never move (moveCollide has no escape), so no waypoint
  // may sit inside a collider's radius either.
  [-16, -15], [16, -14], [0, -15], [-8, -12], [8, -12],
  [-13, 15], [13, 15], [-7, -7], [7, -7],
];
const LINKS = [
  [1, 2, 3, 4, 5], [0, 3, 23], [0, 5, 24], [1, 4, 6, 23], [3, 5, 7, 0],
  [2, 4, 8, 24], [3, 7, 10, 16], [4, 6, 8, 9, 16, 17], [5, 7, 11, 17],
  [7, 10, 11, 21, 22, 25, 26], [6, 9, 12, 21], [8, 9, 14, 22],
  [10, 21, 18], [14, 19, 22], [11, 13, 15], [8, 11, 14, 17],
  [6, 7, 9, 25], [7, 8, 9, 15, 26], [12, 21, 20], [13, 22, 20],
  [18, 19, 21, 22, 9], [9, 10, 12, 18, 20], [9, 11, 13, 19, 20],
  [1, 3], [2, 5], [9, 16, 21], [9, 17, 22],
];

export function buildWorld(scene) {
  const colliders = [];
  const addCol = (x0, z0, x1, z1, y0 = 0, y1 = 4) => {
    colliders.push({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1), y0, y1 });
  };
  const mats = {
    concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.92 }),
    ground: new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }),
    steel: new THREE.MeshStandardMaterial({ map: steelTex, roughness: 0.6, metalness: 0.35 }),
    crate: new THREE.MeshStandardMaterial({ map: crateTex, roughness: 0.85 }),
    copper: new THREE.MeshStandardMaterial({ color: 0xc97b3d, roughness: 0.5, metalness: 0.6 }),
    jade: new THREE.MeshStandardMaterial({ color: 0x9fd8b4, roughness: 0.5, metalness: 0.3 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1f3a3d, roughness: 0.7, metalness: 0.3 }),
    amber: new THREE.MeshStandardMaterial({ color: 0xffb648, emissive: 0xff9a1e, emissiveIntensity: 0.9, roughness: 0.4 }),
    hazard: new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.8 }),
  };
  const box = (w, h, d, mat, x, y, z, col = true) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    if (col) addCol(x - w / 2, z - d / 2, x + w / 2, z + d / 2, y - h / 2, y + h / 2);
    return m;
  };

  // Sky dome + fog + lights (Oxide Hour dusk).
  const sky = new THREE.Mesh(new THREE.SphereGeometry(140, 24, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  scene.add(sky);
  // Low sun glow on the western horizon + distant skyline silhouettes.
  const sunGlow = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshBasicMaterial({ map: flashTexSun(), transparent: true, opacity: 0.9, fog: false, depthWrite: false }),
  );
  sunGlow.position.set(-70, 22, -95);
  sunGlow.lookAt(0, 8, 0);
  scene.add(sunGlow);
  const skylineMat = new THREE.MeshStandardMaterial({ color: 0x4a3540, roughness: 1 });
  for (const [sx, sz, sw, sh] of [[-55, -60, 14, 12], [-30, -70, 10, 18], [0, -75, 18, 9], [28, -68, 12, 15], [55, -55, 16, 10], [-65, 30, 12, 9], [62, 40, 14, 12]]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sw, sh, 6), skylineMat);
    b.position.set(sx, sh / 2 - 1, sz);
    scene.add(b);
  }
  scene.fog = new THREE.Fog(0xc98a5e, 45, 130);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.6);
  sun.position.set(-28, 26, -34);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xffd9a8, 0x4a3a2c, 0.85));
  const fill = new THREE.DirectionalLight(0x8fb8c8, 0.35);
  fill.position.set(20, 14, 24);
  scene.add(fill);

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(46, 46), mats.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Perimeter walls with petrol trim.
  const H = 4.5;
  box(42, H, 1, mats.concrete, 0, H / 2, -20.5);
  box(42, H, 1, mats.concrete, 0, H / 2, 20.5);
  box(1, H, 42, mats.concrete, -20.5, H / 2, 0);
  box(1, H, 42, mats.concrete, 20.5, H / 2, 0);
  box(42, 0.3, 1.2, mats.steel, 0, H + 0.15, -20.5, false);
  box(42, 0.3, 1.2, mats.steel, 0, H + 0.15, 20.5, false);

  // Lane divider walls (interrupted): gaps at the mid connector (z -4..4)
  // and open spawn ground to the south.
  for (const x of [-6.5, 6.5]) {
    box(0.8, 3.4, 12, mats.concrete, x, 1.7, -10);
    box(0.8, 3.4, 12, mats.concrete, x, 1.7, 10);
    box(0.9, 0.25, 12.2, mats.steel, x, 3.5, -10, false);
    box(0.9, 0.25, 12.2, mats.steel, x, 3.5, 10, false);
  }

  // Central machinery block with pipes and glowing vents.
  box(9, 3.2, 7, mats.steel, 0, 1.6, 0);
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 8.4, 12), mats.copper);
  pipe.rotation.z = Math.PI / 2; pipe.position.set(0, 3.7, -1.5);
  pipe.castShadow = true; scene.add(pipe);
  const pipe2 = pipe.clone(); pipe2.position.set(0, 3.7, 1.5); scene.add(pipe2);
  for (let i = -1; i <= 1; i++) {
    const vent = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 0.3), mats.amber);
    vent.position.set(i * 3, 2.2, 3.6); scene.add(vent);
  }

  // Site B raised platform + ramp (south side).
  box(8, 1.2, 8, mats.concrete, 14.5, 0.6, -12);
  box(8.2, 0.18, 8.2, mats.jade, 14.5, 1.28, -12, false);
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.35, 4.4), mats.concrete);
  ramp.position.set(14, 0.6, -6.2);
  ramp.rotation.x = Math.atan2(1.2, 3.5);
  ramp.castShadow = true; ramp.receiveShadow = true;
  scene.add(ramp);
  const rampStrip = new THREE.Mesh(new THREE.BoxGeometry(4.1, 0.06, 4.5), mats.hazard);
  rampStrip.position.set(14, 0.78, -6.2);
  rampStrip.rotation.x = Math.atan2(1.2, 3.5);
  scene.add(rampStrip);
  // Parapets on platform north/east/west edges (ramp mouth stays open).
  box(0.5, 0.6, 8, mats.steel, 10.5, 1.5, -12);
  box(0.5, 0.6, 8, mats.steel, 18.5, 1.5, -12);
  box(8.5, 0.6, 0.5, mats.steel, 14.5, 1.5, -16);

  // Relay pylons at both sites (amber core = the objective).
  const pylons = [];
  for (const [sx, sz, sy] of [[-15.5, -13.5, 0], [14.5, -14.5, 1.2]]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 0.5, 10), mats.dark);
    base.position.set(sx, sy + 0.25, sz); base.castShadow = true; scene.add(base);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 2.4, 10), mats.amber);
    core.position.set(sx, sy + 1.6, sz); scene.add(core);
    const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.15, 0.5, 10), mats.copper);
    dish.position.set(sx, sy + 3.0, sz); dish.castShadow = true; scene.add(dish);
    pylons.push(core);
  }

  // Crate clusters (cover) + barrels.
  const crate = (x, z, s = 1.2, y = 0) => box(s, s, s, mats.crate, x, y + s / 2, z);
  crate(-13, -4); crate(-11.8, -4, 1.2); crate(-12.4, -4, 1.2, 1.2);
  crate(-16, 2); crate(2, -8, 1.4); crate(-2, 8); crate(1.2, 8, 1.2);
  crate(13, 2); crate(14.4, 2, 1.2); crate(16, 6); crate(11, -4, 1.4);
  crate(-4, -1.5, 1.2); crate(4.5, 1.5, 1.2); crate(-17, -6, 1.4); crate(17, -2, 1.2);
  const barrel = (x, z) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.3, 12), mats.steel);
    b.position.set(x, 0.65, z); b.castShadow = true; scene.add(b);
    addCol(x - 0.55, z - 0.55, x + 0.55, z + 0.55, 0, 1.3);
  };
  barrel(-17, 14); barrel(-15.8, 14.4); barrel(17, 14); barrel(18, -2); barrel(-18, -16.5); barrel(8, 16);

  // Tower / mast with blinking beacon (south-east).
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.3, 9, 8), mats.dark);
  mast.position.set(18.5, 4.5, 17.5); mast.castShadow = true; scene.add(mast);
  addCol(18.2, 17.2, 18.8, 17.8, 0, 9);
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0xff3b30, emissive: 0xff3b30, emissiveIntensity: 2 });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), beaconMat);
  beacon.position.set(18.5, 9.2, 17.5); scene.add(beacon);
  const mastLight = new THREE.PointLight(0xff3b30, 6, 12);
  mastLight.position.set(18.5, 9.2, 17.5); scene.add(mastLight);

  // Signage: big site letters, yard sign, arrows.
  const sign = (tex, w, h, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
    m.position.set(x, y, z); m.rotation.y = ry; scene.add(m);
  };
  sign(signTex('A', '#e08a3c', '#1f3a3d', 'RELAY WEST'), 4.4, 2.2, -14.5, 3.4, -19.9);
  sign(signTex('B', '#9fd8b4', '#1f3a3d', 'RELAY EAST'), 4.4, 2.2, 14.5, 3.4, -19.9);
  sign(signTex('CINDERWORKS', '#f2ede3', '#24484a', 'YARD 07 · EMBER HOUR'), 7, 3.5, 0, 4.2, 19.9, Math.PI);
  sign(signTex('A', '#e08a3c', '#1f3a3d'), 2.2, 1.1, -6.9, 2.6, -10, Math.PI / 2);
  sign(signTex('B', '#9fd8b4', '#1f3a3d'), 2.2, 1.1, 6.9, 2.6, -10, -Math.PI / 2);

  // Per-site accent lights.
  const lightA = new THREE.PointLight(0xe08a3c, 18, 16); lightA.position.set(-14.5, 4, -12); scene.add(lightA);
  const lightB = new THREE.PointLight(0x9fd8b4, 18, 16); lightB.position.set(14.5, 5, -12); scene.add(lightB);

  const waypoints = WP.map(([x, z], i) => ({ id: i, x, z, links: LINKS[i] }));
  const sites = {
    A: { name: 'A', x: -14.5, z: -12, r: MAP.siteAR, y: 0 },
    B: { name: 'B', x: 14.5, z: -12, r: MAP.siteBR, y: 1.2 },
  };
  const spawns = {
    atk: [[0, 17], [-10, 17], [10, 17], [-13, 15], [13, 15]],
    // Corner defender spawns sit clear of the barrel (-18,-16.5) and the
    // B-platform parapets (see the waypoint note above): a spawn that
    // overlaps a collider wedges the bot there for the whole round.
    def: [[-16, -15], [16, -14], [0, -15], [-8, -12], [8, -12]],
  };

  return {
    colliders, waypoints, sites, spawns,
    update(t) {
      const on = Math.sin(t * 3) > 0;
      beaconMat.emissiveIntensity = on ? 2.4 : 0.2;
      mastLight.intensity = on ? 6 : 0.5;
      for (const p of pylons) p.rotation.y = t * 0.6;
    },
  };
}

// Ground height: B platform (1.2) and its ramp; 0 elsewhere.
export function groundHeight(x, z) {
  if (x >= 10.5 && x <= 18.5 && z >= -16 && z <= -8) return 1.2;
  if (x >= 12 && x <= 16 && z > -8 && z < -4.5) return 1.2 * clamp((z + 4.5) / -3.5, 0, 1);
  return 0;
}

// Axis-resolved movement against AABBs. pos is a THREE.Vector3 (feet).
export function moveCollide(pos, dx, dz, radius, colliders) {
  const feetY = pos.y;
  const blocked = (x, z) => {
    for (const c of colliders) {
      if (feetY >= c.y1 - 0.05 || feetY + 1.7 <= c.y0) continue;
      if (x + radius > c.x0 && x - radius < c.x1 && z + radius > c.z0 && z - radius < c.z1) return true;
    }
    return false;
  };
  // Escape hatch: if the actor already overlaps a collider (spawned or
  // teleported into one, or a rounding wedge), every small step still
  // overlaps, so a strict check would freeze it there forever. Allow the
  // move while overlapped — the actor's path leads out into the open, and
  // normal blocking resumes the moment it is clear.
  const curBlocked = blocked(pos.x, pos.z);
  const nx = pos.x + dx;
  if (!blocked(nx, pos.z) || curBlocked) pos.x = nx;
  const nz = pos.z + dz;
  if (!blocked(pos.x, nz) || curBlocked) pos.z = nz;
  pos.x = clamp(pos.x, -19.4, 19.4);
  pos.z = clamp(pos.z, -19.4, 19.4);
}

// 3D ray vs AABB slabs. Returns nearest hit distance or Infinity.
export function rayHitWalls(ox, oy, oz, dx, dy, dz, maxDist, colliders) {
  let best = Infinity;
  for (const c of colliders) {
    let t0 = 0, t1 = maxDist;
    const axes = [[ox, dx, c.x0, c.x1], [oy, dy, c.y0, c.y1], [oz, dz, c.z0, c.z1]];
    let ok = true;
    for (const [o, d, mn, mx] of axes) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } continue; }
      let ta = (mn - o) / d, tb = (mx - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < best && t0 >= 0) best = t0;
  }
  return best;
}

// 2D segment vs AABB (tall colliders only) — line of sight at eye height.
export function segBlocked2D(ax, az, bx, bz, colliders) {
  for (const c of colliders) {
    if (c.y1 < 1.5) continue;
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1;
    let ok = true;
    for (const [o, d, mn, mx] of [[ax, dx, c.x0, c.x1], [az, dz, c.z0, c.z1]]) {
      if (Math.abs(d) < 1e-9) { if (o < mn || o > mx) { ok = false; break; } continue; }
      let ta = (mn - o) / d, tb = (mx - o) / d;
      if (ta > tb) { const tmp = ta; ta = tb; tb = tmp; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) { ok = false; break; }
    }
    if (ok && t0 < 1 && t1 > 0) return true;
  }
  return false;
}

// Does segment (p1->p2) pass through a sphere (smoke cloud)?
export function segHitsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = ax + dx * t - cx, py = ay + dy * t - cy, pz = az + dz * t - cz;
  return px * px + py * py + pz * pz < r * r;
}

export function nearestWaypoint(waypoints, x, z) {
  let best = 0, bd = Infinity;
  for (const w of waypoints) {
    const d = (w.x - x) ** 2 + (w.z - z) ** 2;
    if (d < bd) { bd = d; best = w.id; }
  }
  return best;
}

// BFS over the waypoint graph. Returns an array of waypoint ids.
export function findPath(waypoints, from, to) {
  if (from === to) return [to];
  const prev = new Array(waypoints.length).fill(-1);
  const q = [from];
  prev[from] = from;
  while (q.length) {
    const cur = q.shift();
    for (const n of waypoints[cur].links) {
      if (prev[n] === -1) {
        prev[n] = cur;
        if (n === to) {
          const path = [to];
          let p = to;
          while (p !== from) { p = prev[p]; path.unshift(p); }
          return path;
        }
        q.push(n);
      }
    }
  }
  return [to];
}
