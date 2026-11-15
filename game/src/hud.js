// HUD: every readout lives on a scrim panel so text stays readable over
// the brightest floor and the darkest wall. Overlays (title/buy/end/pause/
// scoreboard) are fully opaque — no HUD element ever shows through them.
import { WEAPONS, WEAPON_ORDER, GEAR } from './weapons.js';
import { clamp } from './rng.js';

const $ = (id) => document.getElementById(id);

// Chunky filled-silhouette icons (no thin line art).
function gunIcon(id) {
  const shapes = {
    pistol: '<rect x="14" y="10" width="52" height="9" rx="2"/><rect x="20" y="19" width="10" height="13" rx="2"/><rect x="58" y="12" width="10" height="5"/>',
    smg: '<rect x="8" y="12" width="58" height="10" rx="2"/><rect x="62" y="14" width="14" height="6"/><rect x="26" y="22" width="9" height="12" rx="2"/><rect x="46" y="22" width="7" height="10" rx="2"/>',
    rifle: '<rect x="4" y="12" width="66" height="10" rx="2"/><rect x="66" y="14" width="14" height="5"/><rect x="28" y="22" width="9" height="13" rx="2"/><rect x="14" y="22" width="8" height="11" rx="2"/><rect x="40" y="8" width="18" height="4" rx="2"/>',
    dmr: '<rect x="2" y="13" width="72" height="9" rx="2"/><rect x="70" y="15" width="12" height="4"/><rect x="30" y="6" width="20" height="7" rx="3"/><rect x="34" y="22" width="8" height="11" rx="2"/><rect x="16" y="22" width="7" height="10" rx="2"/>',
    shotgun: '<rect x="4" y="11" width="64" height="11" rx="2"/><rect x="64" y="13" width="16" height="6"/><rect x="34" y="22" width="12" height="7" rx="2"/><rect x="14" y="22" width="8" height="11" rx="2"/>',
  };
  return `<svg viewBox="0 0 84 36" fill="#e8e0d0">${shapes[id] || ''}</svg>`;
}
function gearIcon(id) {
  const shapes = {
    armor: '<path d="M42 4 L66 12 V22 C66 30 54 34 42 36 C30 34 18 30 18 22 V12 Z"/>',
    kit: '<rect x="30" y="6" width="24" height="10" rx="2"/><rect x="36" y="16" width="12" height="18" rx="2"/><rect x="26" y="18" width="32" height="6" rx="2"/>',
    flash: '<path d="M46 4 L26 22 H40 L36 34 L58 16 H44 Z"/>',
    smoke: '<circle cx="30" cy="20" r="10"/><circle cx="46" cy="16" r="12"/><circle cx="58" cy="22" r="9"/>',
    frag: '<circle cx="42" cy="22" r="13"/><rect x="38" y="4" width="8" height="7" rx="1"/>',
  };
  return `<svg viewBox="0 0 84 36" fill="#e8e0d0">${shapes[id] || ''}</svg>`;
}

export class Hud {
  constructor() {
    this.el = {};
    for (const id of ['hud', 'minimap', 'maplabel', 'loclabel', 'score-atk', 'score-def', 'timer', 'phase', 'roundnum', 'sidelabel', 'pips', 'counts', 'count-atk', 'count-def', 'planname', 'planside', 'killfeed', 'health-num', 'health-fill', 'armor-num', 'armor-fill', 'money-num', 'squadhint', 'grenades', 'objprogress', 'objprogress-label', 'objprogress-fill', 'hintrow', 'weapon-name', 'weapon-role', 'ammo-mag', 'ammo-reserve', 'weapon-flavor', 'crosshair', 'hitmarker', 'hurt', 'damage-layer', 'banner-big', 'banner-sub', 'objbanner', 'fusetimer', 'specbanner', 'vignette', 'flashfx', 'scopefx', 'title-screen', 'buy-menu', 'buy-guns', 'buy-gear', 'buy-credits', 'buy-msg', 'buy-close', 'end-screen', 'end-headline', 'end-score', 'end-kills', 'end-deaths', 'end-acc', 'end-hs', 'end-assists', 'end-mvp', 'end-squad', 'again-btn', 'pause-screen', 'resume-btn', 'restart-btn', 'scoreboard', 'sb-round', 'sb-table', 'deploy-btn']) {
      this.el[id] = $(id);
    }
    this.mm = this.el.minimap.getContext('2d');
    this.kfEntries = [];
    this.lastText = 0;
    this.bannerUntil = 0;
    this.buildBuy();
  }

