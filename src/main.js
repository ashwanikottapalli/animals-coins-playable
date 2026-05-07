import * as THREE from 'three';
import { Game } from './game.js';
import { CONFIG, getActiveTheme } from './config.js';
import { createSky } from './sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FXAAShader }     from 'three/addons/shaders/FXAAShader.js';

console.info('%c[boot] config snapshot', 'color:#0aa', {
  pathColor: '0x' + CONFIG.pathColor.toString(16),
  plankColor: '0x' + CONFIG.plankColor.toString(16),
  bearColorOverride: CONFIG.bear.colorOverride ? '0x' + CONFIG.bear.colorOverride.toString(16) : null,
  toonEnabled: CONFIG.toon.enabled,
});

const appEl  = document.getElementById('app');
const canvas = document.getElementById('gameCanvas');

// Read the playable container's size — NOT window — because the page
// letterboxes the playable to 9:16 portrait on desktop.
const getViewSize = () => ({ w: appEl.clientWidth, h: appEl.clientHeight });

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
const PIXEL_RATIO = Math.min(window.devicePixelRatio, 2);
renderer.setPixelRatio(PIXEL_RATIO);
{
  const { w, h } = getViewSize();
  renderer.setSize(w, h, false);
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
// scene.background left null — the procedural sky sphere (added below) covers it.
// Fog still uses the horizon color so distant objects fade into the sky cleanly.
scene.fog = new THREE.Fog(0xc7e0d2, 35, 95);

const camera = new THREE.PerspectiveCamera(
  55,
  (() => { const { w, h } = getViewSize(); return w / h; })(),
  0.1,
  200
);
camera.position.set(0, 6, -8);
camera.lookAt(0, 0, 5);

// Procedural sky — gradient sphere, parented to camera so it's always centered.
// Used as fallback if no equirectangular sky asset is dropped in.
// Camera must be in the scene graph for its children to be rendered.
const sky = createSky({ horizonColor: 0xc7e0d2, zenithColor: 0x6fa6d6 });
camera.add(sky);
scene.add(camera);

// Stylized backdrop card — a wide plane parented to the camera so it's
// always behind the action. Path comes from the active theme.
(async () => {
  const url = getActiveTheme().backdrop;
  if (!url) return;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    if (!r.ok) return;
  } catch { return; }
  new THREE.TextureLoader().load(url, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
    });
    // Plane sized to fully cover the camera's frustum at the chosen distance.
    // Camera looks down its local -Z; backdrop sits at z = -DISTANCE.
    // Vertical extent at FOV 55 / dist 40 ≈ 41 units, so 70 covers it w/ margin.
    const DISTANCE = 40;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(110, 70), mat);
    plane.position.set(0, 0, -DISTANCE);
    plane.renderOrder = -0.5;       // after sky (-1), before world objects (0)
    camera.add(plane);
    console.info('[main] backdrop card loaded:', url);
  });
})();

