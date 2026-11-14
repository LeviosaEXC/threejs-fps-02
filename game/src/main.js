// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. All game state lives in the modules; this file wires them,
// resolves the player's shots, and stages deterministic captures for
// ?shot=start|play|buy|end, which render twice, freeze, and set
// window.__shotReady. Verification hooks live on window.__fps.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeRng } from './rng.js';
import { createWorld, SPAWNS, SITES } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapons, createGrenades, WEAPONS } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch, BUY_TIME } from './match.js';
import { createEffects } from './effects.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const rng = makeRng(seed * 7919 + 13);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.18;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.sky), 26, 70);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
if (shot) audio.setMuted(true);
const effects = createEffects(scene);
const player = createPlayer(world.colliders);
const weapons = createWeapons(camera);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;

const me = { hp: 100, armor: 0, alive: true };
const playerFacade = {
  get pos() { return player.state.position; },
  get alive() { return me.alive; },
};

const grenades = createGrenades(world.colliders, (pos, owner) => explode(pos, owner));
grenades.attach(scene);

const shootables = () => world.shootables.concat(bots.hitMeshes());

const bots = createBots(scene, world.colliders, world.losBlockers, rng, {
  shootables,
  player: () => playerFacade,
  bombState: () => match.state.bomb.state,
  bombSite: () => (match.state.bomb.site ? SITES[match.state.bomb.site] : SITES.A),
  onBotShot(bot, eye, dir) {
    raycaster.set(eye, dir);
    const hit = raycaster.intersectObjects(shootables(), false)[0];
    const end = hit ? hit.point : tmpEnd.copy(eye).addScaledVector(dir, 30);
    effects.tracer(eye, end);
    if (bot.pos.distanceTo(player.state.position) < 40) audio.distantShot();
    bots.hear(bot.pos, 26, bot);
  },
  onBotHit(victim, dmg, head, attacker) {
    const killed = bots.damage(victim, dmg, head);
    if (killed) {
      hud.feed(`${attacker.name} ▸ ${victim.name}${head ? ' (headshot)' : ''}`, now);
      if (victim.carrier) match.carrierDied(victim.pos);
    }
  },
  onPlayerHit(dmg, head, attacker) {
    if (!me.alive) return;
    let rest = dmg;
    if (me.armor > 0) {
      const absorbed = Math.min(me.armor, rest * 0.5);
      me.armor -= absorbed;
      rest -= absorbed;
    }
    me.hp -= rest;
    hud.hurt();
    audio.hurt();
    if (me.hp <= 0) {
      me.hp = 0;
      me.alive = false;
      match.dropBombAt(player.state.position);
      hud.banner('ELIMINATED', `${attacker.name} got you — your squad fights on`, 4, now);
      input.releaseLock();
    }
  },
  onWallHit(point) {
    effects.sparksAt(point, 3, rng);
  },
  onBotDied() {},
  onPlantDone(bot) {
    match.botPlanted(bot.objective, bot.pos);
  },
  onDefuseDone() {
    match.botDefused();
  },
});

const hud = createHud({
  onBuy(itemId) {
    const result = match.buy(itemId, weapons);
    if (result.ok) {
      audio.buy();
      hud.setMoney(match.state.money);
      hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
      hud.showBuy(match.state.phase === 'buy', match.state.timer, weapons, match.state.money);
    } else {
      audio.denied();
      hud.hint(result.why);
    }
  },
});

