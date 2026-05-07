import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CONFIG } from './config.js';
import { applyToonToObject } from './toon.js';

const ANIM_STATES = ['idle', 'run', 'climb', 'fall'];

export class Player {
  constructor(scene) {
    this.scene = scene;

    // Outer group is the world transform (this is what game.js moves).
    this.group = new THREE.Group();
    this.group.name = 'player';
    scene.add(this.group);

    // Inner pivot handles lateral lean.
    this.pivot = new THREE.Group();
    this.group.add(this.pivot);

    // Facing node — independent yaw flip used for climb (bear faces wall).
    // Lives between pivot and the bear so it doesn't rotate the back-stack.
    this.facingNode = new THREE.Group();
    this.pivot.add(this.facingNode);

    // Back-stack anchor on the pivot (NOT facingNode) so flipping the bear's
    // facing direction during climb doesn't move the planks to his front.
    this.backStackAnchor = new THREE.Group();
    const a = CONFIG.bear.backStackLocal;
    this.backStackAnchor.position.set(a.x, a.y, a.z);
    this.pivot.add(this.backStackAnchor);

    // Fake "blob" shadow under the feet — soft dark disc that grounds the bear
    // since we have no directional light casting real shadows.
    this.blobShadow = makeBlobShadow();
    this.group.add(this.blobShadow);

    // State
    this.position = this.group.position;
    this.targetX = 0;
    this.alive = true;
    this.climbing = false;        // when true, forward auto-run is paused (climb in place)
    this.tutorialPaused = false;  // when true, forward auto-run is paused (intro tutorial)
    this.onMoveStart = null;      // optional callback fired the first time the user drags or presses A/D

    // Drag/keyboard input
    this._lastPointerX = null;
    this._dragging = false;
    this._inputEnabled = false;
    this._keyLeft = false;
    this._keyRight = false;

    // Animation
    this.mesh = null;
    this.mixer = null;
    this.actions = {};            // name -> AnimationAction
    this.currentAction = null;
    this.currentName = null;
    this._loaded = false;
    this.onReady = null;          // optional callback fired once bear+anims are ready

    // Temporary placeholder so the scene isn't empty during load.
    this._placeholder = this._buildPlaceholder();
    this.facingNode.add(this._placeholder);

    this._bindInput();
    this._loadBear();
  }

  // ---------- Loading ----------

