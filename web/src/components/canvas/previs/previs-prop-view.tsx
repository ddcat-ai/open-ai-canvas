import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BoxGeometry, Color, EdgesGeometry, Euler, Group, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Quaternion, Vector3 } from "three";

import { generatePrevisLayout } from "@/lib/canvas/previs/previs-layout";
import type { PrevisLayoutPerson, PrevisLayoutResult, PrevisLayoutSurfaceKind } from "@/lib/canvas/previs/previs-layout-core";
import { buildPrevisPropParts, defaultPrevisPropColor, previsPropMaterial } from "@/lib/canvas/previs/previs-prop-geometry";
import { previsRandom, PrevisPropKit } from "@/lib/canvas/previs/previs-prop-kit";
import type { PrevisLayout, PrevisObject } from "@/types/previs";

/** 单个目录道具：几何体与材质都来自共享缓存，卸载时不释放。 */
export function PrevisPropVisual({ object, selected }: { object: PrevisObject; selected: boolean }) {
    const parts = useMemo(() => buildPrevisPropParts(object.propId || "", object.variant ?? 0, object.params), [object.params, object.propId, object.variant]);
    return (
        <>
            {parts.map((part) => (
                <mesh key={part.key} geometry={part.geometry} material={previsPropMaterial(part.key, object.color, selected)} castShadow={object.castShadow} receiveShadow={object.receiveShadow} />
            ))}
        </>
    );
}

const SURFACE_STYLE: Record<PrevisLayoutSurfaceKind, { color: string[]; height: number }> = {
    road: { color: ["#5d6168"], height: 0.03 },
    street: { color: ["#b9b3a6"], height: 0.04 },
    plaza: { color: ["#cfc8ba"], height: 0.06 },
    path: { color: ["#b7a07f"], height: 0.035 },
    water: { color: ["#6f9ab8"], height: 0.05 },
    field: { color: ["#b9b46a", "#8faa5c", "#a3b56d", "#c8b77a"], height: 0.045 },
    lawn: { color: ["#8faa5c"], height: 0.04 },
    sidewalk: { color: ["#c9cbcd"], height: 0.12 },
};

const CLOTHES = ["#5a6b7d", "#8b5e4a", "#c9b9a0", "#3f4a57", "#9e3a30", "#6e7f5e"].map((value) => new Color(value));

/** 路人：低模人形，衣服按实例着色，头部统一肤色。 */
const PERSON_PARTS = (() => {
    const kit = new PrevisPropKit(previsRandom(3));
    kit.box("accent", 0.13, 0.82, 0.16, -0.1, 0, 0);
    kit.box("accent", 0.13, 0.82, 0.16, 0.1, 0, 0);
    kit.cyl("accent", 0.2, 0.17, 0.62, 0, 0.82, 0, 8);
    kit.box("accent", 0.09, 0.55, 0.11, -0.25, 0.9, 0);
    kit.box("accent", 0.09, 0.55, 0.11, 0.25, 0.9, 0);
    kit.sphere("plaster", 0.12, [0, 1.6, 0], [1, 1.12, 1], 10, 8);
    return kit.build();
})();

const BOX = new BoxGeometry(1, 1, 1).translate(0, 0.5, 0);

/** indices：实例序号 → 布景展开结果里的序号；只有建筑、植物等可拆出的道具实例才有。 */
type InstanceRecord = { mesh: InstancedMesh; walkers?: PrevisLayoutPerson[]; indices?: number[] };

function composeMatrix(target: Matrix4, x: number, y: number, z: number, rotationY: number, sx: number, sy = sx, sz = sx) {
    return target.compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(0, rotationY, 0)), new Vector3(sx, sy, sz));
}

