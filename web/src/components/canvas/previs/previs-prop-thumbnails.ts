import { useEffect, useState } from "react";
import { ACESFilmicToneMapping, Color, DirectionalLight, HemisphereLight, Mesh, PerspectiveCamera, Scene, SRGBColorSpace, Vector3, WebGLRenderer } from "three";

import { PREVIS_PROP_CATALOG } from "@/lib/canvas/previs/previs-prop-catalog";
import { buildPrevisPropParts, defaultPrevisPropColor, previsPropMaterial, previsPropPartsBounds } from "@/lib/canvas/previs/previs-prop-geometry";

/**
 * 道具库缩略图：首次打开添加弹窗时用一个临时 WebGL 上下文把全部道具渲染成 PNG，
 * 结果在会话内缓存，渲染完立即释放上下文，不长期多占一个 GPU 上下文。
 */
let thumbnails: Map<string, string> | null = null;
let pending: Promise<Map<string, string>> | null = null;

function renderThumbnails(): Map<string, string> {
    const result = new Map<string, string>();
    const canvas = document.createElement("canvas");
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    try {
        renderer.setPixelRatio(1);
        renderer.setSize(176, 132, false);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = ACESFilmicToneMapping;
        renderer.setClearColor(new Color("#000000"), 0);
        const scene = new Scene();
        scene.add(new HemisphereLight("#ffffff", "#8a939c", 1.6));
        const sun = new DirectionalLight("#fff4e2", 2.4);
        sun.position.set(4, 8, 5);
        scene.add(sun);
        const camera = new PerspectiveCamera(28, 176 / 132, 0.05, 5000);
        for (const prop of PREVIS_PROP_CATALOG) {
            const parts = buildPrevisPropParts(prop.id, 0);
            const meshes = parts.map((part) => new Mesh(part.geometry, previsPropMaterial(part.key, defaultPrevisPropColor(prop.id))));
            meshes.forEach((mesh) => scene.add(mesh));
            const bounds = previsPropPartsBounds(parts);
            bounds.min.y = Math.max(bounds.min.y, 0);
            const center = bounds.getCenter(new Vector3());
            const radius = Math.max(0.3, bounds.getSize(new Vector3()).length() / 2);
            const direction = new Vector3(1, 0.75, 1.25).normalize();
            camera.position.copy(center).add(direction.multiplyScalar((radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.92));
            camera.lookAt(center);
            renderer.render(scene, camera);
            result.set(prop.id, canvas.toDataURL("image/png"));
            meshes.forEach((mesh) => scene.remove(mesh));
        }
    } finally {
        renderer.dispose();
        renderer.forceContextLoss();
    }
    return result;
}

export function usePrevisPropThumbnails(enabled: boolean) {
    const [value, setValue] = useState<Map<string, string> | null>(thumbnails);
    useEffect(() => {
        if (!enabled || thumbnails) return;
        let alive = true;
        pending ??= new Promise((resolve, reject) => {
            // 让弹窗先完成首帧，再做一次性渲染。
            window.setTimeout(() => {
                try {
                    thumbnails = renderThumbnails();
                    resolve(thumbnails);
                } catch (error) {
                    pending = null;
                    reject(error);
                }
            }, 60);
        });
        pending.then(
            (map) => alive && setValue(map),
            () => undefined,
        );
        return () => {
            alive = false;
        };
    }, [enabled]);
    return value;
}
