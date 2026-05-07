import { CONFIG } from './config.js';

export class UI {
  constructor() {
    this.cta       = document.getElementById('cta');
    this.ctaSub    = document.getElementById('ctaSub');
    this.tutorial  = document.getElementById('tutorial');
    this.loading      = document.getElementById('loading');
    this.loadingFill  = document.getElementById('loadingFill');
    this.loadingPct   = document.getElementById('loadingPct');

    // Fake progress 0→90% over ~1.8s while assets decode. completeLoading()
    // jumps to 100% and hides the splash.
    this._loadProgress = 0;
    this._loadInterval = setInterval(() => {
      if (this._loadProgress < 90) {
        this._loadProgress += 2;
        this._renderLoad();
      } else {
        clearInterval(this._loadInterval);
      }
    }, 40);
    this.countEl   = document.getElementById('plankCount');
    this.titleEl   = document.getElementById('ctaTitle');
    this.playBtn   = document.getElementById('playBtn');
    this.retryBtn  = document.getElementById('retryBtn');

    // Branding wired from CONFIG so a single config edit updates the CTA.
    this.titleEl.textContent = CONFIG.branding.title;
    const subEl = document.getElementById('ctaSub');
    if (subEl) subEl.textContent = CONFIG.branding.sub;
    if (this.playBtn) this.playBtn.textContent = CONFIG.branding.cta;
    const logoEl = document.getElementById('ctaTitle')?.previousElementSibling;
    const logoImg = document.getElementById('ctaLogo');
    if (logoImg && CONFIG.branding.logoPath) logoImg.src = CONFIG.branding.logoPath;
    // Update loading splash title to match branding too.
    const ldTitle = document.getElementById('loadingTitle');
    if (ldTitle) ldTitle.textContent = CONFIG.branding.title;

    this.playBtn.addEventListener('click', () => {
      const url = isIOS() ? CONFIG.branding.storeUrlIOS : CONFIG.branding.storeUrlAndroid;
      try { window.open(url, '_blank'); } catch {}
    });
  }

  bindRetry(handler) {
    this.retryBtn.addEventListener('click', () => {
      this.hideCTA();
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

  // mode: 'win' | 'fail' — 'fail' swaps subtext + reveals "Try Again" link.
  showCTA(mode = 'win') {
    if (mode === 'fail') {
      this.cta.classList.add('fail');
      if (this.ctaSub) this.ctaSub.textContent = "Oh no! Install to keep playing.";
    } else {
      this.cta.classList.remove('fail');
      if (this.ctaSub) this.ctaSub.textContent = CONFIG.branding.sub;
    }
    this.cta.classList.add('show');
  }
  hideCTA() {
    this.cta.classList.remove('show');
    this.cta.classList.remove('fail');
  }

  showTutorial() { this.tutorial.classList.remove('hidden'); }
  hideTutorial() { this.tutorial.classList.add('hidden'); }

  _renderLoad() {
    if (!this.loadingFill) return;
    this.loadingFill.style.width = this._loadProgress + '%';
    this.loadingPct.textContent  = this._loadProgress + '%';
  }
  completeLoading() {
    if (!this.loading) return;
    clearInterval(this._loadInterval);
    this._loadProgress = 100;
    this._renderLoad();
    setTimeout(() => this.loading.classList.add('hidden'), 350);
  }

  // Spawn a transient floating "+10" / "−2" / "×3" indicator at app coords (x, y).
  // `positive` flips the color: green for + / ×, red for - / ÷.
  spawnFloatingText(text, x, y, positive) {
    const el = document.createElement('div');
    el.className = 'floatTxt' + (positive ? ' good' : ' bad');
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    document.getElementById('app').appendChild(el);
    // CSS animation runs on insertion; remove after it finishes.
    setTimeout(() => el.remove(), 900);
  }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPad|iPhone|iPod/.test(ua) ||
         (/Mac/.test(ua) && 'ontouchend' in document);
}
