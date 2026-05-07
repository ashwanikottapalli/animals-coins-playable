import * as THREE from 'three';
import { CONFIG } from './config.js';

let _gradient = null;

// 1×N stepped gradient texture used by MeshToonMaterial for crisp light bands.
export function getToonGradient() {
  if (_gradient) return _gradient;
  const steps = Math.max(2, CONFIG.toon.steps | 0);
  const data = new Uint8Array(steps);
  for (let i = 0; i < steps; i++) {
    data[i] = Math.round(((i + 0.5) / steps) * 255);
  }
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  _gradient = tex;
  return tex;
}

// Convert a MeshStandardMaterial (or array of them) on a mesh to MeshToonMaterial,
// preserving color, map (albedo), normalMap, and transparency where present.
export function toToon(material) {
  if (!material) return material;
  if (Array.isArray(material)) return material.map(toToon);
  if (material.isMeshToonMaterial) return material;

  const toon = new THREE.MeshToonMaterial({
    color: material.color ? material.color.clone() : new THREE.Color(0xffffff),
    map: material.map || null,
    normalMap: material.normalMap || null,
    transparent: !!material.transparent,
    opacity: material.opacity ?? 1,
    side: material.side ?? THREE.FrontSide,
    gradientMap: getToonGradient(),
    emissive: material.emissive ? material.emissive.clone() : new THREE.Color(0x000000),
    emissiveIntensity: material.emissiveIntensity ?? 1,
    emissiveMap: material.emissiveMap || null,
  });
  return toon;
}

// Walk a scene/object3D and convert all suitable mesh materials to toon.
export function applyToonToObject(root) {
  if (!CONFIG.toon.enabled) return;
  root.traverse((node) => {
    if (!node.isMesh) return;
    // Skip basic/canvas-textured materials (gates) — they're already flat by design.
    const isStandard = (m) => m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial);
    if (Array.isArray(node.material)) {
      node.material = node.material.map(m => isStandard(m) ? toToon(m) : m);
    } else if (isStandard(node.material)) {
      node.material = toToon(node.material);
    }
  });
}
