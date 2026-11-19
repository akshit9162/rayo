"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export type GlobeGraph = {
  /** One point per crawled site; size follows its best network's score (0..1). */
  nodes: { score: number; linked: boolean }[];
  /** Links between sites, as indexes into nodes. */
  edges: [number, number][];
};

const RADIUS = 1;
const INK = new THREE.Color("#141821");
const ACCENT = new THREE.Color("#3552e0");
const SIGNAL = new THREE.Color("#e6ac2e");

/** Spread n points evenly over a sphere (Fibonacci lattice). */
function lattice(n: number): THREE.Vector3[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  return Array.from({ length: n }, (_, i) => {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    return new THREE.Vector3(Math.cos(golden * i) * r, y, Math.sin(golden * i) * r).multiplyScalar(RADIUS);
  });
}

/** An arc between two points on the sphere, lifted off the surface by its length. */
function arc(a: THREE.Vector3, b: THREE.Vector3): THREE.QuadraticBezierCurve3 {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  const lift = RADIUS + a.distanceTo(b) * 0.45;
  if (mid.lengthSq() < 1e-6) mid.set(0, 1, 0);
  return new THREE.QuadraticBezierCurve3(a, mid.setLength(lift), b);
}

const DOT_VERTEX = `
  attribute float size;
  attribute vec3 color;
  varying vec3 vColor;
  varying float vFade;
  uniform float pixelRatio;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vColor = color;
    // Points on the far side of the globe fade, so it reads as a sphere.
    vFade = smoothstep(-1.2, 0.6, (modelMatrix * vec4(position, 1.0)).z);
    gl_PointSize = size * pixelRatio * (3.2 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;

const DOT_FRAGMENT = `
  varying vec3 vColor;
  varying float vFade;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.38, d);
    if (a < 0.01) discard;
    gl_FragColor = vec4(vColor, a * mix(0.18, 0.95, vFade));
  }`;

/**
 * The crawl as a slowly turning globe: each site a point, each link between sites an arc,
 * with a signal running along every arc. Decorative: the same facts are in the text.
 * Still under reduced motion, paused off screen, and absent when WebGL is unavailable.
 */
export function Globe({ graph }: { graph: GlobeGraph }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
    } catch {
      return;
    }
    const pixelRatio = Math.min(window.devicePixelRatio, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.domElement.setAttribute("aria-hidden", "true");
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
    camera.position.set(0, 0, 4.2);
    const world = new THREE.Group();
    world.rotation.x = 0.35;
    scene.add(world);
    const disposables: { dispose(): void }[] = [];

    // Sites
    const positions = lattice(graph.nodes.length);
    const dotGeo = new THREE.BufferGeometry().setFromPoints(positions);
    dotGeo.setAttribute("size", new THREE.Float32BufferAttribute(graph.nodes.map((n) => 10 + n.score * 22), 1));
    dotGeo.setAttribute("color", new THREE.Float32BufferAttribute(graph.nodes.flatMap((n) => (n.linked ? ACCENT : INK).toArray()), 3));
    const dotMat = new THREE.ShaderMaterial({
      vertexShader: DOT_VERTEX,
      fragmentShader: DOT_FRAGMENT,
      uniforms: { pixelRatio: { value: pixelRatio } },
      transparent: true,
      depthWrite: false,
    });
    const dots = new THREE.Points(dotGeo, dotMat);
    dots.renderOrder = 2; // drawn after the lines, so no line crosses a site
    world.add(dots);
    disposables.push(dotGeo, dotMat);

    // A faint lattice of meridians, so the empty web still has a shape.
    const ringMat = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.07, depthWrite: false });
    for (let i = 0; i < 6; i++) {
      const ring = new THREE.EllipseCurve(0, 0, RADIUS, RADIUS).getPoints(96);
      const geo = new THREE.BufferGeometry().setFromPoints(ring.map((p) => new THREE.Vector3(p.x, p.y, 0)));
      const line = new THREE.LineLoop(geo, ringMat);
      line.rotation.y = (i / 6) * Math.PI;
      world.add(line);
      disposables.push(geo);
    }
    disposables.push(ringMat);

    // Links, and one signal per link
    const curves = graph.edges.map(([a, b]) => arc(positions[a], positions[b]));
    const arcMat = new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.55, depthWrite: false });
    for (const c of curves) {
      const geo = new THREE.BufferGeometry().setFromPoints(c.getPoints(48));
      world.add(new THREE.Line(geo, arcMat));
      disposables.push(geo);
    }
    disposables.push(arcMat);
    const signalGeo = new THREE.BufferGeometry();
    signalGeo.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(curves.length * 3), 3));
    signalGeo.setAttribute("size", new THREE.Float32BufferAttribute(curves.map(() => 14), 1));
    signalGeo.setAttribute("color", new THREE.Float32BufferAttribute(curves.flatMap(() => SIGNAL.toArray()), 3));
    const signalMat = dotMat.clone();
    const signals = new THREE.Points(signalGeo, signalMat);
    signals.renderOrder = 3;
    world.add(signals);
    disposables.push(signalGeo, signalMat);
    const phase = curves.map((_, i) => i / Math.max(curves.length, 1));
    const tmp = new THREE.Vector3();
    function placeSignals(t: number) {
      const attr = signalGeo.getAttribute("position") as THREE.BufferAttribute;
      curves.forEach((c, i) => {
        c.getPoint((t * 0.25 + phase[i]) % 1, tmp);
        attr.setXYZ(i, tmp.x, tmp.y, tmp.z);
      });
      attr.needsUpdate = true;
    }

    function resize() {
      const { width, height } = el!.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    resize();

    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: 0, y: 0 };
    function onPointer(e: PointerEvent) {
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    }

    let frame = 0;
    let visible = true;
    const start = performance.now();
    function draw(now: number) {
      const t = (now - start) / 1000;
      if (!still) {
        world.rotation.y = t * 0.06 + pointer.x * 0.5;
        world.rotation.x += (0.35 + pointer.y * 0.3 - world.rotation.x) * 0.05;
      }
      placeSignals(still ? 0.4 : t);
      renderer.render(scene, camera);
    }
    // Browsers already pause animation frames in hidden tabs; this also stops them off screen.
    function loop(now: number) {
      draw(now);
      frame = visible ? requestAnimationFrame(loop) : 0;
    }
    function wake() {
      if (!still && !frame && visible) frame = requestAnimationFrame(loop);
    }

    const ro = new ResizeObserver(() => {
      resize();
      if (still) draw(start);
    });
    ro.observe(el);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      wake();
    });
    io.observe(el);
    draw(start);
    if (!still) {
      window.addEventListener("pointermove", onPointer, { passive: true });
      wake();
    }

    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener("pointermove", onPointer);
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [graph]);

  return <div ref={host} className="globe" aria-hidden="true" />;
}
