import * as THREE from 'three';
import { CONFIG } from './config.js';
import { toToon } from './toon.js';

// Inventory + bridge + stair + back-stack visualization.
// The system is queried each frame to produce a `groundY` for the player.
export class PlankSystem {
  constructor(scene, level, player) {
    this.scene = scene;
    this.level = level;
    this.player = player;

    this.count = CONFIG.plankInitialCount;
    this.onCountChange = null;

    this._sharedGeo = new THREE.BoxGeometry(
      CONFIG.plankSize.x, CONFIG.plankSize.y, CONFIG.plankSize.z
    );
    this._sharedMat = toToon(new THREE.MeshStandardMaterial({
      color: CONFIG.plankColor,
      roughness: 0.92,
      metalness: 0.0,
    }));

    // Try to apply plank.png to the shared material (used by bridge planks,
    // wall rungs, and the back-stack on the bear).
    fetch('assets/textures/plank.png', { method: 'HEAD' }).then(res => {
      if (!res.ok) return;
      new THREE.TextureLoader().load('assets/textures/plank.png', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        this._sharedMat.map = tex;
        this._sharedMat.color.setHex(0xffffff);
        this._sharedMat.needsUpdate = true;
        console.info('[plankSystem] plank texture applied to shared material');
      });
    }).catch(() => {});

    // back-stack visual on bear
    this._backStack = []; // meshes parented to player.backStackAnchor
    this._rebuildBackStack();
  }

  setCount(n) {
    this.count = Math.max(0, Math.floor(n));
    this._rebuildBackStack();
    if (this.onCountChange) this.onCountChange(this.count);
  }

  add(n)    { this.setCount(this.count + n); }
  spend(n=1){ this.setCount(this.count - n); }

  _rebuildBackStack() {
    const anchor = this.player.backStackAnchor;
    // Resize stack count visually with cap to avoid mesh explosion
    const visible = Math.min(this.count, 30);
    while (this._backStack.length < visible) {
      const m = new THREE.Mesh(this._sharedGeo, this._sharedMat);
      m.castShadow = true;
      anchor.add(m);
      this._backStack.push(m);
    }
    while (this._backStack.length > visible) {
      const m = this._backStack.pop();
      anchor.remove(m);
    }
    // Stack flat planks vertically on bear's back (long axis across back).
    for (let i = 0; i < this._backStack.length; i++) {
      const m = this._backStack[i];
      m.position.set(0, (i + 0.5) * CONFIG.plankSize.y, -0.05);
    }
  }

  // Pickup detection — call each frame. Picks any pickup within radius.
  pickupCheck(onPickup) {
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const r2 = CONFIG.plankPickupRadius * CONFIG.plankPickupRadius;
    for (const p of this.level.pickups) {
      if (p.taken) continue;
      const dx = p.position.x - px;
      const dz = p.position.z - pz;
      if (dx * dx + dz * dz <= r2) {
        p.taken = true;
        p.mesh.visible = false;
        this.add(1);
        if (onPickup) onPickup(p);
      }
    }
  }

  // Lay bridge planks across the nearest gap. Planks are tiled to exactly cover
  // gap.zStart..gap.zEnd, so the last plank reaches the far edge (no fall-through
  // window at the end of a gap).
  updateBridge(lookAheadZ) {
    for (const gap of this.level.gaps) {
      if (gap.bridged) continue;
      const triggerZ = gap.zStart - 1.2;
      const pz = this.player.position.z;
      if (pz < triggerZ) continue;
      if (pz > gap.zEnd + 1.0) continue;

      const gapLen = gap.zEnd - gap.zStart;
      const stepCount = Math.max(1, Math.ceil(gapLen / CONFIG.plankSize.z));
      const stride = gapLen / stepCount;     // exact tile, slightly < plank length so they overlap

      while (gap.planksDropped.length < stepCount) {
        const idx = gap.planksDropped.length;
        const z = gap.zStart + (idx + 0.5) * stride;
        // Place just-in-time as the bear advances (after the first plank).
        if (idx > 0 && z > lookAheadZ + 0.5) break;
        if (this.count <= 0) return true;

        const plank = new THREE.Mesh(this._sharedGeo, this._sharedMat);
        plank.castShadow = true;
        plank.receiveShadow = true;
        plank.position.set(0, gap.y - CONFIG.plankSize.y / 2, z);
        this.scene.add(plank);
        gap.planksDropped.push(plank);
        this.spend(1);
      }

      if (gap.planksDropped.length >= stepCount) gap.bridged = true;
      return true;
    }
    return false;
  }

  // For walls: validate that the bear has enough planks. Rung meshes are placed
  // progressively as the bear climbs — see placeWallRung() below, called from game.js.
  // Returns the wall when bear is in its trigger zone, else null.
  updateStair(_lookAheadZ) {
    for (const wall of this.level.walls) {
      const triggerZ = wall.zStart - 1.2;
      const pz = this.player.position.z;
      if (pz < triggerZ) continue;
      if (pz > wall.zEnd + 1.0) continue;

      if (!wall.validated) {
        const stepHeight = 0.45;
        const stepCount = Math.ceil(wall.height / stepHeight);
        wall.stepHeight = stepHeight;
        wall.stepCount = stepCount;
        wall.rungZ = wall.zStart - 0.20;
        wall.validated = true;
        if (this.count < stepCount) {
          wall.failed = true;
          return null;
        }
      }
      return wall;
    }
    return null;
  }

  // Place a single wall rung at the given index, consuming one plank.
  // Idempotent — does nothing if that index is already placed.
  placeWallRung(wall, idx) {
    if (wall.planksStacked[idx]) return;
    if (this.count <= 0) return;

    const plank = new THREE.Mesh(this._sharedGeo, this._sharedMat);
    plank.castShadow = true;
    plank.receiveShadow = true;
    plank.position.set(0, wall.baseY + (idx + 0.5) * wall.stepHeight, wall.rungZ);
    this.scene.add(plank);
    wall.planksStacked[idx] = plank;
    this.spend(1);
  }

  // Compute the appropriate ground Y for the player at his current z position.
  // Returns { y, fall } where fall=true means the bear is in midair with no plank.
  // NOTE: Wall climb is now driven by game.js (state machine) — this function
  // returns sensible values for before-wall (path elevation) and after-wall (top)
  // states; during climb itself, game.js overrides the y directly.
  resolveGroundY() {
    const pz = this.player.position.z;

    // Gaps: only allow standing if a plank covers this z under the bear.
    for (const gap of this.level.gaps) {
      if (pz >= gap.zStart && pz <= gap.zEnd) {
        // Find a plank at this z
        const stepZ = CONFIG.plankSize.z;
        const covered = gap.planksDropped.some(p => Math.abs(p.position.z - pz) <= stepZ * 0.55);
        if (covered) return { y: gap.y, fall: false };
        return { y: gap.y, fall: true };
      }
    }

    // Path segments: find one containing pz
    for (const seg of this.level.segments) {
      if (seg.type === 'path' && pz >= seg.zStart && pz <= seg.zEnd) {
        return { y: seg.y, fall: false };
      }
      if (seg.type === 'wall' && pz >= seg.zStart && pz <= seg.zEnd) {
        return { y: seg.topY, fall: false };
      }
    }

    // Off the end of the level — keep the last known elevation.
    const last = this.level.segments[this.level.segments.length - 1];
    if (last) {
      const y = last.type === 'wall' ? last.topY : last.y;
      return { y: y || 0, fall: false };
    }
    return { y: 0, fall: false };
  }
}
