// Render-only effects, all pooled: tracer lines, impact sparks and explosion
// flashes. Nothing here allocates per frame; every slot is created once and
// reused, so a long firefight never grows memory. The simulation never waits
// on these — they are pure feedback.
import * as THREE from 'three';

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < 16; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }

  const sparks = [];
  const sparkGeo = new THREE.PlaneGeometry(0.14, 0.14);
  for (let i = 0; i < 12; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(sparkGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    sparks.push({ mesh, life: 0, vel: new THREE.Vector3() });
  }

  const blasts = [];
  for (let i = 0; i < 2; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0, depthWrite: false }),
    );
    mesh.visible = false;
    scene.add(mesh);
    const light = new THREE.PointLight(0xff8a2a, 0, 14);
    scene.add(light);
    blasts.push({ mesh, light, life: 0 });
  }

  function nextFree(list) {
    for (const item of list) if (item.life <= 0) return item;
    return list[0];
  }

  return {
    tracer(from, to) {
      const slot = nextFree(tracers);
      const pos = slot.line.geometry.attributes.position.array;
      pos[0] = from.x;
      pos[1] = from.y;
      pos[2] = from.z;
      pos[3] = to.x;
      pos[4] = to.y;
      pos[5] = to.z;
      slot.line.geometry.attributes.position.needsUpdate = true;
      slot.line.material.opacity = 0.85;
      slot.line.visible = true;
      slot.life = 0.09;
    },
    sparksAt(point, count, rng) {
      for (let i = 0; i < count; i += 1) {
        const slot = nextFree(sparks);
        slot.mesh.position.copy(point);
        slot.mesh.lookAt(point.x + rng.range(-1, 1), point.y + rng.range(-1, 1), point.z + rng.range(-1, 1));
        slot.vel.set(rng.range(-2, 2), rng.range(0.5, 3), rng.range(-2, 2));
        slot.mesh.material.opacity = 0.95;
        slot.mesh.visible = true;
        slot.life = 0.28;
      }
    },
    explosion(point) {
      const slot = nextFree(blasts);
      slot.mesh.position.copy(point);
      slot.mesh.scale.setScalar(0.4);
      slot.mesh.material.opacity = 0.85;
      slot.mesh.visible = true;
      slot.light.position.copy(point);
      slot.light.position.y += 0.5;
      slot.light.intensity = 60;
      slot.life = 0.45;
    },
    step(dt) {
      for (const t of tracers) {
        if (t.life <= 0) continue;
        t.life -= dt;
        t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
        if (t.life <= 0) t.line.visible = false;
      }
      for (const s of sparks) {
        if (s.life <= 0) continue;
        s.life -= dt;
        s.mesh.position.addScaledVector(s.vel, dt);
        s.vel.y -= 9 * dt;
        s.mesh.material.opacity = Math.max(0, s.life / 0.28) * 0.95;
        if (s.life <= 0) s.mesh.visible = false;
      }
      for (const b of blasts) {
        if (b.life <= 0) continue;
        b.life -= dt;
        const k = 1 - Math.max(0, b.life / 0.45);
        b.mesh.scale.setScalar(0.4 + k * 5.4);
        b.mesh.material.opacity = Math.max(0, b.life / 0.45) * 0.85;
        b.light.intensity = Math.max(0, b.life / 0.45) * 60;
        if (b.life <= 0) {
          b.mesh.visible = false;
          b.light.intensity = 0;
        }
      }
    },
  };
}
