import type { AnimationMixer, Material, Mesh, Object3D, Texture } from "three";

type DisposableMaterial = Material & Record<string, unknown>;

// 材质上可能承载纹理的常见槽位；只释放本 owner 真正引用到的纹理。
const TEXTURE_SLOTS = [
    "map",
    "alphaMap",
    "aoMap",
    "bumpMap",
    "displacementMap",
    "emissiveMap",
    "envMap",
    "lightMap",
    "metalnessMap",
    "normalMap",
    "roughnessMap",
    "specularMap",
    "clearcoatMap",
    "clearcoatNormalMap",
    "clearcoatRoughnessMap",
    "sheenColorMap",
    "sheenRoughnessMap",
    "transmissionMap",
    "thicknessMap",
    "iridescenceMap",
    "specularColorMap",
    "specularIntensityMap",
] as const;

function collectTextures(material: DisposableMaterial, sink: Set<Texture>) {
    TEXTURE_SLOTS.forEach((slot) => {
        const value = material[slot];
        // 必须真的是 Texture：仅凭「有 dispose」会把 RenderTarget 等误判成纹理并造成错误释放。
        if (isDirectorTexture(value)) sink.add(value);
    });
}

function isDirectorTexture(value: unknown): value is Texture {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<Texture>;
    return candidate.isTexture === true && typeof candidate.dispose === "function";
}

/**
 * GLTF 加载结果的所有权判定。
 * SkeletonUtils.clone 与 source 共享 geometry/material/texture，
 * 因此被采纳（adopt）时绝不能释放 source —— 共享资源随 owned clone 的最终 cleanup 一并释放。
 * 只有未被采纳的晚到/失效 generation 才需要释放 source，避免孤儿泄漏。
 */
export function resolveDirectorLoadOwnership(input: { active: boolean; generation: number; currentGeneration: number }) {
    const adopt = input.active && input.generation === input.currentGeneration;
    return { adopt, disposeSource: !adopt };
}

/** 释放一组材质及其引用纹理；用于被替换掉的原材质，避免 actor 参考材质造成泄漏。 */
export function disposeDirectorMaterials(materials: Array<Material | null | undefined>) {
    const owned = new Set<DisposableMaterial>();
    materials.forEach((material) => {
        if (material && typeof material.dispose === "function") owned.add(material as DisposableMaterial);
    });
    const textures = new Set<Texture>();
    owned.forEach((material) => collectTextures(material, textures));
    textures.forEach((texture) => texture.dispose());
    owned.forEach((material) => material.dispose());
}

function collectObject3DResources(root: Object3D | null | undefined, geometries: Set<{ dispose: () => void }>, materials: Set<DisposableMaterial>) {
    if (!root) return;
    root.traverse((child) => {
        const mesh = child as Mesh;
        if (mesh.geometry && typeof mesh.geometry.dispose === "function") geometries.add(mesh.geometry);
        if (!mesh.material) return;
        const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        list.forEach((material) => {
            if (!material || typeof material.dispose !== "function") return;
            materials.add(material as DisposableMaterial);
        });
    });
}

function disposeCollected(geometries: Set<{ dispose: () => void }>, materials: Set<DisposableMaterial>) {
    const textures = new Set<Texture>();
    materials.forEach((material) => collectTextures(material, textures));
    textures.forEach((texture) => texture.dispose());
    materials.forEach((material) => material.dispose());
    geometries.forEach((geometry) => geometry.dispose());
}

/**
 * 释放一棵 owned Object3D 的 GPU 资源。
 * 共享的 geometry/material/texture 用 Set 去重，保证同一资源只 dispose 一次。
 * `<primitive object={...}>` 不会代为释放，必须由 owner 显式调用。
 */
export function disposeDirectorObject3D(root: Object3D | null | undefined) {
    if (!root) return;
    const geometries = new Set<{ dispose: () => void }>();
    const materials = new Set<DisposableMaterial>();
    collectObject3DResources(root, geometries, materials);
    disposeCollected(geometries, materials);
}

/** SkeletonHelper 自带 geometry/material，必须单独释放。 */
export function disposeDirectorHelper(helper: Object3D | null | undefined) {
    disposeDirectorObject3D(helper);
}

/** mixer 停止全部动作并解除 root 缓存，避免 clip 绑定泄漏。 */
export function disposeDirectorMixer(mixer: AnimationMixer | null | undefined, root?: Object3D | null) {
    if (!mixer) return;
    mixer.stopAllAction();
    if (root) mixer.uncacheRoot(root as never);
}

/**
 * 一次性释放某个模型 generation 拥有的全部资源。
 * 只释放 owned clone 与 helper：clone 持有与 source 共享的 GPU 引用，
 * source 的 Object3D 层级本身可被 GC，不需要（也不能）在这里再 dispose 一遍。
 * model/helper 在同一次去重集合内收集，共享资源恰好 dispose 一次。
 */
export function disposeDirectorModelResources(input: { model?: Object3D | null; helper?: Object3D | null; mixer?: AnimationMixer | null }) {
    disposeDirectorMixer(input.mixer, input.model);
    const geometries = new Set<{ dispose: () => void }>();
    const materials = new Set<DisposableMaterial>();
    collectObject3DResources(input.model, geometries, materials);
    collectObject3DResources(input.helper, geometries, materials);
    disposeCollected(geometries, materials);
}

/**
 * 采纳过程中途抛错时的精确清理，生产与测试共用。
 * 二选一，绝不 double-dispose：
 * - clone 已建成：它已持有与 source 共享的 GPU 引用，只释放 clone(+mixer)，source 交给 GC。
 * - clone 尚未建成：本次没有任何 owned 资源，只释放这份未被采纳的 source。
 */
export function disposeDirectorAdoptionFailure(input: { clone?: Object3D | null; mixer?: AnimationMixer | null; source?: Object3D | null }) {
    if (input.clone) {
        disposeDirectorModelResources({ model: input.clone, mixer: input.mixer });
        return;
    }
    disposeDirectorMixer(input.mixer, null);
    disposeDirectorObject3D(input.source);
}
