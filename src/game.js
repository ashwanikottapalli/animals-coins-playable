import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildLevel, animatePickups } from './level.js';
import { Player } from './player.js';
import { PlankSystem } from './plankSystem.js';
import { applyGateOp } from './mathGate.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { ParticleSystem } from './particles.js';

const STATE = {
  INTRO: 'intro',
  PLAYING: 'playing',
  WIN: 'win',
  FAIL: 'fail',
};

export class Game {
  constructor({ scene, camera, renderer, canvas }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.canvas = canvas;
    this.state = STATE.INTRO;
    this._time = 0;
    this._endTimer = 0;
    this._climb = null;          // { wall, t } when bear is climbing a wall in place
    this._climbDuration = 1.0;   // seconds to climb a wall fully
  }

  init() {
    this.audio = new Audio();
    this.ui = new UI();
    this.level = buildLevel(this.scene);
    this.player = new Player(this.scene);
    this.plankSystem = new PlankSystem(this.scene, this.level, this.player);
    this.particles = new ParticleSystem(this.scene);
    this.plankSystem.onCountChange = (n) => this.ui.setPlankCount(n);
    this.plankSystem.onBridgePlank = (pos) => {
      this.audio.play('thud');
      this.particles.emit(pos, 3, {
        kind: 'dust',
        color: [0xc8b48a, 0xe8d8b0],
        size: 9, sizeEnd: 0, speed: 0.9, gravity: -2.5, lifetime: 0.35, upBias: 0.6, spread: 0.7,
      });
    };
    this.plankSystem.onWallRung = (pos) => {
      this.audio.play('thud');
      this.particles.emit(pos, 5, {
        kind: 'sparkle',
        color: [0x9be0e0, 0xffffff],
        size: 8, sizeEnd: 0, speed: 1.6, gravity: -4, lifetime: 0.4, upBias: 0.6, spread: 0.9,
      });
    };
    this.ui.setPlankCount(this.plankSystem.count);

    // Camera shake state — small impulse-driven offset added on top of follow cam.
    this._shake = { intensity: 0, decay: 6 };
    // Footstep dust cadence
    this._footstepTimer = 0;

    this.ui.bindRetry(() => this.reset());

    // Wait for bear+animations to load before starting the game and revealing
    // the tutorial. Until then the loading splash covers the scene.
    if (this.player._loaded) {
      this.ui.completeLoading();
      this.start();
    } else {
      this.player.onReady = () => {
        this.ui.completeLoading();
        this.start();
      };
    }
  }

  shakeCamera(intensity = 0.15, decay = 6) {
    this._shake.intensity = Math.max(this._shake.intensity, intensity);
    this._shake.decay = decay;
  }

  // Project a world point to the #app coordinate space and ask the UI to
  // render a transient floating text there.
  _showFloatingChange(text, positive) {
    const v = new THREE.Vector3(
      this.player.position.x,
      this.player.position.y + 1.6,
      this.player.position.z + 0.3,
    );
    v.project(this.camera);
    const appEl = document.getElementById('app');
    const w = appEl.clientWidth;
    const h = appEl.clientHeight;
    const x = (v.x * 0.5 + 0.5) * w;
    const y = (-v.y * 0.5 + 0.5) * h;
    this.ui.spawnFloatingText(text, x, y, positive);
  }

  start() {
    this.state = STATE.PLAYING;
    this.player.enableInput(true);

    // Show "Drag to Move" tutorial — bear stands idle until the first drag.
    this.player.tutorialPaused = true;
    this.player.setAnimation('idle');
    this.ui.showTutorial();
    // First drag both dismisses the tutorial AND unlocks audio
    // (browsers block AudioContext until a user gesture).
    this.player.onMoveStart = () => {
      this.audio.unlock();
      this.audio.startMusic();
      // Greeting voiceover (queues if file is still loading).
      this.audio.play('voice_intro');
      this._dismissTutorial();
    };
  }

  _dismissTutorial() {
    if (!this.player.tutorialPaused) return;
    this.player.tutorialPaused = false;
    this.ui.hideTutorial();
    this.player.setAnimation('run');
  }

  reset() {
    // Phase 1 simple reset: full page reload. Cleaner than mesh teardown.
    location.reload();
  }

