import * as THREE from 'three';
import { CONFIG, getActiveTheme } from './config.js';
import { createMathGate } from './mathGate.js';
import { toToon } from './toon.js';

// Builds level meshes from CONFIG.level. Returns a Level object with
// segment metadata, pickup/gate references, and helpers for runtime queries.
export function buildLevel(scene) {
  const segments = [];
  const pickups = [];
  const gates = [];
  const gaps = [];
  const walls = [];
  let cursorZ = 0;
  let currentY = 0;
  let goalZ = 0;

  // Path uses Lambert. Emissive lifts unlit faces (slab front edge) so they
  // don't go pure-black under the overhead key light.
  const pathMat = new THREE.MeshLambertMaterial({
    color: CONFIG.pathColor,
    emissive: 0x2a2a2a,
    emissiveIntensity: 1.0,
  });
  console.info('[level] pathMat.color =', '#' + pathMat.color.getHexString(), '(from CONFIG.pathColor =', '0x' + CONFIG.pathColor.toString(16) + ')');

  // Optional path texture — try a few filename/extension combos, swap each
  // slab to a per-slab clone with size-aware UV repeat so the tile pattern is
  // consistent regardless of slab length.
  const pathSlabs = []; // tracks { mesh, w, length } for retroactive texturing
  const pathUrl = getActiveTheme().path;
  (async () => {
    if (!pathUrl) return;
    try {
      const head = await fetch(pathUrl, { method: 'HEAD' });
      if (!head.ok) return;
      const tex = await new THREE.TextureLoader().loadAsync(pathUrl);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = 8;
      const TILE = 1.5; // world units per texture tile
      for (const { mesh, w, length } of pathSlabs) {
        const slabTex = tex.clone();
        slabTex.image = tex.image;
        slabTex.needsUpdate = true;
        slabTex.wrapS = slabTex.wrapT = THREE.RepeatWrapping;
        slabTex.repeat.set(w / TILE, length / TILE);
        const slabMat = pathMat.clone();
        slabMat.map = slabTex;
        // White tint = render texture at its full painted brightness; lighting
        // still modulates it via Lambert. Tinting < white was double-darkening.
        slabMat.color.setHex(0xffffff);
        // Lift the dark edges of the slab geometry that don't get direct sun.
        slabMat.emissive.setHex(0x303030);
        slabMat.emissiveIntensity = 1.0;
        mesh.material = slabMat;
      }
      console.info(`[level] path texture loaded from ${pathUrl} — applied to ${pathSlabs.length} slabs`);
    } catch {}
  })();

  const root = new THREE.Group();
  root.name = 'levelRoot';
  scene.add(root);

  // Pre-level intro path — runs from -INTRO_LEN to 0 so the bear (which
  // spawns at z=0) has visible path behind him at game start.
  const INTRO_LEN = CONFIG.preLevelPathLength ?? 4;
  if (INTRO_LEN > 0) {
    const introSlab = createPathSlab(pathMat, CONFIG.pathWidth, CONFIG.pathHeight, INTRO_LEN);
    introSlab.position.set(0, currentY - CONFIG.pathHeight / 2, -INTRO_LEN / 2);
    introSlab.receiveShadow = true;
    root.add(introSlab);
    pathSlabs.push({ mesh: introSlab, w: CONFIG.pathWidth, length: INTRO_LEN });
    segments.push({ type: 'path', zStart: -INTRO_LEN, zEnd: 0, y: currentY });
    // cursorZ stays at 0 — main level builds forward from here as before.
  }

  // Combine consecutive gates into a single z slice (visually they are
  // door-pairs side-by-side). We pre-scan and group by index pairs.
  const layout = CONFIG.level;

  for (let i = 0; i < layout.length; i++) {
    const seg = layout[i];

    if (seg.type === 'path') {
      const len = seg.length;
      const slab = createPathSlab(pathMat, CONFIG.pathWidth, CONFIG.pathHeight, len);
      slab.position.set(0, currentY - CONFIG.pathHeight / 2, cursorZ + len / 2);
      slab.receiveShadow = true;
      root.add(slab);
      pathSlabs.push({ mesh: slab, w: CONFIG.pathWidth, length: len });

      segments.push({ type: 'path', zStart: cursorZ, zEnd: cursorZ + len, y: currentY });

      // Scatter planks on top of the slab
      const plankCount = seg.planks || 0;
      for (let p = 0; p < plankCount; p++) {
        const t = (p + 1) / (plankCount + 1);
        const pz = cursorZ + t * len;
        // Spread across width with mild randomness
        const spread = (CONFIG.pathWidth - 1.4) * 0.5;
        const px = (Math.random() * 2 - 1) * spread;
        const plank = createPlankPickup(px, currentY + 0.12, pz);
        root.add(plank);
        pickups.push({ mesh: plank, position: plank.position.clone(), taken: false });
      }

      cursorZ += len;
    } else if (seg.type === 'gap') {
      const len = seg.length;
      gaps.push({
        zStart: cursorZ,
        zEnd: cursorZ + len,
        y: currentY,
        planksDropped: [],
      });
      segments.push({ type: 'gap', zStart: cursorZ, zEnd: cursorZ + len, y: currentY });
      cursorZ += len;
    } else if (seg.type === 'wall') {
      const wallHeight = seg.height;
      // Visible wall block (the cliff). The path continues at currentY + wallHeight.
      const wallDepth = 0.6;
      const wallGeo = new THREE.BoxGeometry(CONFIG.pathWidth, wallHeight, wallDepth);
      const wallMesh = new THREE.Mesh(wallGeo, pathMat);
      wallMesh.position.set(0, currentY + wallHeight / 2, cursorZ + wallDepth / 2);
      wallMesh.castShadow = true;
      wallMesh.receiveShadow = true;
      root.add(wallMesh);
      pathSlabs.push({ mesh: wallMesh, w: CONFIG.pathWidth, length: wallHeight });

      walls.push({
        zStart: cursorZ,
        zEnd: cursorZ + wallDepth,
        baseY: currentY,
        topY: currentY + wallHeight,
        height: wallHeight,
        planksStacked: [],
      });
      segments.push({ type: 'wall', zStart: cursorZ, zEnd: cursorZ + wallDepth, y: currentY, topY: currentY + wallHeight });
      cursorZ += wallDepth;
      currentY += wallHeight;
    } else if (seg.type === 'gate') {
      // Pair gates that appear consecutively into one row at the same z.
      const pair = [seg];
      if (layout[i + 1] && layout[i + 1].type === 'gate') {
        pair.push(layout[i + 1]);
        i++; // consume next
      }
      const rowZ = cursorZ + 0.5; // small offset into the upcoming path
      // Each gate in a pair gets a reference to its siblings so we can
      // mark all gates in the pair as "applied" the moment one fires —
      // prevents double-fire when the bear straddles the seam between panels.
      const siblings = [];
      for (const g of pair) {
        const xOffset = g.side === 'left' ? -CONFIG.pathWidth / 4 : CONFIG.pathWidth / 4;
        const gate = createMathGate(g.op, g.value);
        gate.group.position.set(xOffset, currentY + CONFIG.gateHeight / 2, rowZ);
        root.add(gate.group);
        const gateObj = {
          ...gate,
          op: g.op,
          value: g.value,
          x: xOffset,
          z: rowZ,
          y: currentY,
          width: CONFIG.gateWidth,
          height: CONFIG.gateHeight,
          applied: false,
          siblings,                // shared array — populated below
        };
        siblings.push(gateObj);
        gates.push(gateObj);
      }
      // Don't advance cursorZ — gates sit on the existing path.
    } else if (seg.type === 'goal') {
      goalZ = cursorZ + 1.0;
      // simple golden disc as goal marker
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 0.06, 32),
        new THREE.MeshStandardMaterial({ color: 0xffc83a, emissive: 0x553300, roughness: 0.4, metalness: 0.6 })
      );
      ring.position.set(0, currentY + 0.6, goalZ);
      ring.rotation.x = Math.PI / 2;
      root.add(ring);
      const glow = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 0.85, 0.02, 32),
        new THREE.MeshBasicMaterial({ color: 0xffe089, transparent: true, opacity: 0.45 })
      );
      glow.position.copy(ring.position);
      glow.rotation.x = Math.PI / 2;
      root.add(glow);
    }
  }

  return {
    root,
    segments,
    pickups,
    gates,
    gaps,
    walls,
    goalZ,
    totalLength: cursorZ,
  };
}