  buildBuy() {
    const mkCard = (kind, id, name, role, stats, bars, price, effect) => {
      const d = document.createElement('div');
      d.className = 'card';
      d.dataset.kind = kind; d.dataset.id = id;
      d.innerHTML = `<div class="icon">${kind === 'gun' ? gunIcon(id) : gearIcon(id)}</div>
        <h3>${name}</h3><div class="role">${role}</div>
        ${stats ? `<div class="stats">${stats}</div>` : ''}
        ${bars ? `<div class="bars">${bars.map(([l, v]) => `<div class="brow"><span style="width:34px">${l}</span><span class="tr"><i style="width:${Math.round(v * 100)}%"></i></span></div>`).join('')}</div>` : ''}
        ${effect ? `<div class="effect">${effect}</div>` : ''}
        <div class="price">${price === 0 ? 'FREE' : '$' + price.toLocaleString('en-US')}</div>
        <div class="owned"></div>`;
      d.addEventListener('click', () => this.onBuy && this.onBuy(kind, id));
      return d;
    };
    for (const id of WEAPON_ORDER) {
      const w = WEAPONS[id];
      const stats = `DMG ${w.dmg}${w.pellets > 1 ? ' × ' + w.pellets : ''} · HEAD ${w.head}×<br>MAG ${w.mag} / ${w.reserve} · RELOAD ${w.reload.toFixed(2)}s`;
      const bars = [['POWER', w.dmg * w.pellets / 110], ['RATE', 1 - Math.min(1, w.interval / 1)], ['REACH', w.id === 'dmr' ? 1 : w.id === 'shotgun' ? 0.3 : w.id === 'rifle' ? 0.85 : 0.6]];
      this.el['buy-guns'].appendChild(mkCard('gun', id, w.name, w.role, stats, bars, w.price));
    }
    const gearKeys = ['armor', 'kit', 'flash', 'smoke', 'frag'];
    const gearRoles = { armor: 'PROTECTION', kit: 'OBJECTIVE', flash: 'UTILITY', smoke: 'UTILITY', frag: 'UTILITY' };
    for (const id of gearKeys) {
      const g = GEAR[id];
      this.el['buy-gear'].appendChild(mkCard('gear', id, g.name, gearRoles[id], null, null, g.price, g.effect));
    }
  }

  setHudVisible(v) {
    this.el.hud.classList.toggle('hidden', !v);
  }

  showOverlay(name) {
    for (const id of ['title-screen', 'buy-menu', 'end-screen', 'pause-screen', 'scoreboard']) {
      this.el[id].hidden = id !== name;
    }
    if (!name) this.setHudVisible(true);
    else this.setHudVisible(false);
  }

  hideOverlays() { this.showOverlay(null); }

