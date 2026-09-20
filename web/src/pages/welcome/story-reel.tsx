import { useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { WelcomeLook } from "./story";

type Props = { look: WelcomeLook; progress: RefObject<number>; paused: boolean; onReady: () => void; onError: () => void };
const count = 12;
const radius = 4.6;
const tileWidth = 2.25;
const tileHeight = 1.5;
const smoothstep = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };

// The film strip bends into a reel, then unfolds into the same assets on a canvas.
function tileGeometry(index: number) {
    const geometry = new THREE.PlaneGeometry(tileWidth, tileHeight, 16, 1);
    const flat = new Float32Array(geometry.attributes.position.array);
    const target = new Float32Array(flat.length);
    for (let i = 0; i < flat.length; i += 3) {
        target[i] = flat[i] + ((index % 4) - 1.5) * 2.65;
        target[i + 1] = flat[i + 1] + (1 - Math.floor(index / 4)) * 2;
        target[i + 2] = 0;
    }
    return { geometry, flat, target };
}

function imageTexture(image: HTMLImageElement, index: number, type: "film" | "script" | "board", look: WelcomeLook) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#101211";
    ctx.fillRect(0, 0, 768, 512);
    ctx.filter = type === "board" ? "grayscale(1) contrast(1.5)" : "none";
    const imageHeight = type === "board" ? 462 : 512;
    const scale = Math.max(768 / image.width, imageHeight / image.height);
    ctx.drawImage(image, (768 - image.width * scale) / 2, (imageHeight - image.height * scale) / 2, image.width * scale, image.height * scale);
    ctx.filter = "none";
    if (type === "board") {
        ctx.fillStyle = "#d8dfd9";
        ctx.font = "18px sans-serif";
        ctx.fillText(`SHOT ${String(index + 1).padStart(2, "0")}   /   MEDIUM SHOT`, 22, 494);
        ctx.fillStyle = "#929c96";
        ctx.textAlign = "right";
        ctx.fillText("DOLLY IN", 746, 494);
    } else if (type === "script") {
        const shade = ctx.createLinearGradient(0, 0, 0, 512);
        shade.addColorStop(0, "#08080880");
        shade.addColorStop(0.35, "#08080810");
        shade.addColorStop(0.65, "#080808a0");
        shade.addColorStop(1, "#080808ed");
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, 768, 512);
        ctx.fillStyle = "#f3f2ef";
        ctx.font = "20px sans-serif";
        ctx.fillText(`${look.title} / 场 ${String(Math.floor(index / 4) + 1).padStart(2, "0")}`, 48, 65);
        ctx.font = "32px serif";
        ctx.fillText(look.screenplay[index], 48, 366, 672);
        ctx.font = "23px serif";
        ctx.fillStyle = "#d0ceca";
        ctx.fillText(look.screenplay[(index + 1) % count], 48, 413, 672);
        ctx.fillStyle = "#b4b2ae";
        ctx.font = "16px monospace";
        ctx.fillText(`SCENE / ${String(index + 1).padStart(2, "0")}`, 48, 475);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export default function StoryReel({ look, progress, paused, onReady, onError }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const pausedRef = useRef(paused);
    const callbacks = useRef({ onReady, onError });
    callbacks.current = { onReady, onError };
    pausedRef.current = paused;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        let disposed = false;
        let frame = 0;
        let renderer: THREE.WebGLRenderer;
        try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" }); }
        catch { callbacks.current.onError(); return; }
        renderer.setClearColor(0x090c0a, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
        const tiles: ReturnType<typeof tileGeometry>[] = [];
        const meshes: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
        const textures: THREE.Texture[] = [];
        const films: THREE.Texture[] = [];
        const scripts: THREE.Texture[] = [];
        const boards: THREE.Texture[] = [];
        const images: HTMLImageElement[] = [];
        const video = document.createElement("video");
        if (look.video) video.src = look.video;
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        video.preload = "none";
        const videoTexture = new THREE.VideoTexture(video);
        videoTexture.colorSpace = THREE.SRGBColorSpace;
        textures.push(videoTexture);
        const linesGeometry = new THREE.BufferGeometry();
        const linePositions: number[] = [];
        for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
            const x = (col - 1.5) * 2.65;
            const y = (1 - row) * 2;
            linePositions.push(x + tileWidth / 2, y, -0.02, x + 2.65 - tileWidth / 2, y, -0.02);
        }
        for (let row = 0; row < 2; row++) {
            linePositions.push(-3.975, (1 - row) * 2 - 0.75, -0.02, -3.975, -row * 2 + 0.75, -0.02);
        }
        linesGeometry.setAttribute("position", new THREE.Float32BufferAttribute(linePositions, 3));
        const lineMaterial = new THREE.LineBasicMaterial({ color: 0x9bb5a4, transparent: true, opacity: 0 });
        scene.add(new THREE.LineSegments(linesGeometry, lineMaterial));
        const tracks = new THREE.Group();
        const trackMaterials: THREE.LineBasicMaterial[] = [];
        const trackGeometries: THREE.BufferGeometry[] = [];
        for (let i = 0; i < 12; i++) {
            const points = Array.from({ length: 20 }, (_, j) => {
                const angle = i * Math.PI / 6 + j * 0.015;
                return new THREE.Vector3(Math.sin(angle) * 5.2, i % 2 ? 1.1 : -1.1, Math.cos(angle) * 5.2);
            });
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color: i % 3 ? 0xc3d4c9 : 0xd7ba80, transparent: true, opacity: 0.2 });
            tracks.add(new THREE.Line(geometry, material));
            trackMaterials.push(material);
            trackGeometries.push(geometry);
        }
        scene.add(tracks);
        let width = 0;
        let height = 0;
        const resize = () => {
            width = canvas.clientWidth;
            height = canvas.clientHeight;
            if (!width || !height) return;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, width < 768 ? 1.25 : 1.7));
            renderer.setSize(width, height, false);
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
        resize();
        let visible = true;
        const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (!visible) video.pause(); });
        visibility.observe(canvas);
        const contextLost = (event: Event) => { event.preventDefault(); callbacks.current.onError(); };
        canvas.addEventListener("webglcontextlost", contextLost);

        const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
            const image = new Image();
            images.push(image);
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = src;
        });
        const timeout = window.setTimeout(() => { if (!disposed) callbacks.current.onError(); }, 15000);
        const loads = new Map<string, Promise<HTMLImageElement>>();
        Promise.all(look.frames.map((src) => {
            if (!loads.has(src)) loads.set(src, loadImage(src));
            return loads.get(src)!;
        })).then((loaded) => {
            if (disposed) return;
            window.clearTimeout(timeout);
            loaded.forEach((image, index) => {
                const film = imageTexture(image, index, "film", look);
                const script = imageTexture(image, index, "script", look);
                const board = imageTexture(image, index, "board", look);
                films.push(film); scripts.push(script); boards.push(board);
                textures.push(film, script, board);
                const tile = tileGeometry(index);
                tiles.push(tile);
                const material = new THREE.MeshBasicMaterial({ map: film, side: THREE.DoubleSide });
                // Both sides of the reel must keep screenplay and shot labels readable.
                material.onBeforeCompile = (shader) => {
                    shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", THREE.ShaderChunk.map_fragment.replaceAll("vMapUv", "(gl_FrontFacing ? vMapUv : vec2(1.0 - vMapUv.x, vMapUv.y))"));
                };
                const mesh = new THREE.Mesh(tile.geometry, material);
                meshes.push(mesh);
                scene.add(mesh);
            });
            let last = performance.now();
            let current = progress.current;
            let idle = 0;
            let previousStage = -1;
            let previousVideoReady = false;
            let playbackBlocked = false;
            let frozen = current;
            let wasPaused = pausedRef.current;
            const animate = (now: number) => {
                if (disposed) return;
                frame = requestAnimationFrame(animate);
                const dt = Math.min((now - last) / 1000, 0.05);
                last = now;
                if (!visible || document.hidden) { video.pause(); return; }
                if (pausedRef.current && !wasPaused) frozen = current;
                wasPaused = pausedRef.current;
                const target = pausedRef.current ? frozen : progress.current;
                const velocity = target - current;
                current += velocity * (1 - Math.exp(-dt * 7));
                if (!pausedRef.current) idle += dt * 0.035;
                const stage = Math.min(5, Math.floor(current * 6));
                const videoReady = video.readyState >= 2 && !playbackBlocked;
                const unfold = smoothstep((current - 0.81) / 0.13);
                const spin = current * Math.PI * 5 + idle;
                const mobile = width < 768;
                const cameraStops = mobile
                    ? [[0, 4, 12], [0, 8, 12], [1, 1.5, 11], [0, 3.5, 10.5], [0, 0.6, 9], [0, 0, Math.max(34, 12 / (2 * Math.tan(THREE.MathUtils.degToRad(21)) * camera.aspect))]]
                    : [[0, 3.5, 8.8], [0, 7.8, 7], [2.2, 1.7, 7.8], [0.5, 1.5, 6.8], [0, 0.5, 5.8], [0, 0, 14]];
                const stop = current * 5;
                const from = Math.floor(stop);
                const to = Math.min(5, from + 1);
                const mix = smoothstep(stop - from);
                camera.position.set(...cameraStops[from].map((value, i) => THREE.MathUtils.lerp(value, cameraStops[to][i], mix)) as [number, number, number]);
                camera.lookAt(0, mobile ? THREE.MathUtils.lerp(-0.9, 4.9, unfold) : THREE.MathUtils.lerp(-0.5, 1.55, unfold), 0);
                scene.rotation.z = -0.14 * (1 - unfold);
                meshes.forEach((mesh, index) => {
                    const tile = tiles[index];
                    const positions = tile.geometry.attributes.position;
                    const angle = index / count * Math.PI * 2 + spin;
                    for (let i = 0; i < positions.count; i++) {
                        const offset = i * 3;
                        const theta = angle + tile.flat[offset] / radius;
                        positions.setXYZ(i,
                            THREE.MathUtils.lerp(Math.sin(theta) * radius, tile.target[offset], unfold),
                            THREE.MathUtils.lerp(tile.flat[offset + 1], tile.target[offset + 1], unfold),
                            THREE.MathUtils.lerp(Math.cos(theta) * radius, tile.target[offset + 2], unfold));
                    }
                    positions.needsUpdate = true;
                    // Deformed vertices move outside the original plane bounds.
                    mesh.frustumCulled = false;
                    if (stage !== previousStage || videoReady !== previousVideoReady) {
                        const showScript = stage === 1 && index % 4 === 0 || stage === 5 && index < 3;
                        const showBoard = stage === 3 || stage === 5 && index >= 6 && index <= 8;
                        mesh.material.map = showScript ? scripts[index] : showBoard ? boards[index] : stage === 4 && videoReady && index % 3 === 0 ? videoTexture : films[index];
                    }
                });
                previousStage = stage;
                previousVideoReady = videoReady;
                if (look.video && stage === 4 && !pausedRef.current && !playbackBlocked && video.paused) void video.play().catch(() => {
                    playbackBlocked = true;
                    meshes.forEach((mesh, index) => { if (mesh.material.map === videoTexture) mesh.material.map = films[index]; });
                });
                else if (stage !== 4 || pausedRef.current) video.pause();
                tracks.rotation.y = spin;
                tracks.visible = unfold < 0.99;
                trackMaterials.forEach((material) => { material.opacity = Math.min(0.6, 0.13 + Math.abs(velocity) * 12) * (1 - unfold); });
                lineMaterial.opacity = unfold * 0.65;
                renderer.render(scene, camera);
            };
            animate(performance.now());
            callbacks.current.onReady();
        }).catch(() => { if (!disposed) callbacks.current.onError(); });

        return () => {
            disposed = true;
            window.clearTimeout(timeout);
            cancelAnimationFrame(frame);
            observer.disconnect();
            visibility.disconnect();
            canvas.removeEventListener("webglcontextlost", contextLost);
            images.forEach((image) => { image.onload = null; image.onerror = null; });
            video.pause(); video.removeAttribute("src"); video.load();
            meshes.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); });
            textures.forEach((texture) => texture.dispose());
            trackMaterials.forEach((material) => material.dispose());
            trackGeometries.forEach((geometry) => geometry.dispose());
            linesGeometry.dispose(); lineMaterial.dispose();
            renderer.dispose();
        };
    }, [progress, look]);
    return <canvas ref={canvasRef} className="welcome-webgl" aria-label="随着故事章节旋转并展开的电影影像卷轴" />;
}