/** 路人来回走 8m：三角波位移，掉头时朝向翻转。 */
function personMatrix(target: Matrix4, person: PrevisLayoutPerson, time: number) {
    if (!person.walk) return composeMatrix(target, person.x, 0, person.z, person.rotationY, person.scale);
    const span = 8;
    const cycle = (person.phase + (time * 1.3) / (span * 2)) % 1;
    const forward = cycle < 0.5;
    const offset = (forward ? cycle * 2 : 2 - cycle * 2) * span - span / 2;
    const bob = Math.abs(Math.sin(time * 7 + person.phase * 20)) * 0.04;
    return composeMatrix(target, person.x + Math.sin(person.rotationY) * offset, bob, person.z + Math.cos(person.rotationY) * offset, forward ? person.rotationY : person.rotationY + Math.PI, person.scale);
}

function buildLayoutMeshes(plan: PrevisLayoutResult, removed: ReadonlySet<number>): InstanceRecord[] {
    const records: InstanceRecord[] = [];
    const matrix = new Matrix4();
    const groups = new Map<string, Array<{ instance: PrevisLayoutResult["instances"][number]; index: number }>>();
    plan.instances.forEach((instance, index) => {
        if (removed.has(index)) return;
        const key = `${instance.propId}:${instance.variant}`;
        const list = groups.get(key);
        if (list) list.push({ instance, index });
        else groups.set(key, [{ instance, index }]);
    });
    groups.forEach((entries, key) => {
        const [propId, variant] = key.split(":");
        const instances = entries.map((entry) => entry.instance);
        const indices = entries.map((entry) => entry.index);
        for (const part of buildPrevisPropParts(propId, Number(variant))) {
            const accent = part.key === "accent";
            const mesh = new InstancedMesh(part.geometry, previsPropMaterial(part.key, accent ? "#ffffff" : undefined), instances.length);
            instances.forEach((instance, index) => {
                mesh.setMatrixAt(index, composeMatrix(matrix, instance.x, 0, instance.z, instance.rotationY, instance.scale));
                if (accent) mesh.setColorAt(index, new Color(instance.color || defaultPrevisPropColor(propId)));
            });
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.userData.previsLayoutPickable = true;
            records.push({ mesh, indices });
        }
    });
    const surfaces = new Map<PrevisLayoutSurfaceKind, PrevisLayoutResult["surfaces"]>();
    plan.surfaces.forEach((surface) => {
        const list = surfaces.get(surface.kind);
        if (list) list.push(surface);
        else surfaces.set(surface.kind, [surface]);
    });
    surfaces.forEach((list, kind) => {
        const style = SURFACE_STYLE[kind];
        const material = kind === "water" ? previsPropMaterial("water") : previsPropMaterial("accent", "#ffffff");
        const mesh = new InstancedMesh(BOX, material, list.length);
        list.forEach((surface, index) => {
            mesh.setMatrixAt(index, composeMatrix(matrix, surface.x, -0.01, surface.z, surface.rotationY, surface.w, style.height, surface.d));
            if (kind !== "water") mesh.setColorAt(index, new Color(style.color[index % style.color.length]));
        });
        mesh.receiveShadow = true;
        records.push({ mesh });
    });
    if (plan.people.length) {
        for (const part of PERSON_PARTS) {
            const accent = part.key === "accent";
            const mesh = new InstancedMesh(part.geometry, previsPropMaterial(part.key, accent ? "#ffffff" : undefined), plan.people.length);
            plan.people.forEach((person, index) => {
                mesh.setMatrixAt(index, personMatrix(matrix, person, 0));
                if (accent) mesh.setColorAt(index, CLOTHES[person.tone % CLOTHES.length]);
            });
            mesh.castShadow = true;
            records.push({ mesh, walkers: plan.people });
        }
    }
    records.forEach(({ mesh }) => {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.computeBoundingBox();
    });
    return records;
}

/** 布景里第 index 个实例的世界变换（拆出为独立对象时用），按布景对象的位置、偏航与缩放换算。 */
export function resolvePrevisLayoutInstanceWorld(object: PrevisObject, index: number) {
    if (!object.layout) return null;
    const instance = generatePrevisLayout(object.layout).instances[index];
    if (!instance) return null;
    const [px, py, pz] = object.transform.position;
    const yaw = object.transform.rotation[1];
    const [sx, sy, sz] = object.transform.scale;
    const lx = instance.x * sx;
    const lz = instance.z * sz;
    return {
        instance,
        position: [px + lx * Math.cos(yaw) + lz * Math.sin(yaw), py, pz - lx * Math.sin(yaw) + lz * Math.cos(yaw)] as [number, number, number],
        rotation: [0, yaw + instance.rotationY, 0] as [number, number, number],
        scale: [instance.scale * sx, instance.scale * sy, instance.scale * sz] as [number, number, number],
    };
}

