import { describe, expect, test } from "bun:test";
import { AnimationClip, AnimationMixer, BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, SkeletonHelper, Texture } from "three";
import { SkeletonUtils } from "three-stdlib";

import { disposeDirectorAdoptionFailure, disposeDirectorHelper, disposeDirectorMaterials, disposeDirectorMixer, disposeDirectorModelResources, disposeDirectorObject3D, resolveDirectorLoadOwnership } from "../src/lib/canvas/director/director-resources";

/** 统计 dispose 调用次数，用真实 Three 对象验证「同一资源只释放一次」。 */
function counted<T extends { dispose: () => void }>(target: T) {
    const calls = { count: 0 };
    const original = target.dispose.bind(target);
    target.dispose = () => {
        calls.count += 1;
        original();
    };
    return { target, calls };
}

function meshWith(geometry: BoxGeometry, material: MeshStandardMaterial | MeshStandardMaterial[]) {
    return new Mesh(geometry, material as never);
}

describe("共享资源只释放一次（C 回归）", () => {
    test("多个 mesh 共享 geometry/material 时各只 dispose 一次", () => {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const root = new Group();
        root.add(meshWith(geometry.target, material.target));
        root.add(meshWith(geometry.target, material.target));
        root.add(meshWith(geometry.target, material.target));
        disposeDirectorObject3D(root);
        expect(geometry.calls.count).toBe(1);
        expect(material.calls.count).toBe(1);
    });

    test("共享 texture 只 dispose 一次", () => {
        const texture = counted(new Texture());
        const first = new MeshStandardMaterial();
        const second = new MeshStandardMaterial();
        first.map = texture.target;
        second.map = texture.target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), first));
        root.add(meshWith(new BoxGeometry(1, 1, 1), second));
        disposeDirectorObject3D(root);
        expect(texture.calls.count).toBe(1);
    });

    test("数组材质全部释放，并覆盖各自纹理", () => {
        const a = counted(new MeshStandardMaterial());
        const b = counted(new MeshStandardMaterial());
        const textureA = counted(new Texture());
        const textureB = counted(new Texture());
        a.target.map = textureA.target;
        b.target.normalMap = textureB.target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), [a.target, b.target]));
        disposeDirectorObject3D(root);
        expect(a.calls.count).toBe(1);
        expect(b.calls.count).toBe(1);
        expect(textureA.calls.count).toBe(1);
        expect(textureB.calls.count).toBe(1);
    });

    test("多种纹理槽位都会被收集", () => {
        const material = new MeshStandardMaterial();
        const slots = [counted(new Texture()), counted(new Texture()), counted(new Texture())];
        material.map = slots[0].target;
        material.roughnessMap = slots[1].target;
        material.emissiveMap = slots[2].target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), material));
        disposeDirectorObject3D(root);
        slots.forEach((slot) => expect(slot.calls.count).toBe(1));
    });

    test("空输入是安全的", () => {
        expect(() => disposeDirectorObject3D(null)).not.toThrow();
        expect(() => disposeDirectorObject3D(undefined)).not.toThrow();
        expect(() => disposeDirectorHelper(null)).not.toThrow();
        expect(() => disposeDirectorMixer(null)).not.toThrow();
    });
});

