// Bots: nine teammates and opponents with routes, vision, hearing and bomb
// roles. Each bot runs a small state machine — advance along the waypoint
// graph, hold an angle, investigate a noise, plant or defuse — and fires
// hitscan bursts only after a reaction delay, with spread that grows with
// distance and target speed. Vision is a staggered cone check with a real
// line-of-sight ray against the tall geometry; hearing pulls bots toward
// recent gunfire. One shared Raycaster and scratch vectors serve all bots.
import * as THREE from 'three';
import { WAYPOINTS, EDGES, SITES } from './world.js';
import { material } from './palette.js';

const BOT_NAMES = {
  ember: ['Ash', 'Cinder', 'Flint', 'Soot'],
  hollow: ['Vane', 'Gale', 'Mist', 'Reed', 'Onyx'],
};

const RADIUS = 0.34;
const WALK_SPEED = 3.7;
const EYE = 1.55;
const VISION_RANGE = 55;
const VISION_HALF_FOV = 1.05;
const BOT_DAMAGE = 20;

const ADJ = {};
for (const [a, b] of EDGES) {
  (ADJ[a] ??= []).push(b);
  (ADJ[b] ??= []).push(a);
}

function nearestNode(x, z) {
  let best = null;
  let bestD = Infinity;
  for (const [id, [nx, nz]] of Object.entries(WAYPOINTS)) {
    const d = (nx - x) * (nx - x) + (nz - z) * (nz - z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

function bfsPath(from, to) {
  if (from === to) return [to];
  const prev = { [from]: null };
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of ADJ[cur] ?? []) {
      if (prev[next] !== undefined) continue;
      prev[next] = cur;
      if (next === to) {
        const path = [to];
        let node = to;
        while (prev[node]) {
          node = prev[node];
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

export function createBots(scene, colliders, losBlockers, rng, hooks) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 80;
  const tmpDir = new THREE.Vector3();
  const tmpTo = new THREE.Vector3();
  const tmpEye = new THREE.Vector3();
  const probe = new THREE.Box3();
  const bots = [];

  function makeMesh(team) {
    const g = new THREE.Group();
    const cloth = team === 'ember' ? material('rust') : material('teal');
    const dark = material('dark');
    const stripe = material(team === 'ember' ? 'ally' : 'foe');
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.72, 0.3), cloth);
    torso.position.y = 1.08;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), dark);
    head.position.y = 1.62;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, 0.02), stripe);
    visor.position.set(0, 1.64, 0.16);
    const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.22), dark);
    legL.position.set(-0.14, 0.34, 0);
    const legR = legL.clone();
    legR.position.x = 0.14;
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.62), dark);
    gun.position.set(0.2, 1.15, -0.3);
    g.add(torso, head, visor, legL, legR, gun);
    g.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
      }
    });
    return { group: g, torso, head, legL, legR, gun };
  }

  function spawnBot(team, index, spawn) {
    const parts = makeMesh(team);
    scene.add(parts.group);
    const bot = {
      team,
      index,
      name: BOT_NAMES[team][index],
      pos: new THREE.Vector3(spawn[0], 0, spawn[1]),
      vel: new THREE.Vector3(),
      yaw: team === 'ember' ? 0 : Math.PI,
      hp: 100,
      armor: 0,
      alive: true,
      state: 'advance',
      path: [],
      pathIndex: 0,
      holdUntil: 0,
      target: null,
      lastSeen: new THREE.Vector3(),
      seenAt: -99,
      reactUntil: 0,
      burstLeft: 0,
      burstTimer: 0,
      fireTimer: 0,
      thinkTimer: index * 0.03,
      channel: 0,
      channelKind: null,
      carrier: false,
      objective: team === 'ember' ? (rng.chance(0.5) ? 'A' : 'B') : null,
      parts,
      walkPhase: rng.range(0, 6),
    };
    parts.torso.userData = { bot, part: 'body' };
    parts.head.userData = { bot, part: 'head' };
    parts.legL.userData = { bot, part: 'legs' };
    parts.legR.userData = { bot, part: 'legs' };
    parts.group.position.copy(bot.pos);
    parts.group.rotation.y = bot.yaw;
    bots.push(bot);
    return bot;
  }

  function hits(x, y, z, height) {
    probe.min.set(x - RADIUS, y + 0.04, z - RADIUS);
    probe.max.set(x + RADIUS, y + height - 0.04, z + RADIUS);
    for (let i = 0; i < colliders.length; i += 1) {
      if (probe.intersectsBox(colliders[i])) return true;
    }
    return false;
  }

  function moveBot(bot, dt) {
    if (!bot.alive) return;
    if (bot.pathIndex >= bot.path.length) {
      bot.vel.set(0, 0, 0);
      return;
    }
    const [tx, tz] = WAYPOINTS[bot.path[bot.pathIndex]];
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      bot.pathIndex += 1;
      return;
    }
    const vx = (dx / dist) * WALK_SPEED;
    const vz = (dz / dist) * WALK_SPEED;
    bot.vel.set(vx, 0, vz);
    bot.yaw = Math.atan2(-dx, -dz);
    const nx = bot.pos.x + vx * dt;
    if (!hits(nx, bot.pos.y, bot.pos.z, 1.72)) bot.pos.x = nx;
    const nz = bot.pos.z + vz * dt;
    if (!hits(bot.pos.x, bot.pos.y, nz, 1.72)) bot.pos.z = nz;
    bot.walkPhase += dt * 9;
    const swing = Math.sin(bot.walkPhase) * 0.35;
    bot.parts.legL.rotation.x = swing;
    bot.parts.legR.rotation.x = -swing;
  }

  function setPath(bot, targetNode) {
    const from = nearestNode(bot.pos.x, bot.pos.z);
    bot.path = bfsPath(from, targetNode);
    bot.pathIndex = 0;
  }

  function canSee(bot, targetPos) {
    tmpTo.copy(targetPos).sub(bot.pos);
    tmpTo.y = 0;
    const dist = tmpTo.length();
    if (dist > VISION_RANGE) return false;
    const angle = Math.atan2(-tmpTo.x, -tmpTo.z);
    let diff = angle - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > VISION_HALF_FOV) return false;
    tmpEye.set(bot.pos.x, bot.pos.y + EYE, bot.pos.z);
    tmpDir.copy(targetPos).setY(targetPos.y + 1.2).sub(tmpEye).normalize();
    raycaster.set(tmpEye, tmpDir);
    raycaster.far = dist + 1;
    const hit = raycaster.intersectObjects(losBlockers, false)[0];
    return !hit;
  }

  // Ray vs player body: the player has no mesh in the shootable list, so a bot
  // shot is tested analytically against the player's standing capsule. A wall
  // or another bot hit closer than the player still blocks the shot.
  const tmpCenter = new THREE.Vector3();
  const tmpRel = new THREE.Vector3();

  function fireAt(bot, targetPos, targetBot, now, dt) {
    if (bot.burstLeft <= 0) return;
    bot.fireTimer -= dt;
    if (bot.fireTimer > 0) return;
    bot.fireTimer = 0.11;
    bot.burstLeft -= 1;
    tmpEye.set(bot.pos.x, bot.pos.y + EYE, bot.pos.z);
    tmpDir.copy(targetPos).setY(targetPos.y + 1.15).sub(tmpEye);
    const dist = tmpDir.length();
    tmpDir.normalize();
    const spread = 0.028 + dist * 0.0006;
    tmpDir.x += (rng.next() * 2 - 1) * spread;
    tmpDir.y += (rng.next() * 2 - 1) * spread;
    tmpDir.z += (rng.next() * 2 - 1) * spread;
    tmpDir.normalize();
    hooks.onBotShot(bot, tmpEye, tmpDir);
    raycaster.set(tmpEye, tmpDir);
    raycaster.far = 80;
    const meshes = hooks.shootables();
    const hit = raycaster.intersectObjects(meshes, false)[0];
    const hitDist = hit ? hit.distance : Infinity;
    // Player capsule test.
    const player = hooks.player();
    if (player.alive && targetBot === 'player') {
      tmpCenter.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
      tmpRel.copy(tmpCenter).sub(tmpEye);
      const along = tmpRel.dot(tmpDir);
      if (along > 0 && along < hitDist) {
        const px = tmpEye.x + tmpDir.x * along;
        const py = tmpEye.y + tmpDir.y * along;
        const pz = tmpEye.z + tmpDir.z * along;
        const perp = Math.hypot(px - tmpCenter.x, py - tmpCenter.y, pz - tmpCenter.z);
        if (perp < 0.5) {
          const head = py > player.pos.y + 1.35;
          hooks.onPlayerHit(BOT_DAMAGE * (head ? 4 : 1), head, bot);
          return;
        }
      }
    }
    if (!hit) return;
    const data = hit.object.userData;
    if (!data || !data.bot) {
      hooks.onWallHit(hit.point);
      return;
    }
    const victim = data.bot;
    if (victim === bot || !victim.alive) return;
    if (victim.team === bot.team) return;
    const dmg = BOT_DAMAGE * (data.part === 'head' ? 4 : data.part === 'legs' ? 0.75 : 1);
    hooks.onBotHit(victim, dmg, data.part === 'head', bot);
    void now;
  }

  function think(bot, now, player, phase) {
    // Pick the nearest visible enemy: the player for Hollow, Hollow bots for Ember.
    // No acquisition outside the live phase: the buy freeze is a truce.
    let best = null;
    let bestD = Infinity;
    if (phase === 'live') {
      const foes = [];
      if (bot.team === 'hollow' && player.alive) foes.push({ pos: player.pos, isPlayer: true, ref: player });
      for (const other of bots) {
        if (other.team !== bot.team && other.alive) foes.push({ pos: other.pos, isPlayer: false, ref: other });
      }
      for (const foe of foes) {
        const d = bot.pos.distanceTo(foe.pos);
        if (d < bestD && canSee(bot, foe.pos)) {
          bestD = d;
          best = foe;
        }
      }
    }
    if (best) {
      bot.lastSeen.copy(best.pos);
      bot.seenAt = now;
      if (bot.reactUntil <= 0) bot.reactUntil = now + 0.28 + bestD * 0.004;
      bot.target = best;
    } else if (now - bot.seenAt > 2.5) {
      bot.target = null;
      bot.reactUntil = 0;
    }

    if (bot.target && now >= bot.reactUntil) {
      // Face the target and fire in bursts.
      tmpTo.copy(bot.lastSeen).sub(bot.pos);
      bot.yaw = Math.atan2(-tmpTo.x, -tmpTo.z);
      if (bot.burstLeft <= 0 && bot.fireTimer <= 0) {
        bot.burstLeft = 3 + Math.floor(rng.next() * 3);
        bot.fireTimer = 0.5 + rng.next() * 0.5;
      }
    }

    // Bomb roles. The carrier bot only plants when it holds the spike itself.
    if (bot.team === 'ember' && hooks.bombState() === 'with-bot' && bot.carrier && !bot.target) {
      if (bot.state !== 'plant' && bot.channelKind !== 'plant') {
        const site = SITES[bot.objective];
        const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
        if (d < site.radius - 1) {
          bot.state = 'plant';
          bot.path = [];
          bot.channelKind = 'plant';
          bot.channel = 0;
        } else if (bot.state !== 'advance' || bot.pathIndex >= bot.path.length) {
          setPath(bot, bot.objective === 'A' ? 'A3' : 'B3');
          bot.state = 'advance';
        }
      }
    }
    if (hooks.bombState() === 'planted' && bot.team === 'hollow' && !bot.target) {
      const site = hooks.bombSite();
      if (bot.channelKind !== 'defuse') {
        const d = Math.hypot(site.x - bot.pos.x, site.z - bot.pos.z);
        if (d < 2.5) {
          bot.state = 'defuse';
          bot.path = [];
          bot.channelKind = 'defuse';
          bot.channel = 0;
        } else if (bot.state !== 'advance' || bot.pathIndex >= bot.path.length) {
          setPath(bot, site === SITES.A ? 'A3' : 'B3');
          bot.state = 'advance';
        }
      }
    }
    if (bot.state === 'hold' && now >= bot.holdUntil) {
      bot.state = 'advance';
      pickRoute(bot);
    }
    if (bot.state === 'advance' && bot.pathIndex >= bot.path.length) {
      if (rng.chance(0.45)) {
        bot.state = 'hold';
        bot.holdUntil = now + rng.range(2, 5);
      } else {
        pickRoute(bot);
      }
    }
  }

  function pickRoute(bot) {
    if (bot.team === 'ember') {
      const dest = rng.chance(0.55) ? (bot.objective === 'A' ? 'A3' : 'B3') : rng.pick(['M3', 'M4', 'M5', 'A5', 'B5']);
      setPath(bot, dest);
    } else {
      const dest = rng.pick(['A3', 'B3', 'A4', 'B4', 'M6', 'M4', 'M5', 'A5', 'B5']);
      setPath(bot, dest);
    }
    bot.state = 'advance';
  }

  function hear(pos, radius, exceptBot) {
    for (const bot of bots) {
      if (!bot.alive || bot === exceptBot || bot.target) continue;
      if (bot.channelKind) continue;
      if (bot.pos.distanceTo(pos) > radius) continue;
      setPath(bot, nearestNode(pos.x, pos.z));
      bot.state = 'investigate';
      bot.holdUntil = 0;
    }
  }

  function damage(bot, amount, head) {
    if (!bot.alive) return false;
    let rest = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, rest * 0.5);
      bot.armor -= absorbed;
      rest -= absorbed;
    }
    bot.hp -= rest;
    if (bot.hp <= 0) {
      bot.hp = 0;
      bot.alive = false;
      bot.channelKind = null;
      bot.state = 'dead';
      bot.parts.group.rotation.x = -Math.PI / 2;
      bot.parts.group.position.y = 0.25;
      hooks.onBotDied(bot);
      return true;
    }
    void head;
    return false;
  }

  return {
    bots,
    spawnAll(spawns) {
      for (let i = 0; i < 4; i += 1) spawnBot('ember', i, spawns.ember[i + 1]);
      for (let i = 0; i < 5; i += 1) spawnBot('hollow', i, spawns.hollow[i]);
      const carrier = bots[0];
      carrier.carrier = true;
    },
    reset(spawns) {
      for (const bot of bots) {
        bot.hp = 100;
        bot.armor = 0;
        bot.alive = true;
        bot.carrier = false;
        bot.state = 'advance';
        bot.path = [];
        bot.pathIndex = 0;
        bot.target = null;
        bot.channel = 0;
        bot.channelKind = null;
        bot.burstLeft = 0;
        bot.fireTimer = 0;
        bot.reactUntil = 0;
        bot.seenAt = -99;
        bot.parts.group.rotation.x = 0;
        bot.parts.group.position.y = 0;
      }
      bots.forEach((bot) => {
        const spawn = bot.team === 'ember' ? spawns.ember[bot.index + 1] : spawns.hollow[bot.index];
        bot.pos.set(spawn[0], 0, spawn[1]);
        bot.yaw = bot.team === 'ember' ? 0 : Math.PI;
        bot.parts.group.position.copy(bot.pos);
        bot.parts.group.rotation.y = bot.yaw;
        bot.objective = bot.team === 'ember' ? (rng.chance(0.5) ? 'A' : 'B') : null;
        pickRoute(bot);
      });
      bots[0].carrier = true;
    },
    step(dt, now, player, phase) {
      for (const bot of bots) {
        if (!bot.alive) continue;
        bot.thinkTimer -= dt;
        if (bot.thinkTimer <= 0) {
          bot.thinkTimer = 0.15;
          think(bot, now, player, phase);
        }
        if (bot.channelKind) {
          bot.channel += dt;
          bot.vel.set(0, 0, 0);
          if (bot.channelKind === 'plant' && bot.channel >= 4) {
            bot.channelKind = null;
            bot.channel = 0;
            hooks.onPlantDone(bot);
          } else if (bot.channelKind === 'defuse' && bot.channel >= 5) {
            bot.channelKind = null;
            bot.channel = 0;
            hooks.onDefuseDone(bot);
          }
        } else if (bot.target && now >= bot.reactUntil && phase === 'live') {
          bot.vel.set(0, 0, 0);
          const tgt = bot.target.isPlayer ? player.pos : bot.target.ref.pos;
          fireAt(bot, tgt, bot.target.isPlayer ? 'player' : bot.target.ref, now, dt);
        } else if (phase === 'live') {
          moveBot(bot, dt);
        }
        bot.parts.group.position.copy(bot.pos);
        bot.parts.group.rotation.y = bot.yaw;
      }
    },
    hear,
    damage,
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
    hitMeshes() {
      const list = [];
      for (const bot of bots) {
        if (!bot.alive) continue;
        list.push(bot.parts.torso, bot.parts.head, bot.parts.legL, bot.parts.legR);
      }
      return list;
    },
  };
}