const match = createMatch(rng, {
  onRoundStart(round) {
    resetRound();
    hud.setScore(match.state.score.ember, match.state.score.hollow, round);
    hud.showBuy(true, BUY_TIME, weapons, match.state.money);
    hud.banner(`ROUND ${round}`, 'Buy phase — press B for the buy menu', 3, now);
  },
  onLive() {
    hud.showBuy(false, 0, weapons, match.state.money);
    hud.banner('GO', 'Plant the spike at A or B', 2.5, now);
  },
  onRoundEnd(winner, reason, score) {
    hud.setScore(score.ember, score.hollow, match.state.round);
    const won = winner === 'ember';
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, 4, now);
    if (won) audio.roundWin();
    else audio.roundLose();
  },
  onMatchEnd(winner, score) {
    const title = winner === 'ember' ? 'MATCH WON' : winner === 'hollow' ? 'MATCH LOST' : 'MATCH DRAWN';
    hud.showOverlay('match', { title, sub: `Ember ${score.ember} — ${score.hollow} Hollow. First to 5.` });
    input.releaseLock();
  },
  onPlant(site, pos) {
    hud.banner('SPIKE PLANTED', `Site ${site} — 35 seconds to detonation`, 3, now);
    hud.setBomb(`SPIKE PLANTED — SITE ${site}`);
    spikeMesh.position.copy(pos);
    spikeMesh.visible = true;
    audio.plantBeep();
  },
  onDetonate(pos) {
    explode(pos, 'spike');
    hud.setBomb('SPIKE DETONATED');
  },
  onDefuse() {
    hud.banner('SPIKE DEFUSED', 'Hollow holds the yard', 3, now);
    hud.setBomb('SPIKE DEFUSED');
    spikeMesh.visible = false;
  },
  onBombDropped(pos) {
    hud.hint('Spike dropped — walk over it to pick it up');
    spikeMesh.position.copy(pos);
    spikeMesh.visible = true;
  },
  onBombPickedUp(who) {
    hud.hint(who === 'player' ? 'You carry the spike — plant it at A or B' : `${who} picked up the spike`);
    spikeMesh.visible = false;
  },
});

// The spike prop: a small dark case with an ember core, shown while dropped
// or planted so the objective is always visible.
const spikeMesh = new THREE.Group();
const spikeCase = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.5, metalness: 0.4 }));
const spikeCore = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.1), new THREE.MeshBasicMaterial({ color: 0xff7a2f }));
spikeCore.position.y = 0.08;
spikeMesh.add(spikeCase, spikeCore);
spikeMesh.visible = false;
scene.add(spikeMesh);
const spikeLight = new THREE.PointLight(0xff7a2f, 0, 5);
spikeMesh.add(spikeLight);

const dir = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmp = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const EMPTY_KEYS = new Set();
let now = 0;
let elapsed = 0;
let accumulator = 0;
let lastTime = performance.now();
let frozen = false;
let started = false;
let shake = 0;
let beepTimer = 0;
let prevFiring = false;
let buyOpen = false;
let scopeFov = 74;

function resetRound() {
  me.hp = 100;
  me.armor = 0;
  me.alive = true;
  player.teleport(SPAWNS.ember[0][0], SPAWNS.ember[0][1], 0);
  weapons.resetLoadout();
  grenades.clear();
  bots.reset(SPAWNS);
  spikeMesh.visible = false;
  hud.setHealth(100, 0);
  hud.setMoney(match.state.money);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, 0);
  hud.setBomb('SPIKE WITH YOU — PLANT AT A OR B');
  hud.hint('');
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
  } else if (match.state.phase !== 'matchend' && me.alive) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (match.state.phase === 'matchend') {
    match.startMatch();
    resetRound();
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  input.requestLock();
});

function syncCamera() {
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  if (shake > 0) {
    camera.rotation.x += (rng.next() * 2 - 1) * shake * 0.02;
    camera.rotation.y += (rng.next() * 2 - 1) * shake * 0.02;
  }
  const targetFov = weapons.state.scoped ? 30 : 74;
  if (Math.abs(scopeFov - targetFov) > 0.1) {
    scopeFov += (targetFov - scopeFov) * 0.25;
    camera.fov = scopeFov;
    camera.updateProjectionMatrix();
  }
  hud.setScoped(weapons.state.scoped);
}

