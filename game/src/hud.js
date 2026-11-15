// The DOM HUD: health, money, timer, score, ammo, bomb status, kill feed, crosshair
// spread, damage flash and the overlay panels (menu, pause, buy, match end). It
// never touches the simulation; main.js pushes numbers in and reads callbacks out.
// Every write is cached, so the DOM is only touched when a value actually changes.
import { WEAPONS, GRENADE, BUY_ORDER } from './weapons.js';

const COPY = {
  start: {
    title: 'Deadlock Yard',
    copy: 'Vanguard attacks, Sentinel holds. Plant the bomb at Foundry or Silo, or clear all four Sentinels. First to 5 rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'Deadlock Yard',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  match: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const damage = $('damage');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const scoreEl = $('round-score');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const grenadeEl = $('grenades');
  const bombEl = $('bomb-status');
  const bombTimer = $('bomb-timer');
  const bombFill = $('bomb-fill');
  const plantEl = $('plant-status');
  const plantFill = $('plant-fill');
  const feed = $('feed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerReason = $('banner-reason');
  const buyEl = $('buy');
  const buyRows = $('buy-rows');
  const buyMoney = $('buy-money');
  const buyTimer = $('buy-timer');
  const buyContinue = $('buy-continue');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastHealth = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';
  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastGrenades = -1;
  let lastGap = -1;
  let lastBuyTimer = '';
  let buyHandler = null;
  let playHandler = null;
  let continueHandler = null;

  play.addEventListener('click', () => playHandler && playHandler());
  buyContinue.addEventListener('click', () => continueHandler && continueHandler());

  function buildBuyRows() {
    buyRows.innerHTML = '';
    const items = BUY_ORDER.map((id) => ({ id, name: WEAPONS[id].name, price: WEAPONS[id].price, key: String(BUY_ORDER.indexOf(id) + 1) }));
    items.push({ id: 'grenade', name: GRENADE.name, price: GRENADE.price, key: '6' });
    for (const item of items) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.dataset.id = item.id;
      row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-price">$${item.price}</span>`;
      row.addEventListener('click', () => buyHandler && buyHandler(item.id));
      buyRows.appendChild(row);
    }
  }
  buildBuyRows();

  return {
    setHealth(hp) {
      if (hp === lastHealth) return;
      lastHealth = hp;
      healthFill.style.width = `${Math.max(0, hp)}%`;
      healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      healthFill.classList.toggle('low', hp <= 30);
    },
    setMoney(n) {
      if (n === lastMoney) return;
      lastMoney = n;
      moneyEl.textContent = `$${n}`;
      buyMoney.textContent = `$${n}`;
    },
    setTimer(seconds) {
      const s = Math.max(0, Math.ceil(seconds));
      if (s === lastTimer) return;
      lastTimer = s;
      timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    },
    setScore(v, s, round) {
      const text = `V ${v} — ${s} S · R${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreEl.textContent = text;
    },
    setAmmo(mag, reserve, name, grenades) {
      if (mag !== lastMag || reserve !== lastReserve) {
        lastMag = mag;
        lastReserve = reserve;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        ammoMag.parentElement.classList.toggle('empty', mag === 0);
      }
      if (name !== lastWeapon) {
        lastWeapon = name;
        weaponName.textContent = name;
      }
      if (grenades !== lastGrenades) {
        lastGrenades = grenades;
        grenadeEl.textContent = grenades > 0 ? `HE x${grenades}` : '';
      }
    },
    setCrosshair(spread) {
      const gap = Math.max(4, Math.min(26, 4 + spread * 420));
      if (gap === lastGap) return;
      lastGap = gap;
      crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);
    },
    setBomb(mode, fuseLeft, plantT, defuseT) {
      if (mode === 'planted') {
        bombEl.hidden = false;
        plantEl.hidden = true;
        bombTimer.textContent = fuseLeft.toFixed(1);
        bombFill.style.width = `${Math.max(0, Math.min(100, (1 - defuseT) * 100))}%`;
        bombFill.classList.toggle('defusing', defuseT > 0);
      } else if (mode === 'planting') {
        bombEl.hidden = true;
        plantEl.hidden = false;
        plantFill.style.width = `${Math.max(0, Math.min(100, plantT * 100))}%`;
      } else {
        bombEl.hidden = true;
        plantEl.hidden = true;
      }
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash() {
      damage.style.opacity = '0.55';
      setTimeout(() => { damage.style.opacity = '0'; }, 60);
    },
    killFeed(text) {
      const line = document.createElement('div');
      line.className = 'feed-line';
      line.textContent = text;
      feed.prepend(line);
      while (feed.children.length > 4) feed.removeChild(feed.lastChild);
      setTimeout(() => line.remove(), 5000);
    },
    banner(text, reason, win, holdMs = 2600) {
      bannerTitle.textContent = text;
      bannerReason.textContent = reason;
      banner.classList.toggle('win', win);
      banner.classList.toggle('lose', !win);
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, holdMs);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.hidden = true;
    },
    showOverlay(mode, detail) {
      const text = COPY[mode];
      title.textContent = text.title;
      copy.textContent = mode === 'match' ? detail : text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    showBuy(money, secondsLeft) {
      this.setMoney(money);
      const text = `${Math.max(0, Math.ceil(secondsLeft))}s`;
      if (text !== lastBuyTimer) {
        lastBuyTimer = text;
        buyTimer.textContent = text;
      }
      buyEl.hidden = false;
    },
    updateBuy(money, secondsLeft, owned) {
      this.setMoney(money);
      const text = `${Math.max(0, Math.ceil(secondsLeft))}s`;
      if (text !== lastBuyTimer) {
        lastBuyTimer = text;
        buyTimer.textContent = text;
      }
      for (const row of buyRows.children) {
        const id = row.dataset.id;
        const price = id === 'grenade' ? GRENADE.price : WEAPONS[id].price;
        row.classList.toggle('owned', !!owned[id]);
        row.classList.toggle('cant', money < price && !owned[id]);
      }
    },
    hideBuy() {
      buyEl.hidden = true;
    },
    onPlay(handler) {
      playHandler = handler;
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    onContinue(handler) {
      continueHandler = handler;
    },
  };
}