/** 布景包围盒高度：选中框与取景都用它。 */
export function previsLayoutHeight(layout?: PrevisLayout) {
    if (!layout) return 10;
    return layout.template === "modern_city" ? 120 : layout.template === "modern_street" ? 40 : layout.template === "ancient_city" ? 26 : 14;
}

/** 整片布景：同种道具同变体合并为 InstancedMesh；路人按镜头时间走动。 */
export function PrevisLayoutVisual({ object, selected, playhead, onPickInstance }: { object: PrevisObject; selected: boolean; playhead: number; onPickInstance?: (index: number) => void }) {
    const layout = object.layout;
    const plan = useMemo(() => (layout ? generatePrevisLayout(layout) : null), [layout]);
    const removedKey = layout?.removed?.join(",") ?? "";
    const records = useMemo(() => (plan ? buildLayoutMeshes(plan, new Set(removedKey ? removedKey.split(",").map(Number) : [])) : []), [plan, removedKey]);
    const groupRef = useRef<Group>(null);
    useEffect(() => () => records.forEach(({ mesh }) => mesh.dispose()), [records]);

    const walkers = useMemo(() => records.filter((record) => record.walkers), [records]);
    const updateWalkers = useMemo(() => {
        const matrix = new Matrix4();
        return (time: number) => {
            walkers.forEach(({ mesh, walkers: people }) => {
                people?.forEach((person, index) => {
                    if (person.walk) mesh.setMatrixAt(index, personMatrix(matrix, person, time));
                });
                mesh.instanceMatrix.needsUpdate = true;
            });
        };
    }, [walkers]);
    useEffect(() => updateWalkers(playhead), [playhead, updateWalkers]);
    useEffect(() => {
        const group = groupRef.current;
        if (!group) return;
        group.userData.previsEvaluate = updateWalkers;
        return () => {
            delete group.userData.previsEvaluate;
        };
    }, [updateWalkers]);

    const outline = useMemo(() => {
        if (!layout) return null;
        const height = previsLayoutHeight(layout);
        const edges = new EdgesGeometry(new BoxGeometry(layout.size, height, layout.size).translate(0, height / 2, 0));
        const line = new LineSegments(edges, new LineBasicMaterial({ color: "#ffb020", transparent: true, opacity: 0.85 }));
        line.userData.previsCaptureExclude = true;
        return line;
    }, [layout]);
    useEffect(
        () => () => {
            outline?.geometry.dispose();
            (outline?.material as LineBasicMaterial | undefined)?.dispose();
        },
        [outline],
    );

    return (
        <group ref={groupRef}>
            {records.map(({ mesh, indices }) =>
                indices && onPickInstance ? (
                    <primitive
                        key={mesh.uuid}
                        object={mesh}
                        onClick={(event: ThreeEvent<MouseEvent>) => {
                            // 拖动视角后松开不算点击；只有原地点击才拆出这栋建筑。
                            if (event.delta > 4 || event.instanceId === undefined) return;
                            event.stopPropagation();
                            const index = indices[event.instanceId];
                            if (index !== undefined) onPickInstance(index);
                        }}
                        onPointerOver={(event: ThreeEvent<PointerEvent>) => {
                            event.stopPropagation();
                            document.body.style.cursor = "pointer";
                        }}
                        onPointerOut={() => {
                            document.body.style.cursor = "";
                        }}
                    />
                ) : (
                    <primitive key={mesh.uuid} object={mesh} />
                ),
            )}
            {selected && outline ? <primitive object={outline} /> : null}
        </group>
    );
}
