import { describe, expect, test } from "bun:test";
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshStandardMaterial, SkinnedMesh } from "three";

import { applyActorReferenceMaterial, updateActorReferenceColor } from "../src/components/canvas/previs/previs-viewport-rig";

describe("预演台角色参考材质", () => {
    test("自定义着色器应用骨骼蒙皮后的顶点与法线", () => {
        const geometry = new BufferGeometry();
        geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
        geometry.setAttribute("normal", new Float32BufferAttribute([0, 1, 0], 3));
        const mesh = new SkinnedMesh(geometry, new MeshStandardMaterial());

        applyActorReferenceMaterial(mesh, "#2f7de1");

        expect(mesh.material.vertexShader).toContain("#include <skinning_pars_vertex>");
        expect(mesh.material.vertexShader).toContain("#include <skinning_vertex>");
        expect(mesh.material.vertexShader).toContain("normalize(transformedNormal)");
        expect(mesh.material.vertexShader).toContain("vec4(transformed, 1.0)");
        expect(mesh.userData.previsActor).toBe(true);

        updateActorReferenceColor(mesh, "#ff0000");
        expect(mesh.material.uniforms.uBaseColor.value.getHexString()).toBe("ff0000");
    });

    test("普通网格也可使用参考材质", () => {
        const mesh = new Mesh(new BufferGeometry(), new MeshStandardMaterial());
        applyActorReferenceMaterial(mesh, "#2f7de1");

        expect(mesh.material.vertexShader).toContain("#include <skinning_vertex>");
    });
});
