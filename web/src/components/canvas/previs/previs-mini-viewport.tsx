import { Canvas } from "@react-three/fiber";
import { OrthographicCamera } from "@react-three/drei";
import { Suspense } from "react";
import type { PrevisObject, PrevisScene } from "@/types/previs";

/**
 * 画布卡片的轻量场景缩略图：固定俯视正交相机，只渲染简化几何体。
 * 演员使用带朝向的 clay marker，避免缩略图里只剩一根胶囊或骨骼线。
 */
export function PrevisMiniViewport({ scene }: { scene: PrevisScene }) {
    const activeShot = scene.shots.find((shot) => shot.id === scene.activeShotId) || scene.shots[0];
    const visibleObjects = scene.objects.filter((object) => object.visible !== false);

    return (
        <div className="relative h-full w-full overflow-hidden rounded-[inherit] bg-[radial-gradient(circle_at_50%_35%,#2e3949_0%,#151b25_58%,#0d1118_100%)]">
            <Canvas className="previs-mini-viewport-canvas" gl={{ alpha: true, antialias: true }} dpr={[1, 1.5]}>
                <OrthographicCamera makeDefault position={[0, 10, 0]} zoom={46} up={[0, 0, -1]} />
                <ambientLight intensity={0.72} />
                <directionalLight position={[4, 8, 4]} intensity={1.1} />
                <Suspense fallback={null}>
                    <gridHelper args={[20, 20, "#65738a", "#2b3544"]} />
                    {visibleObjects.map((object) => <MiniObject key={object.id} object={object} />)}
                </Suspense>
            </Canvas>
            <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.16em] text-white/55">
                <span>Top view</span><span>{activeShot?.name || "未设置镜头"}</span>
            </div>
            <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2 rounded-lg border border-white/12 bg-[#0d1118cc] px-3 py-2 text-[10px] font-medium text-white/80 backdrop-blur-md">
                <Stat value={visibleObjects.length} label="对象" />
                <Stat value={scene.cameras.length} label="机位" />
                <Stat value={`${activeShot?.duration ?? 0}s`} label="时长" />
            </div>
        </div>
    );
}

function MiniObject({ object }: { object: PrevisObject }) {
    const [x, , z] = object.transform.position;
    const position: [number, number, number] = [x, 0, z];
    const scale = object.transform.scale as [number, number, number];
    const rotation: [number, number, number] = [0, object.transform.rotation[1], 0];
    const color = object.color || "#d6d9dd";

    if (object.kind === "actor" || object.primitive === "character") {
        return (
            <group position={position} rotation={rotation} scale={scale}>
                <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
                    <cylinderGeometry args={[0.34, 0.34, 0.14, 24]} />
                    <meshStandardMaterial color={color} roughness={0.82} metalness={0.02} />
                </mesh>
                <mesh position={[0, 0.18, -0.26]} rotation={[-Math.PI / 2, 0, 0]}>
                    <coneGeometry args={[0.16, 0.34, 3]} />
                    <meshStandardMaterial color={color} roughness={0.82} metalness={0.02} />
                </mesh>
                <mesh position={[0, 0.155, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                    <ringGeometry args={[0.39, 0.43, 24]} />
                    <meshBasicMaterial color={color} transparent opacity={0.28} />
                </mesh>
            </group>
        );
    }
    if (object.primitive === "sphere") {
        return (
            <mesh position={position} rotation={rotation} scale={scale} castShadow receiveShadow>
                <sphereGeometry args={[0.52, 16, 12]} />
                <meshStandardMaterial color={color} roughness={0.72} metalness={0.05} />
            </mesh>
        );
    }
    if (object.primitive === "cylinder") {
        return (
            <mesh position={position} rotation={rotation} scale={scale} castShadow receiveShadow>
                <cylinderGeometry args={[0.48, 0.48, 0.9, 16]} />
                <meshStandardMaterial color={color} roughness={0.72} metalness={0.05} />
            </mesh>
        );
    }
    if (object.primitive === "plane" || object.kind === "billboard") {
        return (
            <mesh position={[x, -0.02, z]} rotation={[-Math.PI / 2, 0, object.transform.rotation[1]]} scale={scale} receiveShadow>
                <planeGeometry args={[1.5, 0.9]} />
                <meshStandardMaterial color={color} roughness={0.8} metalness={0} transparent opacity={0.76} side={2} />
            </mesh>
        );
    }
    return (
        <mesh position={position} rotation={rotation} scale={scale} castShadow receiveShadow>
            <boxGeometry args={[0.85, 0.85, 0.85]} />
            <meshStandardMaterial color={color} roughness={0.72} metalness={0.05} />
        </mesh>
    );
}

function Stat({ value, label }: { value: number | string; label: string }) {
    return <span className="inline-flex min-w-0 items-center gap-1"><b className="text-white">{value}</b><span>{label}</span></span>;
}
