import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Modular configuration for easy iteration on shape count,
 * wobble dynamics, drift, parallax, bloom, and color palette.
 */
export const CONFIG = {
  shapeCount: 36,
  depthRange: { min: -18, max: 4 },
  spread: { x: 14, y: 8.5 },
  palette: [
    '#0b2545', // deep abyss blue
    '#134074', // midnight ocean blue
    '#1d6fa5', // luminous cobalt
    '#2ec4b6', // deep cyan
    '#5ce1e6', // icy cyan
    '#8be9fd', // pale aqua glow
    '#e6f4ff', // soft frost white
    '#6c809a', // cool slate grey
    '#9fb1c7', // misty silver-blue
  ],
  flickerRatio: 0.38,
  wobble: {
    speed: 0.45,
    vertexAmp: 0.065,
    uvAmp: 0.14,
    frequency: 2.4,
  },
  drift: {
    speed: 0.22,
    amplitudeX: 0.35,
    amplitudeY: 0.45,
  },
  parallax: {
    strengthX: 2.6,
    strengthY: 1.8,
    damping: 0.05,
  },
  bloom: {
    strength: 0.85,
    radius: 0.65,
    threshold: 0.22,
  },
};

const VERTEX_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uWobbleSpeed;
  uniform float uWobbleAmp;
  uniform float uWobbleFreq;
  uniform float uSeed;
  uniform vec2 uSize;

  varying vec2 vUv;

  void main() {
    vUv = uv;

    // Normalize wave displacement by uSize so world-space wobble
    // stays organic regardless of the rectangle's aspect ratio.
    vec3 pos = position;
    float t = uTime * uWobbleSpeed + uSeed * 12.73;

    vec2 worldApprox = pos.xy * uSize;
    float waveX = sin(worldApprox.y * uWobbleFreq + t)
                + 0.5 * cos(worldApprox.x * (uWobbleFreq * 0.7) - t * 1.15);
    float waveY = cos(worldApprox.x * uWobbleFreq * 0.9 - t * 0.92)
                + 0.5 * sin(worldApprox.y * (uWobbleFreq * 1.1) + t * 1.28);
    float waveZ = sin((worldApprox.x + worldApprox.y) * 1.3 + t * 0.85);

    pos.x += (waveX * uWobbleAmp) / max(uSize.x, 0.25);
    pos.y += (waveY * uWobbleAmp) / max(uSize.y, 0.25);
    pos.z += waveZ * (uWobbleAmp * 0.45);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uTime;
  uniform float uUvWobbleAmp;
  uniform float uWobbleSpeed;
  uniform float uSeed;
  uniform float uOpacity;
  uniform float uFlickerMode;
  uniform float uGlowBoost;
  uniform vec3 uColor;
  uniform vec2 uSize;

  varying vec2 vUv;

  // Soft 2D hash for subtle organic shimmer
  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float noise1D(float x) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i), hash(i + 1.0), u);
  }

  void main() {
    float t = uTime * uWobbleSpeed + uSeed * 19.31;

    // Organic world-space liquid distortion inset safely within the quad bounds
    // so wavy bulges and feathered edges are never clipped by the mesh border.
    vec2 worldPos = (vUv - 0.5) * uSize;
    vec2 distortedWorld = worldPos;
    distortedWorld.x += sin(worldPos.y * 1.45 + t * 1.3) * uUvWobbleAmp;
    distortedWorld.y += cos(worldPos.x * 1.35 - t * 1.1) * uUvWobbleAmp;

    // Distance to rectangle edges in world units with a guaranteed outer margin
    vec2 centered = abs(distortedWorld);
    vec2 halfSize = max(uSize * 0.5 - (uUvWobbleAmp + 0.08), vec2(0.05));
    vec2 edgeDist = halfSize - centered;
    float minEdge = min(edgeDist.x, edgeDist.y);

    // Soft outer feather so borders never look harsh or aliased
    float outerMask = smoothstep(-0.02, 0.06, minEdge);

    // Luminous rim highlight + translucent misty interior
    float rimGlow = smoothstep(0.24, 0.0, minEdge) * outerMask;
    float interiorGradient = 0.65
      + 0.22 * sin(vUv.x * 3.14159 + t * 0.6)
      + 0.13 * cos(vUv.y * 4.2 - t * 0.5);

    // Flicker vs. steady glow behavior
    float intensity = 1.0;
    if (uFlickerMode > 0.5) {
      float slowPulse = 0.72 + 0.28 * sin(uTime * (0.9 + uSeed * 0.8) + uSeed * 25.0);
      float microFlutter = noise1D(uTime * (5.5 + uSeed * 4.0) + uSeed * 100.0);
      float neonDip = smoothstep(0.12, 0.35, microFlutter);
      intensity = slowPulse * (0.55 + 0.45 * neonDip);
    }

    // Boost rim color into HDR range (> 1.0) to feed UnrealBloomPass
    vec3 rimColor = uColor * (1.35 + uGlowBoost);
    vec3 bodyColor = uColor * (0.65 + 0.35 * interiorGradient);
    vec3 finalColor = mix(bodyColor, rimColor, rimGlow * 0.82) * intensity;

    float alpha = outerMask * (uOpacity * interiorGradient + rimGlow * 0.38);
    alpha *= mix(1.0, 0.65 + 0.35 * intensity, uFlickerMode);

    if (alpha < 0.003) discard;
    gl_FragColor = vec4(finalColor, clamp(alpha, 0.0, 0.92));
  }
