"use client";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import {
  WORLD,
  clampPosition,
  eligibleHearts,
  heartLayout,
  modeInfo,
  mulberry32,
  nearestCollectible,
  stepAvatar,
  type AvatarPosition,
  type Couple3DHeart,
  type Couple3DMode,
  type Couple3DSide,
} from "@/lib/couple3d";

type Props = {
  mode: Couple3DMode;
  hearts: readonly Couple3DHeart[];
  side: Couple3DSide;
  peerRef: { current: AvatarPosition | null };
  onMove: (position: AvatarPosition) => void;
  onCollect: (itemId: string) => void;
  onError: (message: string) => void;
  reducedMotion: boolean;
};

type HeartMesh = { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial; baseY: number; index: number };

const KEY_CODES: Record<string, string> = {
  ArrowUp: "up", KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  Space: "float", ShiftLeft: "sink", ShiftRight: "sink", KeyC: "sink",
};

function heartGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.35);
  shape.bezierCurveTo(0, 0.68, -0.58, 0.9, -0.58, 0.34);
  shape.bezierCurveTo(-0.58, 0.03, -0.05, -0.24, 0, -0.62);
  shape.bezierCurveTo(0.05, -0.24, 0.58, 0.03, 0.58, 0.34);
  shape.bezierCurveTo(0.58, 0.9, 0, 0.68, 0, 0.35);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.05, bevelThickness: 0.04, curveSegments: 12 });
  geometry.center();
  geometry.scale(0.72, 0.72, 0.72);
  return geometry;
}

function avatar(color: number, sharedHeart: THREE.BufferGeometry) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.38, 0.62, 4, 10),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.15 }),
  );
  body.position.y = 0.72;
  group.add(body);
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.54, 0.035, 8, 28),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
  );
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 0.06;
  group.add(halo);
  const badge = new THREE.Mesh(sharedHeart, new THREE.MeshBasicMaterial({ color: 0xfff0f6 }));
  badge.scale.setScalar(0.34);
  badge.position.y = 1.62;
  group.add(badge);
  return group;
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose?.();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach(item => item.dispose());
    else material?.dispose?.();
  });
}

