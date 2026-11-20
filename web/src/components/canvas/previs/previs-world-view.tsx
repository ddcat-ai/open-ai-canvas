import { useFrame, useThree } from "@react-three/fiber";
import { Sky } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferAttribute, BufferGeometry, Color, FogExp2, MeshStandardMaterial, Object3D, RingGeometry, Vector3, type DirectionalLight, type LineSegments, type Points } from "three";

import { previsRandom } from "@/lib/canvas/previs/previs-prop-kit";
import { resolvePrevisGroundColors, resolvePrevisWorldLighting } from "@/lib/canvas/previs/previs-world";
import type { PrevisRenderMode, PrevisWorld } from "@/types/previs";

const SKY_DISTANCE = 9000;

/** 机位高度 → 雾浓度系数：40m 以下不变，越高越淡，最低保留 15% 让远山仍然消失在天际。 */
export function previsFogAltitudeFactor(height: number) {
    return Math.max(0.15, Math.min(1, Math.pow(40 / Math.max(40, height), 0.85)));
}

/** 天空、降水只进成片，不进深度/法线/骨骼控制图（会被 overrideMaterial 画成实体）。 */
const DATA_PASS_EXCLUDE = { previsDataPassExclude: true } as const;

export function PrevisWorldView({ world, renderMode }: { world: PrevisWorld; renderMode: PrevisRenderMode }) {
    const lighting = useMemo(() => resolvePrevisWorldLighting(world), [world]);
    const ground = useMemo(() => resolvePrevisGroundColors(world), [world]);
    const { scene, invalidate } = useThree();
    const dataMode = renderMode === "depth" || renderMode === "normal" || renderMode === "pose";

    useEffect(() => {
        scene.fog = new FogExp2(lighting.fogColor.clone(), lighting.fogDensity);
        invalidate();
        return () => {
            scene.fog = null;
        };
    }, [invalidate, lighting.fogColor, lighting.fogDensity, scene]);

    // 雾浓度按机位高度衰减：雾是为平视远山调的，拉远俯瞰时若不减淡，整座城会被雾刷成一片白。
    // 捕捉按镜头摄影机求值（previsEvaluate），机位一般贴近地面，用基准浓度。
    const fogGroupRef = useRef<Object3D>(null);
    useFrame((state) => {
        const fog = scene.fog;
        if (!(fog instanceof FogExp2)) return;
        fog.density = lighting.fogDensity * previsFogAltitudeFactor(state.camera.position.y);
    });
    useEffect(() => {
        const group = fogGroupRef.current;
        if (!group) return;
        group.userData.previsEvaluate = () => {
            if (scene.fog instanceof FogExp2) scene.fog.density = lighting.fogDensity;
        };
        return () => {
            delete group.userData.previsEvaluate;
        };
    }, [lighting.fogDensity, scene]);

    const shadowExtent = Math.min(world.groundSize / 2, 170);
    const sunRef = useRef<DirectionalLight>(null);
    const [sunTarget] = useState(() => new Object3D());
    useEffect(() => {
        scene.add(sunTarget);
        if (sunRef.current) sunRef.current.target = sunTarget;
        return () => {
            scene.remove(sunTarget);
        };
    }, [scene, sunTarget]);
    const sunPosition = lighting.sunDirection.clone().multiplyScalar(700);

    return (
        <>
            <object3D ref={fogGroupRef} />
            {lighting.physicalSky && !dataMode ? (
                <Sky
                    ref={(sky: Object3D | null) => {
                        if (sky) Object.assign(sky.userData, DATA_PASS_EXCLUDE);
                    }}
                    distance={SKY_DISTANCE}
                    sunPosition={lighting.sunDirection.toArray()}
                    turbidity={lighting.turbidity}
                    rayleigh={lighting.rayleigh}
                    mieCoefficient={0.004}
                    mieDirectionalG={0.82}
                />
            ) : null}
            <hemisphereLight args={[lighting.skyColor, lighting.groundColor, lighting.hemisphereIntensity]} />
            <directionalLight
                ref={sunRef}
                position={sunPosition.toArray()}
                color={lighting.sunColor}
                intensity={lighting.sunIntensity}
                castShadow
                shadow-mapSize={[4096, 4096]}
                shadow-bias={-0.0004}
                shadow-normalBias={0.04}
                shadow-camera-near={1}
                shadow-camera-far={1600}
                shadow-camera-left={-shadowExtent}
                shadow-camera-right={shadowExtent}
                shadow-camera-top={shadowExtent}
                shadow-camera-bottom={-shadowExtent}
            />
            {/* 地面压在铺装之下 5cm，并做深度偏移：远看时街道、广场不会与地面互相穿插闪烁。 */}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]} receiveShadow>
                <planeGeometry args={[world.groundSize, world.groundSize]} />
                <meshStandardMaterial color={ground.near} roughness={0.96} polygonOffset polygonOffsetFactor={2} polygonOffsetUnits={4} />
            </mesh>
            {world.horizon ? <PrevisHorizon size={world.groundSize} color={ground.far} water={ground.water} /> : null}
            {!dataMode && (world.weather === "snow" || world.weather === "rain" || world.weather === "storm") ? <PrevisPrecipitation kind={world.weather === "snow" ? "snow" : "rain"} heavy={world.weather === "storm"} /> : null}
        </>
    );
}

