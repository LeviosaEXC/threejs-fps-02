// The match: rounds, the clock, the economy, the buy menu and the spike.
// Ember attacks with the spike; Hollow defends. A round ends on elimination,
// detonation, defusal or the clock. First to 5 rounds takes the match (at
// most 9 rounds). Money is the player's only: kills pay $300, a plant $300,
// a round win $3,250, a loss $1,900 plus $500 per consecutive loss up to
// $3,400. The spike starts with the player; when the player dies it drops
// where they fell and any Ember bot — or the player, walking over it — picks
// it up. A bot that carries it walks to its site and plants.
import * as THREE from 'three';
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';
import { SITES } from './world.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 90;
export const END_TIME = 5;
export const FUSE_TIME = 35;
export const PLANT_TIME = 4;
export const DEFUSE_TIME = 5;
const WINS_TO = 5;
const MAX_ROUNDS = 9;

export function createMatch(rng, hooks) {
  const state = {
    phase: 'buy',
    round: 1,
    score: { ember: 0, hollow: 0 },
    timer: BUY_TIME,
    money: 800,
    lossStreak: 0,
    bomb: {
      state: 'with-player',
      site: null,
      pos: new THREE.Vector3(),
      fuse: 0,
      carrier: null,
    },
    plantProgress: 0,
    defuseProgress: 0,
    winner: null,
    reason: '',
    kills: { ember: 0, hollow: 0 },
  };

  function siteAt(pos) {
    for (const [key, site] of Object.entries(SITES)) {
      if (Math.hypot(site.x - pos.x, site.z - pos.z) < site.radius) return key;
    }
    return null;
  }

  function endRound(winner, reason) {
    if (state.phase === 'end' || state.phase === 'matchend') return;
    state.phase = 'end';
    state.timer = END_TIME;
    state.winner = winner;
    state.reason = reason;
    state.score[winner] += 1;
    if (winner === 'ember') {
      state.money += 3250;
      state.lossStreak = 0;
    } else {
      state.money += 1900 + Math.min(1500, state.lossStreak * 500);
      state.lossStreak += 1;
    }
    hooks.onRoundEnd(winner, reason, { ...state.score });
    if (state.score[winner] >= WINS_TO || state.round >= MAX_ROUNDS) {
      state.phase = 'matchend';
      const matchWinner = state.score.ember > state.score.hollow ? 'ember' : state.score.ember < state.score.hollow ? 'hollow' : 'draw';
      hooks.onMatchEnd(matchWinner, { ...state.score });
    }
  }

  function startRound() {
    state.round += 1;
    state.phase = 'buy';
    state.timer = BUY_TIME;
    state.winner = null;
    state.reason = '';
    state.bomb.state = 'with-player';
    state.bomb.site = null;
    state.bomb.fuse = 0;
    state.bomb.carrier = null;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    hooks.onRoundStart(state.round);
  }

  return {
    state,
    startMatch() {
      state.round = 1;
      state.score.ember = 0;
      state.score.hollow = 0;
      state.money = 800;
      state.lossStreak = 0;
      state.phase = 'buy';
      state.timer = BUY_TIME;
      state.bomb.state = 'with-player';
      state.bomb.site = null;
      state.bomb.carrier = null;
      state.kills.ember = 0;
      state.kills.hollow = 0;
      hooks.onRoundStart(1);
    },
    buy(itemId, weapons) {
      if (state.phase !== 'buy') return { ok: false, why: 'buy phase is over' };
      if (itemId === 'grenade') {
        if (weapons.state.grenades >= 2) return { ok: false, why: 'already carrying two' };
        if (state.money < GRENADE_PRICE) return { ok: false, why: 'not enough money' };
        state.money -= GRENADE_PRICE;
        weapons.state.grenades += 1;
        return { ok: true };
      }
      if (itemId === 'armor') {
        if (weapons.state.armor >= 50) return { ok: false, why: 'armor already full' };
        if (state.money < ARMOR_PRICE) return { ok: false, why: 'not enough money' };
        state.money -= ARMOR_PRICE;
        weapons.state.armor = 50;
        return { ok: true };
      }
      const def = WEAPONS[itemId];
      if (!def) return { ok: false, why: 'unknown item' };
      if (weapons.owned.has(itemId)) return { ok: false, why: 'already owned' };
      if (state.money < def.price) return { ok: false, why: 'not enough money' };
      state.money -= def.price;
      weapons.give(itemId);
      weapons.switchTo(itemId);
      return { ok: true };
    },
    awardKill() {
      state.money += 300;
    },
    awardPlant() {
      state.money += 300;
    },
    // The player channels a plant or a defuse while holding E. Returns the
    // progress 0..1 so the HUD can draw it. Completing fires the hooks.
    channel(dt, player, holding) {
      if (state.phase !== 'live' || !player.alive) {
        state.plantProgress = 0;
        state.defuseProgress = 0;
        return 0;
      }
      if (state.bomb.state === 'with-player' && holding) {
        const site = siteAt(player.pos);
        if (site) {
          state.plantProgress += dt / PLANT_TIME;
          if (state.plantProgress >= 1) {
            state.plantProgress = 0;
            state.bomb.state = 'planted';
            state.bomb.site = site;
            state.bomb.pos.copy(player.pos);
            state.bomb.fuse = FUSE_TIME;
            this.awardPlant();
            hooks.onPlant(site, player.pos);
          }
          return state.plantProgress;
        }
      }
      if (state.bomb.state === 'planted' && holding) {
        const d = Math.hypot(state.bomb.pos.x - player.pos.x, state.bomb.pos.z - player.pos.z);
        if (d < 2.5) {
          state.defuseProgress += dt / DEFUSE_TIME;
          if (state.defuseProgress >= 1) {
            state.defuseProgress = 0;
            state.bomb.state = 'none';
            hooks.onDefuse();
            endRound('hollow', 'Spike defused');
          }
          return state.defuseProgress;
        }
      }
      state.plantProgress = 0;
      state.defuseProgress = 0;
      return 0;
    },
    dropBombAt(pos) {
      if (state.bomb.state !== 'with-player') return;
      state.bomb.state = 'dropped';
      state.bomb.pos.copy(pos);
      state.bomb.pos.y = 0.3;
      hooks.onBombDropped(state.bomb.pos);
    },
    pickupCheck(player, bots) {
      if (state.bomb.state !== 'dropped') return;
      if (player.alive && Math.hypot(state.bomb.pos.x - player.pos.x, state.bomb.pos.z - player.pos.z) < 1.4) {
        state.bomb.state = 'with-player';
        hooks.onBombPickedUp('player');
        return;
      }
      for (const bot of bots) {
        if (bot.team === 'ember' && bot.alive && Math.hypot(state.bomb.pos.x - bot.pos.x, state.bomb.pos.z - bot.pos.z) < 1.4) {
          state.bomb.state = 'with-bot';
          state.bomb.carrier = bot;
          bot.carrier = true;
          hooks.onBombPickedUp(bot.name);
          return;
        }
      }
    },
    botPlanted(site, pos) {
      state.bomb.state = 'planted';
      state.bomb.site = site;
      state.bomb.pos.copy(pos);
      state.bomb.fuse = FUSE_TIME;
      hooks.onPlant(site, pos);
    },
    carrierDied(pos) {
      if (state.bomb.state !== 'with-bot') return;
      state.bomb.state = 'dropped';
      state.bomb.pos.copy(pos);
      state.bomb.pos.y = 0.3;
      if (state.bomb.carrier) state.bomb.carrier.carrier = false;
      state.bomb.carrier = null;
      hooks.onBombDropped(state.bomb.pos);
    },
    botDefused() {
      if (state.bomb.state !== 'planted') return;
      state.bomb.state = 'none';
      hooks.onDefuse();
      endRound('hollow', 'Spike defused');
    },
    step(dt, ctx) {
      const { player, bots } = ctx;
      if (state.phase === 'buy' || state.phase === 'live') {
        state.timer -= dt;
        if (state.phase === 'buy' && state.timer <= 0) {
          state.phase = 'live';
          state.timer = ROUND_TIME;
          hooks.onLive();
        }
      }
      if (state.phase === 'live' && state.bomb.state === 'planted') {
        state.bomb.fuse -= dt;
        if (state.bomb.fuse <= 0) {
          state.bomb.fuse = 0;
          hooks.onDetonate(state.bomb.pos);
          endRound('ember', 'Spike detonated');
          return;
        }
      }
      if (state.phase === 'live') {
        this.pickupCheck(player, bots);
        const emberAlive = (player.alive ? 1 : 0) + bots.aliveCount('ember');
        const hollowAlive = bots.aliveCount('hollow');
        if (hollowAlive === 0) {
          endRound('ember', 'Hollow team eliminated');
          return;
        }
        if (emberAlive === 0) {
          if (state.bomb.state === 'planted') return; // fuse decides it
          endRound('hollow', 'Ember team eliminated');
          return;
        }
        if (state.timer <= 0 && state.bomb.state !== 'planted') {
          endRound('hollow', 'Time expired — spike never planted');
          return;
        }
      }
      if (state.phase === 'end') {
        state.timer -= dt;
        if (state.timer <= 0) {
          if (state.score.ember >= WINS_TO || state.score.hollow >= WINS_TO || state.round >= MAX_ROUNDS) {
            state.phase = 'matchend';
          } else {
            startRound();
          }
        }
      }
    },
    siteAt,
    endRound,
  };
}