function explode(pos, owner) {
  effects.explosion(pos);
  audio.explosion();
  shake = 1;
  const hurt = (targetPos, hp, armor, apply) => {
    const d = Math.hypot(targetPos.x - pos.x, targetPos.y - pos.y, targetPos.z - pos.z);
    if (d > 7) return;
    const dmg = Math.round(95 * (1 - d / 7) + 10);
    apply(dmg, armor);
    void hp;
  };
  if (me.alive) {
    hurt(player.state.position, me.hp, me.armor, (dmg) => {
      let rest = dmg;
      if (me.armor > 0) {
        const absorbed = Math.min(me.armor, rest * 0.5);
        me.armor -= absorbed;
        rest -= absorbed;
      }
      me.hp -= rest;
      hud.hurt();
      if (me.hp <= 0) {
        me.hp = 0;
        me.alive = false;
        match.dropBombAt(player.state.position);
        hud.banner('ELIMINATED', 'Caught by the blast', 4, now);
        input.releaseLock();
      }
    });
  }
  for (const bot of bots.bots) {
    if (!bot.alive) continue;
    hurt(bot.pos, bot.hp, bot.armor, (dmg) => {
      const killed = bots.damage(bot, dmg, false);
      if (killed) {
        hud.feed(`${owner === 'player' ? 'You' : owner} ▸ ${bot.name} (blast)`, now);
        if (owner === 'player') match.awardKill();
        if (bot.carrier) match.carrierDied(bot.pos);
      }
    });
  }
  void owner;
}

function shootPlayer() {
  const d = weapons.def();
  if (!weapons.takeRound()) {
    audio.dryClick();
    return;
  }
  camera.getWorldDirection(dir);
  muzzle.copy(camera.position);
  tmp.set(0.27, -0.2, -1.0);
  camera.localToWorld(tmp);
  muzzle.copy(tmp);
  let anyHit = false;
  for (let p = 0; p < d.pellets; p += 1) {
    const spread = weapons.spread(player.groundSpeed());
    const jx = (rng.next() * 2 - 1) * spread;
    const jy = (rng.next() * 2 - 1) * spread;
    const jz = (rng.next() * 2 - 1) * spread;
    tmp.copy(dir);
    tmp.x += jx;
    tmp.y += jy;
    tmp.z += jz;
    tmp.normalize();
    raycaster.set(camera.position, tmp);
    const hit = raycaster.intersectObjects(shootables(), false)[0];
    const end = hit ? hit.point : tmpEnd.copy(camera.position).addScaledVector(tmp, 60);
    effects.tracer(muzzle, end);
    if (!hit) continue;
    const data = hit.object.userData;
    if (data && data.bot) {
      const victim = data.bot;
      if (victim.alive && victim.team !== 'ember') {
        const dmg = d.damage * (data.part === 'head' ? d.headMult : data.part === 'legs' ? 0.75 : 1);
        const killed = bots.damage(victim, dmg, data.part === 'head');
        hud.hitMarker(killed);
        audio.hit();
        if (killed) {
          audio.kill();
          match.awardKill();
          hud.feed(`You ▸ ${victim.name}${data.part === 'head' ? ' (headshot)' : ''}`, now);
          if (victim.carrier) match.carrierDied(victim.pos);
        }
        anyHit = true;
      }
    } else if (hit) {
      effects.sparksAt(hit.point, 3, rng);
    }
  }
  void anyHit;
  weapons.pullTrigger();
  player.recoil(0.011 + rng.next() * 0.004, (rng.next() * 2 - 1) * 0.004);
  audio.shot();
  bots.hear(player.state.position, 30, null);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, d.name, weapons.state.grenades);
}

