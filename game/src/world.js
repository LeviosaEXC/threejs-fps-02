// Kestrel Yard: an original dusk rail yard, 44 x 30 m. Ember attacks from the
// south, Hollow defends from the north. Two bomb sites: A Depot (west, stacked
// containers) and B Silo (east, a tank and pipes). Three lanes link them: A-long
// on the west, B-long on the east, and mid through the double doors. Every solid
// box is a collider and stops bullets; tall boxes also block bot sightlines.
// The waypoint graph is hand-authored: bots pathfind over it with BFS.
import * as THREE from 'three';
import { material } from './palette.js';

export const SITES = {
  A: { name: 'A Depot', x: -16, z: -8, radius: 4.6 },
  B: { name: 'B Silo', x: 16, z: -8, radius: 4.6 },
};

export const SPAWNS = {
  ember: [
    [-8, 12], [-4, 12.4], [0, 12.6], [4, 12.4], [8, 12],
  ],
  hollow: [
    [-8, -12], [-4, -12.4], [0, -12.6], [4, -12.4], [8, -12],
  ],
};

// Waypoint graph: id -> [x, z], plus undirected edges. Bots walk node to node.
export const WAYPOINTS = {
  E0: [-8, 12], E1: [0, 12], E2: [8, 12],
  H0: [-8, -12], H1: [0, -12], H2: [8, -12],
  M0: [-6, 6], M1: [0, 5], M2: [6, 6], M3: [0, 0], M4: [-6, -2], M5: [6, -2], M6: [0, -6],
  A0: [-16, 8], A1: [-18, 2], A2: [-18, -4], A3: [-16, -8], A4: [-12, -8], A5: [-10, -2],
  B0: [16, 8], B1: [18, 2], B2: [18, -4], B3: [16, -8], B4: [12, -8], B5: [10, -2],
  C0: [-12, 6], C1: [12, 6],
};

