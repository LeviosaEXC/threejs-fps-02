// The HUD: every number and overlay is a DOM element owned by index.html;
// this module only writes to them, and only when a value actually changed.
// The buy menu is clickable during the buy phase; the overlays (start, pause,
// round end, match end) are the only screens with pointer events.
import { WEAPONS, GRENADE_PRICE, ARMOR_PRICE } from './weapons.js';

const BUY_ITEMS = [
  { id: 'hornet', key: '1' },
  { id: 'kestrel', key: '2' },
  { id: 'breacher', key: '3' },
  { id: 'longbow', key: '4' },
  { id: 'grenade', key: '5' },
  { id: 'armor', key: '6' },
];

export function createHud(hooks) {
  const el = {};
  for (const id of ['health-num', 'health-bar', 'armor-num', 'armor-bar', 'ammo-mag', 'ammo-reserve', 'weapon-name', 'money', 'timer', 'score-ember', 'score-hollow', 'round-label', 'pips-ember', 'pips-hollow', 'killfeed', 'banner', 'banner-title', 'banner-sub', 'channel', 'channel-fill', 'channel-label', 'bomb-status', 'crosshair', 'hitmarker', 'vignette', 'overlay', 'overlay-title', 'overlay-copy', 'play', 'buy-menu', 'buy-items', 'buy-timer', 'scope', 'grenades', 'hint']) {
    el[id] = document.getElementById(id);
  }
  const last = {};
  let bannerUntil = 0;

  function setText(id, value) {
    if (last[id] !== value) {
      last[id] = value;
      el[id].textContent = value;
    }
  }

  function setBar(id, pct) {
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    if (last[id] !== v) {
      last[id] = v;
      el[id].style.width = `${v}%`;
    }
  }

  function buildBuyMenu() {
    el['buy-items'].innerHTML = '';
    for (const item of BUY_ITEMS) {
      const def = item.id === 'grenade'
        ? { name: 'Spark-9 HE Grenade', price: GRENADE_PRICE, short: 'HE' }
        : item.id === 'armor'
          ? { name: 'Vest — 50 armor', price: ARMOR_PRICE, short: 'ARMOR' }
          : WEAPONS[item.id];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.item = item.id;
      button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${def.name}</span><span class="buy-price">$${def.price}</span>`;
      button.addEventListener('click', () => hooks.onBuy(item.id));
      el['buy-items'].appendChild(button);
    }
  }
  buildBuyMenu();

  function markBuyOwned(weapons, money) {
    for (const button of el['buy-items'].children) {
      const id = button.dataset.item;
      const owned = id === 'grenade' ? weapons.state.grenades >= 2 : id === 'armor' ? weapons.state.armor >= 50 : weapons.owned.has(id);
      const price = id === 'grenade' ? GRENADE_PRICE : id === 'armor' ? ARMOR_PRICE : WEAPONS[id].price;
      button.classList.toggle('owned', owned);
      button.classList.toggle('poor', money < price && !owned);
    }
  }

  return {
    setHealth(hp, armor) {
      setText('health-num', String(Math.ceil(hp)));
      setBar('health-bar', hp);
      setText('armor-num', String(Math.ceil(armor)));
      setBar('armor-bar', armor * 2);
    },
    setAmmo(mag, reserve, name, grenades) {
      setText('ammo-mag', String(mag));
      setText('ammo-reserve', `/ ${reserve}`);
      setText('weapon-name', name);
      setText('grenades', grenades > 0 ? `HE x${grenades} — G to throw` : '');
      el['ammo-mag'].parentElement.classList.toggle('empty', mag === 0);
    },
    setMoney(value) {
      setText('money', `$${value}`);
    },
    setTimer(seconds, phase) {
      const t = Math.max(0, Math.ceil(seconds));
      const mm = Math.floor(t / 60);
      const ss = String(t % 60).padStart(2, '0');
      setText('timer', `${mm}:${ss}`);
      el.timer.classList.toggle('buy-phase', phase === 'buy');
    },
    setScore(ember, hollow, round) {
      setText('score-ember', String(ember));
      setText('score-hollow', String(hollow));
      setText('round-label', `ROUND ${round} — FIRST TO 5`);
    },
    setPips(emberAlive, hollowAlive) {
      const draw = (id, alive, total) => {
        const key = `${alive}/${total}`;
        if (last[id] === key) return;
        last[id] = key;
        el[id].textContent = '';
        for (let i = 0; i < total; i += 1) {
          const pip = document.createElement('i');
          if (i < alive) pip.className = 'alive';
          el[id].appendChild(pip);
        }
      };
      draw('pips-ember', emberAlive, 5);
      draw('pips-hollow', hollowAlive, 5);
    },
    setBomb(text) {
      setText('bomb-status', text);
    },
    setCrosshair(spread) {
      const gap = 4 + spread * 900;
      el.crosshair.style.setProperty('--gap', `${Math.min(26, gap).toFixed(1)}px`);
    },
    hitMarker(kill) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', kill);
      window.setTimeout(() => el.hitmarker.classList.remove('on', 'kill'), 110);
    },
    hurt() {
      el.vignette.style.opacity = '0.55';
      window.setTimeout(() => {
        el.vignette.style.opacity = '0';
      }, 160);
    },
    feed(text, now) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      row.textContent = text;
      el.killfeed.prepend(row);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
    },
    banner(title, sub, seconds, now) {
      setText('banner-title', title);
      setText('banner-sub', sub);
      el.banner.classList.add('show');
      bannerUntil = now + seconds;
    },
    hideBanner(now) {
      if (bannerUntil && now > bannerUntil) {
        el.banner.classList.remove('show');
        bannerUntil = 0;
      }
    },
    setChannel(progress, label) {
      if (progress > 0) {
        el.channel.classList.add('show');
        el['channel-fill'].style.width = `${Math.round(progress * 100)}%`;
        setText('channel-label', label);
      } else {
        el.channel.classList.remove('show');
      }
    },
    setScoped(scoped) {
      el.scope.classList.toggle('on', scoped);
    },
    showBuy(show, secondsLeft, weapons, money) {
      el['buy-menu'].classList.toggle('show', show);
      if (show) {
        setText('buy-timer', `Buy phase — ${Math.ceil(secondsLeft)}s — press B to close`);
        markBuyOwned(weapons, money);
      }
    },
    showOverlay(kind, data = {}) {
      const titles = {
        start: ['EMBERLINE', 'A tactical shooter in Kestrel Yard. Plant the spike at A or B, or eliminate Hollow. First to 5 rounds takes the match.'],
        paused: ['Paused', 'Pointer released. Click resume to keep playing.'],
        round: [data.title ?? 'Round over', data.sub ?? ''],
        match: [data.title ?? 'Match over', data.sub ?? ''],
      };
      const [title, copy] = titles[kind] ?? titles.start;
      setText('overlay-title', title);
      setText('overlay-copy', copy);
      el.overlay.hidden = false;
      el.play.textContent = kind === 'start' ? 'Click to play' : kind === 'match' ? 'Play again' : 'Resume';
    },
    hideOverlay() {
      el.overlay.hidden = true;
    },
    onPlay(callback) {
      el.play.addEventListener('click', callback);
    },
    hint(text) {
      setText('hint', text);
    },
  };
}
