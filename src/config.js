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

  // Branding (swap when ready)
  branding: {
    title: 'Animals & Coins',
    sub: 'Run, collect, and build your way to victory!',
    cta: 'PLAY NOW',
    storeUrlIOS: '#',
    storeUrlAndroid: '#',
  },
};