  // ---- live HUD ----
  update(G, now) {
    const p = G.player;
    const L = p.loadout;
    const w = WEAPONS[L.weapon];
    this.el['health-num'].textContent = Math.max(0, Math.ceil(p.hp));
    this.el['health-fill'].style.width = clamp(p.hp, 0, 100) + '%';
    this.el['health-fill'].classList.toggle('low', p.hp <= 30);
    this.el['armor-num'].textContent = Math.round(L.armor);
    this.el['armor-fill'].style.width = clamp(L.armor, 0, 100) + '%';
    this.el['money-num'].textContent = Math.round(p.money).toLocaleString('en-US');
    this.el['weapon-name'].textContent = w.name;
    this.el['weapon-role'].textContent = w.role + (L.ads && w.scoped ? ' · SCOPED' : '');
    const mag = this.el['ammo-mag'];
    mag.textContent = L.mag;
    mag.classList.toggle('empty', L.mag === 0);
    this.el['ammo-reserve'].textContent = '/ ' + L.reserve;
    this.el['weapon-flavor'].textContent = w.flavor;
    // Grenades.
    const nades = ['flash', 'smoke', 'frag'];
    const ghtml = nades.map((n) => `<span class="nade${L.nadeSel === n ? ' active' : ''}">${n.toUpperCase()} <b>×${L.nades[n] || 0}</b></span>`).join('');
    if (this.el.grenades._last !== ghtml) { this.el.grenades.innerHTML = ghtml; this.el.grenades._last = ghtml; }
    // Crosshair spread from bloom + movement.
    const gap = 5 + L.bloom * 260 + (p.speed2d > 0.6 ? 4 : 0) + (L.ads ? -2 : 0);
    this.el.crosshair.style.setProperty('--gap', clamp(gap, 3, 22) + 'px');
    // Top bar (10 Hz text is fine; called every frame is cheap enough at this size).
    const t = Math.max(0, Math.ceil(G.phaseTime));
    this.el.timer.textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    this.el.phase.textContent = G.phaseLabel;
    this.el['score-atk'].textContent = G.scores.atk;
    this.el['score-def'].textContent = G.scores.def;
    this.el.roundnum.textContent = G.round;
    this.el.sidelabel.textContent = G.playerSide === 'atk' ? 'ATTACK' : 'DEFEND';
    this.el['count-atk'].textContent = G.actors.filter((a) => a.team === 'atk' && a.alive).length;
    this.el['count-def'].textContent = G.actors.filter((a) => a.team === 'def' && a.alive).length;
    this.el.planname.textContent = G.playerSide === 'atk' ? G.planName : 'SITE HOLD';
    this.el.planside.textContent = G.playerSide === 'atk' ? 'FIRST TO 7' : 'HOLD THE SITES · FIRST TO 7';
    // Round pips.
    const pips = G.roundHistory.map((r, i) => `<span class="pip ${r === 'atk' ? 'win-atk' : r === 'def' ? 'win-def' : ''} ${i === G.round - 1 ? 'now' : ''}"></span>`).join('');
    if (this.el.pips._last !== pips) { this.el.pips.innerHTML = pips; this.el.pips._last = pips; }
    // Location label.
    const s = G.siteAt(p.pos.x, p.pos.z);
    this.el.loclabel.textContent = s ? 'SITE ' + s : G.nearLane(p.pos.x, p.pos.z);
    // Objective progress.
    if (G.objProgress) {
      this.el.objprogress.hidden = false;
      this.el['objprogress-label'].textContent = G.objProgress.label;
      this.el['objprogress-fill'].style.width = Math.round(G.objProgress.frac * 100) + '%';
    } else this.el.objprogress.hidden = true;
    // Fuse timer.
    if (G.spike.planted) {
      this.el.fusetimer.hidden = false;
      this.el.fusetimer.textContent = `SPIKE DETONATES IN ${Math.max(0, G.spike.fuseLeft).toFixed(1)}s — SITE ${G.spike.site}`;
    } else this.el.fusetimer.hidden = true;
    // Objective banner (spike carry instruction).
    const carrier = G.spike.carrier;
    if (!G.spike.planted && carrier === p && p.alive) {
      this.el.objbanner.hidden = false;
      this.el.objbanner.textContent = 'YOU CARRY THE RELAY SPIKE — reach SITE A or B, hold E to plant · X to drop';
    } else if (!G.spike.planted && G.spike.dropped) {
      this.el.objbanner.hidden = false;
      this.el.objbanner.textContent = 'SPIKE DOWN — recover it (amber marker on the minimap)';
    } else this.el.objbanner.hidden = true;
    // Spectator banner.
    if (!p.alive && G.spectating) {
      this.el.specbanner.hidden = false;
      this.el.specbanner.textContent = `SPECTATING ${G.spectating.name} — round continues`;
    } else this.el.specbanner.hidden = true;
    // Banner expiry.
    if (this.bannerUntil && now > this.bannerUntil) {
      this.el['banner-big'].hidden = true;
      this.el['banner-sub'].hidden = true;
      this.bannerUntil = 0;
    }
    // Flash / hurt overlays decay.
    if (G.playerFlash > 0) this.el.flashfx.style.opacity = clamp(G.playerFlash, 0, 0.95);
    else this.el.flashfx.style.opacity = 0;
    this.el.vignette.style.opacity = p.hp < 50 && p.alive ? (0.5 - p.hp / 100) : 0;
    this.drawMinimap(G);
  }

