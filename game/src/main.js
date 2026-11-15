// EMBERLINE — Cinderworks Yard. Round-based 5v5 tactical FPS.
// Fixed 60 Hz simulation decoupled from rendering; one state object (G)
// holds match, economy, spike and actors; rendering/HUD/audio are thin
// layers over it. Deterministic ?shot= fixtures render the real game.
import * as THREE from 'three';
import { makeRng, clamp } from './rng.js';
import { buildWorld, groundHeight, segBlocked2D } from './world.js';
import { Actor, ALLY_NAMES, ENEMY_NAMES, PLANS, PLAN_NAMES, assignRound, updateBot, updatePlayer, botBuy, squadRotate, hearInvestigate } from './actors.js';
import { WEAPONS, GEAR, fireWeapon, reloadWeapon, finishReload, throwGrenade, updateGrenades, smokeBlocks, Effects, freshLoadout } from './weapons.js';
import { Hud } from './hud.js';
import { AudioSys } from './audio.js';
import { ViewModel } from './viewmodel.js';

const STEP = 1 / 60;
const BUY_TIME = 15, LIVE_TIME = 100, INTER_TIME = 4, FUSE_TIME = 40;
const WIN_ROUNDS = 7;

window.__errors = [];
window.addEventListener('error', (e) => window.__errors.push(String(e.message || e.error)));
window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));

