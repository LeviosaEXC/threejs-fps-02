// Weapons: five guns and one grenade, each with its own damage, magazine,
// cadence, spread and price. Hitscan fire, a view model on the camera, recoil
// kick and a muzzle flash. Grenades are real projectiles: they arc, bounce off
// the map's boxes, and detonate on a fuse. No allocation in the hot path: the
// view model is rebuilt from shared geometries when the weapon changes, and the
// grenade list is a fixed pool.
import * as THREE from 'three';
import { material } from './palette.js';

export const WEAPONS = {
  p9: { id: 'p9', name: 'P9 Sidearm', short: 'P9', price: 0, damage: 34, headMult: 4, mag: 12, reserve: 36, gap: 0.15, reload: 1.4, spreadStill: 0.004, spreadMove: 0.02, auto: false, pellets: 1, barrel: 0.22, zoom: 0 },
  hornet: { id: 'hornet', name: 'Hornet-9 SMG', short: 'SMG', price: 1400, damage: 26, headMult: 4, mag: 28, reserve: 112, gap: 0.075, reload: 1.7, spreadStill: 0.006, spreadMove: 0.03, auto: true, pellets: 1, barrel: 0.34, zoom: 0 },
  kestrel: { id: 'kestrel', name: 'Kestrel AR-7', short: 'AR-7', price: 2700, damage: 33, headMult: 4, mag: 25, reserve: 75, gap: 0.105, reload: 2.1, spreadStill: 0.002, spreadMove: 0.026, auto: true, pellets: 1, barrel: 0.5, zoom: 0 },
  breacher: { id: 'breacher', name: 'Breacher-12', short: 'SG-12', price: 1700, damage: 9, headMult: 3, mag: 6, reserve: 24, gap: 0.85, reload: 2.6, spreadStill: 0.03, spreadMove: 0.05, auto: false, pellets: 8, barrel: 0.42, zoom: 0 },
  longbow: { id: 'longbow', name: 'Longbow .50', short: 'AWP', price: 4000, damage: 110, headMult: 2, mag: 5, reserve: 15, gap: 1.15, reload: 2.8, spreadStill: 0.0008, spreadMove: 0.04, auto: false, pellets: 1, barrel: 0.62, zoom: 30 },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

const GEO = {
  receiver: new THREE.BoxGeometry(0.09, 0.11, 0.4),
  stock: new THREE.BoxGeometry(0.075, 0.09, 0.24),
  sight: new THREE.BoxGeometry(0.03, 0.06, 0.12),
  grip: new THREE.BoxGeometry(0.07, 0.14, 0.09),
};

function barrelGeo(len) {
  return new THREE.BoxGeometry(0.045, 0.045, len);
}

export function createWeapons(camera) {
  const model = new THREE.Group();
  model.position.set(0.27, -0.23, -0.48);
  camera.add(model);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.27, -0.2, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(0xffc46b, 0, 6);
  flashLight.position.set(0.27, -0.19, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'p9',
    mag: WEAPONS.p9.mag,
    reserve: WEAPONS.p9.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    scoped: false,
    grenades: 0,
    armor: 0,
  };
  const owned = new Set(['p9']);

  function buildModel(def) {
    while (model.children.length) model.remove(model.children[0]);
    const receiver = new THREE.Mesh(GEO.receiver, material('steel'));
    const barrel = new THREE.Mesh(barrelGeo(def.barrel), material('dark'));
    barrel.position.set(0, 0.03, -0.2 - def.barrel / 2);
    const stock = new THREE.Mesh(GEO.stock, material('dark'));
    stock.position.set(0, -0.02, 0.3);
    const sight = new THREE.Mesh(GEO.sight, material('ink'));
    sight.position.set(0, 0.085, -0.05);
    const grip = new THREE.Mesh(GEO.grip, material('dark'));
    grip.position.set(0, -0.1, 0.12);
    grip.rotation.x = 0.35;
    model.add(receiver, barrel, stock, sight, grip);
    flash.position.z = -0.6 - def.barrel;
  }

  buildModel(WEAPONS.p9);

  function def() {
    return WEAPONS[state.current];
  }

  return {
    state,
    owned,
    def,
    switchTo(id) {
      if (!owned.has(id) || id === state.current) return false;
      if (state.reloadLeft > 0) return false;
      state.current = id;
      const d = WEAPONS[id];
      state.mag = d.mag;
      state.reserve = d.reserve;
      state.cooldown = 0.25;
      state.scoped = false;
      buildModel(d);
      return true;
    },
    give(id) {
      if (owned.has(id)) return false;
      owned.add(id);
      return true;
    },
    resetLoadout() {
      owned.clear();
      owned.add('p9');
      state.current = 'p9';
      state.mag = WEAPONS.p9.mag;
      state.reserve = WEAPONS.p9.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      state.scoped = false;
      state.grenades = 0;
      state.armor = 0;
      buildModel(WEAPONS.p9);
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    pullTrigger() {
      const d = def();
      state.cooldown = d.gap;
      state.flash = 0.06;
      state.kick = d.id === 'longbow' ? 0.12 : d.id === 'breacher' ? 0.1 : 0.05;
    },
    reload() {
      const d = def();
      if (state.reloadLeft > 0 || state.mag === d.mag || state.reserve === 0) return false;
      state.reloadLeft = d.reload;
      state.scoped = false;
      return true;
    },
    spread(speed) {
      const d = def();
      const moving = Math.min(1, speed / 5.2);
      const scoped = state.scoped ? 0.35 : 1;
      return (d.spreadStill + moving * d.spreadMove) * scoped;
    },
    setScoped(value) {
      state.scoped = value && def().zoom > 0 && state.reloadLeft === 0;
    },
    step(dt) {
      state.cooldown = Math.max(0, state.cooldown - dt);
      state.flash = Math.max(0, state.flash - dt);
      state.kick += (0 - state.kick) * Math.min(1, dt * 14);
      model.position.z = -0.48 + state.kick;
      model.rotation.x = state.kick * 2.2;
      flash.visible = state.flash > 0;
      if (state.flash > 0) flash.rotation.z = state.flash * 40;
      flashLight.intensity = state.flash > 0 ? 16 : 0;
      if (state.reloadLeft > 0) {
        state.reloadLeft = Math.max(0, state.reloadLeft - dt);
        const d = def();
        model.rotation.x = -0.55 * Math.min(1, (d.reload - state.reloadLeft) * 2);
        if (state.reloadLeft === 0) {
          const need = d.mag - state.mag;
          const take = Math.min(need, state.reserve);
          state.mag += take;
          state.reserve -= take;
        }
      }
    },
  };
}

// Grenades: a fixed pool of 8. Each holds position, velocity and fuse; the
// simulation bounces them off the world's boxes and calls onDetonate at zero.
export function createGrenades(colliders, onDetonate) {
  const pool = [];
  for (let i = 0; i < 8; i += 1) {
    pool.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      fuse: 0,
      owner: null,
      mesh: null,
    });
  }
  const geo = new THREE.SphereGeometry(0.09, 10, 8);
  const mat = material('hazard');

  return {
    pool,
    attach(scene) {
      for (const g of pool) {
        g.mesh = new THREE.Mesh(geo, mat);
        g.mesh.visible = false;
        scene.add(g.mesh);
      }
    },
    throwFrom(origin, dir, owner, power = 13) {
      const slot = pool.find((g) => !g.active);
      if (!slot) return false;
      slot.active = true;
      slot.pos.copy(origin);
      slot.vel.copy(dir).multiplyScalar(power);
      slot.vel.y += 3.2;
      slot.fuse = 1.6;
      slot.owner = owner;
      slot.mesh.visible = true;
      slot.mesh.position.copy(origin);
      return true;
    },
    step(dt) {
      for (const g of pool) {
        if (!g.active) continue;
        g.fuse -= dt;
        g.vel.y -= 14 * dt;
        g.pos.addScaledVector(g.vel, dt);
        // Floor and wall bounce: clamp against each collider box.
        if (g.pos.y < 0.09) {
          g.pos.y = 0.09;
          g.vel.y = Math.abs(g.vel.y) * 0.45;
          g.vel.x *= 0.7;
          g.vel.z *= 0.7;
        }
        for (let i = 0; i < colliders.length; i += 1) {
          const b = colliders[i];
          if (g.pos.x > b.min.x - 0.09 && g.pos.x < b.max.x + 0.09 && g.pos.y > b.min.y - 0.09 && g.pos.y < b.max.y + 0.09 && g.pos.z > b.min.z - 0.09 && g.pos.z < b.max.z + 0.09) {
            const dxMin = Math.abs(g.pos.x - (b.min.x - 0.09));
            const dxMax = Math.abs(g.pos.x - (b.max.x + 0.09));
            const dyMin = Math.abs(g.pos.y - (b.min.y - 0.09));
            const dyMax = Math.abs(g.pos.y - (b.max.y + 0.09));
            const dzMin = Math.abs(g.pos.z - (b.min.z - 0.09));
            const dzMax = Math.abs(g.pos.z - (b.max.z + 0.09));
            const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
            if (m === dxMin || m === dxMax) g.vel.x = -g.vel.x * 0.45;
            else if (m === dyMin || m === dyMax) g.vel.y = -g.vel.y * 0.45;
            else g.vel.z = -g.vel.z * 0.45;
            g.vel.x *= 0.85;
            g.vel.y *= 0.85;
            g.vel.z *= 0.85;
            break;
          }
        }
        g.mesh.position.copy(g.pos);
        if (g.fuse <= 0) {
          g.active = false;
          g.mesh.visible = false;
          onDetonate(g.pos, g.owner);
        }
      }
    },
    clear() {
      for (const g of pool) {
        g.active = false;
        if (g.mesh) g.mesh.visible = false;
      }
    },
  };
}