  drawMinimap(G) {
    const c = this.mm, S = 336, sc = S / 44;
    c.clearRect(0, 0, S, S);
    c.fillStyle = 'rgba(20,24,26,0.9)'; c.fillRect(0, 0, S, S);
    const X = (x) => (x + 22) * sc, Z = (z) => (z + 22) * sc;
    // Walls.
    c.fillStyle = '#6b6252';
    for (const col of G.world.colliders) {
      if (col.y1 < 2.5) continue;
      c.fillRect(X(col.x0), Z(col.z0), (col.x1 - col.x0) * sc, (col.z1 - col.z0) * sc);
    }
    // Sites.
    for (const key of ['A', 'B']) {
      const s = G.world.sites[key];
      c.fillStyle = key === 'A' ? 'rgba(224,138,60,0.25)' : 'rgba(159,216,180,0.25)';
      c.beginPath(); c.arc(X(s.x), Z(s.z), s.r * sc, 0, 7); c.fill();
      c.fillStyle = key === 'A' ? '#e08a3c' : '#9fd8b4';
      c.font = 'bold 20px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(key, X(s.x), Z(s.z));
    }
    // Spike marker.
    if (G.spike.dropped) {
      c.fillStyle = '#ffb648';
      c.beginPath(); c.arc(X(G.spike.x), Z(G.spike.z), 6, 0, 7); c.fill();
    }
    // Actors: allies always; enemies only when legitimately revealed.
    for (const a of G.actors) {
      if (!a.alive) continue;
      if (a.team !== G.player.team && !G.enemyRevealed(a)) continue;
      c.fillStyle = a.team === G.player.team ? '#4fd8c0' : '#ff5a3c';
      c.beginPath(); c.arc(X(a.pos.x), Z(a.pos.z), a.isPlayer ? 6 : 4.5, 0, 7); c.fill();
      if (G.spike.carrier === a) {
        c.strokeStyle = '#ffb648'; c.lineWidth = 2;
        c.beginPath(); c.arc(X(a.pos.x), Z(a.pos.z), 8, 0, 7); c.stroke();
      }
    }
    // Player view cone.
    const p = G.player;
    c.fillStyle = 'rgba(242,237,227,0.25)';
    c.beginPath();
    c.moveTo(X(p.pos.x), Z(p.pos.z));
    c.arc(X(p.pos.x), Z(p.pos.z), 26, -p.yaw - Math.PI / 2 - 0.5, -p.yaw - Math.PI / 2 + 0.5);
    c.closePath(); c.fill();
  }

  pushKillfeed(killer, weapon, victim, head) {
    const d = document.createElement('div');
    d.className = 'kf scrim';
    d.innerHTML = `<span class="killer">${killer}</span> <span class="wpn">[${weapon}]</span> <span class="victim">${victim}</span>${head ? ' <span class="hs">HEADSHOT</span>' : ''}`;
    this.el.killfeed.prepend(d);
    this.kfEntries.push(d);
    if (this.kfEntries.length > 5) { const old = this.kfEntries.shift(); old.remove(); }
    for (const e of this.kfEntries) e.classList.remove('old');
    this.kfEntries.slice(0, -2).forEach((e) => e.classList.add('old'));
    setTimeout(() => { d.style.opacity = '0.25'; }, 6000);
  }

  banner(big, sub, dur = 3.5) {
    this.el['banner-big'].textContent = big;
    this.el['banner-big'].hidden = !big;
    this.el['banner-sub'].textContent = sub || '';
    this.el['banner-sub'].hidden = !sub;
    this.bannerUntil = performance.now() / 1000 + dur;
  }