function step(dt) {
  now += dt;
  elapsed += dt;
  const phase = match.state.phase;
  const keys = input.state.keys;

  if (input.wasPressed('KeyB') && phase === 'buy') {
    buyOpen = !buyOpen;
    hud.showBuy(buyOpen, match.state.timer, weapons, match.state.money);
  }
  if (buyOpen && phase === 'buy') {
    const buyKeys = { Digit1: 'hornet', Digit2: 'kestrel', Digit3: 'breacher', Digit4: 'longbow', Digit5: 'grenade', Digit6: 'armor' };
    for (const [code, item] of Object.entries(buyKeys)) {
      if (input.wasPressed(code)) {
        const result = match.buy(item, weapons);
        if (result.ok) {
          audio.buy();
          hud.setMoney(match.state.money);
          hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
          hud.showBuy(true, match.state.timer, weapons, match.state.money);
        } else {
          audio.denied();
          hud.hint(result.why);
        }
      }
    }
  }
  if (buyOpen && phase !== 'buy') {
    buyOpen = false;
    hud.showBuy(false, 0, weapons, match.state.money);
  }

  if (me.alive && phase !== 'buy') {
    player.step(dt, keys);
  } else if (phase === 'buy') {
    player.step(dt, EMPTY_KEYS);
  }
  const look = input.takeLook();
  if (me.alive) player.look(look.x, look.y);

  // Weapon switching.
  const slots = ['p9', 'hornet', 'kestrel', 'breacher', 'longbow'];
  slots.forEach((id, i) => {
    if (input.wasPressed(`Digit${i + 1}`) && !buyOpen) {
      if (weapons.switchTo(id)) {
        hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
      }
    }
  });
  if (input.wasPressed('KeyR') && me.alive) {
    if (weapons.reload()) audio.reload();
  }
  if (input.wasPressed('KeyG') && me.alive && phase === 'live' && weapons.state.grenades > 0) {
    camera.getWorldDirection(dir);
    muzzle.copy(camera.position);
    if (grenades.throwFrom(muzzle, dir, 'player')) {
      weapons.state.grenades -= 1;
      hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
    }
  }

  // Firing: auto weapons hold, semi weapons fire on the press edge.
  if (me.alive && phase === 'live') {
    const d = weapons.def();
    const firing = input.state.firing;
    if (d.auto) {
      if (firing && weapons.ready()) shootPlayer();
    } else if (firing && !prevFiring && weapons.ready()) {
      shootPlayer();
    }
  }
  prevFiring = input.state.firing;

  // Plant / defuse channel on E.
  const channelProgress = match.channel(dt, playerFacade, keys.has('KeyE'));
  hud.setChannel(channelProgress, match.state.bomb.state === 'planted' ? 'Defusing…' : 'Planting…');

  weapons.step(dt);
  grenades.step(dt);
  bots.step(dt, now, playerFacade, phase);
  match.step(dt, { player: playerFacade, bots });
  effects.step(dt);

  // Planted spike beeps once a second.
  if (match.state.bomb.state === 'planted') {
    beepTimer -= dt;
    if (beepTimer <= 0) {
      beepTimer = 1;
      audio.plantBeep();
      spikeLight.intensity = 6;
    }
    spikeLight.intensity = Math.max(0, spikeLight.intensity - dt * 8);
  }

  shake = Math.max(0, shake - dt * 3);
  hud.setHealth(me.hp, me.armor);
  hud.setMoney(match.state.money);
  hud.setTimer(match.state.timer, phase);
  hud.setPips((me.alive ? 1 : 0) + bots.aliveCount('ember'), bots.aliveCount('hollow'));
  hud.hideBanner(now);
  hud.setCrosshair(weapons.spread(player.groundSpeed()));
  if (match.state.bomb.state === 'planted') {
    hud.setBomb(`SPIKE PLANTED — SITE ${match.state.bomb.site} — ${Math.ceil(match.state.bomb.fuse)}s`);
  } else if (match.state.bomb.state === 'dropped') {
    hud.setBomb('SPIKE DROPPED — RECOVER IT');
  } else if (match.state.bomb.state === 'with-bot') {
    hud.setBomb('SPIKE WITH YOUR SQUAD');
  }
  input.endFrame();
}

