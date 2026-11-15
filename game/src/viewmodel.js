// Weapon view models: assembled parts with material variation — a real
// barrel, receiver, magazine and stock per class, never a single scaled
// box. Muzzle flash is a brief additive sprite at the muzzle; it never
// leaves a persistent artifact in frame.
import * as THREE from 'three';

const M = {
  metal: new THREE.MeshStandardMaterial({ color: 0x2a2f33, roughness: 0.45, metalness: 0.75 }),
  polymer: new THREE.MeshStandardMaterial({ color: 0x1c1f22, roughness: 0.85, metalness: 0.1 }),
  copper: new THREE.MeshStandardMaterial({ color: 0xc97b3d, roughness: 0.4, metalness: 0.7 }),
  jade: new THREE.MeshStandardMaterial({ color: 0x9fd8b4, roughness: 0.5, metalness: 0.3 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x3a2e22, roughness: 0.9 }),
};

function part(w, h, d, mat, x, y, z, rx = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  if (rz) m.rotation.z = rz;
  return m;
}

function cyl(r, len, mat, x, y, z, rx = Math.PI / 2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 12), mat);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  return m;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  gr.addColorStop(0, 'rgba(255,240,190,1)');
  gr.addColorStop(0.4, 'rgba(255,170,60,0.85)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class ViewModel {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    this.root.position.set(0.32, -0.3, -0.62);
    this.root.rotation.y = 0.06;
    this.root.scale.setScalar(0.72);
    camera.add(this.root);
    this.models = {};
    this.muzzle = new THREE.Group();
    this.flashMat = new THREE.SpriteMaterial({ map: flashTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false });
    this.flash = new THREE.Sprite(this.flashMat);
    this.flash.scale.setScalar(0.22);
    this.muzzle.add(this.flash);
    this.root.add(this.muzzle);
    this.models.pistol = this.buildPistol();
    this.models.smg = this.buildSmg();
    this.models.rifle = this.buildRifle();
    this.models.dmr = this.buildDmr();
    this.models.shotgun = this.buildShotgun();
    this.current = null;
    this.kick = 0; this.kickPitch = 0;
    this.bobT = 0; this.reloadT = -1; this.switchT = 0;
    this.adsAmt = 0;
    this.setWeapon('pistol');
  }

  buildPistol() {
    const g = new THREE.Group();
    g.add(part(0.055, 0.05, 0.24, M.metal, 0, 0.02, -0.08)); // slide
    g.add(part(0.045, 0.045, 0.05, M.copper, 0, 0.045, -0.19)); // front sight block
    g.add(part(0.05, 0.13, 0.06, M.grip, 0, -0.06, 0.03, 0.25)); // grip
    g.add(part(0.05, 0.03, 0.1, M.polymer, 0, -0.005, -0.02)); // frame
    g.add(cyl(0.014, 0.06, M.metal, 0, 0.02, -0.22)); // barrel tip
    this.muzzlePos = { x: 0, y: 0.02, z: -0.26 };
    return g;
  }

  buildSmg() {
    const g = new THREE.Group();
    g.add(part(0.06, 0.08, 0.34, M.metal, 0, 0, -0.1)); // receiver
    g.add(cyl(0.028, 0.22, M.polymer, 0, 0.005, -0.36)); // shrouded barrel
    g.add(part(0.05, 0.06, 0.16, M.polymer, 0, -0.01, -0.22)); // handguard
    g.add(part(0.045, 0.12, 0.05, M.grip, 0, -0.09, -0.05, 0.15)); // mag (straight)
    g.add(part(0.04, 0.1, 0.04, M.grip, 0, -0.08, -0.18, -0.2)); // foregrip
    g.add(part(0.05, 0.07, 0.12, M.polymer, 0, 0.01, 0.14)); // stock
    g.add(part(0.02, 0.02, 0.06, M.jade, 0, 0.05, -0.05)); // accent rail
    return g;
  }

  buildRifle() {
    const g = new THREE.Group();
    g.add(part(0.065, 0.09, 0.42, M.metal, 0, 0, -0.08)); // receiver
    g.add(cyl(0.024, 0.3, M.metal, 0, 0.01, -0.42)); // barrel
    g.add(part(0.07, 0.07, 0.24, M.polymer, 0, 0, -0.28)); // handguard
    for (let i = 0; i < 3; i++) g.add(part(0.072, 0.02, 0.02, M.metal, 0, 0.035, -0.2 - i * 0.07)); // vents
    g.add(part(0.05, 0.16, 0.06, M.grip, 0, -0.11, -0.02, 0.35)); // curved mag
    g.add(part(0.05, 0.1, 0.05, M.grip, 0, -0.08, 0.08, 0.3)); // pistol grip
    g.add(part(0.055, 0.08, 0.18, M.polymer, 0, 0.005, 0.2)); // stock
    g.add(part(0.02, 0.03, 0.1, M.copper, 0, 0.055, -0.08)); // copper rail accent
    return g;
  }

  buildDmr() {
    const g = new THREE.Group();
    g.add(part(0.06, 0.08, 0.5, M.metal, 0, 0, -0.06)); // long receiver
    g.add(cyl(0.02, 0.42, M.metal, 0, 0.01, -0.5)); // long barrel
    g.add(cyl(0.035, 0.1, M.copper, 0, 0.01, -0.68)); // muzzle brake
    g.add(cyl(0.032, 0.2, M.metal, 0, 0.075, -0.1, 0)); // scope tube
    g.add(cyl(0.04, 0.04, M.metal, 0, 0.075, -0.2, 0));
    g.add(cyl(0.04, 0.04, M.metal, 0, 0.075, 0.0, 0));
    g.add(part(0.045, 0.11, 0.05, M.grip, 0, -0.09, 0.0, 0.2)); // mag
    g.add(part(0.05, 0.07, 0.22, M.polymer, 0, 0.005, 0.24)); // stock + cheek rest
    g.add(part(0.055, 0.02, 0.1, M.jade, 0, 0.05, 0.2)); // cheek pad
    return g;
  }

  buildShotgun() {
    const g = new THREE.Group();
    g.add(part(0.07, 0.09, 0.4, M.metal, 0, 0, -0.06)); // receiver
    g.add(cyl(0.032, 0.42, M.metal, 0, 0.02, -0.44)); // thick barrel
    g.add(cyl(0.026, 0.4, M.metal, 0, -0.045, -0.42)); // mag tube
    g.add(part(0.07, 0.06, 0.16, M.grip, 0, -0.035, -0.3)); // pump
    g.add(part(0.05, 0.09, 0.05, M.grip, 0, -0.08, 0.08, 0.3)); // grip
    g.add(part(0.06, 0.08, 0.16, M.polymer, 0, 0.005, 0.2)); // stock
    g.add(part(0.02, 0.02, 0.08, M.copper, 0, 0.05, -0.1)); // bead sight
    return g;
  }

  setWeapon(id) {
    if (this.current === id) return;
    if (this.current) this.root.remove(this.models[this.current]);
    this.current = id;
    this.root.add(this.models[id]);
    this.switchT = 1;
    const muzzleZ = { pistol: -0.26, smg: -0.48, rifle: -0.58, dmr: -0.72, shotgun: -0.66 }[id];
    this.muzzle.position.set(0, 0.01, muzzleZ);
  }

  fire() {
    this.kick = 1;
    this.kickPitch = 1;
    this.flashMat.opacity = 0.95;
    this.flash.scale.setScalar(0.2 + Math.random() * 0.12);
  }

  startReload() { this.reloadT = 0; }
  setReloadProgress(t) { this.reloadT = t; }

  update(dt, moving, ads, scoped) {
    this.kick = Math.max(0, this.kick - dt * 7);
    this.kickPitch = Math.max(0, this.kickPitch - dt * 5);
    this.flashMat.opacity = Math.max(0, this.flashMat.opacity - dt * 22);
    this.bobT += dt * (moving ? 9 : 4);
    const bobAmp = moving ? 0.012 : 0.004;
    this.adsAmt += ((ads ? 1 : 0) - this.adsAmt) * Math.min(1, dt * 10);
    const baseX = 0.32, baseY = -0.3, baseZ = -0.62;
    const adsX = 0, adsY = -0.21, adsZ = -0.5;
    let x = baseX + (adsX - baseX) * this.adsAmt;
    let y = baseY + (adsY - baseY) * this.adsAmt + Math.sin(this.bobT) * bobAmp;
    let z = baseZ + (adsZ - baseZ) * this.adsAmt + this.kick * 0.09;
    if (this.switchT > 0) {
      this.switchT = Math.max(0, this.switchT - dt * 4);
      y -= Math.sin(this.switchT * Math.PI) * 0.09;
    }
    if (this.reloadT >= 0) {
      const t = this.reloadT;
      y -= Math.sin(Math.min(1, t) * Math.PI) * 0.14;
      this.root.rotation.x = Math.sin(Math.min(1, t) * Math.PI) * 0.5;
      if (t >= 1) { this.reloadT = -1; this.root.rotation.x = 0; }
    }
    this.root.position.set(x, y, z);
    this.root.rotation.x = (this.root.rotation.x || 0) * 0.9 + this.kickPitch * 0.05;
    this.root.rotation.y = 0.06 - this.adsAmt * 0.06;
    this.root.visible = !scoped;
  }
}