export const EDGES = [
  ['E0', 'M0'], ['E0', 'C0'], ['E1', 'M1'], ['E2', 'M2'], ['E2', 'C1'],
  ['M0', 'M1'], ['M1', 'M2'], ['M0', 'C0'], ['M2', 'C1'], ['M1', 'M3'],
  ['M3', 'M4'], ['M3', 'M5'], ['M4', 'M6'], ['M5', 'M6'],
  ['M4', 'A5'], ['M5', 'B5'], ['A5', 'A4'], ['B5', 'B4'], ['A4', 'A3'], ['B4', 'B3'],
  ['C0', 'A0'], ['C1', 'B0'], ['A0', 'A1'], ['B0', 'B1'], ['A1', 'A2'], ['B1', 'B2'],
  ['A2', 'A3'], ['B2', 'B3'], ['A1', 'M4'], ['B1', 'M5'],
  ['M6', 'H1'], ['M4', 'H0'], ['M5', 'H2'], ['H0', 'H1'], ['H1', 'H2'],
  ['A4', 'M6'], ['B4', 'M6'], ['A3', 'B3'],
];

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const shootables = [];
  const losBlockers = [];

  function box(w, h, d, x, y, z, matName, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(matName, opts.mat ?? {}));
    mesh.position.set(x, y, z);
    if (opts.ry) mesh.rotation.y = opts.ry;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const collider = new THREE.Box3().setFromObject(mesh);
    colliders.push(collider);
    shootables.push(mesh);
    if (h >= 2) losBlockers.push(mesh);
    return mesh;
  }

  function pad(w, d, x, z, matName) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), material(matName));
    mesh.position.set(x, 0.03, z);
    mesh.receiveShadow = true;
    group.add(mesh);
    shootables.push(mesh);
    return mesh;
  }

  function lamp(x, z) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8), material('steel'));
    pole.position.set(x, 2.6, z);
    pole.castShadow = true;
    group.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.3), material('lamp'));
    head.position.set(x, 5.25, z);
    group.add(head);
    const light = new THREE.PointLight(0xff9a3c, 22, 16, 1.8);
    light.position.set(x, 5.0, z);
    group.add(light);
    colliders.push(new THREE.Box3().setFromObject(pole));
  }

  // Floor and perimeter, 5 m walls, open sky above.
  box(44.4, 0.4, 30.4, 0, -0.2, 0, 'asphalt');
  box(0.5, 5, 30.4, -22.2, 2.5, 0, 'concrete');
  box(0.5, 5, 30.4, 22.2, 2.5, 0, 'concrete');
  box(44.4, 5, 0.5, 0, 2.5, -15.2, 'concrete');
  box(44.4, 5, 0.5, 0, 2.5, 15.2, 'concrete');

  // Mid spine: two wall stubs leaving a 4 m double-doors gap at the centre.
  box(8, 4.2, 0.6, -10, 2.1, 0, 'concrete');
  box(8, 4.2, 0.6, 10, 2.1, 0, 'concrete');
  box(0.6, 4.2, 6, -6, 2.1, 0, 'concrete');
  box(0.6, 4.2, 6, 6, 2.1, 0, 'concrete');
  pad(4.4, 0.8, 0, 0, 'hazard');

  // Site A Depot: stacked containers and crates.
  box(6, 2.6, 2.6, -18.5, 1.3, -10.5, 'rust');
  box(6, 2.6, 2.6, -18.5, 3.9, -10.5, 'teal');
  box(2.6, 2.6, 2.6, -13.5, 1.3, -11.5, 'ochre');
  box(1.4, 1.1, 1.4, -14.5, 0.55, -6.5, 'concrete');
  box(1.4, 1.1, 1.4, -17.5, 0.55, -5.5, 'concrete');
  pad(7, 7, -16, -8, 'hazard');
  // Site B Silo: a tank, pipes and crates.
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 6.4, 20), material('steel'));
  silo.position.set(19, 3.2, -11.5);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3().setFromObject(silo));
  shootables.push(silo);
  losBlockers.push(silo);
  box(0.8, 0.8, 9, 14.5, 0.4, -11, 'rust');
  box(2.6, 2.6, 2.6, 13.5, 1.3, -6, 'teal');
  box(1.4, 1.1, 1.4, 17.5, 0.55, -5.5, 'concrete');
  pad(7, 7, 16, -8, 'hazard');

  // Mid cover: crates and a low wall so the centre lane has angles to hold.
  box(2.2, 1.1, 1.2, -3.5, 0.55, 3.2, 'concrete');
  box(1.2, 1.1, 2.2, 3.5, 0.55, 3.2, 'concrete');
  box(3.6, 1.0, 1.0, 0, 0.5, -3.4, 'rust');
  box(1.6, 1.1, 1.6, -9, 0.55, -4.5, 'ochre');
  box(1.6, 1.1, 1.6, 9, 0.55, -4.5, 'ochre');

  // Lane cover on both longs.
  box(1.2, 1.1, 3.4, -18, 0.55, 3.5, 'concrete');
  box(1.2, 1.1, 3.4, 18, 0.55, 3.5, 'concrete');
  box(2.4, 2.4, 1.4, -19.5, 1.2, -1.5, 'teal');
  box(2.4, 2.4, 1.4, 19.5, 1.2, -1.5, 'rust');

  // Spawn cover.
  box(2.4, 1.1, 1.2, -5, 0.55, 9.5, 'concrete');
  box(2.4, 1.1, 1.2, 5, 0.55, 9.5, 'concrete');
  box(2.4, 1.1, 1.2, -5, 0.55, -9.5, 'concrete');
  box(2.4, 1.1, 1.2, 5, 0.55, -9.5, 'concrete');

  // Site beacons: tall emissive strips so each site reads from across the yard.
  for (const site of Object.values(SITES)) {
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.6, 8), material('ember'));
    beacon.position.set(site.x - 3.4, 2.3, site.z - 3.4);
    group.add(beacon);
    const beaconB = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 4.6, 8), material('ember'));
    beaconB.position.set(site.x + 3.4, 2.3, site.z + 3.4);
    group.add(beaconB);
  }

  // Sodium lamps.
  lamp(-10, 4);
  lamp(10, 4);
  lamp(-10, -10);
  lamp(10, -10);

  // Distant skyline silhouettes outside the walls, for depth in the vista.
  const skyline = new THREE.Group();
  const skyMat = new THREE.MeshBasicMaterial({ color: 0x161a21 });
  const skySeed = [28, 34, 26, 40, 31, 36, 29, 44, 33, 38, 27, 35];
  skySeed.forEach((h, i) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(5, h, 5), skyMat);
    const angle = (i / skySeed.length) * Math.PI * 2;
    b.position.set(Math.cos(angle) * 52, h / 2 - 1, Math.sin(angle) * 52);
    skyline.add(b);
  });
  scene.add(skyline);

  // Light: low dusk sun from the west, cool sky fill.
  const sky = new THREE.HemisphereLight(0x4a5a7d, 0x2a2320, 1.9);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.8);
  sun.position.set(-26, 16, 8);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 80;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(0x5a6a8a, 0.8);
  fill.position.set(18, 12, 14);
  scene.add(fill);

  return { colliders, shootables, losBlockers, group };
}