  async _loadBear() {
    const fbxLoader = new FBXLoader();
    const gltfLoader = new GLTFLoader();
    const path = CONFIG.bear.modelPath;
    const isGLB = /\.gl(b|tf)$/i.test(path);
    try {
      let bear;
      if (isGLB) {
        const gltf = await gltfLoader.loadAsync(path);
        bear = gltf.scene;
        // glTF clips live on the gltf object, not the scene — copy if any.
        if (gltf.animations?.length) bear.animations = gltf.animations;
        console.info('[player] loaded GLB:', path);
      } else {
        bear = await fbxLoader.loadAsync(path);
        console.info('[player] loaded FBX:', path);
      }

      // Load the bear's diffuse texture in parallel (doesn't block FBX parsing).
      let bearTexture = null;
      if (CONFIG.bear.texture) {
        try {
          bearTexture = await new THREE.TextureLoader().loadAsync(CONFIG.bear.texture);
          bearTexture.colorSpace = THREE.SRGBColorSpace;
          bearTexture.flipY = !!CONFIG.bear.textureFlipY;
          bearTexture.repeat.set(CONFIG.bear.textureRepeat.x, CONFIG.bear.textureRepeat.y);
          bearTexture.offset.set(CONFIG.bear.textureOffset.x, CONFIG.bear.textureOffset.y);
          bearTexture.wrapS = THREE.RepeatWrapping;
          bearTexture.wrapT = THREE.RepeatWrapping;
          bearTexture.anisotropy = 8;
          console.info('[player] bear texture loaded:', CONFIG.bear.texture, 'flipY=', bearTexture.flipY);
        } catch (err) {
          console.warn('[player] failed to load bear texture:', err);
        }
      }

      // Apply orientation FIRST (before bbox) so the bbox is measured along the
      // bear's true up-axis. GLB exports from Blender often arrive lying flat
      // (Z-up source), so config.bear.rotation lets us correct that.
      const rot = CONFIG.bear.rotation || { x: 0, y: 0, z: 0 };
      bear.rotation.set(rot.x, rot.y + (CONFIG.bear.yawOffset || 0), rot.z);
      bear.updateMatrixWorld(true);

      // Auto-scale by bounding box height so target height ≈ CONFIG.bear.targetHeight
      const bbox = new THREE.Box3().setFromObject(bear);
      const size = new THREE.Vector3();
      bbox.getSize(size);
      console.info('[player] bear pre-scale bbox size:', size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));
      const heightScale = CONFIG.bear.targetHeight / Math.max(0.001, size.y);
      bear.scale.setScalar(heightScale);

      // Recompute bbox post-scale so we can land the bear feet at y=0 of the pivot.
      bbox.setFromObject(bear);
      bear.position.y -= bbox.min.y; // feet on ground

      // Material/shadow polish
      const tint = CONFIG.bear.colorOverride;
      const emiHex = CONFIG.bear.emissive;
      const emiInt = CONFIG.bear.emissiveIntensity ?? 0;
      const meshSummary = [];
      bear.traverse((node) => {
        if (node.isMesh) {
          const mats = Array.isArray(node.material) ? node.material : [node.material];
          meshSummary.push({
            name: node.name || '(unnamed)',
            materialCount: mats.length,
            materialNames: mats.map(m => m?.name || '(unnamed)'),
            hasUv: !!node.geometry?.attributes?.uv,
            hasUv2: !!node.geometry?.attributes?.uv2,
          });
          node.castShadow = true;
          node.receiveShadow = true;
          if (node.material) {
            const mats = Array.isArray(node.material) ? node.material : [node.material];
            for (const m of mats) {
              if ('metalness' in m) m.metalness = 0.0;
              if ('roughness' in m) m.roughness = 0.85;
              // Apply our diffuse texture if loaded; otherwise fall back to the color tint.
              if (bearTexture && 'map' in m) {
                m.map = bearTexture;
                if (m.color) m.color.setHex(0xffffff); // texture provides colour
                m.needsUpdate = true;
              } else if (tint != null && m.color && !m.map) {
                m.color.setHex(tint);
              }
              // Self-illumination so the bear stays readable in shadow.
              if (emiHex && 'emissive' in m) {
                m.emissive.setHex(emiHex);
                if ('emissiveIntensity' in m) m.emissiveIntensity = emiInt;
              }
            }
          }
        }
      });

      console.table(meshSummary);

      // Convert standard materials to toon for cartoon shading.
      applyToonToObject(bear);

      // Cel-shaded outline (inverted hull). Clones the skinned meshes,
      // pushes their vertices outward along normals via a tiny shader, and
      // renders them with backface-only + dark color → traces a thin outline.
      if (CONFIG.bear.outline?.enabled !== false) {
        addInvertedHullOutline(bear, CONFIG.bear.outline);
      }

      this.mesh = bear;
      this.facingNode.add(bear);

      // Remove placeholder once real mesh is in
      this.facingNode.remove(this._placeholder);
      this._placeholder = null;

      // Mixer
      this.mixer = new THREE.AnimationMixer(bear);

      // 1) Pull any clips baked into bear.fbx (commonly the idle pose).
      //    First baked clip gets registered as 'idle' unless the config also
      //    points to a separate idle.fbx that loads successfully (it'll overwrite later).
      const bakedClips = (bear.animations || []).map((c, i) => ({
        name: i === 0 ? 'idle' : (c.name || `baked${i}`),
        clip: c,
      }));
      if (bakedClips.length) {
        console.log('[player] Found baked clips in bear.fbx:', bakedClips.map(b => `${b.name} (${b.clip.name || 'unnamed'})`));
      }

      // 2) Load animation clips from separate FBX files, in parallel.
      //    These are FBX regardless of bear model format — Mixamo-style separate clips.
      const animEntries = Object.entries(CONFIG.bear.animations);
      const fileResults = await Promise.all(
        animEntries.map(async ([name, path]) => {
          try {
            const animFbx = await fbxLoader.loadAsync(path);
            const clip = animFbx.animations && animFbx.animations[0];
            return { name, clip };
          } catch (err) {
            console.warn(`[player] Failed to load animation '${name}' from ${path}:`, err);
            return { name, clip: null };
          }
        })
      );

      // Combine: baked first, then files (files override baked under the same name)
      const results = [...bakedClips, ...fileResults];

      // ----- Diagnostics: catalog bear's bones, then sanity-check each clip's tracks -----
      const bearNodeNames = new Set();
      bear.traverse((n) => { if (n.name) bearNodeNames.add(n.name); });
      console.group('[player] Bear hierarchy');
      console.log('Total named nodes:', bearNodeNames.size);
      console.log('Sample bone-ish names:',
        Array.from(bearNodeNames).filter(n => /hip|spine|neck|head|leg|arm|root|bone|mixamo/i.test(n)).slice(0, 20));
      console.groupEnd();

      const rootBone = CONFIG.bear.rootBone;
      const rootMotionRe = rootBone ? new RegExp(`(^|\\|)${rootBone}\\.position$`) : null;

      for (const { name, clip } of results) {
        if (!clip) {
          console.warn(`[player] '${name}' returned no clip from FBX.`);
          continue;
        }

        // Strip root-motion (translation of the hip bone). Otherwise the run clip
        // physically displaces the bear forward in-clip and snaps back on loop.
        if (rootMotionRe) {
          const before = clip.tracks.length;
          clip.tracks = clip.tracks.filter(t => !rootMotionRe.test(t.name));
          if (clip.tracks.length !== before) {
            console.log(`[player] stripped root motion from '${name}' (${before - clip.tracks.length} track removed)`);
          }
        }

        // Strip any "Armature|" or similar prefix from track names that don't exist on the bear.
        const retargetedTracks = clip.tracks.map(t => {
          // Track name format: "<NodePath>.<property>" e.g., "mixamorigHips.position" or "Armature|Hips.quaternion"
          const dotIdx = t.name.lastIndexOf('.');
          const nodePath = t.name.slice(0, dotIdx);
          const prop = t.name.slice(dotIdx);
          const lastBone = nodePath.split('|').pop();
          if (bearNodeNames.has(nodePath))   return t;        // exact match
          if (bearNodeNames.has(lastBone))  {                  // try last segment of pipe-delimited path
            const cloned = t.clone();
            cloned.name = lastBone + prop;
            return cloned;
          }
          return t;
        });
        clip.tracks = retargetedTracks;

        const matched = clip.tracks.filter(t => {
          const nodePath = t.name.slice(0, t.name.lastIndexOf('.'));
          return bearNodeNames.has(nodePath);
        }).length;

        console.log(`[player] clip '${name}': duration=${clip.duration.toFixed(2)}s, tracks=${clip.tracks.length}, matched=${matched}`);
        if (matched === 0) {
          console.warn(`[player] '${name}': NO tracks match bear bones. Sample track names:`, clip.tracks.slice(0, 5).map(t => t.name));
        }

        clip.name = name;
        const action = this.mixer.clipAction(clip);
        action.enabled = true;
        action.setEffectiveWeight(0);
        // 'fall' should play once and hold its final pose. All other clips loop.
        if (name === 'fall') {
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
        }
        action.play();
        this.actions[name] = action;
      }

      this._loaded = true;
      const initial = this.actions.idle ? 'idle' : this.actions.run ? 'run' : null;
      if (initial) this.setAnimation(initial, 0);

      console.info('[player] Bear loaded.',
        'scale:', heightScale.toFixed(3),
        'animations:', Object.keys(this.actions));

      if (this.onReady) this.onReady();
    } catch (err) {
      console.error('[player] Failed to load bear FBX:', err);
      console.info('[player] Continuing with placeholder capsule.');
    }
  }

  _buildPlaceholder() {
    const g = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x9b5530, roughness: 0.7 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 0.7, 6, 12), bodyMat);
    body.castShadow = true;
    body.position.y = 0.8;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), bodyMat);
    head.position.set(0, 1.45, 0.18);
    head.castShadow = true;
    g.add(head);
    const snout = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.16, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x5a3a25, roughness: 0.7 })
    );
    snout.position.set(0, 1.40, 0.42);
    g.add(snout);
    return g;
  }

  // ---------- Animation control ----------

  setAnimation(name, fadeSec = CONFIG.bear.crossFadeSec) {
    if (!this._loaded) return;
    if (this.currentName === name) return;
    const next = this.actions[name];
    if (!next) return;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (this.currentAction && this.currentAction !== next) {
      this.currentAction.crossFadeTo(next, fadeSec, false);
    }
    this.currentAction = next;
    this.currentName = name;
  }

  // ---------- Input ----------

  _bindInput() {
    const canvas = document.getElementById('gameCanvas');
    const onDown = (e) => {
      if (!this._inputEnabled) return;
      this._dragging = true;
      this._lastPointerX = getPointerX(e);
    };
    const onMove = (e) => {
      if (!this._dragging || !this._inputEnabled) return;
      const x = getPointerX(e);
      const dx = x - this._lastPointerX;
      this._lastPointerX = x;
      if (dx !== 0) this._fireMoveStart();
      this.targetX -= dx * CONFIG.dragSensitivity;
      this._clampTargetX();
    };
    const onUp = () => { this._dragging = false; };

    canvas.addEventListener('pointerdown', onDown, { passive: false });
    window.addEventListener('pointermove', onMove, { passive: false });
    window.addEventListener('pointerup', onUp, { passive: false });
    window.addEventListener('pointercancel', onUp, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft')  { this._keyLeft = true;  this._fireMoveStart(); }
      if (e.code === 'KeyD' || e.code === 'ArrowRight') { this._keyRight = true; this._fireMoveStart(); }
      // Debug pace controls
      if (e.code === 'BracketLeft')  { CONFIG.debugSpeedScale = Math.max(0.05, CONFIG.debugSpeedScale * 0.5); console.log('[debug] speedScale =', CONFIG.debugSpeedScale.toFixed(3)); }
      if (e.code === 'BracketRight') { CONFIG.debugSpeedScale = Math.min(8,    CONFIG.debugSpeedScale * 2.0); console.log('[debug] speedScale =', CONFIG.debugSpeedScale.toFixed(3)); }
      if (e.code === 'Backslash')    { CONFIG.debugSpeedScale = 1.0; console.log('[debug] speedScale = 1.0'); }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyA' || e.code === 'ArrowLeft')  this._keyLeft = false;
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this._keyRight = false;
    });
  }

  _clampTargetX() {
    const halfWidth = CONFIG.pathWidth / 2 - CONFIG.playerHalfWidth;
    this.targetX = Math.max(-halfWidth, Math.min(halfWidth, this.targetX));
  }

  enableInput(enabled) { this._inputEnabled = enabled; }

  _fireMoveStart() {
    if (this.onMoveStart) {
      const cb = this.onMoveStart;
      this.onMoveStart = null;   // fire once
      cb();
    }
  }

  // Flip the bear's yaw so it faces a different direction.
  // Applied to facingNode (which sits between pivot and bear) so we get a
  // clean world-Y rotation independent of the bear's own X-axis correction.
  // 'forward' = running direction (default).
  // 'wall'    = +180° flip so bear's front is toward the wall during climb.
  setFacing(mode) {
    this.facingNode.rotation.y = (mode === 'wall') ? Math.PI : 0;
  }

  // ---------- Per-frame ----------

  update(dt, isRunning) {
    if (this.mixer) this.mixer.update(dt);

    if (!isRunning || !this.alive) return;

    const scale = CONFIG.debugSpeedScale ?? 1;
    if (!this.climbing && !this.tutorialPaused) {
      this.position.z += CONFIG.playerSpeed * scale * dt;
    }

    if (this._inputEnabled && (this._keyLeft || this._keyRight)) {
      const dir = (this._keyLeft ? 1 : 0) - (this._keyRight ? 1 : 0);
      this.targetX += dir * CONFIG.playerLateralSpeed * scale * dt;
      this._clampTargetX();
    }

    const lerpAmt = Math.min(1, CONFIG.playerLateralSpeed * scale * dt);
    this.position.x += (this.targetX - this.position.x) * lerpAmt;

    // Lean into turn (applied to the pivot so it doesn't fight world transforms)
    this.pivot.rotation.z = (this.targetX - this.position.x) * -0.25;
  }

  setGroundY(y) { this.position.y = y; }

  triggerFall() {
    this.alive = false;
    this.setAnimation('fall');
  }
}