class Game {
  constructor() {
    const params = new URLSearchParams(location.search);
    this.shot = params.get('shot') || null;
    this.seed = Number(params.get('seed') || 1);
    this.rng = makeRng(this.seed);
    this.audio = new AudioSys();
    this.hud = new Hud();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 220);
    this.scene.add(this.camera);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    document.getElementById('game').appendChild(this.renderer.domElement);
    this.world = buildWorld(this.scene);
    this.colliders = this.world.colliders;
    this.fx = new Effects(this.scene);
    this.viewmodel = new ViewModel(this.camera);
    this.grenades = [];
    this.smokes = [];
    this.actors = [];
    this.input = { keys: new Set(), jumpQueued: false, firing: false, ads: false, mouseDX: 0, mouseDY: 0 };
    this.time = 0;
    this.state = 'title'; // title | playing | paused | matchend
    this.phase = 'buy'; this.phaseTime = BUY_TIME; this.phaseLabel = 'BUY';
    this.round = 1; this.roundsPlayed = 0;
    this.scores = { atk: 0, def: 0 };
    this.roundHistory = [];
    this.lossStreak = { atk: 0, def: 0 };
    this.playerSide = 'atk';
    this.planName = 'A RUSH';
    this.spike = { carrier: null, planted: false, site: null, fuseLeft: 0, dropped: false, x: 0, z: 0, beepAt: 0 };
    this.objProgress = null;
    this.spectating = null;
    this.playerFlash = 0;
    this.buyOpen = false;
    this.mvpLabel = '';
    this.clutchFlag = false;
    this.roundMvp = {};
    this.acc = 0; this.lastT = performance.now() / 1000;
    this.buildActors();
    this.wireInput();
    if (this.shot) this.setupShot();
    else this.showTitle();
    if (!this.shot) requestAnimationFrame((t) => this.frame(t));
  }

  buildActors() {
    this.player = new Actor(0, 'ALCHEMIST', 'atk', true, 0, 17);
    this.actors.push(this.player);
    ALLY_NAMES.forEach((n, i) => {
      const a = new Actor(1 + i, n, 'atk', false, -10 + i * 6, 17);
      a.buildMesh(this.scene);
      this.actors.push(a);
    });
    ENEMY_NAMES.forEach((n, i) => {
      const a = new Actor(5 + i, n, 'def', false, -16 + i * 8, -15);
      a.buildMesh(this.scene);
      this.actors.push(a);
    });
  }

  showTitle() {
    this.state = 'title';
    this.hud.showOverlay('title-screen');
  }

  // ---------- match flow ----------
  startMatch() {
    this.scores = { atk: 0, def: 0 };
    this.roundHistory = [];
    this.lossStreak = { atk: 0, def: 0 };
    this.round = 1; this.roundsPlayed = 0;
    this.playerSide = 'atk';
    this.mvpLabel = '';
    // A fresh match always starts with the canonical sides (player + named
    // allies attack, named enemies defend). Without this reset, a match
    // restarted after a side swap (halftime, or the harness's setSide)
    // would keep the flipped teams while playerSide resets to 'atk' — the
    // player would then be on the defending team while the HUD and the
    // objective logic treat them as the attacker.
    for (const a of this.actors) {
      a.team = (a.isPlayer || ALLY_NAMES.includes(a.name)) ? 'atk' : 'def';
      if (!a.isPlayer) a.setSideColor('atk');
    }
    for (const a of this.actors) {
      a.kills = 0; a.deaths = 0; a.assists = 0; a.shots = 0; a.hits = 0; a.headshots = 0;
      a.money = 800;
      a.loadout = freshLoadout();
    }
    this.state = 'playing';
    this.startBuyPhase();
  }

  startBuyPhase() {
    this.phase = 'buy'; this.phaseTime = BUY_TIME; this.phaseLabel = 'BUY';
    this.planName = PLAN_NAMES[this.rng.int(0, PLAN_NAMES.length - 1)];
    // Respawn + replenish ammo; bots spend their money.
    const atkSpawns = this.world.spawns.atk, defSpawns = this.world.spawns.def;
    const atk = this.actors.filter((a) => a.team === 'atk');
    const def = this.actors.filter((a) => a.team === 'def');
    atk.forEach((a, i) => { const s = atkSpawns[i % atkSpawns.length]; a.resetForRound(s[0], s[1], 'atk'); });
    def.forEach((a, i) => { const s = defSpawns[i % defSpawns.length]; a.resetForRound(s[0], s[1], 'def'); });
    for (const a of this.actors) {
      const L = a.loadout;
      const w = WEAPONS[L.weapon];
      L.mag = w.mag; L.reserve = w.reserve;
      if (!a.isPlayer) botBuy(this, a);
    }
    this.spike = { carrier: null, planted: false, site: null, fuseLeft: 0, dropped: false, x: 0, z: 0, beepAt: 0 };
    this.spectating = null;
    this.objProgress = null;
    this.clutchFlag = false;
    this.roundMvp = {};
    assignRound(this, this.planName);
    this.hud.banner(`ROUND ${this.round} — ${this.planName}`, this.playerSide === 'atk' ? 'Plant the relay spike at A or B · first to 7' : 'Hold the sites · first to 7', 3.5);
    this.audio.roundStart();
  }

  startLive() {
    this.phase = 'live'; this.phaseTime = LIVE_TIME; this.phaseLabel = 'LIVE';
  }

  endRound(winner, reason) {
    if (this.phase === 'intermission' || this.state !== 'playing') return;
    this.roundsPlayed++;
    this.roundHistory.push(winner);
    this.scores[winner]++;
    const loser = winner === 'atk' ? 'def' : 'atk';
    this.lossStreak[winner] = 0;
    this.lossStreak[loser]++;
    const lossBonus = Math.min(1900 + 500 * (this.lossStreak[loser] - 1), 3400);
    for (const a of this.actors) {
      if (!a.alive) continue;
      a.money = Math.min(9000, a.money + (a.team === winner ? 3250 : lossBonus));
    }
    // Death resets equipment to the free pistol + one flash.
    for (const a of this.actors) {
      if (!a.alive) {
        a.loadout = freshLoadout();
        a.money = Math.min(9000, a.money);
      }
    }
    // MVP / clutch labels.
    let mvp = null, mk = -1;
    for (const a of this.actors) {
      const rk = (this.roundMvp[a.id] || 0);
      if (rk > mk) { mk = rk; mvp = a; }
    }
    const aliveWin = this.actors.filter((a) => a.team === winner && a.alive).length;
    const clutch = this.clutchFlag && aliveWin <= 2;
    this.mvpLabel = mvp ? `ROUND MVP — ${mvp.name} · ${mk} elimination${mk === 1 ? '' : 's'}${clutch ? ' · CLUTCH' : ''}` : '';
    const youWon = winner === this.playerSide;
    this.hud.banner(youWon ? 'ROUND WON' : 'ROUND LOST', `${reason} · ${this.scores.atk} : ${this.scores.def}${clutch ? ' · CLUTCH' : ''}`, 3.5);
    if (youWon) this.audio.roundWin(); else this.audio.roundLose();
    this.phase = 'intermission'; this.phaseTime = INTER_TIME; this.phaseLabel = 'NEXT ROUND';
    if (this.scores[winner] >= WIN_ROUNDS) {
      this.endMatch();
      return;
    }
    // Halftime: after 6 rounds, swap sides.
    if (this.roundHistory.length === 6) {
      this.halftimePending = true;
    }
  }

  endMatch() {
    this.state = 'matchend';
    this.phase = 'over'; this.phaseLabel = 'MATCH END';
    const won = this.scores[this.playerSide] >= WIN_ROUNDS;
    let mvp = null, mk = -1;
    for (const a of this.actors) if (a.kills > mk) { mk = a.kills; mvp = a; }
    this.mvpLabel = mvp ? `MATCH MVP — ${mvp.name} · ${mk} eliminations` : '';
    this.hud.populateEnd(this);
    this.hud.showOverlay('end-screen');
    document.exitPointerLock?.();
  }

  doHalftime() {
    this.halftimePending = false;
    this.playerSide = this.playerSide === 'atk' ? 'def' : 'atk';
    for (const a of this.actors) {
      a.team = a.team === 'atk' ? 'def' : 'atk';
      if (!a.isPlayer) a.setSideColor(this.playerSide);
    }
    this.hud.banner('HALFTIME — SIDES SWAPPED', this.playerSide === 'atk' ? 'You attack now. Plant the spike.' : 'You defend now. Hold the sites.', 4);
  }

  nextRound() {
    if (this.halftimePending) this.doHalftime();
    this.round++;
    this.startBuyPhase();
  }

  // ---------- combat / damage ----------
  applyDamage(victim, dmg, source, head, point) {
    if (!victim.alive || this.phase !== 'live') return;
    const L = victim.loadout;
    let remaining = dmg;
    if (L.armor > 0) {
      const absorbed = Math.min(L.armor, Math.round(dmg * 0.35));
      L.armor -= absorbed;
      remaining = dmg - absorbed;
    }
    victim.hp -= remaining;
    victim.lastDamagedBy = source;
    victim.lastDamagedAt = this.time;
    if (source && source !== victim) {
      source.hits++;
      if (head) source.headshots++;
    }
    if (victim.isPlayer) {
      const ang = Math.atan2(source ? source.pos.x - victim.pos.x : 0, source ? source.pos.z - victim.pos.z : 1);
      this.hud.hurt(((ang - victim.yaw) * 180 / Math.PI + 360) % 360);
      this.audio.hurt();
    } else if (source && source.isPlayer) {
      this.hud.hitmarker(false);
      this.audio.hit();
      if (point) {
        const s = this.project(point.x, point.y, point.z);
        if (s) this.hud.damageNumber(s.x, s.y, String(dmg), head);
      }
    }
    if (victim.hp <= 0) this.killActor(victim, source, head);
  }

  killActor(victim, source, head) {
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.deathAt = this.time;
    if (victim.mesh) {
      victim.mesh.rotation.x = -Math.PI / 2;
      victim.mesh.position.y = victim.pos.y + 0.25;
    }
    if (this.spike.carrier === victim) {
      this.spike.carrier = null;
      this.spike.dropped = true;
      this.spike.x = victim.pos.x; this.spike.z = victim.pos.z;
    }
    if (source && source !== victim) {
      source.kills++;
      source.money = Math.min(9000, source.money + 300);
      this.roundMvp[source.id] = (this.roundMvp[source.id] || 0) + 1;
      const wname = WEAPONS[source.loadout.weapon].name;
      this.hud.pushKillfeed(source.name, wname, victim.name, head);
      if (source.isPlayer) { this.hud.hitmarker(true); this.audio.kill(); }
      // Assist: someone else damaged the victim within 5 s.
      const assist = this.actors.find((a) => a !== source && a !== victim && a.team === source.team && victim.lastDamagedBy === a && this.time - victim.lastDamagedAt < 5);
      if (assist) assist.assists++;
    }
    // Clutch tracking: a team reduced to <=2 while the enemy still has >=3.
    const aliveAtk = this.actors.filter((a) => a.team === 'atk' && a.alive).length;
    const aliveDef = this.actors.filter((a) => a.team === 'def' && a.alive).length;
    if ((aliveAtk <= 2 && aliveDef >= 3) || (aliveDef <= 2 && aliveAtk >= 3)) this.clutchFlag = true;
    if (victim.isPlayer) {
      const ally = this.actors.find((a) => a.team === victim.team && a.alive && !a.isPlayer);
      this.spectating = ally || null;
    }
    // Elimination round end.
    if (aliveAtk === 0) this.endRound('def', 'ATTACKERS ELIMINATED');
    else if (aliveDef === 0) this.endRound('atk', 'DEFENDERS ELIMINATED');
  }

  // ---------- spike ----------
  completePlant(actor) {
    if (this.spike.planted || this.phase !== 'live') return;
    const site = this.siteAt(actor.pos.x, actor.pos.z);
    if (!site) return;
    this.spike.planted = true;
    this.spike.site = site;
    this.spike.fuseLeft = FUSE_TIME;
    this.spike.carrier = null;
    this.spike.dropped = false;
    actor.money = Math.min(9000, actor.money + 300);
    this.hud.banner('SPIKE PLANTED', `Detonation in ${FUSE_TIME}s — site ${site}`, 3);
    this.audio.plantBeep(false);
    // Attackers fall back to post-plant; defenders retake.
    for (const b of this.actors) {
      if (!b.isPlayer && b.alive && b.team === 'atk') b.state = 'postplant';
      if (!b.isPlayer && b.alive && b.team === 'def') b.state = 'retake';
    }
  }

  completeDefuse(actor) {
    if (!this.spike.planted) return;
    this.spike.planted = false;
    actor.money = Math.min(9000, actor.money + 300);
    this.endRound('def', 'SPIKE DEFUSED');
  }

  pickupSpike(actor) {
    if (this.spike.planted || actor.team !== 'atk') return;
    // A just-dropped spike cannot be reclaimed for 1.5 s: without this,
    // dropping it at your own feet re-picks it up on the next tick, so
    // "drop the spike for a teammate" never works.
    if (this.spike.dropAt && this.time - this.spike.dropAt < 1.5) return;
    this.spike.carrier = actor;
    this.spike.dropped = false;
    if (actor.isPlayer) this.audio.pickup();
  }

  dropSpike() {
    const p = this.player;
    if (this.spike.carrier !== p || this.spike.planted) return;
    this.spike.carrier = null;
    this.spike.dropped = true;
    this.spike.dropAt = this.time;
    this.spike.x = p.pos.x; this.spike.z = p.pos.z;
  }

  detonate() {
    const s = this.world.sites[this.spike.site];
    const sy = s.y + 1;
    this.fx.fragBurst({ x: s.x, y: sy, z: s.z });
    for (const a of this.actors) {
      if (!a.alive) continue;
      const d = Math.hypot(a.pos.x - s.x, a.pos.z - s.z);
      if (d < 10) this.applyDamage(a, Math.round(160 * (1 - d / 10)), this.player, false, { x: a.pos.x, y: a.pos.y + 1, z: a.pos.z });
    }
    this.spike.planted = false;
    this.endRound('atk', 'SPIKE DETONATED');
  }

  // ---------- economy / buy ----------
  buyItem(kind, id) {
    const p = this.player, L = p.loadout;
    if (this.phase !== 'buy') return { ok: false, msg: 'Purchases open only during the buy phase.' };
    if (kind === 'gun') {
      const w = WEAPONS[id];
      if (L.owned[id]) { this.switchWeapon(id); return { ok: true, msg: w.name + ' equipped.' }; }
      if (p.money < w.price) { this.audio.deny(); return { ok: false, msg: 'Insufficient credits for ' + w.name + '.' }; }
      p.money -= w.price;
      L.owned[id] = true;
      L.ammo = L.ammo || {};
      L.ammo[id] = { mag: w.mag, reserve: w.reserve };
      this.switchWeapon(id);
      this.audio.buy();
      return { ok: true, msg: w.name + ' requisitioned.' };
    }
    const g = GEAR[id];
    if (id === 'armor') {
      if (L.armor >= 100) return { ok: false, msg: 'Armor already full.' };
      if (p.money < g.price) { this.audio.deny(); return { ok: false, msg: 'Insufficient credits.' }; }
      p.money -= g.price; L.armor = 100; this.audio.buy();
      return { ok: true, msg: 'Ceramic plate fitted.' };
    }
    if (id === 'kit') {
      if (L.kit) return { ok: false, msg: 'Relay kit already owned.' };
      if (p.money < g.price) { this.audio.deny(); return { ok: false, msg: 'Insufficient credits.' }; }
      p.money -= g.price; L.kit = true; this.audio.buy();
      return { ok: true, msg: 'Relay kit acquired — defuse in 3.5 s.' };
    }
    if ((L.nades[id] || 0) >= 2) return { ok: false, msg: 'Utility cap: 2 of each.' };
    if (p.money < g.price) { this.audio.deny(); return { ok: false, msg: 'Insufficient credits.' }; }
    p.money -= g.price;
    L.nades[id] = (L.nades[id] || 0) + 1;
    L.nadeSel = id;
    this.audio.buy();
    return { ok: true, msg: g.name + ' added.' };
  }

  switchWeapon(id) {
    const p = this.player, L = p.loadout;
    if (!L.owned[id]) return;
    L.ammo = L.ammo || {};
    L.ammo[L.weapon] = { mag: L.mag, reserve: L.reserve };
    L.weapon = id;
    const a = L.ammo[id] || { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
    L.mag = a.mag; L.reserve = a.reserve;
    L.bloom = 0; L.reloadUntil = 0; L.pendingReload = false;
    this.viewmodel.setWeapon(id);
  }

  // ---------- helpers ----------
  siteAt(x, z) {
    for (const key of ['A', 'B']) {
      const s = this.world.sites[key];
      if (Math.hypot(x - s.x, z - s.z) < s.r) return key;
    }
    return null;
  }

  nearLane(x, z) {
    if (z > 12) return 'SPAWN';
    if (x < -6.5) return 'A LANE';
    if (x > 6.5) return 'B LANE';
    return 'MID';
  }

  enemyRevealed(a) {
    if (a.team === this.player.team) return true;
    if (this.time - (a.lastFiredAt || -99) < 2) return true;
    const p = this.player;
    const d = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z);
    if (d > 34 || d < 1) return d < 8;
    if (segBlocked2D(p.pos.x, p.pos.z, a.pos.x, a.pos.z, this.colliders)) return false;
    if (smokeBlocks(this, p.pos.x, p.eyeY(), p.pos.z, a.pos.x, a.eyeY(), a.pos.z)) return false;
    return true;
  }

  hearSound(x, z, radius, kind) {
    for (const b of this.actors) {
      if (b.isPlayer || !b.alive) continue;
      const d = Math.hypot(b.pos.x - x, b.pos.z - z);
      if (d < radius && d > 1) hearInvestigate(this, b, x, z);
    }
  }

  onPlayerFlashed(dur) {
    this.playerFlash = dur;
    this.audio.flashRing();
  }

  project(x, y, z) {
    this.camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1) return null;
    return { x: (v.x + 1) / 2 * innerWidth, y: (-v.y + 1) / 2 * innerHeight };
  }

  // ---------- input ----------
  wireInput() {
    const canvas = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (this.shot) return;
      this.input.keys.add(e.code);
      if (e.code === 'Tab' && this.state === 'playing' && !this.buyOpen) {
        this.hud.scoreboard(this);
        this.hud.showOverlay('scoreboard');
      }
      if (e.code === 'Space') { this.input.jumpQueued = true; e.preventDefault(); }
      if (e.code === 'KeyR') this.tryReload();
      if (e.code === 'KeyB') this.toggleBuy();
      if (e.code === 'KeyQ') this.cycleNade();
      if (e.code === 'KeyG') this.tryThrow();
      if (e.code === 'KeyX') this.dropSpike();
      if (e.code === 'KeyM') { this.audio.setMuted(!this.audio.muted); }
      if (e.code === 'KeyZ') this.squadCmd('A');
      if (e.code === 'KeyV') this.squadCmd('B');
      if (e.code === 'Digit1') this.switchWeapon(this.primaryWeapon() || 'pistol');
      if (e.code === 'Digit2') this.switchWeapon('pistol');
      if (e.code === 'Digit3') this.input.slotNade = true;
      if (e.code === 'Escape') this.pauseGame();
      // Buy menu hotkeys 1-5 guns, 6-0 gear.
      if (this.buyOpen) {
        const guns = ['pistol', 'smg', 'rifle', 'dmr', 'shotgun'];
        const gear = ['armor', 'kit', 'flash', 'smoke', 'frag'];
        const gi = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(e.code);
        if (gi >= 0) this.doBuy('gun', guns[gi]);
        const ei = ['Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'].indexOf(e.code);
        if (ei >= 0) this.doBuy('gear', gear[ei]);
      }
    });
    addEventListener('keyup', (e) => {
      this.input.keys.delete(e.code);
      if (e.code === 'Digit3') this.input.slotNade = false;
      if (e.code === 'Tab' && this.state === 'playing') this.hud.hideOverlays();
    });
    addEventListener('blur', () => { if (this.state === 'playing') this.pauseGame(); });
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'playing' && !this.shot) {
        if (this.expectUnlock) { this.expectUnlock = false; return; } // intentional exit (buy menu)
        this.pauseGame();
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.input.mouseDX += e.movementX;
        this.input.mouseDY += e.movementY;
      }
    });
    canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || this.shot) return;
      if (e.button === 0) this.input.firing = true;
      if (e.button === 2) this.input.ads = true;
    });
    // Fire/ADS on the window too, so a click is never swallowed when the
    // pointer is over a HUD layer (all HUD layers are pointer-events:none,
    // but a click must still reach the game if one ever intercepts it).
    // Clicks on real controls (buy cards, buttons) are excluded.
    addEventListener('mousedown', (e) => {
      if (this.state !== 'playing' || this.shot) return;
      if (e.target && e.target.closest && e.target.closest('button, .card, a, input')) return;
      if (e.button === 0) this.input.firing = true;
      if (e.button === 2) this.input.ads = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.firing = false;
      if (e.button === 2) this.input.ads = false;
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    this.hud.el['deploy-btn'].addEventListener('click', () => this.deploy());
    this.hud.el['again-btn'].addEventListener('click', () => { this.startMatch(); this.deploy(); });
    this.hud.el['resume-btn'].addEventListener('click', () => this.resume());
    this.hud.el['restart-btn'].addEventListener('click', () => { this.startMatch(); this.deploy(); });
    this.hud.el['buy-close'].addEventListener('click', () => this.toggleBuy());
    this.hud.onBuy = (kind, id) => this.doBuy(kind, id);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  primaryWeapon() {
    const L = this.player.loadout;
    for (const id of ['dmr', 'rifle', 'shotgun', 'smg']) if (L.owned[id]) return id;
    return null;
  }

  deploy() {
    this.audio.ensure();
    if (this.state === 'title') this.startMatch();
    this.hud.hideOverlays();
    this.state = 'playing';
    this.requestLock();
  }

  requestLock() {
    try {
      const p = this.renderer.domElement.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* headless or denied: play continues, look via keys/API */ }
  }

  resume() {
    this.hud.hideOverlays();
    this.state = 'playing';
    this.requestLock();
  }

  pauseGame() {
    if (this.state !== 'playing' || this.shot) return;
    this.state = 'paused';
    this.hud.showOverlay('pause-screen');
    document.exitPointerLock?.();
  }

  toggleBuy() {
    if (this.phase !== 'buy' || this.state !== 'playing') return;
    this.buyOpen = !this.buyOpen;
    if (this.buyOpen) {
      this.hud.buyRefresh(this);
      this.hud.showOverlay('buy-menu');
      this.expectUnlock = true;
      document.exitPointerLock?.();
    } else {
      this.hud.hideOverlays();
      this.requestLock();
    }
  }

  doBuy(kind, id) {
    const r = this.buyItem(kind, id);
    this.hud.buyMessage(r.msg);
    this.hud.buyRefresh(this);
  }

  tryReload() {
    if (this.state !== 'playing') return;
    if (reloadWeapon(this, this.player)) {
      this.audio.reload();
      this.viewmodel.startReload();
    }
  }

  cycleNade() {
    const L = this.player.loadout;
    const order = ['flash', 'smoke', 'frag'];
    const owned = order.filter((n) => (L.nades[n] || 0) > 0);
    if (!owned.length) return;
    const i = owned.indexOf(L.nadeSel);
    L.nadeSel = owned[(i + 1) % owned.length];
    this.audio.click();
  }

  tryThrow() {
    if (this.state !== 'playing' || this.phase !== 'live' || !this.player.alive) return;
    const g = throwGrenade(this, this.player, this.player.loadout.nadeSel);
    if (g) this.audio.click();
  }

  // One synchronous shot through the same code path as held fire (same
  // interval, mag, bloom and recoil rules). The harness calls this instead
  // of holding the trigger for a few milliseconds, which a slow frame rate
  // would swallow entirely — a real player holds the button, so the
  // per-frame path in step() is unchanged.
  fireOnce() {
    const p = this.player, L = p.loadout;
    if (this.state !== 'playing' || this.phase !== 'live' || !p.alive) return false;
    if (this.buyOpen) return false;
    const w = WEAPONS[L.weapon];
    if (L.weapon === 'none' || this.time - L.lastShot < w.interval) return false;
    if (L.mag <= 0 || this.time < L.reloadUntil) return false;
    const blinded = this.time < p.blindUntil;
    const ay = p.yaw + (blinded ? (this.rng.next() - 0.5) * 0.3 : 0);
    const ap = p.pitch - L.recoilPitch + (blinded ? (this.rng.next() - 0.5) * 0.3 : 0);
    const res = fireWeapon(this, p, ay, ap, {});
    if (!res) return false;
    p.shots += w.pellets;
    p.lastFiredAt = this.time;
    this.viewmodel.fire();
    this.audio.shot(w.id);
    this.hearSound(p.pos.x, p.pos.z, 26, 'shot');
    for (const r of res.results) {
      this.fx.tracer(res.origin, { x: r.x, y: r.y, z: r.z });
      if (!r.victim && r.wall) this.fx.impact({ x: r.x, y: r.y, z: r.z });
    }
    return true;
  }

  squadCmd(site) {
    if (this.state !== 'playing') return;
    const n = squadRotate(this, site);
    if (n) this.hud.banner(`SQUAD — ROTATE ${site}`, `${n} teammate${n === 1 ? '' : 's'} re-routing`, 2.5);
  }

  // ---------- per-tick simulation ----------
  step(dt) {
    this.time += dt;
    if (this.state !== 'playing') return;
    // Phase timer.
    if (this.phase === 'buy') {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) this.startLive();
    } else if (this.phase === 'live') {
      this.phaseTime -= dt;
      // Spike fuse.
      if (this.spike.planted) {
        this.spike.fuseLeft -= dt;
        if (this.time >= this.spike.beepAt) {
          this.audio.plantBeep(this.spike.fuseLeft < 10);
          this.spike.beepAt = this.time + 0.25 + this.spike.fuseLeft * 0.02;
        }
        if (this.spike.fuseLeft <= 0) { this.detonate(); return; }
      }
      if (this.phaseTime <= 0 && !this.spike.planted) {
        this.endRound('def', 'TIME EXPIRED — SPIKE NEVER PLANTED');
        return;
      }
    } else if (this.phase === 'intermission') {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) this.nextRound();
    }
    // Player.
    const p = this.player;
    const L = p.loadout;
    if (p.alive) {
      // Mouse look.
      p.yaw -= this.input.mouseDX * 0.0022;
      p.pitch = clamp(p.pitch - this.input.mouseDY * 0.0022, -1.45, 1.45);
      this.input.mouseDX = 0; this.input.mouseDY = 0;
      L.ads = this.input.ads && !this.input.slotNade;
      updatePlayer(this, p, this.input, dt);
      // Firing.
      const w = WEAPONS[L.weapon];
      const blinded = this.time < p.blindUntil;
      if (this.input.firing && this.phase === 'live' && !this.buyOpen) {
        const slotNade = this.input.slotNade;
        if (slotNade) {
          if (this.time - (this._lastThrow || -9) > 0.5) { this._lastThrow = this.time; this.tryThrow(); }
        } else if (this.time - L.lastShot >= w.interval && (w.auto || !this._firedThisClick)) {
          this._firedThisClick = true;
          if (L.mag > 0 && this.time >= L.reloadUntil) {
            const ay = p.yaw + (blinded ? (this.rng.next() - 0.5) * 0.3 : 0);
            const ap = p.pitch - L.recoilPitch + (blinded ? (this.rng.next() - 0.5) * 0.3 : 0);
            const res = fireWeapon(this, p, ay, ap, {});
            if (res) {
              p.shots += w.pellets;
              p.lastFiredAt = this.time;
              this.viewmodel.fire();
              this.audio.shot(w.id);
              this.hearSound(p.pos.x, p.pos.z, 26, 'shot');
              for (const r of res.results) {
                this.fx.tracer(res.origin, { x: r.x, y: r.y, z: r.z });
                if (!r.victim && r.wall) this.fx.impact({ x: r.x, y: r.y, z: r.z });
              }
            }
          } else if (L.mag <= 0) this.tryReload();
        }
      } else this._firedThisClick = false;
      if (L.pendingReload && this.time >= L.reloadUntil) {
        finishReload(p);
        this.viewmodel.setReloadProgress(1);
      }
      if (L.reloadUntil > this.time) this.viewmodel.setReloadProgress(1 - (L.reloadUntil - this.time) / WEAPONS[L.weapon].reload);
      // Plant / defuse (hold E).
      this.updateObjective(dt);
      // Spike pickup by walking over it.
      if (this.spike.dropped && p.team === 'atk') {
        if (Math.hypot(p.pos.x - this.spike.x, p.pos.z - this.spike.z) < 1.2) this.pickupSpike(p);
      }
    }
    // Bots.
    for (const b of this.actors) {
      if (b.isPlayer) continue;
      if (this.phase === 'buy') continue; // frozen at spawn during buy
      if (b.alive) updateBot(this, b, dt);
      if (b.mesh) {
        b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
        b.mesh.rotation.y = b.yaw;
        b.mesh.visible = true; // corpses stay fallen where they dropped
      }
      if (b.loadout.pendingReload && this.time >= b.loadout.reloadUntil) finishReload(b);
    }
    updateGrenades(this, dt);
    // Smoke expiry.
    this.smokes = this.smokes.filter((s) => this.time < s.until);
    // Player flash decay.
    if (this.playerFlash > 0) this.playerFlash -= dt;
  }

  updateObjective(dt) {
    const p = this.player;
    const holdingE = this.input.keys.has('KeyE');
    const site = this.siteAt(p.pos.x, p.pos.z);
    const L = p.loadout;
    if (!holdingE || !p.alive || this.phase !== 'live') {
      this.objProgress = null;
      this._objT = 0;
      return;
    }
    if (p.team === 'atk' && this.spike.carrier === p && !this.spike.planted && site) {
      this._objT = (this._objT || 0) + dt;
      this.objProgress = { label: `PLANTING SPIKE — SITE ${site}`, frac: this._objT / 4 };
      if (Math.floor(this._objT * 2) !== Math.floor((this._objT - dt) * 2)) this.audio.defuseTick();
      if (this._objT >= 4) { this._objT = 0; this.objProgress = null; this.completePlant(p); }
    } else if (p.team === 'def' && this.spike.planted && site === this.spike.site) {
      const need = L.kit ? 3.5 : 7;
      this._objT = (this._objT || 0) + dt;
      this.objProgress = { label: `DEFUSING SPIKE${L.kit ? ' (KIT)' : ''}`, frac: this._objT / need };
      if (Math.floor(this._objT * 2) !== Math.floor((this._objT - dt) * 2)) this.audio.defuseTick();
      if (this._objT >= need) { this._objT = 0; this.objProgress = null; this.completeDefuse(p); }
    } else {
      this.objProgress = null;
      this._objT = 0;
    }
  }

  // ---------- render ----------
  frame(nowMs) {
    const now = nowMs / 1000;
    let dt = now - this.lastT;
    this.lastT = now;
    if (dt > 0.25) dt = 0.25;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 8) {
      this.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    this.world.update(now);
    this.fx.update(dt, now);
    this.updateCamera(dt);
    this.viewmodel.update(dt, this.player.speed2d > 0.6, this.player.loadout.ads, this.player.loadout.ads && WEAPONS[this.player.loadout.weapon].scoped);
    if (this.state !== 'title') this.hud.update(this, now);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((t) => this.frame(t));
  }

  updateCamera(dt) {
    const p = this.player;
    const scoped = p.loadout.ads && WEAPONS[p.loadout.weapon].scoped && p.alive;
    if (this.state === 'title') {
      const t = performance.now() / 1000;
      this.camera.position.set(Math.sin(t * 0.05) * 12, 7, 14 + Math.cos(t * 0.05) * 4);
      this.camera.lookAt(0, 1.5, -8);
      this.camera.fov = 60;
      this.camera.updateProjectionMatrix();
      return;
    }
    let eye, yaw, pitch;
    if (!p.alive && this.spectating) {
      const s = this.spectating;
      eye = new THREE.Vector3(s.pos.x, s.eyeY(), s.pos.z);
      yaw = s.yaw; pitch = s.pitch;
    } else {
      eye = new THREE.Vector3(p.pos.x, p.eyeY(), p.pos.z);
      yaw = p.yaw; pitch = p.pitch - p.loadout.recoilPitch;
    }
    this.camera.position.copy(eye);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(pitch, yaw, 0);
    const targetFov = scoped ? 26 : 75;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 12);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.hud.setScope(scoped);
  }

  // ---------- deterministic shot fixtures ----------
  setupShot() {
    document.body.classList.add('shot');
    this.state = 'playing';
    this.startMatch();
    const p = this.player;
    if (this.shot === 'start') {
      this.state = 'title';
      this.hud.showOverlay('title-screen');
      this.camera.position.set(10, 6, 16);
      this.camera.lookAt(0, 1.5, -10);
    } else if (this.shot === 'play') {
      this.phase = 'live'; this.phaseTime = 72; this.phaseLabel = 'LIVE';
      this.round = 3; this.scores = { atk: 2, def: 1 };
      this.roundHistory = ['atk', 'def', 'atk'];
      this.planName = 'A RUSH';
      this.hud.banner('ROUND 3 — A RUSH', 'Plant the relay spike at A or B · first to 7', 60);
      p.money = 3200; p.hp = 82;
      this.buyItemSilent('rifle');
      p.loadout.nades = { flash: 1, smoke: 1, frag: 0 };
      // Stage: player in A lane, one big coral enemy 4.5 m ahead, centre frame.
      p.pos.set(-13, 0, 2.5); p.yaw = 0; p.pitch = 0;
      const foe = this.actors.find((a) => a.name === 'ASH');
      foe.pos.set(-13, 0, -2.0); foe.yaw = Math.PI; foe.alive = true; foe.hp = 100;
      foe.mesh.position.copy(foe.pos);
      foe.mesh.rotation.y = foe.yaw;
      this.spike.carrier = p;
      this.hud.hideOverlays();
      this.hud.setHudVisible(true);
      this.updateCamera(0.016);
      this.hud.update(this, 0);
      // Fire the real rifle function at the real enemy: genuine tracer,
      // hit feedback, damage number and live HUD state — not a pose.
      const dy = (foe.pos.y + 1.2) - p.eyeY();
      const ap = Math.atan2(dy, 4.5);
      const res = fireWeapon(this, p, 0, ap, {});
      if (res) {
        p.shots += 1;
        this.viewmodel.fire();
        for (const r of res.results) {
          this.fx.tracer(res.origin, { x: r.x, y: r.y, z: r.z });
          if (!r.victim && r.wall) this.fx.impact({ x: r.x, y: r.y, z: r.z });
        }
      }
      this.hud.pushKillfeed('SAGE', 'EMBER AR-7', 'FLINT', false);
      this.hud.pushKillfeed('ALCHEMIST', 'EMBER AR-7', 'CINDER', true);
      this.hud.update(this, 0);
    } else if (this.shot === 'buy') {
      this.phase = 'buy'; this.phaseTime = 12; this.phaseLabel = 'BUY';
      p.money = 3200;
      this.buyItemSilent('rifle');
      p.loadout.armor = 100; p.loadout.kit = true;
      p.loadout.nades = { flash: 2, smoke: 1, frag: 1 };
      this.buyOpen = true;
      this.hud.buyRefresh(this);
      this.hud.showOverlay('buy-menu');
      this.camera.position.set(0, 6, 16);
      this.camera.lookAt(0, 1.5, -10);
    } else if (this.shot === 'end') {
      this.round = 11; this.roundsPlayed = 11;
      this.scores = { atk: 7, def: 4 };
      p.kills = 18; p.deaths = 9; p.shots = 120; p.hits = 54; p.headshots = 7; p.assists = 4;
      const botStats = { SAGE: [12, 8, 90, 34, 3, 5], ORION: [9, 10, 70, 22, 2, 3], VEGA: [7, 9, 60, 18, 1, 2], NOVA: [5, 11, 55, 15, 0, 1], ASH: [14, 12, 110, 44, 5, 2], CINDER: [11, 13, 95, 36, 4, 3], FLINT: [8, 12, 80, 29, 2, 2], SLAG: [6, 10, 65, 21, 1, 1], PYRE: [9, 11, 85, 31, 3, 2] };
      for (const a of this.actors) {
        const s = botStats[a.name];
        if (s) { [a.kills, a.deaths, a.shots, a.hits, a.headshots, a.assists] = s; }
      }
      this.mvpLabel = 'MATCH MVP — ALCHEMIST · 18 eliminations · CLUTCH ROUND 9';
      this.state = 'matchend';
      this.hud.populateEnd(this);
      this.hud.showOverlay('end-screen');
      this.camera.position.set(10, 6, 16);
      this.camera.lookAt(0, 1.5, -10);
    }
    // Two renders, then signal readiness (no listeners installed in shot mode).
    this.renderer.render(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
    window.__shotReady = true;
  }

  buyItemSilent(id) {
    const p = this.player, L = p.loadout;
    const w = WEAPONS[id];
    L.owned[id] = true;
    L.ammo = L.ammo || {};
    L.ammo[id] = { mag: w.mag, reserve: w.reserve };
    this.switchWeapon(id);
  }
}

