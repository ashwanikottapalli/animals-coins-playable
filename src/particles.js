import * as THREE from 'three';

// Multi-channel particle system. Each "kind" has its own sprite texture and
// blend mode so sparkles glow (additive) and dust/confetti look solid (normal).
//
// Usage:
//   ps.emit(pos, count, { kind: 'sparkle' | 'dust' | 'confetti', ...opts });
// Default kind is 'sparkle'.
export class ParticleSystem {
  constructor(scene, maxPerKind = 300) {
    this.sub = {
      sparkle:  new SubSystem(scene, maxPerKind, makeSparkleTex(),  THREE.AdditiveBlending, true),
      dust:     new SubSystem(scene, maxPerKind, makeDustTex(),     THREE.NormalBlending,   false),
      confetti: new SubSystem(scene, maxPerKind, makeConfettiTex(), THREE.NormalBlending,   false),
    };
  }
  emit(pos, count, opts = {}) {
    const kind = opts.kind || 'sparkle';
    const sub = this.sub[kind] || this.sub.sparkle;
    sub.emit(pos, count, opts);
  }
  update(dt) {
    for (const k in this.sub) this.sub[k].update(dt);
  }
}

class SubSystem {
  constructor(scene, max, texture, blending, premultRGB) {
    this.max = max;

    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(max * 3);
    const colors    = new Float32Array(max * 3);
    const sizes     = new Float32Array(max);

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

    // For additive blending we pre-multiply rgb by alpha so transparent
    // sprite edges contribute nothing. For normal blending we keep rgb
    // intact and use texture alpha as the mask.
    const fragmentShader = premultRGB
      ? `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor * t.a, t.a);
        }`
      : `
        uniform sampler2D uMap;
        varying vec3 vColor;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(vColor, t.a);
        }`;

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: /* glsl */ `
        attribute float aSize;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (300.0 / max(0.001, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);

    this.particles = new Array(max).fill(0).map(() => ({
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      gx: 0, gy: 0, gz: 0,
      r: 1, g: 1, b: 1,
      size0: 5, size1: 0,
      life: 0, lifeMax: 1,
      active: false,
    }));
  }

  emit(pos, count, opts = {}) {
    const {
      color = 0xffffff,
      size = 8,
      sizeEnd = 0.5,
      speed = 4,
      gravity = -10,
      spread = 1,
      lifetime = 0.6,
      upBias = 0.6,
    } = opts;

    const colors = Array.isArray(color) ? color : [color];

    for (let i = 0; i < count; i++) {
      const p = this._allocate();
      if (!p) return;

      const c = colors[(Math.random() * colors.length) | 0];
      p.r = ((c >> 16) & 0xff) / 255;
      p.g = ((c >>  8) & 0xff) / 255;
      p.b = ( c        & 0xff) / 255;

      p.x = pos.x;
      p.y = pos.y;
      p.z = pos.z;

      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI;
      const sx = Math.sin(phi) * Math.cos(theta);
      const sy = Math.cos(phi);
      const sz = Math.sin(phi) * Math.sin(theta);
      const s = speed * (0.6 + Math.random() * 0.8) * spread;
      p.vx = sx * s;
      p.vy = (sy * (1 - upBias) + (Math.random() * 0.6 + 0.4) * upBias) * s;
      p.vz = sz * s;
      p.gx = 0; p.gy = gravity; p.gz = 0;
      p.size0 = size * (0.7 + Math.random() * 0.6);
      p.size1 = sizeEnd;
      p.life = 0;
      p.lifeMax = lifetime * (0.8 + Math.random() * 0.4);
      p.active = true;
    }
  }

  _allocate() {
    for (let i = 0; i < this.particles.length; i++) {
      if (!this.particles[i].active) return this.particles[i];
    }
    return null;
  }

  update(dt) {
    const pos = this.points.geometry.attributes.position.array;
    const col = this.points.geometry.attributes.color.array;
    const sz  = this.points.geometry.attributes.aSize.array;

    let n = 0;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life += dt;
      if (p.life >= p.lifeMax) { p.active = false; continue; }

      p.vx += p.gx * dt;
      p.vy += p.gy * dt;
      p.vz += p.gz * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      const t = p.life / p.lifeMax;
      const fade = 1 - t;
      const size = p.size0 * (1 - t) + p.size1 * t;

      pos[n * 3 + 0] = p.x;
      pos[n * 3 + 1] = p.y;
      pos[n * 3 + 2] = p.z;
      col[n * 3 + 0] = p.r * fade;
      col[n * 3 + 1] = p.g * fade;
      col[n * 3 + 2] = p.b * fade;
      sz[n]          = size;
      n++;
    }

    this.points.geometry.setDrawRange(0, n);
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.aSize.needsUpdate = true;
  }
}

// ---------- Procedural sprite textures ----------

// 4-point star with bright center for sparkle/burst effects.
function makeSparkleTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.globalCompositeOperation = 'lighter';

  // Horizontal beam
  const h = ctx.createLinearGradient(0, 32, 64, 32);
  h.addColorStop(0,    'rgba(255,255,255,0)');
  h.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  h.addColorStop(0.5,  'rgba(255,255,255,1)');
  h.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  h.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 30, 64, 4);

  // Vertical beam
  const v = ctx.createLinearGradient(32, 0, 32, 64);
  v.addColorStop(0,    'rgba(255,255,255,0)');
  v.addColorStop(0.45, 'rgba(255,255,255,0.6)');
  v.addColorStop(0.5,  'rgba(255,255,255,1)');
  v.addColorStop(0.55, 'rgba(255,255,255,0.6)');
  v.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = v;
  ctx.fillRect(30, 0, 4, 64);

  // Bright center bloom
  const r = ctx.createRadialGradient(32, 32, 0, 32, 32, 14);
  r.addColorStop(0,    'rgba(255,255,255,1)');
  r.addColorStop(0.4,  'rgba(255,255,255,0.7)');
  r.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = r;
  ctx.fillRect(0, 0, 64, 64);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Soft round puff for dust / debris (no glow).
function makeDustTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  g.addColorStop(0,    'rgba(255,255,255,0.95)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
  g.addColorStop(1,    'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Rounded square chip for confetti.
function makeConfettiTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  const x = 10, y = 14, w = 44, h = 36, r = 10;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