  damageNumber(sx, sy, text, head) {
    const d = document.createElement('div');
    d.className = 'dmgnum' + (head ? ' head' : '');
    d.textContent = text;
    d.style.left = sx + 'px';
    d.style.top = sy + 'px';
    this.el['damage-layer'].appendChild(d);
    // In shot mode the number must survive until capture: no auto-remove.
    if (!document.body.classList.contains('shot')) setTimeout(() => d.remove(), 950);
  }

  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.classList.add('on');
    h.classList.toggle('kill', !!kill);
    if (document.body.classList.contains('shot')) return; // stay visible for capture
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => h.classList.remove('on'), 120);
  }

  hurt(angleDeg) {
    const h = this.el.hurt;
    h.querySelector('.arc').style.transform = `rotate(${angleDeg}deg)`;
    h.classList.add('on');
    clearTimeout(this._hurtT);
    this._hurtT = setTimeout(() => h.classList.remove('on'), 450);
  }

  setScope(on) { this.el.scopefx.style.display = on ? 'block' : 'none'; }

  // ---- buy menu ----
  buyRefresh(G) {
    const p = G.player, L = p.loadout;
    this.el['buy-credits'].textContent = Math.round(p.money).toLocaleString('en-US');
    for (const card of this.el['buy-guns'].children) {
      const w = WEAPONS[card.dataset.id];
      const owned = !!L.owned[card.dataset.id];
      const equipped = L.weapon === card.dataset.id;
      card.classList.toggle('equipped', equipped);
      card.querySelector('.owned').textContent = equipped ? '' : owned ? 'PRESS TO EQUIP' : '';
      card.querySelector('.price').textContent = equipped ? 'EQUIPPED' : owned ? 'OWNED' : w.price === 0 ? 'FREE' : '$' + w.price.toLocaleString('en-US');
      card.querySelector('.price').classList.toggle('free', w.price === 0);
    }
    for (const card of this.el['buy-gear'].children) {
      const id = card.dataset.id;
      const owned = id === 'armor' ? L.armor >= 100 : id === 'kit' ? L.kit : (L.nades[id] || 0) >= 2;
      const count = id === 'armor' ? '' : id === 'kit' ? '' : ` ×${L.nades[id] || 0}`;
      card.classList.toggle('equipped', owned);
      card.querySelector('.owned').textContent = (id === 'flash' || id === 'smoke' || id === 'frag') ? `OWNED${count} / 2 MAX` : owned ? 'EQUIPPED' : '';
    }
  }

  buyMessage(msg) { this.el['buy-msg'].textContent = msg || ''; }

  // ---- scoreboard / end screen ----
  scoreboard(G) {
    this.el['sb-round'].textContent = 'ROUND ' + G.round + ' · ' + G.scores.atk + ' : ' + G.scores.def;
    this.el['sb-table'].innerHTML = '<tr><th>PLAYER</th><th>K</th><th>D</th><th>A</th><th>ACC</th><th>HS</th><th>$</th></tr>' +
      G.actors.map((a) => `<tr><td>${a.name}${a.isPlayer ? ' (YOU)' : ''}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${a.assists}</td><td>${a.shots ? Math.round(a.hits / a.shots * 100) + '%' : '—'}</td><td>${a.headshots}</td><td>${Math.round(a.money)}</td></tr>`).join('');
  }

  populateEnd(G) {
    const p = G.player;
    const won = G.scores[G.playerSide] >= 7;
    this.el['end-headline'].textContent = won ? 'VICTORY' : 'DEFEAT';
    this.el['end-headline'].className = won ? 'win' : 'lose';
    this.el['end-score'].innerHTML = `${G.scores.atk} : ${G.scores.def} <span>· CINDERWORKS YARD · ${G.roundsPlayed} ROUNDS</span>`;
    this.el['end-kills'].textContent = p.kills;
    this.el['end-deaths'].textContent = p.deaths;
    this.el['end-acc'].textContent = (p.shots ? Math.round(p.hits / p.shots * 100) : 0) + '%';
    this.el['end-hs'].textContent = p.headshots;
    this.el['end-assists'].textContent = p.assists;
    this.el['end-mvp'].textContent = G.mvpLabel;
    this.el['end-squad'].innerHTML = '<table><tr><th>PLAYER</th><th>K</th><th>D</th><th>A</th><th>ACC</th><th>HS</th></tr>' +
      G.actors.map((a) => `<tr><td>${a.name}${a.isPlayer ? ' (YOU)' : ''}</td><td>${a.kills}</td><td>${a.deaths}</td><td>${a.assists}</td><td>${a.shots ? Math.round(a.hits / a.shots * 100) + '%' : '—'}</td><td>${a.headshots}</td></tr>`).join('') + '</table>';
  }
}
