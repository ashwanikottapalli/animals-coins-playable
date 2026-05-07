import * as THREE from 'three';

// Procedural gradient sky. Returns a Mesh you parent to the camera so it
// always appears infinitely far in every direction. Uses ~zero KB of assets.
//
// Tweakable colors:
//   horizon — color at the horizon line and below
//   zenith  — color at the top of the sky
// The gradient softly interpolates between the two based on view-direction's
// vertical component (y).
export function createSky({
  horizonColor = 0xc7e0d2,   // pale mint
  zenithColor  = 0x6fa6d6,   // soft mid-blue
  radius       = 60,
} = {}) {
  const uniforms = {
    horizonColor: { value: new THREE.Color(horizonColor) },
    zenithColor:  { value: new THREE.Color(zenithColor) },
  };

  const vertexShader = /* glsl */`
    varying vec3 vWorldDirection;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldDirection = normalize(worldPosition.xyz - cameraPosition);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const fragmentShader = /* glsl */`
    uniform vec3 horizonColor;
    uniform vec3 zenithColor;
    varying vec3 vWorldDirection;
    void main() {
      // 0 at horizon and below, smoothly to 1 by ~30° elevation.
      float t = smoothstep(0.0, 0.55, vWorldDirection.y);
      vec3 col = mix(horizonColor, zenithColor, t);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), mat);
  mesh.renderOrder = -1; // ensure it draws before everything
  mesh.frustumCulled = false;
  mesh.userData.uniforms = uniforms;  // exposed for live tuning
  return mesh;
}