  update(dt) {
    this._time += dt;

    animatePickups(this.level, this._time);

    // Always tick the player so the AnimationMixer runs (idle in intro, fall after fail, etc.)
    const playing = this.state === STATE.PLAYING;
    this.player.update(dt, playing);

    if (playing && this.player.tutorialPaused) {
      // Tutorial showing — bear stands idle, no gameplay logic.
      this.player.setAnimation('idle');
    } else if (playing) {

      // Pickups — minimal sparkle (4-point star) on each plank collected
      this.plankSystem.pickupCheck((pickup) => {
        this.audio.play('pickup');
        this.particles.emit(pickup.position, 4, {
          kind: 'sparkle',
          color: [0xa6f4ee, 0xffffff],
          size: 9, sizeEnd: 0, speed: 2.2, gravity: -6, lifetime: 0.32, upBias: 0.8,
        });
      });

      // Anticipate ground (lookahead a bit)
      const lookAheadZ = this.player.position.z + CONFIG.plankSize.z * 1.5;
      this.plankSystem.updateBridge(lookAheadZ);
      const wallNear = this.plankSystem.updateStair(lookAheadZ);

      // ---- Wall climb state machine ----
      // updateStair places ladder rungs once bear is in trigger zone.
      // We start climbing when the bear reaches wall.zStart, hold bear in
      // place while raising y over `_climbDuration`, then teleport past wall.

      // Climb hold: bear sits this far in front of the wall while ascending,
      // so its body stays clear of the wall mesh and the rungs (at wall.zStart - 0.20).
      const CLIMB_HOLD_OFFSET = 0.55;

      // Start climb if applicable
      if (!this._climb && wallNear && wallNear.validated && !wallNear.failed &&
          !wallNear.entered &&
          this.player.position.z >= wallNear.zStart - CLIMB_HOLD_OFFSET) {
        wallNear.entered = true;
        this._climb = { wall: wallNear, t: 0 };
        this.player.climbing = true;
        this.player.setFacing('wall');
        // Place the bottom rung immediately so bear has something under his feet.
        this.plankSystem.placeWallRung(wallNear, 0);
        // Instant pose swap so the run→climb crossfade doesn't visibly blend
        // through an in-between rotated body.
        this.player.setAnimation('climb', 0);
      }

      if (this._climb) {
        const w = this._climb.wall;
        this._climb.t += dt / this._climbDuration;

        // Progressive rung placement: each rung pops in just before the bear's
        // feet reach it. Rung i wants to be in place when t >= i / stepCount.
        const rungsWanted = Math.min(w.stepCount, Math.floor(this._climb.t * w.stepCount) + 1);
        for (let i = 0; i < rungsWanted; i++) this.plankSystem.placeWallRung(w, i);

        if (this._climb.t >= 1) {
          this.player.position.z = w.zEnd + 0.05;
          this.player.setGroundY(w.topY);
          this.player.climbing = false;
          this._climb = null;
          this.player.setFacing('forward');
          // Instant swap back to run — no crossfade rotation glitch.
          this.player.setAnimation('run', 0);
        } else {
          this.player.position.z = w.zStart - CLIMB_HOLD_OFFSET;
          this.player.setGroundY(w.baseY + this._climb.t * w.height);
          this.player.setAnimation('climb', 0);
        }
      } else if (wallNear && wallNear.failed && !wallNear.entered &&
                 this.player.position.z >= wallNear.zStart - CLIMB_HOLD_OFFSET) {
        // Not enough planks for the wall — tip off the path edge.
        wallNear.entered = true;
        this._triggerFail('wall');
        return;
      } else {
        // Normal ground resolution
        const ground = this.plankSystem.resolveGroundY();
        if (ground.fall && this.player.alive) {
          this._triggerFail();
          return;
        }
        this.player.setGroundY(ground.y);
        this.player.setAnimation('run');
      }

      // Math-gate collisions
      for (const g of this.level.gates) {
        if (g.applied) continue;
        const dz = Math.abs(this.player.position.z - g.z);
        const dx = Math.abs(this.player.position.x - g.x);
        if (dz < 0.4 && dx < g.width / 2) {
          const before = this.plankSystem.count;
          const after = applyGateOp(before, g.op, g.value);
          this.plankSystem.setCount(after);
          g.applied = true;
          g.group.userData._t0 = this._time;

          // Shatter the panel — keep the posts standing
          if (g.panel) g.panel.visible = false;

          const positive = g.op === 'add' || g.op === 'multiply';

          // Audio: shatter + ascending/descending tone
          this.audio.play('shatter');
          this.audio.play(positive ? 'gate_pos' : 'gate_neg');

          // Shatter burst — sparkle (additive star) flying out in the gate's color
          const burstColor = positive ? [0x9ce86b, 0xfff09e, 0xb6f3ff] : [0xff8079, 0xffaaaa, 0xfff5e0];
          this.particles.emit(
            new THREE.Vector3(g.x, g.y + g.height * 0.55, g.z),
            22,
            { kind: 'sparkle', color: burstColor, size: 14, sizeEnd: 0, speed: 7, gravity: -8, lifetime: 0.6, upBias: 0.5, spread: 1.2 }
          );

          // Camera shake — felt impact when the panel breaks
          this.shakeCamera(positive ? 0.16 : 0.12);

          // Floating "+10" / "x3" / "-2" / "÷2" indicator above bear
          const sym = { add: '+', subtract: '-', multiply: '×', divide: '÷' }[g.op] || '';
          this._showFloatingChange(`${sym}${g.value}`, positive);
        }
      }
      // Goal check
      if (this.player.position.z >= this.level.goalZ - 0.2) {
        this._triggerWin();
      }
    }

    // Decay camera shake every frame regardless of state
    if (this._shake && this._shake.intensity > 0) {
      this._shake.intensity = Math.max(0, this._shake.intensity - this._shake.decay * dt);
    }

    if (this.state === STATE.WIN) {
      // Slow the bear, slight drift, then show CTA
      this.player.position.z += 1.2 * dt;
      this._endTimer += dt;
      if (this._endTimer > 1.0) {
        this.ui.showCTA();
        this.audio.play('voice_end');
        this.state = 'cta-shown';
      }
    }

    if (this.state === STATE.FAIL && !this._failShown) {
      if (!this._failStatic) {
        // Gravity drop into the void (gap fail).
        const GRAVITY = 28;
        this._fallVy -= GRAVITY * dt;
        this.player.position.y += this._fallVy * dt;
        this.player.position.z += 0.4 * dt;
      }
      // For wall-fail the bear stays planted; we just hold for a beat then show UI.
      const delay = this._failStatic ? 0.7 : 1.1;
      if (this._time - this._fallStart > delay) {
        this._failShown = true;
        this.ui.showCTA('fail');
        this.audio.play('voice_end');
      }
    }

    this._followCamera(dt);
    this.particles.update(dt);
  }

