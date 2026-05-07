import { CONFIG } from './config.js';

export class UI {
  constructor() {
    this.cta       = document.getElementById('cta');
    this.fail      = document.getElementById('fail');
    this.tutorial  = document.getElementById('tutorial');
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

  showTutorial() { this.tutorial.classList.remove('hidden'); }
  hideTutorial() { this.tutorial.classList.add('hidden'); }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
         (/Mac/.test(ua) && 'ontouchend' in document);
}
