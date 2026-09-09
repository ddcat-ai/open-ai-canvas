import { describe, expect, test } from "bun:test";
import { Line, LineBasicMaterial, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Scene, ShaderMaterial, type Material } from "three";

import { applyClaySceneMaterials } from "../src/lib/canvas/director/director-clay-materials";

const geometry = new PlaneGeometry(1, 1);

describe("导演台白膜材质切换", () => {
    test("标准材质 mesh 换成 clay，恢复后还原为原材质", () => {
        const scene = new Scene();
        const original = new MeshStandardMaterial({ color: "#ff0000" });
        const mesh = new Mesh(geometry, original);
        scene.add(mesh);
        const restore = applyClaySceneMaterials(scene);
        expect(mesh.material).not.toBe(original);
        expect(mesh.material).toBeInstanceOf(MeshStandardMaterial);
        restore();
        expect(mesh.material).toBe(original);
    });

    test("带 uniforms 的 shader 材质保持原样（Grid 逐帧崩溃回归）", () => {
        const scene = new Scene();
        const shader = new ShaderMaterial({ uniforms: { worldCamProjPosition: { value: null } } });
        const grid = new Mesh(geometry, shader);
        scene.add(grid);
        const restore = applyClaySceneMaterials(scene);
        expect(grid.material).toBe(shader);
        restore();
        expect(grid.material).toBe(shader);
    });

    test("directorActor mesh 与非 Mesh 对象不受影响", () => {
        const scene = new Scene();
        const actorMaterial = new MeshBasicMaterial();
        const actor = new Mesh(geometry, actorMaterial);
        actor.userData.directorActor = true;
        const line = new Line(geometry, new LineBasicMaterial());
        scene.add(actor, line);
        const restore = applyClaySceneMaterials(scene);
        expect(actor.material).toBe(actorMaterial);
        expect(line.material).toBeInstanceOf(LineBasicMaterial);
        restore();
        expect(actor.material).toBe(actorMaterial);
    });

    test("材质数组混入 uniforms 材质时整组跳过", () => {
        const scene = new Scene();
        const materials: Material[] = [new MeshStandardMaterial(), new ShaderMaterial({ uniforms: {} })];
        const mesh = new Mesh(geometry, materials);
        scene.add(mesh);
        const restore = applyClaySceneMaterials(scene);
        expect(mesh.material).toBe(materials);
        restore();
        expect(mesh.material).toBe(materials);
    });
});
