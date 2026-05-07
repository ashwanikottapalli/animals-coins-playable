import { getActiveTheme } from './config.js';

// Lightweight Web Audio engine. Plays procedurally-generated sound effects
// + theme-bound voice files (loaded via fetch, decoded, played as buffers).
//
// Usage:
//   const a = new Audio();
//   a.unlock();                  // on first gesture (creates ctx + loads voice)
//   a.play('voice_intro');       // file-backed
//   a.play('pickup');            // procedural fallback
//
// File paths come from the active theme, so each theme can ship its own
// voiceover (e.g. ?theme=ice loads the ice-themed VO).

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.unlocked = false;
    this.muted = false;
    this._buffers = new Map();   // name -> { buffer, gain }
    this._loading = new Map();   // name -> Promise<void>
    this._pending = [];          // names queued while ctx is suspended
  }

  // Idempotent. First call creates the AudioContext (browsers create it
  // suspended without a user gesture). Subsequent calls (typically on first
  // user gesture) actually resume() the ctx, which drains queued plays.
  unlock() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) { console.warn('[audio] Web Audio API not available'); return; }

    if (!this.ctx) {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', () => {
        if (this.ctx.state === 'running') this._drainPending();
      });
      // Auto-load theme-bound voice files (decodeAudioData works in suspended state).
      const theme = getActiveTheme();
      if (theme.intro_voice) this.loadFile('voice_intro', theme.intro_voice);
      if (theme.end_voice)   this.loadFile('voice_end',   theme.end_voice);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {}); // no-op if browser blocks
    }
    // iOS Safari: silent buffer nudge once context is running.
    if (this.ctx.state === 'running') {
      const buf = this.ctx.createBuffer(1, 1, 22050);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      try { src.start(0); } catch {}
    }
    this.unlocked = true;
  }

  _drainPending() {
    while (this._pending.length) {
      const name = this._pending.shift();
      this.play(name);
    }
  }

  // Async-load an audio file into a named buffer slot.
  // Only requires the AudioContext to exist (decodeAudioData works while
  // suspended); doesn't wait for the unlock-by-gesture flag.
  loadFile(name, url, gain = 1.0) {
    if (!this.ctx) return Promise.resolve();
    if (this._buffers.has(name) || this._loading.has(name)) {
      return this._loading.get(name) || Promise.resolve();
    }
    const p = (async () => {
      try {
        const head = await fetch(url, { method: 'HEAD' });
        if (!head.ok) return;
        const r = await fetch(url);
        const ab = await r.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(ab);
        this._buffers.set(name, { buffer: buf, gain });
        console.info('[audio] loaded:', url);
      } catch (e) {
        // silent — buffer simply not available
      } finally {
        this._loading.delete(name);
      }
    })();
    this._loading.set(name, p);
    return p;
  }

  play(name) {
    if (this.muted || !this.ctx) return;

    // Context not yet running (audio not unlocked by gesture) — queue and
    // replay when state flips to 'running'. Keep the most recent of each name
    // so duplicate calls don't stack up.
    if (this.ctx.state !== 'running') {
      if (!this._pending.includes(name)) this._pending.push(name);
      return;
    }

    // Prefer a loaded audio file over procedural recipe.
    if (this._buffers.has(name)) return this._playBuffer(name);
    // If a file is mid-load, queue play for when it arrives.
    if (this._loading.has(name)) {
      this._loading.get(name).then(() => {
        if (this._buffers.has(name)) this._playBuffer(name);
      });
      return;
    }

    switch (name) {
      case 'pickup':   return this._pickup();
      case 'gate_pos': return this._gatePos();
      case 'gate_neg': return this._gateNeg();
      case 'thud':     return this._thud();
      case 'win':      return this._win();
      case 'fail':     return this._fail();
      case 'shatter':  return this._shatter();
    }
  }

  _playBuffer(name) {
    const entry = this._buffers.get(name);
    if (!entry) return;
    const src = this.ctx.createBufferSource();
    src.buffer = entry.buffer;
    const g = this.ctx.createGain();
    g.gain.value = entry.gain ?? 1.0;
    src.connect(g).connect(this.master);
    src.start(0);
  }

  // ---------- Stubs for future bg music (left as no-ops) ----------
  startMusic() { /* no-op for now */ }
  stopMusic()  { /* no-op for now */ }

  // ---------- Sound primitives ----------

  // Schedule a tone at offset seconds from "now".
  _tone({ freq, type = 'sine', attack = 0.005, decay = 0.12, gain = 0.3, offset = 0, freqEnd = null }) {
    const t = this.ctx.currentTime + offset;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd != null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + attack + decay);
    }
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0008, t + attack + decay);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  // Filtered noise burst — wood thud, dust, debris.
  _noise({ duration = 0.08, gain = 0.4, lowpass = 800, highpass = 0, offset = 0 }) {
    const t = this.ctx.currentTime + offset;
    const buf = this.ctx.createBuffer(1, Math.max(1, this.ctx.sampleRate * duration), this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    let node = src;
    if (highpass > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'highpass';
      f.frequency.value = highpass;
      node.connect(f); node = f;
    }
    if (lowpass > 0) {
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node.connect(f); node = f;
    }
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + duration);
    node.connect(env).connect(this.master);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // ---------- Sound recipes ----------

  _pickup() {
    this._tone({ freq: 1320, type: 'triangle', decay: 0.10, gain: 0.18 });
    this._tone({ freq: 1980, type: 'sine',     decay: 0.08, gain: 0.10, offset: 0.015 });
  }

  _gatePos() {
    // Two-note ascending major third
    this._tone({ freq: 660, type: 'sine', decay: 0.10, gain: 0.22 });
    this._tone({ freq: 990, type: 'sine', decay: 0.16, gain: 0.22, offset: 0.10 });
  }

  _gateNeg() {
    // Two-note descending, slightly harsher waveform
    this._tone({ freq: 520, type: 'square', decay: 0.10, gain: 0.18 });
    this._tone({ freq: 360, type: 'square', decay: 0.18, gain: 0.18, offset: 0.10 });
  }

  _thud() {
    // Wood-on-wood: short low-passed noise + tiny low-frequency tone for body
    this._noise({ duration: 0.08, gain: 0.30, lowpass: 600 });
    this._tone({ freq: 220, type: 'sine', decay: 0.10, gain: 0.10 });
  }

  _shatter() {
    // High-pitched noise burst with bandpass for "glass break" feel
    this._noise({ duration: 0.12, gain: 0.22, lowpass: 6000, highpass: 1200 });
  }

  _win() {
    // Three ascending notes: C5 → E5 → G5 (major arpeggio)
    this._tone({ freq: 523, type: 'sine', decay: 0.18, gain: 0.28, offset: 0.00 });
    this._tone({ freq: 659, type: 'sine', decay: 0.18, gain: 0.28, offset: 0.12 });
    this._tone({ freq: 784, type: 'sine', decay: 0.30, gain: 0.30, offset: 0.24 });
    // sparkle on top
    this._tone({ freq: 1568, type: 'triangle', decay: 0.30, gain: 0.10, offset: 0.30 });
  }

  _fail() {
    // Descending sad — slight frequency slide for that "trombone wah-wah" feel
    this._tone({ freq: 523, type: 'sawtooth', decay: 0.20, gain: 0.18, offset: 0.00, freqEnd: 392 });
    this._tone({ freq: 392, type: 'sawtooth', decay: 0.30, gain: 0.18, offset: 0.18, freqEnd: 261 });
  }
}