  _triggerWin() {
    this.state = STATE.WIN;
    this._endTimer = 0;
    this.player.enableInput(false);
    this.player.setAnimation('idle');
    this.audio.play('win');

    // Win celebration — confetti chips falling + a sparkle bloom on top
    const goalPos = new THREE.Vector3(0, this.player.position.y + 1, this.level.goalZ);
    this.particles.emit(goalPos, 50, {
      kind: 'confetti',
      color: [0xffd966, 0xff8a4f, 0x9ce86b, 0x6fb9ff, 0xff6fb3, 0xffffff],
      size: 22, sizeEnd: 16, speed: 8, gravity: -7, lifetime: 1.2, upBias: 0.6, spread: 1.3,
    });
    this.particles.emit(goalPos, 18, {
      kind: 'sparkle',
      color: [0xfff09e, 0xffffff, 0xb6f3ff],
      size: 14, sizeEnd: 0, speed: 6, gravity: -5, lifetime: 0.6, upBias: 0.5, spread: 1.0,
    });
    this.shakeCamera(0.18);
  }

  _triggerFail(reason = 'fall') {
    if (this.state === STATE.FAIL) return;
    this.state = STATE.FAIL;
    this.player.triggerFall();
    this.player.enableInput(false);
    this.audio.play('fail');
    this._fallStart = this._time;
    this._failShown = false;
    // 'wall' = bear is stuck at the wall, no plunging into the void.
    // Anything else (gap, etc.) = real gravity drop.
    this._failStatic = reason === 'wall';
    this._fallVy = -1.5;
    this._fallVx = 0;

    // Dust/debris burst + camera shake (normal blend so it doesn't glow)
    this.particles.emit(
      new THREE.Vector3(this.player.position.x, this.player.position.y + 0.3, this.player.position.z),
      14,
      { kind: 'dust', color: [0xc8b48a, 0x9c8665, 0xe6d4ad], size: 18, sizeEnd: 0, speed: 3, gravity: -4, lifetime: 0.7, upBias: 0.5, spread: 1.0 }
    );
    this.shakeCamera(0.35, 5);
  }

  _followCamera(dt) {
    // Dynamic zoom-back: as the plank stack grows the bear becomes very tall.
    // We pull the camera up + back proportional to plank count so the whole
    // stack stays in frame, capped so it doesn't run away on huge counts.
    const stackBoost = Math.min(1, this.plankSystem.count / 25); // 0..1
    const yBoost = stackBoost * 1.6;
    const zBoost = stackBoost * 1.6;
    const lookYBoost = stackBoost * 0.9;

    const tgt = new THREE.Vector3(
      this.player.position.x * 0.4 + CONFIG.cameraOffset.x,
      this.player.position.y + CONFIG.cameraOffset.y + yBoost,
      this.player.position.z + CONFIG.cameraOffset.z - zBoost,   // -z = further behind
    );
    this.camera.position.lerp(tgt, CONFIG.cameraLerp);

    // Apply camera shake (small random offset based on intensity).
    if (this._shake.intensity > 0) {
      const i = this._shake.intensity;
      this.camera.position.x += (Math.random() - 0.5) * i * 2;
      this.camera.position.y += (Math.random() - 0.5) * i * 2;
    }

    this.camera.lookAt(
      this.player.position.x * 0.5,
      this.player.position.y + 0.8 + lookYBoost,
      this.player.position.z + CONFIG.cameraLookAhead
    );
  }
}