// Optional environment loader — auto-detects an equirectangular sky asset.
// If found, hides the procedural sky and uses the asset instead.
(async () => {
  const candidates = [
    { url: 'assets/textures/forest.hdr', kind: 'hdr' },
    { url: 'assets/textures/sky.hdr',    kind: 'hdr' },
    { url: 'assets/textures/forest.jpg', kind: 'jpg' },
    { url: 'assets/textures/sky.jpg',    kind: 'jpg' },
  ];
  for (const c of candidates) {
    try {
      const head = await fetch(c.url, { method: 'HEAD' });
      if (!head.ok) continue;
      let tex;
      if (c.kind === 'hdr') {
        const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
        tex = await new RGBELoader().loadAsync(c.url);
      } else {
        tex = await new THREE.TextureLoader().loadAsync(c.url);
        tex.colorSpace = THREE.SRGBColorSpace;
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = tex;
      // Intentionally NOT setting scene.environment — the HDR is a dim
      // under-canopy shot and using it as IBL darkens the whole scene.
      // We rely on our explicit key/fill/rim/ambient lighting setup instead.
      sky.visible = false;
      console.info(`[main] background loaded (no IBL): ${c.url}`);
      return;
    } catch (err) {
      console.warn(`[main] failed to load ${c.url}:`, err);
    }
  }
  console.info('[main] no sky asset found — using procedural gradient sky');
})();

// ------------------------------------------------------------------
// LIGHTING — cartoon key / fill / ambient triad
// ------------------------------------------------------------------
//
// Strategy:
//   KEY  = warm sun, near-overhead, the dominant light. Soft cast shadows.
//   FILL = cool-sky hemisphere; lifts shadow side without flattening the scene.
//   RIM  = back-side directional, no shadow, to separate the bear silhouette
//          from the background.
//   AMB  = a touch of flat fill so nothing renders pure black.
//
// Total Y-up light hitting top of an object: key 0.60 + hemi 0.55 + amb 0.18 ≈ 1.33.
// Warm/cool balance gives the scene depth without bloom or post.

// KEY — warm sun, slightly off vertical so we get a readable shadow direction
const sun = new THREE.DirectionalLight(0xffe9c4, 1.3);
sun.position.set(5, 22, 4);
sun.target.position.set(0, 0, 25);
scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.06;
sun.shadow.radius = 6;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 80;
sun.shadow.camera.left = -14;
sun.shadow.camera.right = 14;
sun.shadow.camera.top = 60;
sun.shadow.camera.bottom = -10;
scene.add(sun);

// FILL — cool sky / warm earth hemisphere
const hemi = new THREE.HemisphereLight(
  0xc6dcf0,   // sky    — pale cool blue
  0x6e5a3f,   // ground — warm earth bounce
  0.65
);
scene.add(hemi);

// RIM — back-light to outline the bear; no shadow, low intensity
const rim = new THREE.DirectionalLight(0xffe2bf, 0.45);
rim.position.set(-3, 8, -10);     // behind+above the bear, opposite the sun
rim.target.position.set(0, 1, 20);
scene.add(rim.target);
scene.add(rim);

const ambient = new THREE.AmbientLight(0xffffff, 0.30);
scene.add(ambient);

// ------------------------------------------------------------------
// POST-PROCESSING — cartoony pipeline
// ------------------------------------------------------------------
//
// 1) RenderPass        — base scene render
// 2) UnrealBloomPass   — subtle bloom; bright saturated colors (gates, planks)
//                        get a soft halo, makes the scene "pop"
// 3) FXAA              — antialiasing (we disabled MSAA on the renderer above
//                        because it gets ignored once you go through composer)
//
// Each pass's strength is in CONFIG.fx so we can tune without editing here.

const composer = new EffectComposer(renderer);
composer.setPixelRatio(PIXEL_RATIO);
{
  const { w, h } = getViewSize();
  composer.setSize(w, h);
}

composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(...Object.values(getViewSize())),
  CONFIG.fx.bloomStrength,
  CONFIG.fx.bloomRadius,
  CONFIG.fx.bloomThreshold,
);
composer.addPass(bloom);

const fxaa = new ShaderPass(FXAAShader);
const setFxaaResolution = () => {
  const { w, h } = getViewSize();
  fxaa.uniforms.resolution.value.set(
    1 / (w * PIXEL_RATIO),
    1 / (h * PIXEL_RATIO),
  );
};
setFxaaResolution();
composer.addPass(fxaa);

// ------------------------------------------------------------------

function applyViewSize() {
  const { w, h } = getViewSize();
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w, h);
  setFxaaResolution();
}
window.addEventListener('resize', applyViewSize);
// Also react if something resizes the #app element itself (e.g., devtools open).
new ResizeObserver(applyViewSize).observe(appEl);

const game = new Game({ scene, camera, renderer, canvas });
game.init();

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  game.update(dt);
  composer.render();
  requestAnimationFrame(tick);
}
tick();
