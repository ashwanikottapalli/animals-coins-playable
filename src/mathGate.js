import * as THREE from 'three';
import { CONFIG } from './config.js';

const OP_SYMBOL = {
  add: '+',
  subtract: '-',
  multiply: 'x',
  divide: '÷',
};

export function createMathGate(op, value) {
  const group = new THREE.Group();
  const colors = CONFIG.gateColors[op] || [0xff7a3a, 0xc9412a];
  const tex = makeGateTexture(`${OP_SYMBOL[op] ?? '+'}${value}`, colors);

  const panelMat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0.78,            // slightly see-through for that glassy gradient look
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const panelGeo = new THREE.PlaneGeometry(CONFIG.gateWidth, CONFIG.gateHeight);
  const panel = new THREE.Mesh(panelGeo, panelMat);
  panel.rotation.y = Math.PI; // face -z so the bear runs into the front of it
  group.add(panel);

  // Side posts to give it physical presence
  const postMat = new THREE.MeshStandardMaterial({ color: 0x6b6b6b, roughness: 0.6 });
  const postGeo = new THREE.BoxGeometry(0.12, CONFIG.gateHeight, 0.12);
  const postL = new THREE.Mesh(postGeo, postMat);
  postL.position.set(-CONFIG.gateWidth / 2, 0, 0);
  group.add(postL);
  const postR = postL.clone();
  postR.position.x = CONFIG.gateWidth / 2;
  group.add(postR);

  return { group, panel };
}

// Creates a CanvasTexture with vertical gradient + bold centered op label.
function makeGateTexture(label, [topColor, bottomColor]) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 768;
  const ctx = c.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, 0, c.height);
  grad.addColorStop(0, '#' + topColor.toString(16).padStart(6, '0'));
  grad.addColorStop(1, '#' + bottomColor.toString(16).padStart(6, '0'));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, c.width, c.height);

  // Soft inner border
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 14;
  ctx.strokeRect(0, 0, c.width, c.height);

  // Label
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 280px -apple-system, "Segoe UI", Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowOffsetY = 10;
  ctx.shadowBlur = 12;
  ctx.fillText(label, c.width / 2, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Apply the gate's math op to a count, clamped to >= 0 and integer.
export function applyGateOp(count, op, value) {
  let next = count;
  switch (op) {
    case 'add':      next = count + value; break;
    case 'subtract': next = count - value; break;
    case 'multiply': next = count * value; break;
    case 'divide':   next = Math.floor(count / Math.max(1, value)); break;
  }
  return Math.max(0, Math.floor(next));
}