const game = new Game();

// Harness API for scripted verification (never used by the game itself).
window.__ember = {
  game,
  state() {
    const g = game;
    return {
      state: g.state, phase: g.phase, phaseTime: +g.phaseTime.toFixed(2),
      time: +g.time.toFixed(2),
      round: g.round, scores: { ...g.scores }, history: [...g.roundHistory],
      playerSide: g.playerSide, plan: g.planName,
      player: {
        hp: Math.round(g.player.hp), money: Math.round(g.player.money),
        x: +g.player.pos.x.toFixed(2), z: +g.player.pos.z.toFixed(2),
        weapon: g.player.loadout.weapon, mag: g.player.loadout.mag,
        reserve: g.player.loadout.reserve, alive: g.player.alive,
        armor: Math.round(g.player.loadout.armor), kit: g.player.loadout.kit,
        nadeSel: g.player.loadout.nadeSel,
        nades: { ...g.player.loadout.nades }, kills: g.player.kills,
      },
      spike: {
        planted: g.spike.planted, site: g.spike.site,
        fuseLeft: +g.spike.fuseLeft.toFixed(1),
        carrier: g.spike.carrier ? g.spike.carrier.name : null,
        dropped: g.spike.dropped,
        x: +g.spike.x.toFixed(2), z: +g.spike.z.toFixed(2),
      },
      actors: g.actors.map((a) => ({
        name: a.name, team: a.team, alive: a.alive, hp: Math.round(a.hp),
        x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2),
        state: a.state, plan: a.plan, money: Math.round(a.money),
        weapon: a.loadout.weapon, stuck: +a.stuckTime.toFixed(2),
      })),
      killfeed: g.hud.kfEntries.length,
      errors: [...window.__errors],
      fov: +g.camera.fov.toFixed(1),
      smokes: g.smokes.length,
      grenades: g.grenades.length,
      scopeShown: g.hud.el.scopefx.style.display === 'block',
      buyOpen: g.buyOpen,
      spectating: g.spectating ? g.spectating.name : null,
      flash: +g.playerFlash.toFixed(2),
      objProgress: g.objProgress,
    };
  },
  teleport(x, z) { const p = game.player; p.pos.set(x, groundHeight(x, z), z); },
  lookAt(x, y, z) {
    const p = game.player;
    const dx = x - p.pos.x, dz = z - p.pos.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(y - p.eyeY(), Math.hypot(dx, dz));
  },
  fire() { return game.fireOnce(); },
  key(code, down) { if (down) game.input.keys.add(code); else game.input.keys.delete(code); },
  startMatch() { game.startMatch(); game.deploy(); },
  buy(kind, id) { return game.buyItem(kind, id); },
  endRoundNow(winner, reason) { game.endRound(winner, reason || 'HARNESS'); },
  forceLive() { game.startLive(); },
  forceBuy() { game.startBuyPhase(); },
  giveSpike() { game.spike.carrier = game.player; game.spike.dropped = false; },
  plantProgress() { return game.objProgress; },
  errors() { return [...window.__errors]; },
  setMoney(n) { game.player.money = n; },
  setKit(v) { game.player.loadout.kit = v; },
  setFuse(s) { game.spike.fuseLeft = s; },
  skipIntermission() { if (game.phase === 'intermission') game.phaseTime = 0.01; },
  hurtPlayer(dmg) { const foe = game.actors.find((a) => a.team !== game.player.team && a.alive); game.applyDamage(game.player, dmg, foe || game.player, false, null); },
  killBot(name) { const b = game.actors.find((a) => a.name === name); if (b && b.alive) game.applyDamage(b, 9999, game.player, false, null); },
  teleportBot(name, x, z) { const b = game.actors.find((a) => a.name === name); if (b) { b.pos.set(x, 0, z); b.path = []; } },
  plantNow(site) {
    game.spike.planted = true;
    game.spike.site = site;
    game.spike.fuseLeft = 40;
    game.spike.carrier = null;
    game.spike.dropped = false;
  },
  setSide(side) {
    if (game.playerSide === side) return;
    game.playerSide = side;
    for (const a of game.actors) {
      a.team = a.team === 'atk' ? 'def' : 'atk';
      if (!a.isPlayer) a.setSideColor(game.playerSide);
    }
    // Re-assign plans for the new attackers, exactly as a real halftime
    // does (startBuyPhase -> assignRound); a flipped 'SITE HOLD' bot must
    // not keep a defender plan while attacking.
    assignRound(game, game.planName || 'A RUSH');
  },
  switchWeapon(id) { game.switchWeapon(id); },
  losBlocked(ax, ay, az, bx, by, bz) { return smokeBlocks(game, ax, ay, az, bx, by, bz); },
};
