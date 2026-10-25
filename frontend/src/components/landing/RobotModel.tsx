"use client";

import { useEffect, useRef } from "react";

type Three = typeof import("three");

/**
 * The hero's robot, built in 3D from simple shapes: a glossy white hover-bot with a glass face and lime eyes.
 * It waves hello, blinks, follows the pointer with its head, and hovers. It loads after the page is shown;
 * without WebGL the space stays empty, and it holds still for people who turn motion off.
 */
export function RobotModel({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let stop = () => {};
    let cancelled = false;
    Promise.all([import("three"), import("three/examples/jsm/environments/RoomEnvironment.js")])
      .then(([THREE, { RoomEnvironment }]) => {
        if (!cancelled) stop = start(THREE, host, new RoomEnvironment());
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return <div ref={ref} aria-hidden="true" className={`opacity-0 transition-opacity duration-1000 ${className}`} />;
}

/** The robot's parts, so the animation can move them. */
function build(THREE: Three) {
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xf4f1ee, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0x07070a, roughness: 0.05, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c2629, roughness: 0.35, metalness: 0.8 });
  const light = new THREE.MeshBasicMaterial({ color: 0xc6ff4d, toneMapped: false });
  const mesh = (geometry: import("three").BufferGeometry, material: import("three").Material, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    return m;
  };

  const robot = new THREE.Group();

  // Body: a smooth egg, wide at the shoulders, with a lime light bar on the chest.
  const profile = [
    [0, -1],
    [0.32, -0.95],
    [0.58, -0.62],
    [0.71, -0.12],
    [0.69, 0.25],
    [0.55, 0.5],
    [0.26, 0.62],
    [0, 0.64],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  robot.add(mesh(new THREE.LatheGeometry(profile, 64), shell));
  const bar = mesh(new THREE.CapsuleGeometry(0.03, 0.26, 4, 12), light, 0, 0.12, 0.7);
  bar.rotation.z = Math.PI / 2;
  robot.add(bar);
  robot.add(mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.2, 24), metal, 0, 0.72, 0));

  // Arms float beside the body; each hangs from a pivot at the shoulder.
  const arm = (side: 1 | -1) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.86, 0.32, 0);
    pivot.add(mesh(new THREE.CapsuleGeometry(0.15, 0.5, 8, 24), shell, 0, -0.4, 0), mesh(new THREE.SphereGeometry(0.09, 16, 16), metal));
    pivot.rotation.z = side * 0.16;
    robot.add(pivot);
    return pivot;
  };
  const arms = { left: arm(-1), right: arm(1) };

  // Head: a white helmet with a black glass face pushed through its front, lime eyes and a smile.
  const head = new THREE.Group();
  head.position.y = 1.45;
  const helmet = mesh(new THREE.SphereGeometry(0.75, 64, 48), shell);
  helmet.scale.set(1.18, 0.92, 1);
  const face = mesh(new THREE.SphereGeometry(0.75, 64, 48), glass, 0, -0.02, 0.2);
  face.scale.set(1, 0.68, 0.86);
  head.add(helmet, face);
  const eyes = ([-1, 1] as const).map((side) => {
    const eye = mesh(new THREE.CapsuleGeometry(0.065, 0.1, 6, 16), light, side * 0.26, 0.05, 0.79);
    eye.rotation.y = side * 0.32;
    head.add(eye);
    return eye;
  });
  const smile = mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 32, Math.PI), light, 0, -0.17, 0.83);
  smile.rotation.z = Math.PI;
  head.add(smile);
  for (const side of [-1, 1]) {
    const ear = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 32), metal, side * 0.9, 0, 0);
    ear.rotation.z = Math.PI / 2;
    const ring = mesh(new THREE.TorusGeometry(0.15, 0.022, 8, 32), light, side * 0.975, 0, 0);
    ring.rotation.y = Math.PI / 2;
    head.add(ear, ring);
  }
  head.add(mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 12), metal, 0, 0.82, 0), mesh(new THREE.SphereGeometry(0.07, 16, 16), light, 0, 1, 0));
  robot.add(head);

  // Hover: a lime ring and light under the body (the soft glow around it is CSS, so it is never cut at the canvas edge).
  const ring = mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 40), light, 0, -1.02, 0);
  ring.rotation.x = Math.PI / 2;
  const thrust = new THREE.PointLight(0xa6ff00, 4, 3);
  thrust.position.y = -1.2;
  robot.add(ring, thrust);

  return { robot, head, arms, eyes };
}

function start(THREE: Three, host: HTMLDivElement, room: InstanceType<typeof import("three/examples/jsm/environments/RoomEnvironment.js").RoomEnvironment>) {
  // Still for people who turn motion off.
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: InstanceType<Three["WebGLRenderer"]>;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return () => {};
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Studio reflections make the shell read as glossy plastic; a teal rim light sits it in the night.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0xe6f2ee, 0x08110f, 0.7));
  const key = new THREE.DirectionalLight(0xf2f7f4, 2);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight(0x4fb3a9, 3);
  rim.position.set(-4, 2, -3);
  scene.add(key, rim);

  const { robot, head, arms, eyes } = build(THREE);
  scene.add(robot);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.7, 8);
  camera.lookAt(0, 0.62, 0);

  const pointer = { x: 0, y: 0 };
  const turn = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
    pointer.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height * 0.3)) / (window.innerHeight / 2)));
  };

  // Wave hello in the first few seconds; blink every few seconds.
  const ease = (a: number, b: number, t: number) => {
    const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  let blinkAt = 2.5;
  const clock = new THREE.Clock();
  const draw = () => {
    const t = still ? 0 : clock.getElapsedTime();
    turn.x += (pointer.x - turn.x) * 0.06;
    turn.y += (pointer.y - turn.y) * 0.06;
    robot.position.y = Math.sin(t * 1.2) * 0.08;
    robot.rotation.y = turn.x * 0.22;
    robot.rotation.z = Math.sin(t * 0.8) * 0.025;
    head.rotation.y = turn.x * 0.5;
    head.rotation.x = turn.y * 0.25;
    const lift = ease(0.3, 0.8, t) * (1 - ease(2.6, 3.2, t));
    arms.right.rotation.z = 0.16 + lift * (2.3 + 0.3 * Math.sin(t * 9));
    arms.left.rotation.z = -0.16 - Math.sin(t * 1.2 + 1) * 0.05;
    if (t > blinkAt + 0.14) blinkAt = t + 3 + Math.random() * 3;
    const open = t > blinkAt && t < blinkAt + 0.14 ? 0.12 : 1;
    eyes.forEach((e) => (e.scale.y = open));
    renderer.render(scene, camera);
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole robot in frame whatever the box's shape.
    camera.position.z = 8 * Math.max(1, 0.78 / camera.aspect);
    camera.updateProjectionMatrix();
    if (still) draw();
  };

  // Runs only while on screen.
  let visible = true;
  let frame = 0;
  const loop = () => {
    frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    draw();
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
  draw();
  host.style.opacity = "1";
  seen.observe(host);
  sized.observe(host);
  if (!still) {
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", wake);
    wake();
  }

  return () => {
    cancelAnimationFrame(frame);
    seen.disconnect();
    sized.disconnect();
    window.removeEventListener("pointermove", onMove);
    document.removeEventListener("visibilitychange", wake);
    scene.traverse((o) => {
      const m = o as import("three").Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as import("three").Material).dispose();
      }
    });
    scene.environment?.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
