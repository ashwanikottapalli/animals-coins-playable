# Animals & Coins — Playable Ad

A 3D playable ad prototype: a bear runner that auto-runs forward, picks up planks, passes through math gates that change the plank count, builds bridges across gaps, climbs walls with planks, and reaches a goal.

Built with vanilla **Three.js** (no bundler), portrait-friendly, mobile-first.

## Run locally

```bash
python3 serve.py 8080
# open http://localhost:8080
```

`serve.py` adds no-cache headers so refreshes always pick up code changes.

## Project layout

```
.
├── index.html              entrypoint, import map, UI overlays
├── src/
│   ├── main.js             renderer, scene, lighting, post-FX, sky/backdrop
│   ├── game.js             state machine + main update loop
│   ├── player.js           bear FBX/GLB loading, animation, controls
│   ├── level.js            path/gap/wall/gate/pickup mesh builders
│   ├── plankSystem.js      plank inventory, bridge, ladder, back-stack
│   ├── mathGate.js         gate prefab + math op
│   ├── ui.js               counter, intro, CTA, fail overlays
│   ├── audio.js            audio stub (Phase 5)
│   ├── config.js           tunables + level layout + branding
│   ├── sky.js              procedural gradient sky shader
│   └── toon.js             cel-shading utilities
├── assets/
│   ├── models/bear.glb     rigged bear with embedded textures
│   ├── animations/         idle/run/climb/fall FBX clips
│   └── textures/           backdrop, path, plank
└── serve.py                no-cache static server for development
```

## Controls (during gameplay)

- **Touch / mouse**: drag left/right to steer
- **A / D** or arrow keys: steer (debug)
- **`[` / `]`**: halve / double playback speed (debug)
- **`\`**: reset speed