/** 地面之外的一圈远山（或水面）：越远越高，配合指数雾自然消失在天际。 */
function PrevisHorizon({ size, color, water }: { size: number; color: Color; water: boolean }) {
    const geometry = useMemo(() => {
        const inner = size / 2 - 2;
        const outer = size * 2.6;
        const ring = new RingGeometry(inner, outer, 160, 10);
        if (!water) {
            const random = previsRandom(Math.round(size));
            const phases = Array.from({ length: 5 }, () => random() * Math.PI * 2);
            const position = ring.getAttribute("position") as BufferAttribute;
            const point = new Vector3();
            for (let index = 0; index < position.count; index++) {
                point.fromBufferAttribute(position, index);
                const radius = Math.hypot(point.x, point.y);
                const angle = Math.atan2(point.y, point.x);
                const t = Math.max(0, (radius - inner) / (outer - inner));
                const ridge = 0.55 + 0.25 * Math.sin(angle * 3 + phases[0]) + 0.15 * Math.sin(angle * 7 + phases[1]) + 0.08 * Math.sin(angle * 17 + phases[2]) + 0.05 * Math.sin(angle * 31 + phases[3]);
                const height = Math.pow(Math.min(1, t * 1.6), 1.4) * ridge * size * 0.16 * (0.8 + 0.2 * Math.sin(radius * 0.01 + phases[4]));
                position.setZ(index, height);
            }
            ring.computeVertexNormals();
        }
        return ring;
    }, [size, water]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    const material = useMemo(() => new MeshStandardMaterial({ color, roughness: water ? 0.2 : 1, metalness: water ? 0.15 : 0, flatShading: !water, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8 }), [color, water]);
    useEffect(() => () => material.dispose(), [material]);
    return <mesh geometry={geometry} material={material} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]} receiveShadow />;
}

const PRECIP_BOX = { width: 180, height: 70 };

/**
 * 雨雪粒子：在相机周围 180m 的体积里循环下落。视口用真实时钟，捕捉时按镜头时间求值，
 * 同一帧导出两次结果一致。降水期间视口持续重绘。
 */
function PrevisPrecipitation({ kind, heavy }: { kind: "snow" | "rain"; heavy: boolean }) {
    const count = kind === "snow" ? 9000 : heavy ? 9000 : 6000;
    const { camera, invalidate } = useThree();
    const seeds = useMemo(() => {
        const random = previsRandom(kind === "snow" ? 7 : 11);
        return Float32Array.from({ length: count * 4 }, () => random());
    }, [count, kind]);
    const geometry = useMemo(() => {
        const result = new BufferGeometry();
        result.setAttribute("position", new BufferAttribute(new Float32Array(count * (kind === "snow" ? 3 : 6)), 3));
        return result;
    }, [count, kind]);
    useEffect(() => () => geometry.dispose(), [geometry]);
    const objectRef = useRef<Points | LineSegments>(null);

    const update = (time: number, center: Vector3) => {
        const attribute = geometry.getAttribute("position") as BufferAttribute;
        const array = attribute.array as Float32Array;
        const speed = kind === "snow" ? 1.6 : heavy ? 26 : 18;
        for (let index = 0; index < count; index++) {
            const base = index * 4;
            const x = center.x + (seeds[base] - 0.5) * PRECIP_BOX.width;
            const z = center.z + (seeds[base + 1] - 0.5) * PRECIP_BOX.width;
            const fall = (seeds[base + 2] * PRECIP_BOX.height + time * speed * (0.7 + seeds[base + 3] * 0.6)) % PRECIP_BOX.height;
            const y = PRECIP_BOX.height - fall;
            if (kind === "snow") {
                const drift = Math.sin(time * 0.8 + seeds[base] * 40) * 0.6;
                array.set([x + drift, y, z + Math.cos(time * 0.6 + seeds[base + 1] * 40) * 0.6], index * 3);
            } else {
                array.set([x, y, z, x + 0.12, y - (heavy ? 1.1 : 0.8), z + 0.05], index * 6);
            }
        }
        attribute.needsUpdate = true;
        geometry.computeBoundingSphere();
    };

    useEffect(() => {
        const object = objectRef.current;
        if (!object) return;
        object.userData.previsEvaluate = (time: number) => update(time, camera.position);
        return () => {
            delete object.userData.previsEvaluate;
        };
    });

    useEffect(() => {
        let frame = 0;
        const loop = () => {
            if (document.visibilityState === "visible") invalidate();
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(frame);
    }, [invalidate]);

    useFrame((state) => update(state.clock.elapsedTime, state.camera.position));

    if (kind === "snow") {
        return (
            <points ref={objectRef as React.RefObject<Points>} geometry={geometry} frustumCulled={false} userData={DATA_PASS_EXCLUDE}>
                <pointsMaterial color="#ffffff" size={0.16} sizeAttenuation transparent opacity={0.92} depthWrite={false} fog />
            </points>
        );
    }
    return (
        <lineSegments ref={objectRef as React.RefObject<LineSegments>} geometry={geometry} frustumCulled={false} userData={DATA_PASS_EXCLUDE}>
            <lineBasicMaterial color="#c4ced8" transparent opacity={heavy ? 0.55 : 0.42} depthWrite={false} fog />
        </lineSegments>
    );
}