function createPathSlab(mat, w, h, length) {
  const geo = new THREE.BoxGeometry(w, h, length);
  return new THREE.Mesh(geo, mat);
}

// One shared pickup material across all pickups so we can apply a texture once.
let _pickupMat = null;
let _pickupGeo = null;
function getPickupMaterial() {
  if (_pickupMat) return _pickupMat;
  _pickupMat = toToon(new THREE.MeshStandardMaterial({
    color: CONFIG.plankColor,
    roughness: 0.92,
    metalness: 0.0,
  }));
  // Try to load the active-theme plank texture and apply.
  (async () => {
    const url = getActiveTheme().plank;
    if (!url) return;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (!r.ok) return;
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      _pickupMat.map = tex;
      _pickupMat.color.setHex(0xffffff);
      _pickupMat.needsUpdate = true;
      console.info('[level] plank texture loaded for pickups:', url);
    } catch {}
  })();
  return _pickupMat;
}

function createPlankPickup(x, y, z) {
  const { plankSize } = CONFIG;
  if (!_pickupGeo) _pickupGeo = new THREE.BoxGeometry(plankSize.x, plankSize.y, plankSize.z);
  const m = new THREE.Mesh(_pickupGeo, getPickupMaterial());
  m.castShadow = true;
  m.position.set(x, y, z);
  m.userData.basePos = m.position.clone();
  m.userData.bobPhase = Math.random() * Math.PI * 2;
  return m;
}

// Per-frame pickup animation — currently a no-op; planks sit static on the path.
export function animatePickups(_level, _time) {
}