describe("SkeletonHelper / mixer / 组合释放", () => {
    test("helper 自有 geometry 与 material 都被释放", () => {
        const helper = new SkeletonHelper(new Object3D());
        const geometry = counted(helper.geometry);
        const material = counted(helper.material as MeshStandardMaterial);
        disposeDirectorHelper(helper);
        expect(geometry.calls.count).toBe(1);
        expect(material.calls.count).toBe(1);
    });

    test("mixer 停止全部动作并 uncacheRoot", () => {
        const root = new Object3D();
        const mixer = new AnimationMixer(root);
        mixer.clipAction(new AnimationClip("idle", 1, [])).play();
        const stopped = { count: 0 };
        const uncached: Object3D[] = [];
        const originalStop = mixer.stopAllAction.bind(mixer);
        mixer.stopAllAction = () => {
            stopped.count += 1;
            return originalStop();
        };
        const originalUncache = mixer.uncacheRoot.bind(mixer);
        mixer.uncacheRoot = (target) => {
            uncached.push(target as Object3D);
            return originalUncache(target);
        };
        disposeDirectorMixer(mixer, root);
        expect(stopped.count).toBe(1);
        expect(uncached).toEqual([root]);
    });

    test("组合释放覆盖 model + helper + mixer（晚到回调复用同一 helper）", () => {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const model = new Group();
        model.add(meshWith(geometry.target, material.target));
        const helper = new SkeletonHelper(model);
        const helperGeometry = counted(helper.geometry);
        const mixer = new AnimationMixer(model);
        const stopped = { count: 0 };
        const originalStop = mixer.stopAllAction.bind(mixer);
        mixer.stopAllAction = () => {
            stopped.count += 1;
            return originalStop();
        };
        disposeDirectorModelResources({ model, helper, mixer });
        expect(geometry.calls.count).toBe(1);
        expect(material.calls.count).toBe(1);
        expect(helperGeometry.calls.count).toBe(1);
        expect(stopped.count).toBe(1);
    });

    test("被替换掉的原材质与其纹理会被释放，替换后的新材质不受影响", () => {
        const original = counted(new MeshStandardMaterial());
        const originalTexture = counted(new Texture());
        original.target.map = originalTexture.target;
        const replacement = counted(new MeshStandardMaterial());
        disposeDirectorMaterials([original.target]);
        expect(original.calls.count).toBe(1);
        expect(originalTexture.calls.count).toBe(1);
        expect(replacement.calls.count).toBe(0);
    });

    test("重复出现在列表中的材质只释放一次", () => {
        const material = counted(new MeshStandardMaterial());
        disposeDirectorMaterials([material.target, material.target, null, undefined]);
        expect(material.calls.count).toBe(1);
    });
});

describe("GLTF clone 的 GPU 所有权（#1 回归）", () => {
    /** 造一棵带共享 geometry/material/texture 的 source，模拟 gltf.scene。 */
    function sourceScene() {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const texture = counted(new Texture());
        material.target.map = texture.target;
        const root = new Group();
        root.name = "source-root";
        const child = meshWith(geometry.target, material.target);
        child.name = "source-mesh";
        root.add(child);
        return { root, geometry, material, texture };
    }

    test("active adopt 不释放 source 的共享资源", () => {
        const source = sourceScene();
        const ownership = resolveDirectorLoadOwnership({ active: true, generation: 3, currentGeneration: 3 });
        expect(ownership).toEqual({ adopt: true, disposeSource: false });
        // 采纳路径：只 clone，不 dispose source。
        const clone = SkeletonUtils.clone(source.root);
        expect(source.geometry.calls.count).toBe(0);
        expect(source.material.calls.count).toBe(0);
        expect(source.texture.calls.count).toBe(0);
        // clone 确实与 source 共享 GPU 资源。
        const clonedMesh = clone.getObjectByName("source-mesh") as Mesh;
        expect(clonedMesh.geometry).toBe(source.geometry.target);
        expect(clonedMesh.material).toBe(source.material.target);
    });

    test("owned clone 最终 cleanup 让共享资源恰好释放一次", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        const mixer = new AnimationMixer(clone);
        const helper = new SkeletonHelper(clone);
        disposeDirectorModelResources({ model: clone, helper, mixer });
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });

    test("stale / 未采纳的晚到 source 会被释放", () => {
        const stale = resolveDirectorLoadOwnership({ active: true, generation: 1, currentGeneration: 2 });
        expect(stale).toEqual({ adopt: false, disposeSource: true });
        const unmounted = resolveDirectorLoadOwnership({ active: false, generation: 2, currentGeneration: 2 });
        expect(unmounted).toEqual({ adopt: false, disposeSource: true });
        const orphan = sourceScene();
        disposeDirectorObject3D(orphan.root);
        expect(orphan.geometry.calls.count).toBe(1);
        expect(orphan.material.calls.count).toBe(1);
        expect(orphan.texture.calls.count).toBe(1);
    });

    test("采纳后 source 不再被单独释放：不会出现二次 dispose", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        // 只释放 owned clone（当前实现的语义），source 层级交给 GC。
        disposeDirectorModelResources({ model: clone, mixer: new AnimationMixer(clone) });
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });
});