function getPointerX(e) {
  if (e.touches && e.touches.length) return e.touches[0].clientX;
  return e.clientX ?? 0;
}

// Soft round shadow disc rendered as a flat plane just above the foot plane.
// Texture is a radial gradient so it fades cleanly into the path.
function makeBlobShadow() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 60);
  grad.addColorStop(0,    'rgba(0,0,0,0.55)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.30)');
  grad.addColorStop(1,    'rgba(0,0,0,0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.02;          // just above the foot plane to avoid z-fighting
  mesh.renderOrder = 1;
  return mesh;
}

// Cel-shaded outline via inverted-hull pass. For each SkinnedMesh in the bear,
// add a sibling clone that shares the same skeleton, renders BackSide only, and
// inflates vertices along normals in the vertex shader. Result: a thin solid
// outline traced around the silhouette.
function addInvertedHullOutline(root, opts = {}) {
  const color = opts.color ?? 0x1a1106;
  const thickness = opts.thickness ?? 0.04;   // world units of outline expansion

  const created = [];
  root.traverse((node) => {
    if (!node.isSkinnedMesh && !node.isMesh) return;
    // Only outline geometry that has normals.
    if (!node.geometry?.attributes?.normal) return;

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor:     { value: new THREE.Color(color) },
        uThickness: { value: thickness },
      },
      vertexShader: /* glsl */ `
        uniform float uThickness;
        #include <common>
        #include <skinning_pars_vertex>
        void main() {
          vec3 inflated = position + normal * uThickness;
          #include <skinbase_vertex>
          #include <begin_vertex>
          transformed = inflated;
          #include <skinning_vertex>
          #include <project_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        void main() {
          gl_FragColor = vec4(uColor, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: true,
      skinning: !!node.isSkinnedMesh,
      fog: false,
    });

    let outlineMesh;
    if (node.isSkinnedMesh) {
      outlineMesh = new THREE.SkinnedMesh(node.geometry, mat);
      outlineMesh.bind(node.skeleton, node.bindMatrix);
    } else {
      outlineMesh = new THREE.Mesh(node.geometry, mat);
    }
    outlineMesh.castShadow = false;
    outlineMesh.receiveShadow = false;
    // Render outline before the main bear so the bear's front faces draw on top.
    outlineMesh.renderOrder = -1;
    created.push({ owner: node, outline: outlineMesh });
  });

  for (const { owner, outline } of created) {
    owner.add(outline);
  }
}
