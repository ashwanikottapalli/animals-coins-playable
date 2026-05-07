// Stubbed for Phase 1. Phase 5 will load real assets via Web Audio.
// API kept stable so callers can wire in now without changes later.

export class Audio {
  constructor() {
    this.unlocked = false;
    this.muted = false;
  }
  unlock() { this.unlocked = true; }
  play(_name) { /* no-op until Phase 5 */ }
  startMusic() { /* no-op */ }
  stopMusic() { /* no-op */ }
}