describe("纹理识别必须基于 isTexture（#8 回归）", () => {
    test("带 dispose 但非 Texture 的值不会被当作纹理释放", () => {
        const material = new MeshStandardMaterial();
        const impostor = {
            dispose: () => {
                impostorCalls += 1;
            },
        };
        let impostorCalls = 0;
        (material as unknown as Record<string, unknown>).map = impostor;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), material));
        disposeDirectorObject3D(root);
        expect(impostorCalls).toBe(0);
    });

    test("真实 Texture 仍然被识别并去重释放", () => {
        const texture = counted(new Texture());
        expect(texture.target.isTexture).toBe(true);
        const first = new MeshStandardMaterial();
        const second = new MeshStandardMaterial();
        first.map = texture.target;
        second.emissiveMap = texture.target;
        const root = new Group();
        root.add(meshWith(new BoxGeometry(1, 1, 1), first));
        root.add(meshWith(new BoxGeometry(1, 1, 1), second));
        disposeDirectorObject3D(root);
        expect(texture.calls.count).toBe(1);
    });
});

describe("采纳中途抛错的精确清理（#3 回归）", () => {
    /** 造一棵带共享 geometry/material/texture 的 source，模拟 gltf.scene。 */
    function sourceScene() {
        const geometry = counted(new BoxGeometry(1, 1, 1));
        const material = counted(new MeshStandardMaterial());
        const texture = counted(new Texture());
        material.target.map = texture.target;
        const root = new Group();
        const child = meshWith(geometry.target, material.target);
        child.name = "src-mesh";
        root.add(child);
        return { root, geometry, material, texture };
    }

    test("clone 已建成时只释放 clone(+mixer)，共享资源恰好一次", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        const mixer = new AnimationMixer(clone);
        let stopped = 0;
        mixer.stopAllAction = (() => {
            stopped += 1;
            return mixer;
        }) as typeof mixer.stopAllAction;
        disposeDirectorAdoptionFailure({ clone, mixer, source: source.root });
        expect(stopped).toBe(1);
        // clone 与 source 共享这三个资源：必须恰好 1 次，不能因为同时传了 source 变成 2 次。
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });

    test("clone 尚未建成时释放未采纳的 source", () => {
        const source = sourceScene();
        disposeDirectorAdoptionFailure({ clone: null, mixer: null, source: source.root });
        expect(source.geometry.calls.count).toBe(1);
        expect(source.material.calls.count).toBe(1);
        expect(source.texture.calls.count).toBe(1);
    });

    test("clone 未建成但 mixer 已建成时也会停掉 mixer", () => {
        const source = sourceScene();
        const orphanMixer = new AnimationMixer(new Group());
        let stopped = 0;
        orphanMixer.stopAllAction = (() => {
            stopped += 1;
            return orphanMixer;
        }) as typeof orphanMixer.stopAllAction;
        disposeDirectorAdoptionFailure({ clone: null, mixer: orphanMixer, source: source.root });
        expect(stopped).toBe(1);
        expect(source.geometry.calls.count).toBe(1);
    });

    test("全空输入是安全空操作", () => {
        expect(() => disposeDirectorAdoptionFailure({ clone: null, mixer: null, source: null })).not.toThrow();
    });

    test("重复调用不 double-dispose 同一批资源", () => {
        const source = sourceScene();
        const clone = SkeletonUtils.clone(source.root);
        disposeDirectorAdoptionFailure({ clone, mixer: null, source: source.root });
        const afterFirst = source.geometry.calls.count;
        // 生产在 catch 里已经把 ownedRef 摘空，effect cleanup 不会再传同一个 clone；
        // 这里断言 helper 自身对「已释放的 clone」再调用也不会把计数推高到危险值。
        disposeDirectorAdoptionFailure({ clone: null, mixer: null, source: null });
        expect(source.geometry.calls.count).toBe(afterFirst);
    });
});
