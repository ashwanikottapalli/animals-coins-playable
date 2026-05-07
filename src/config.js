// Central tunables. Tweak gameplay feel here.

export const CONFIG = {
  // Path geometry
  pathWidth: 4.0,
  pathHeight: 0.6,
  pathColor: 0x2a2e33,    // very dark slate — unmistakably dark even after Lambert × hemi/ambient
  preLevelPathLength: 4,  // runway behind the bear at game start (set 0 to disable)

  // Player
  playerSpeed: 4.0,           // forward (z) units/sec
  playerLateralSpeed: 14.0,   // x units/sec (drag-driven max)
  debugSpeedScale: 1.0,       // runtime multiplier; press [ / ] to halve/double, \ to reset
  dragSensitivity: 0.018,     // px → world units factor
  playerHalfWidth: 0.45,      // for bounds clamp inside path
  playerSize: 0.9,            // placeholder cube size

  // Plank — long & thin (real plank proportions, not chunky cubes)
  plankSize: { x: 1.5, y: 0.09, z: 0.36 },
  plankColor: 0x2faaaa,
  plankPickupRadius: 0.9,
  plankInitialCount: 1,
  backStackSpacing: 0.06,    // vertical spacing between stacked planks on bear's back

  // Math gate
  gateWidth: 1.9,
  gateHeight: 2.6,
  gateThickness: 0.16,
  gateColors: {
    // Lifted toward pastel — same hues, ~25% lerp toward white for a softer
    // reference-style gradient feel (matches the lighter look of typical
    // playable-ad math gates).
    add:      [0xff9b6b, 0xd7715f],   // soft coral → warm peach
    subtract: [0xbe79ff, 0xd55d7a],   // light orchid → muted magenta
    multiply: [0xffc464, 0xff8364],   // soft yellow-orange → coral
    divide:   [0x65e0d4, 0x5fa9b3],   // light teal → muted aqua
  },

  // Camera — closer 3/4 hero shot like classic playable ads
  cameraOffset: { x: 0, y: 4.2, z: -5.5 }, // relative to player (z negative = behind)
  cameraLookAhead: 5.5,
  cameraLerp: 0.12,

  // Level layout — z grows forward.
  // Each segment knows how to build itself; positions are computed sequentially.
  // Designed to be tight: 3 gaps, 1 wall, mostly negative gates so the bear
  // can run out of planks if the player picks the worse side.
  level: [
    { type: 'path', length: 8,  planks: 5 },
    { type: 'gate', op: 'add',      value: 20, side: 'left'  },   // big positive boost to start
    { type: 'gate', op: 'add',      value: 15, side: 'right' },
    { type: 'path', length: 5,  planks: 3 },
    { type: 'gap',  length: 4 },                                  // gap #1
    { type: 'path', length: 4,  planks: 3 },
    { type: 'gate', op: 'subtract', value: 3,  side: 'left'  },   // both negative — pick the lighter loss
    { type: 'gate', op: 'divide',   value: 2,  side: 'right' },
    { type: 'path', length: 4,  planks: 4 },
    { type: 'gap',  length: 5 },                                  // gap #2 (bigger)
    { type: 'path', length: 4,  planks: 4 },
    { type: 'wall', height: 2.4 },                                // wall climb
    { type: 'path', length: 4,  planks: 3 },
    { type: 'gate', op: 'subtract', value: 4,  side: 'left'  },   // both negative again
    { type: 'gate', op: 'subtract', value: 2,  side: 'right' },
    { type: 'path', length: 5,  planks: 3 },
    { type: 'gap',  length: 4 },                                  // gap #3
    { type: 'path', length: 4,  planks: 0 },
    { type: 'goal' },
  ],

  // Bear model (FBX or GLB — auto-detected by file extension).
  // GLB recommended: textures embed cleanly out of Blender. Animations stay as separate FBX.
  bear: {
    modelPath: 'assets/models/bear.glb',
    animations: {
      idle:  'assets/animations/idle.fbx',
      run:   'assets/animations/run.fbx',
      climb: 'assets/animations/climb.fbx',
      fall:  'assets/animations/fall.fbx',
    },
    targetHeight: 0.9,        // bear height in world units
    // Pre-bbox rotation, in radians. Apply BEFORE auto-scale so the bbox height
    // is measured along the bear's actual up-axis. Tweak per export:
    //   FBX (Mixamo) usually needs (0, 0, 0)
    //   GLB from Blender's Z-up scene typically needs (-Math.PI/2, 0, 0)
    //     — try +Math.PI/2 if it lands on its head
    rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    yawOffset: 0,             // additional Y rotation (face direction); Math.PI flips bear
    backStackLocal: { x: 0, y: 0.60, z: -0.32 }, // anchor offset on the bear — scaled with the bear
    crossFadeSec: 0.18,
    rootBone: 'mixamorigHips', // strip this bone's .position track from clips (kills root motion)
    // Cel-shaded outline (inverted-hull). Set enabled:false to skip.
    outline: {
      enabled: true,
      color: 0x1a1106,
      thickness: 0.012,   // world units; small because bear is small
    },
    // GLB embeds textures natively — leave overrides off.
    colorOverride: null,
    emissive: null,
    emissiveIntensity: 0,
    texture: null,
    textureFlipY: true,
    textureRepeat: { x: 1, y: 1 },
    textureOffset: { x: 0, y: 0 },
  },

  // Cartoon / toon-shading
  toon: {
    enabled: true,
    steps: 3,                 // number of light bands (3 = clean cel-shaded look)
  },

  // Post-processing knobs (UnrealBloom). Set bloomStrength: 0 to disable bloom.
  fx: {
    bloomStrength: 0.0,       // overall glow amount; 0 = off, 0.4 = strong
    bloomRadius:   0.55,      // halo softness/spread
    bloomThreshold:0.78,      // only pixels brighter than this contribute (lower = more areas glow)
  },

  // ------------------------------------------------------------------
  // Theme system. Switch via URL: index.html?theme=ice
  // Each theme defines paths for the three swappable textures:
  //   backdrop = the distant jungle/sky card behind the level
  //   plank    = the texture used for ALL plank meshes (pickups, bridge, rungs, back-stack)
  //   path     = the runway / wall slab texture
  // The path strings can point anywhere — keep all in assets/textures/ for the
  // default theme, or organize per-theme folders under assets/themes/<name>/.
  // ------------------------------------------------------------------
  themes: {
    jungle: {
      backdrop:    'assets/textures/backdrop.jpg',
      plank:       'assets/textures/plank.jpg',
      path:        'assets/textures/path.jpg',
      intro_voice: 'assets/audio/voice_intro.mp3',
      end_voice:   'assets/audio/voice_end.mp3',
    },
    space: {
      backdrop:    'assets/themes/space/backdrop.jpg',
      plank:       'assets/themes/space/plank.jpg',
      path:        'assets/themes/space/path.jpg',
      intro_voice: 'assets/themes/space/voice_intro.mp3',
      end_voice:   'assets/audio/voice_end.mp3',
    },
    desert: {
      backdrop:    'assets/themes/desert/backdrop.jpg',
      plank:       'assets/themes/desert/plank.jpg',
      path:        'assets/themes/desert/path.jpg',
      intro_voice: 'assets/themes/desert/voice_intro.mp3',
      end_voice:   'assets/audio/voice_end.mp3',
    },
    ice: {
      backdrop:    'assets/themes/ice/backdrop.jpg',
      plank:       'assets/themes/ice/plank.jpg',
      path:        'assets/themes/ice/path.jpg',
      intro_voice: 'assets/themes/ice/voice_intro.mp3',
      end_voice:   'assets/audio/voice_end.mp3',
    },
    city: {
      backdrop:    'assets/themes/city/backdrop.jpg',
      plank:       'assets/themes/city/plank.jpg',
      path:        'assets/themes/city/path.jpg',
      intro_voice: 'assets/themes/city/voice_intro.mp3',
      end_voice:   'assets/audio/voice_end.mp3',
    },
    // Example: drop a new theme by adding files and an entry here.
    // ice: {
    //   backdrop:    'assets/themes/ice/backdrop.jpg',
    //   plank:       'assets/themes/ice/plank.jpg',
    //   path:        'assets/themes/ice/path.jpg',
    //   intro_voice: 'assets/themes/ice/voice_intro.mp3',
    //   end_voice:   'assets/themes/ice/voice_end.mp3',
    // },
  },
  defaultTheme: 'jungle',

  // Branding
  branding: {
    title: 'Animals & Coins',
    sub: 'Run, collect, and build your way to victory!',
    cta: 'PLAY NOW',
    storeUrlIOS:     'https://apps.apple.com/il/app/animals-coins-adventure-game/id1492722342',
    storeUrlAndroid: 'https://play.google.com/store/apps/details?id=com.innplaylabs.animalkingdomraid&hl=en_IN',
    logoPath: 'assets/textures/icon.jpg',
  },
};

// Resolve the active theme from the ?theme=... URL query param. Falls back
// to CONFIG.defaultTheme if the param is missing or unknown. Cached so all
// loaders see the same theme even if read at different times.
let _activeTheme = null;
export function getActiveTheme() {
  if (_activeTheme) return _activeTheme;
  let requested = null;
  if (typeof window !== 'undefined') {
    requested = new URLSearchParams(window.location.search).get('theme');
  }
  if (requested && CONFIG.themes[requested]) {
    _activeTheme = CONFIG.themes[requested];
    console.info(`[theme] active: ${requested}`);
  } else {
    if (requested) console.warn(`[theme] '${requested}' not found — using default '${CONFIG.defaultTheme}'`);
    _activeTheme = CONFIG.themes[CONFIG.defaultTheme];
    console.info(`[theme] active: ${CONFIG.defaultTheme} (default)`);
  }
  return _activeTheme;
}
