"use client";

import { useEffect, useRef } from "react";

type Three = typeof import("three");

// The model: RobotExpressive by Quaternius (CC0 1.0), served from /public/models.
const MODEL = "/models/robot.glb";

/**
 * The hero's robot as a live 3D model: glossy white, it waves once, then idles and turns toward the pointer.
 * It loads after the page is shown and fades in; without WebGL the space stays empty.
 */
export function RobotModel({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    let stop = () => {};
    let cancelled = false;
    Promise.all([import("three"), import("three/examples/jsm/loaders/GLTFLoader.js"), import("three/examples/jsm/environments/RoomEnvironment.js")])
      .then(([THREE, { GLTFLoader }, { RoomEnvironment }]) => {
        if (cancelled) return;
        stop = start(THREE, host, new GLTFLoader(), new RoomEnvironment(), () => cancelled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  return <div ref={ref} aria-hidden="true" className={`opacity-0 transition-opacity duration-1000 ${className}`} />;
}

function start(
  THREE: Three,
  host: HTMLDivElement,
  loader: InstanceType<typeof import("three/examples/jsm/loaders/GLTFLoader.js").GLTFLoader>,
  room: InstanceType<typeof import("three/examples/jsm/environments/RoomEnvironment.js").RoomEnvironment>,
  cancelled: () => boolean,
) {
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
  renderer.toneMappingExposure = 1.1;
  renderer.domElement.style.cssText = "width:100%;height:100%;display:block";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  // Soft studio reflections make the white shell read as glossy plastic.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffe6d0, 0x2a0f24, 0.8));
  const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0xff8a5c, 3);
  rim.position.set(-4, 3, -3);
  const glow = new THREE.PointLight(0xa6ff00, 6, 6);
  scene.add(key, rim, glow);

  // Shell, joints and face in the brand's dusk look instead of the model's orange.
  const paint: Record<string, { color: number; roughness: number; metalness: number }> = {
    Main: { color: 0xf3eee8, roughness: 0.28, metalness: 0.05 },
    Grey: { color: 0x3a3438, roughness: 0.45, metalness: 0.6 },
    Black: { color: 0x0b0a0d, roughness: 0.12, metalness: 0.2 },
  };

  let model: import("three").Object3D | null = null;
  let mixer: import("three").AnimationMixer | null = null;
  const clock = new THREE.Clock();
  const pointer = { x: 0, y: 0 };
  const turn = { x: 0, y: 0 };
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    pointer.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
    pointer.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
  };

  const draw = () => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (mixer && !still) mixer.update(dt);
    if (model) {
      // Ease toward the pointer: the whole robot turns and tilts a little.
      turn.x += (pointer.x - turn.x) * 0.06;
      turn.y += (pointer.y - turn.y) * 0.06;
      model.rotation.y = turn.x * 0.55;
      model.rotation.x = turn.y * 0.12;
    }
    renderer.render(scene, camera);
  };

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (still) draw();
  };

  let visible = true;
  let frame = 0;
  const loop = () => {
    frame = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
    draw();
  };
  const wake = () => {
    if (!still && !frame && visible && !document.hidden && model) {
      clock.getDelta();
      frame = requestAnimationFrame(loop);
    }
  };
  const seen = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    wake();
  });
  const sized = new ResizeObserver(resize);

  loader.load(MODEL, (gltf) => {
    if (cancelled()) return;
    model = gltf.scene;
    model.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.isMesh) {
        const mat = mesh.material as import("three").MeshStandardMaterial;
        const p = paint[mat.name];
        if (p) Object.assign(mat, { roughness: p.roughness, metalness: p.metalness }).color.setHex(p.color);
      }
    });
    // Frame the model: centred, with a little room around it.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    model.position.sub(centre);
    scene.add(model);
    const fit = (size.y / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.25;
    camera.position.set(0, size.y * 0.06, fit);
    camera.lookAt(0, 0, 0);
    glow.position.set(0, -size.y * 0.35, size.z * 1.2);

    mixer = new THREE.AnimationMixer(model);
    const clip = (name: string) => gltf.animations.find((a) => a.name === name);
    const idleClip = clip("Idle");
    const waveClip = clip("Wave");
    const idle = idleClip ? mixer.clipAction(idleClip) : null;
    idle?.play();
    if (waveClip && !still) {
      // Wave hello once, then settle back into the idle loop.
      const wave = mixer.clipAction(waveClip);
      wave.setLoop(THREE.LoopOnce, 1);
      wave.clampWhenFinished = true;
      setTimeout(() => {
        if (cancelled() || !mixer) return;
        idle?.fadeOut(0.3);
        wave.reset().fadeIn(0.3).play();
        mixer.addEventListener("finished", () => {
          wave.fadeOut(0.4);
          idle?.reset().fadeIn(0.4).play();
        });
      }, 600);
    }
    resize();
    draw();
    host.style.opacity = "1";
    wake();
  });

  seen.observe(host);
  sized.observe(host);
  if (!still) {
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", wake);
  }

  return () => {
    cancelAnimationFrame(frame);
    seen.disconnect();
    sized.disconnect();
    window.removeEventListener("pointermove", onMove);
    document.removeEventListener("visibilitychange", wake);
    mixer?.stopAllAction();
    scene.traverse((o) => {
      const mesh = o as import("three").Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as import("three").Material).dispose();
      }
    });
    scene.environment?.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  };
}