`;

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function createLiquidMaterial({ color, opacity, flickerMode, seed, size }) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: { value: 0 },
      uWobbleSpeed: { value: CONFIG.wobble.speed },
      uWobbleAmp: { value: CONFIG.wobble.vertexAmp },
      uWobbleFreq: { value: CONFIG.wobble.frequency },
      uUvWobbleAmp: { value: CONFIG.wobble.uvAmp },
      uSeed: { value: seed },
      uOpacity: { value: opacity },
      uFlickerMode: { value: flickerMode ? 1.0 : 0.0 },
      uGlowBoost: { value: randomRange(0.25, 0.95) },
      uColor: { value: new THREE.Color(color) },
      uSize: { value: new THREE.Vector2(size.x, size.y) },
    },
  });
}

function generatePlaneDescriptors(count) {
  const descriptors = [];

  for (let i = 0; i < count; i++) {
    const z = randomRange(CONFIG.depthRange.min, CONFIG.depthRange.max);
    // Scale XY spread slightly with distance from camera so deep planes stay framed
    const depthFactor = 1 + Math.max(0, 6 - z) * 0.055;
    const x = randomRange(-CONFIG.spread.x * 0.5, CONFIG.spread.x * 0.5) * depthFactor;
    const y = randomRange(-CONFIG.spread.y * 0.5, CONFIG.spread.y * 0.5) * depthFactor;

    // Varied aspect ratios: tall monoliths, wide ribbons, balanced rectangles
    const archetype = Math.random();
    let width;
    let height;
    if (archetype < 0.34) {
      // Tall vertical slab
      width = randomRange(0.9, 2.2);
      height = randomRange(3.4, 6.8);
    } else if (archetype < 0.68) {
      // Wide horizontal band
      width = randomRange(3.6, 7.4);
      height = randomRange(0.9, 2.3);
    } else {
      // Balanced plane
      width = randomRange(2.2, 4.6);
      height = randomRange(2.2, 4.8);
    }

    // Scale hierarchy: mostly large and monumental planes, fewer small ones
    const tier = Math.random();
    let scaleMultiplier;
    let maxOpacity = 0.44;
    if (tier < 0.28) {
      // Monumental / very large background & mid-ground sheets
      scaleMultiplier = randomRange(1.85, 2.9);
      maxOpacity = 0.3;
    } else if (tier < 0.78) {
      // Large planes
      scaleMultiplier = randomRange(1.25, 1.85);
    } else {
      // Medium accent planes
      scaleMultiplier = randomRange(0.85, 1.25);
    }
    width *= scaleMultiplier;
    height *= scaleMultiplier;

    const color = CONFIG.palette[Math.floor(Math.random() * CONFIG.palette.length)];
    const opacity = randomRange(0.12, maxOpacity);
    const flickerMode = Math.random() < CONFIG.flickerRatio;

    descriptors.push({
      basePos: new THREE.Vector3(x, y, z),
      size: new THREE.Vector2(width, height),
      color,
      opacity,
      flickerMode,
      seed: Math.random(),
      driftPhaseX: randomRange(0, Math.PI * 2),
      driftPhaseY: randomRange(0, Math.PI * 2),
      driftSpeedMul: randomRange(0.65, 1.35),
    });
  }

  // Sort back-to-front so translucent layers blend cleanly without depth artifacts
  descriptors.sort((a, b) => a.basePos.z - b.basePos.z);
  return descriptors;
}

function init() {
  const canvas = document.getElementById('scene');

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100
  );
  const baseCameraPos = new THREE.Vector3(0, 0, 14);
  const baseTarget = new THREE.Vector3(0, 0, -6);
  camera.position.copy(baseCameraPos);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(baseTarget);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 4;
  controls.maxDistance = 46;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 0.85;
  controls.update();

  // Double-click smoothly resets back to the head-on view
  let resettingView = false;
  canvas.addEventListener('dblclick', () => {
    resettingView = true;
  });
  controls.addEventListener('start', () => {
    resettingView = false;
  });

  // Post-processing with HalfFloat render target to preserve HDR bloom glow
  const renderTarget = new THREE.WebGLRenderTarget(
    window.innerWidth,
    window.innerHeight,
    { type: THREE.HalfFloatType }
  );
  const composer = new EffectComposer(renderer, renderTarget);
  composer.addPass(new RenderPass(scene, camera));

  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    CONFIG.bloom.strength,
    CONFIG.bloom.radius,
    CONFIG.bloom.threshold
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // Group holds all planes so passive mouse parallax works cleanly alongside OrbitControls
  const sceneGroup = new THREE.Group();
  scene.add(sceneGroup);

  // Shared subdivided geometry so vertices can undulate smoothly
  const sharedGeometry = new THREE.PlaneGeometry(1, 1, 28, 28);
  const descriptors = generatePlaneDescriptors(CONFIG.shapeCount);

  const planes = descriptors.map((desc, index) => {
    const material = createLiquidMaterial(desc);
    const mesh = new THREE.Mesh(sharedGeometry, material);
    mesh.position.copy(desc.basePos);
    mesh.scale.set(desc.size.x, desc.size.y, 1);
    // Keep strictly parallel to the XY plane facing the viewer
    mesh.rotation.set(0, 0, 0);
    mesh.renderOrder = index;
    sceneGroup.add(mesh);

    return { mesh, material, desc };
  });

  // Pointer parallax state
  const pointer = { targetX: 0, targetY: 0, currentX: 0, currentY: 0 };

  function updatePointer(clientX, clientY) {
    pointer.targetX = (clientX / window.innerWidth) * 2 - 1;
    pointer.targetY = -((clientY / window.innerHeight) * 2 - 1);
  }

  window.addEventListener('pointermove', (event) => {
    updatePointer(event.clientX, event.clientY);
  });

  window.addEventListener('pointerleave', () => {
    pointer.targetX = 0;
    pointer.targetY = 0;
  });

  window.addEventListener('resize', () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    composer.setSize(width, height);
    bloomPass.setSize(width, height);
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();

    // Damped mouse-parallax applied to sceneGroup so OrbitControls remain unobstructed
    pointer.currentX += (pointer.targetX - pointer.currentX) * CONFIG.parallax.damping;
    pointer.currentY += (pointer.targetY - pointer.currentY) * CONFIG.parallax.damping;

    sceneGroup.position.x = -pointer.currentX * CONFIG.parallax.strengthX;
    sceneGroup.position.y = -pointer.currentY * CONFIG.parallax.strengthY;

    if (resettingView) {
      camera.position.lerp(baseCameraPos, 0.08);
      controls.target.lerp(baseTarget, 0.08);
      if (
        camera.position.distanceTo(baseCameraPos) < 0.02 &&
        controls.target.distanceTo(baseTarget) < 0.02
      ) {
        camera.position.copy(baseCameraPos);
        controls.target.copy(baseTarget);
        resettingView = false;
      }
    }
    controls.update();

    // Update shader time, zero-gravity drift, and camera-relative depth sorting
    for (let i = 0; i < planes.length; i++) {
      const { mesh, material, desc } = planes[i];
      material.uniforms.uTime.value = elapsed;

      const driftT = elapsed * CONFIG.drift.speed * desc.driftSpeedMul;
      mesh.position.x =
        desc.basePos.x + Math.sin(driftT + desc.driftPhaseX) * CONFIG.drift.amplitudeX;
      mesh.position.y =
        desc.basePos.y + Math.cos(driftT * 0.85 + desc.driftPhaseY) * CONFIG.drift.amplitudeY;
    }

    // Sort back-to-front relative to current camera angle for clean 360° translucency
    planes.sort(
      (a, b) =>
        b.mesh.position.distanceToSquared(camera.position) -
        a.mesh.position.distanceToSquared(camera.position)
    );
    for (let i = 0; i < planes.length; i++) {
      planes[i].mesh.renderOrder = i;
    }

    composer.render();
  }

  animate();
}

init();
