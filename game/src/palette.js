// The look plan, in one place. Dusk over an industrial rail yard: cold blue-grey
// concrete and asphalt, rust and ochre containers, sodium lamps, and one ember
// accent. The same names are the CSS custom properties in index.html, so the HUD
// and the 3D scene share one palette. No other colour appears in the code.
import * as THREE from 'three';

export const PALETTE = {
  sky: '#20242e',
  asphalt: '#26292f',
  concrete: '#3b4046',
  steel: '#4a545e',
  rust: '#a4552f',
  teal: '#2f6f6a',
  ochre: '#c08a2d',
  hazard: '#e8b93a',
  lamp: '#ff9a3c',
  ember: '#ff7a2f',
  ink: '#ece7db',
  muted: '#98a0a8',
  ally: '#ff7a2f',
  foe: '#37c8b8',
};

const cache = new Map();

export function material(name, extra = {}) {
  const key = `${name}|${JSON.stringify(extra)}`;
  let mat = cache.get(key);
  if (mat) return mat;
  const base = {
    asphalt: { color: 0x26292f, roughness: 0.96, metalness: 0.0 },
    concrete: { color: 0x3b4046, roughness: 0.94, metalness: 0.02 },
    steel: { color: 0x4a545e, roughness: 0.55, metalness: 0.55 },
    rust: { color: 0xa4552f, roughness: 0.85, metalness: 0.15 },
    teal: { color: 0x2f6f6a, roughness: 0.8, metalness: 0.2 },
    ochre: { color: 0xc08a2d, roughness: 0.8, metalness: 0.15 },
    hazard: { color: 0xe8b93a, roughness: 0.6, metalness: 0.1 },
    lamp: { color: 0xff9a3c, roughness: 0.5, metalness: 0.0, emissive: 0xff9a3c, emissiveIntensity: 1.6 },
    ember: { color: 0xff7a2f, roughness: 0.5, metalness: 0.1, emissive: 0xff7a2f, emissiveIntensity: 0.9 },
    ink: { color: 0xece7db, roughness: 0.6, metalness: 0.05 },
    ally: { color: 0xff7a2f, roughness: 0.6, metalness: 0.1 },
    foe: { color: 0x37c8b8, roughness: 0.6, metalness: 0.1 },
    dark: { color: 0x17191d, roughness: 0.9, metalness: 0.05 },
  }[name] ?? { color: 0x3b4046, roughness: 0.9, metalness: 0.0 };
  mat = new THREE.MeshStandardMaterial({ ...base, ...extra });
  cache.set(key, mat);
  return mat;
}

export function hex(name) {
  return PALETTE[name] ?? '#3b4046';
}
