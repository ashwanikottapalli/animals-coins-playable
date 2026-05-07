import * as THREE from 'three';
import { CONFIG } from './config.js';
import { buildLevel, animatePickups } from './level.js';
import { Player } from './player.js';
import { PlankSystem } from './plankSystem.js';
import { applyGateOp } from './mathGate.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';

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
    this.plankSystem.onCountChange = (n) => this.ui.setPlankCount(n);
    this.ui.setPlankCount(this.plankSystem.count);

    this.ui.bindStart(() => this.start());
    this.ui.bindRetry(() => this.reset());
  }

  start() {
    this.state = STATE.PLAYING;
    this.player.enableInput(true);
    this.player.setAnimation('run');
    this.audio.unlock();
    this.audio.startMusic();
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

    if (playing) {

      // Pickups
      this.plankSystem.pickupCheck();

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
          // Quick scale punch on the gate
          g.group.userData._t0 = this._time;
        }
      }
      // Animate gate punch
      for (const g of this.level.gates) {
        const t0 = g.group.userData._t0;
        if (t0 != null) {
          const dt2 = this._time - t0;
          const k = Math.max(0, 1 - dt2 / 0.25);
          const s = 1 + k * 0.18;
          g.group.scale.setScalar(s);
          if (dt2 > 0.4) g.group.userData._t0 = null;
        }
      }

      // Goal check
      if (this.player.position.z >= this.level.goalZ - 0.2) {
        this._triggerWin();
      }
    }

    if (this.state === STATE.WIN) {
      // Slow the bear, slight drift, then show CTA
      this.player.position.z += 1.2 * dt;
      this._endTimer += dt;
      if (this._endTimer > 1.0) {
        this.ui.showCTA();
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
        this.ui.showFail();
      }
    }

    this._followCamera(dt);
  }

  _triggerWin() {
    this.state = STATE.WIN;
    this._endTimer = 0;
    this.player.enableInput(false);
    this.player.setAnimation('idle');
    this.audio.play('win');
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
  }

  _followCamera(dt) {
    const tgt = new THREE.Vector3(
      this.player.position.x * 0.4 + CONFIG.cameraOffset.x,
      this.player.position.y + CONFIG.cameraOffset.y,
      this.player.position.z + CONFIG.cameraOffset.z
    );
    this.camera.position.lerp(tgt, CONFIG.cameraLerp);
    this.camera.lookAt(
      this.player.position.x * 0.5,
      this.player.position.y + 0.8,
      this.player.position.z + CONFIG.cameraLookAhead
    );
  }
}