export default function Couple3DScene({ mode, hearts, side, peerRef, onMove, onCollect, onError, reducedMotion }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const heartsRef = useRef<readonly Couple3DHeart[]>(hearts);
  const onMoveRef = useRef(onMove);
  const onCollectRef = useRef(onCollect);
  const onErrorRef = useRef(onError);
  const reducedRef = useRef(reducedMotion);
  heartsRef.current = hearts;
  onMoveRef.current = onMove;
  onCollectRef.current = onCollect;
  onErrorRef.current = onError;
  reducedRef.current = reducedMotion;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      onErrorRef.current("3D is unavailable on this device. The heart list still works.");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = "couple3d-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const palette = mode === "garden" ? 0x13211c : mode === "rally" ? 0x14122c : 0x101426;
    scene.background = new THREE.Color(palette);
    scene.fog = new THREE.FogExp2(palette, 0.022);
    const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
    const ambient = new THREE.HemisphereLight(0xffe7f2, 0x1a2240, 1.7);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffd9ec, 1.35);
    sun.position.set(8, 14, 6);
    scene.add(sun);
    const glow = new THREE.PointLight(0xff79b0, 18, 26);
    glow.position.set(0, 7, 0);
    scene.add(glow);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshStandardMaterial({ color: mode === "garden" ? 0x183c31 : 0x20233c, roughness: 0.9, metalness: 0.05 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    scene.add(ground);
    for (let i = 1; i <= 3; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(3.2 * i - 0.04, 3.2 * i + 0.04, 72),
        new THREE.MeshBasicMaterial({ color: mode === "garden" ? 0x6ce0b0 : 0x8a74ff, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.01;
      scene.add(ring);
    }

    const random = mulberry32(mode === "garden" ? 71 : mode === "rally" ? 97 : 43);
    const starPositions = new Float32Array(260 * 3);
    for (let i = 0; i < 260; i++) {
      const radius = 15 + random() * 25;
      const angle = random() * Math.PI * 2;
      starPositions[i * 3] = Math.cos(angle) * radius;
      starPositions[i * 3 + 1] = 3 + random() * 22;
      starPositions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xffe7f5, size: 0.12, transparent: true, opacity: 0.85, sizeAttenuation: true })));

    // Procedural, license-free scenery inspired by open-source low-poly worlds.
    if (mode === "orbit") {
      for (let i = 0; i < 5; i++) {
        const moon = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.7 + random() * 0.55, 1),
          new THREE.MeshStandardMaterial({ color: 0xa69cff, emissive: 0x382d7a, roughness: 0.6, flatShading: true }),
        );
        moon.position.set((random() - 0.5) * 21, 5 + random() * 5, (random() - 0.5) * 21);
        scene.add(moon);
      }
      const orbit = new THREE.Mesh(
        new THREE.TorusGeometry(10.5, 0.035, 8, 96),
        new THREE.MeshBasicMaterial({ color: 0xd8a8ff, transparent: true, opacity: 0.38 }),
      );
      orbit.rotation.x = 1.18;
      orbit.position.y = 5;
      scene.add(orbit);
    } else if (mode === "garden") {
      for (let i = 0; i < 34; i++) {
        const flower = new THREE.Group();
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.75, 6), new THREE.MeshStandardMaterial({ color: 0x4bd39b, roughness: 0.8 }));
        stem.position.y = 0.36;
        flower.add(stem);
        const petals = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 0), new THREE.MeshStandardMaterial({ color: i % 3 === 0 ? 0xff9fc8 : 0xffd6e8, emissive: 0x7a264d, emissiveIntensity: 0.25, flatShading: true }));
        petals.position.y = 0.82;
        flower.add(petals);
        flower.position.set((random() - 0.5) * 22, 0, (random() - 0.5) * 22);
        flower.rotation.y = random() * Math.PI;
        scene.add(flower);
      }
    } else {
      const trail = heartLayout("rally").map(item => new THREE.Vector3(item.x, item.y + 0.15, item.z));
      const curve = new THREE.CatmullRomCurve3(trail, false, "catmullrom", 0.4);
      scene.add(new THREE.Mesh(
        new THREE.TubeGeometry(curve, 100, 0.045, 6, false),
        new THREE.MeshBasicMaterial({ color: 0x9ee7ff, transparent: true, opacity: 0.45 }),
      ));
      for (const point of trail) {
        const arch = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.055, 8, 32), new THREE.MeshBasicMaterial({ color: 0x8ed8ff, transparent: true, opacity: 0.55 }));
        arch.position.copy(point);
        arch.rotation.x = Math.PI / 2;
        scene.add(arch);
      }
    }

    const sharedHeart = heartGeometry();
    const me = avatar(side === "a" ? 0xff7ab6 : 0x8ad8ff, sharedHeart);
    const partner = avatar(side === "a" ? 0x8ad8ff : 0xff7ab6, sharedHeart);
    partner.visible = false;
    scene.add(me, partner);

    const heartMeshes = new Map<string, HeartMesh>();
    const layout = heartsRef.current.length ? heartsRef.current : heartLayout(mode);
    layout.forEach((heart, index) => {
      const material = new THREE.MeshStandardMaterial({ color: 0xff7ab6, emissive: 0xff4f9a, emissiveIntensity: 0.85, roughness: 0.28, metalness: 0.15, transparent: true, opacity: 0.98 });
      const mesh = new THREE.Mesh(sharedHeart, material);
      mesh.position.set(heart.x, heart.y, heart.z);
      mesh.scale.setScalar(1.05);
      scene.add(mesh);
      heartMeshes.set(heart.id, { mesh, material, baseY: heart.y, index });
    });

    let mine: AvatarPosition = clampPosition({ x: side === "a" ? -3 : 3, y: WORLD.minY + 0.5, z: side === "a" ? 6 : 7, yaw: 0, t: Date.now() });
    me.position.set(mine.x, mine.y - WORLD.minY, mine.z);
    let frame = 0;
    let last = performance.now();
    let lastMove = 0;
    const collectCooldown = new Map<string, number>();
    const resize = () => {
      const width = container.clientWidth || 640;
      const height = container.clientHeight || 420;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(container);
    window.addEventListener("resize", resize);
    onMoveRef.current({ ...mine });

    const keyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,[contenteditable=true]")) return;
      const key = KEY_CODES[event.code];
      if (!key) return;
      event.preventDefault();
      keysRef.current.add(key);
    };
    const keyUp = (event: KeyboardEvent) => {
      const key = KEY_CODES[event.code];
      if (key) keysRef.current.delete(key);
    };
    const blur = () => keysRef.current.clear();
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);

    const animate = (now: number) => {
      frame = requestAnimationFrame(animate);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = stepAvatar(mine, keysRef.current, dt);
      mine = { ...next, t: now };
      me.position.set(mine.x, mine.y - WORLD.minY, mine.z);
      me.rotation.y = mine.yaw;
      const peer = peerRef.current;
      const peerFresh = !!peer && (!peer.t || now - peer.t < WORLD.peerStaleMs);
      partner.visible = peerFresh;
      if (peerFresh && peer) {
        partner.position.lerp(new THREE.Vector3(peer.x, peer.y - WORLD.minY, peer.z), reducedRef.current ? 0.35 : 0.18);
        partner.rotation.y = peer.yaw;
      }
      const desired = new THREE.Vector3(mine.x + Math.sin(mine.yaw) * 6.2, mine.y + 3.8, mine.z + Math.cos(mine.yaw) * 6.2);
      camera.position.lerp(desired, reducedRef.current ? 0.24 : 0.09);
      camera.lookAt(mine.x - Math.sin(mine.yaw) * 2.6, mine.y + 0.85, mine.z - Math.cos(mine.yaw) * 2.6);

      const currentHearts = heartsRef.current.length ? heartsRef.current : heartLayout(mode);
      const eligible = new Set(eligibleHearts(mode, currentHearts).map(heart => heart.id));
      const motion = reducedRef.current ? 0 : 1;
      currentHearts.forEach((heart, index) => {
        const entry = heartMeshes.get(heart.id);
        if (!entry) return;
        const active = !heart.collected_by && eligible.has(heart.id);
        entry.mesh.visible = !heart.collected_by;
        entry.mesh.position.set(heart.x, entry.baseY + Math.sin(now / 620 + index) * 0.22 * motion, heart.z);
        entry.mesh.quaternion.copy(camera.quaternion);
        entry.mesh.rotation.z += 0.008 * motion;
        entry.material.color.setHex(heart.collected_by === "a" ? 0xff9cc8 : heart.collected_by === "b" ? 0x9ddcff : active ? 0xff7ab6 : 0x6f668f);
        entry.material.emissiveIntensity = active ? 1.1 + Math.sin(now / 280 + index) * 0.25 * motion : 0.18;
        entry.material.opacity = active ? 0.98 : 0.42;
      });

      const found = nearestCollectible(mode, currentHearts, mine, peerFresh ? peer : null, now);
      if (found && now - (collectCooldown.get(found.id) ?? 0) > 900) {
        collectCooldown.set(found.id, now);
        onCollectRef.current(found.id);
      }
      if (now - lastMove > 125) {
        lastMove = now;
        onMoveRef.current({ ...mine });
      }
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
      observer?.disconnect();
      keysRef.current.clear();
      disposeScene(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [mode, side, peerRef]);

  const bind = (key: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      keysRef.current.add(key);
    },
    onPointerUp: () => keysRef.current.delete(key),
    onPointerCancel: () => keysRef.current.delete(key),
    onLostPointerCapture: () => keysRef.current.delete(key),
  });

  return <div className="couple3d-stage" ref={containerRef} aria-label={`3D ${modeInfo(mode).name} world`} role="application">
    <div className="couple3d-compass" aria-hidden="true"><span>Us</span><i>✦</i></div>
    <div className="couple3d-pad" role="group" aria-label="Move in the 3D world">
      <button className="pad-up" aria-label="Move forward" {...bind("up")}>↑</button>
      <button className="pad-left" aria-label="Turn left" {...bind("left")}>↰</button>
      <button className="pad-right" aria-label="Turn right" {...bind("right")}>↱</button>
      <button className="pad-down" aria-label="Move back" {...bind("down")}>↓</button>
      <button className="pad-float" aria-label="Float up" {...bind("float")}>☁️</button>
      <button className="pad-sink" aria-label="Float down" {...bind("sink")}>⌄</button>
    </div>
    <p className="couple3d-keys">WASD / arrows to glide · Space to float · C to land</p>
  </div>;
}
