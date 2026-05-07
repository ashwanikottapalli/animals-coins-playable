import { CONFIG } from './config.js';

export class UI {
  constructor() {
    this.intro     = document.getElementById('intro');
    this.cta       = document.getElementById('cta');
    this.fail      = document.getElementById('fail');
    this.countEl   = document.getElementById('plankCount');
    this.titleEl   = document.getElementById('ctaTitle');
    this.playBtn   = document.getElementById('playBtn');
    this.retryBtn  = document.getElementById('retryBtn');

    this.titleEl.textContent = CONFIG.branding.title;

    this.playBtn.addEventListener('click', () => {
      const url = isIOS() ? CONFIG.branding.storeUrlIOS : CONFIG.branding.storeUrlAndroid;
      try { window.open(url, '_blank'); } catch {}
    });
  }

  bindStart(handler) {
    const fire = (e) => {
      e.preventDefault();
      this.intro.style.opacity = '0';
      setTimeout(() => { this.intro.style.display = 'none'; }, 400);
      handler();
    };
    this.intro.addEventListener('pointerdown', fire, { once: true });
  }

  bindRetry(handler) {
    this.retryBtn.addEventListener('click', () => {
      this.hideFail();
      handler();
    });
  }

  setPlankCount(n) {
    this.countEl.textContent = n;
    this.countEl.classList.remove('pop');
    // Force reflow to restart animation
    void this.countEl.offsetWidth;
    this.countEl.classList.add('pop');
    setTimeout(() => this.countEl.classList.remove('pop'), 140);
  }

  showCTA() { this.cta.classList.add('show'); }
  showFail() { this.fail.classList.add('show'); }
  hideFail() { this.fail.classList.remove('show'); }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
         (/Mac/.test(ua) && 'ontouchend' in document);
}