function frame(time) {
  requestAnimationFrame(frame);
  const dt = Math.min((time - lastTime) / 1000, 0.1);
  lastTime = time;
  if (!frozen) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function aimAt(point) {
  const dx = point.x - player.state.position.x;
  const dy = point.y - (player.state.position.y + player.state.eye);
  const dz = point.z - player.state.position.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
  syncCamera();
}

function runShot(name) {
  hud.hideOverlay();
  buyOpen = false;
  hud.showBuy(false, 0, weapons, match.state.money);
  match.startMatch();
  resetRound();
  if (name === 'start') {
    player.teleport(0, 13.5, 0);
    settle(20);
    aimAt(new THREE.Vector3(0, 2, -10));
    hud.showOverlay('start');
    hud.setScore(0, 0, 1);
  } else if (name === 'play') {
    match.state.phase = 'live';
    match.state.timer = 74;
    hud.showBuy(false, 0, weapons, match.state.money);
    player.teleport(0, 9, 0);
    bots.bots[4].pos.set(2, 0, -6);
    bots.bots[4].parts.group.position.copy(bots.bots[4].pos);
    bots.bots[5].pos.set(-3, 0, -9);
    bots.bots[5].parts.group.position.copy(bots.bots[5].pos);
    settle(20);
    aimAt(new THREE.Vector3(2, 1.4, -6));
    shootPlayer();
    settle(6);
    aimAt(new THREE.Vector3(2, 1.4, -6));
    hud.banner('GO', 'Plant the spike at A or B', 2.5, now);
  } else if (name === 'buy') {
    buyOpen = true;
    hud.showBuy(true, BUY_TIME, weapons, match.state.money);
    player.teleport(0, 12.6, Math.PI);
    settle(10);
    aimAt(new THREE.Vector3(0, 1.6, -8));
  } else if (name === 'end') {
    match.state.score.ember = 3;
    match.state.score.hollow = 2;
    match.state.round = 6;
    match.state.phase = 'end';
    match.state.timer = 4;
    match.state.winner = 'ember';
    match.state.reason = 'Spike detonated';
    hud.setScore(3, 2, 6);
    hud.banner('ROUND WON', 'Spike detonated', 4, now);
    hud.showBuy(false, 0, weapons, match.state.money);
    player.teleport(6, 8, Math.PI * 0.75);
    settle(10);
    aimAt(new THREE.Vector3(16, 2, -8));
  }
  hud.setHealth(me.hp, me.armor);
  hud.setAmmo(weapons.state.mag, weapons.state.reserve, weapons.def().name, weapons.state.grenades);
  hud.setMoney(match.state.money);
  hud.setTimer(match.state.timer, match.state.phase);
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Right mouse scopes the Longbow.
window.addEventListener('mousedown', (event) => {
  if (event.button === 2 && input.state.locked) weapons.setScoped(true);
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 2) weapons.setScoped(false);
});

// Debug hook: state reads, deterministic stepping and input injection, so
// verification never needs a human holding keys. Audio stays muted here.
window.__fps = {
  snapshot() {
    return {
      phase: match.state.phase,
      round: match.state.round,
      score: { ...match.state.score },
      timer: +match.state.timer.toFixed(2),
      money: match.state.money,
      player: {
        x: +player.state.position.x.toFixed(2),
        z: +player.state.position.z.toFixed(2),
        hp: me.hp,
        alive: me.alive,
        mag: weapons.state.mag,
      },
      emberAlive: (me.alive ? 1 : 0) + bots.aliveCount('ember'),
      hollowAlive: bots.aliveCount('hollow'),
      bomb: match.state.bomb.state,
      bots: bots.bots.map((b) => ({ name: b.name, team: b.team, hp: b.hp, alive: b.alive, x: +b.pos.x.toFixed(1), z: +b.pos.z.toFixed(1), state: b.state })),
    };
  },
  step(n = 60) {
    for (let i = 0; i < n; i += 1) step(FIXED_STEP);
    syncCamera();
    return this.snapshot();
  },
  press(code) { input.injectDown(code); },
  release(code) { input.injectUp(code); },
  look(dx, dy) { input.injectLook(dx, dy); },
  fire() { shootPlayer(); },
  teleport(x, z, yaw) { player.teleport(x, z, yaw); },
  setPhaseLive() { match.state.phase = 'live'; match.state.timer = 90; },
  buy(item) { return match.buy(item, weapons); },
  setMoney(n) { match.state.money = n; },
  pacify() {
    for (const bot of bots.bots) {
      bot.target = null;
      bot.state = 'hold';
      bot.holdUntil = now + 600;
      bot.thinkTimer = 1e9;
      bot.burstLeft = 0;
      bot.path = [];
    }
  },
  killPlayer() { me.hp = 0; me.alive = false; match.dropBombAt(player.state.position); },
};

bots.spawnAll(SPAWNS);
match.startMatch();
resetRound();
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
