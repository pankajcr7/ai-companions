"use client";

import { useEffect, useRef } from "react";

type Three = typeof import("three");

/**
 * A field of small pillars under the dusk sky that swell and glow warm around the pointer.
 * Three.js loads after the page is shown; without WebGL the sky gradient alone stays.
 */
export function DuskField() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let stop = () => {};
    let cancelled = false;
    import("three")
      .then((THREE) => {
        if (!cancelled) stop = start(THREE, host);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-1000" />;
}

function start(THREE: Three, host: HTMLDivElement) {
  // Still for people who turn motion off.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: InstanceType<Three["WebGLRenderer"]>;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xb9533f, 10, 28);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  camera.position.set(0, 3.2, 12);
  camera.lookAt(0, 0, -4);
  scene.add(new THREE.HemisphereLight(0xffdcb4, 0x2a0f24, 1.5));
  const sun = new THREE.DirectionalLight(0xffe4c4, 1.6);
  sun.position.set(6, 10, 3);
  scene.add(sun);

  // Small, dense studs read as one rippling surface. Phones get fewer to move every frame.
  const cols = host.clientWidth < 640 ? 50 : 110;
  const rows = host.clientWidth < 640 ? 44 : 64;
  const gap = 0.26;
  const geometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 10);
  geometry.translate(0, 0.5, 0); // scale grows a pillar up from the ground
  const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
  const field = new THREE.InstancedMesh(geometry, material, cols * rows);
  scene.add(field);
  const spots = Array.from({ length: cols * rows }, (_, i) => ({ x: ((i % cols) - cols / 2) * gap, z: 5 - Math.floor(i / cols) * gap }));
  const ground = new THREE.Color(0xc55a41);
  const glow = new THREE.Color(0xffe0b0);
  const colour = new THREE.Color();
  const matrix = new THREE.Matrix4();

  // The pointer, as a point on the ground; the swell follows it softly and fades when the pointer leaves.
  const raycaster = new THREE.Raycaster();
  const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const aim = new THREE.Vector3(0, 0, 0);
  const hover = new THREE.Vector3(0, 0, 0);
  let want = 0;
  let swell = 0;
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    if (e.clientY < r.top || e.clientY > r.bottom) return void (want = 0);
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    if (raycaster.ray.intersectPlane(floor, aim)) want = 1;
  };
  const onLeave = () => void (want = 0);

  const draw = (t: number) => {
    hover.lerp(aim, 0.08);
    swell += (want - swell) * 0.05;
    spots.forEach((s, i) => {
      // Slow dunes everywhere; around the pointer a soft swell with rings running out from it.
      const d = Math.sqrt((s.x - hover.x) ** 2 + (s.z - hover.z) ** 2);
      const near = swell * Math.exp(-(d * d) / 6);
      const ring = swell * 0.12 * Math.sin(d * 2.2 - t * 3.5) * Math.exp(-d / 2.5);
      const dunes = 0.15 * (1 + Math.sin(s.x * 0.22 + t * 0.25) * Math.cos(s.z * 0.28 - t * 0.18));
      field.setMatrixAt(i, matrix.makeScale(1, 0.1 + dunes + near * 0.9 + ring, 1).setPosition(s.x, 0, s.z));
      field.setColorAt(i, colour.copy(ground).lerp(glow, near * 0.9).multiplyScalar(1 + near * 0.6));
    });
    field.instanceMatrix.needsUpdate = true;
    if (field.instanceColor) field.instanceColor.needsUpdate = true;
    renderer.render(scene, camera);
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (still) draw(0);
  };

  // Runs only while on screen.
  let visible = true;
  let frame = 0;
  const loop = (ms: number) => {
    frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    draw(ms / 1000);
  };
  const wake = () => {
    if (!still && !frame && visible && !document.hidden) frame = requestAnimationFrame(loop);
  };
  const seen = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    wake();
  });
  const sized = new ResizeObserver(resize);

  resize();
  draw(0);
  host.style.opacity = "1";
  seen.observe(host);
  sized.observe(host);
  if (!still) {
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    document.addEventListener("visibilitychange", wake);
    wake();
  }

  return () => {
    cancelAnimationFrame(frame);
    seen.disconnect();
    sized.disconnect();
    window.removeEventListener("pointermove", onMove);
    document.documentElement.removeEventListener("pointerleave", onLeave);
    document.removeEventListener("visibilitychange", wake);
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
