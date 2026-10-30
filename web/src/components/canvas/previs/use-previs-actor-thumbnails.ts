import { useEffect, useState } from "react";
import { ACESFilmicToneMapping, CircleGeometry, DirectionalLight, HemisphereLight, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from "three";

import { buildPrevisActorFromTemplate, PREVIS_ACTOR_TEMPLATES } from "@/lib/canvas/previs/previs-add-catalog";
import { buildPrevisMannequin, loadPrevisMannequinTemplate, resolvePrevisMannequinProfile } from "@/lib/canvas/previs/previs-mannequin";
import { evaluatePrevisActorPose } from "@/lib/canvas/previs/previs-motion";

/**
 * 「添加角色」卡片缩略图：用视口同一套标准人偶、体型参数和姿势求值渲染真实模型。
 *
 * 所有模板共用一台固定机位，儿童、成人、怪物的身高差在缩略图里直接可比。
 * 渲染只在首次打开弹窗时做一次：短暂创建一个离屏 WebGL 上下文，出图后立即释放，
 * 结果按模板 id 缓存为 data URL。WebGL 不可用或模型加载失败时返回空表，卡片退回纯文字。
 */
// 3 倍于卡片显示尺寸（36×72），1:2 竖版贴合站立人形。
const THUMB_WIDTH = 108;
const THUMB_HEIGHT = 216;
const THUMB_COLOR = "#c3cad4";
// 可见高度 2.3m（带角怪物约 2.17m）：取景中心 1.08m，竖直视角 28°。
const THUMB_TARGET_Y = 1.08;
const THUMB_FOV = 28;
const THUMB_DISTANCE = 2.3 / (2 * Math.tan((THUMB_FOV * Math.PI) / 360));

const cache = new Map<string, string>();
let rendering: Promise<void> | null = null;

function snapshot() {
    return Object.fromEntries(cache);
}

async function renderPrevisActorThumbnails() {
    const missing = PREVIS_ACTOR_TEMPLATES.filter((template) => !cache.has(template.id));
    if (!missing.length) return;
    const template = await loadPrevisMannequinTemplate();
    const canvas = document.createElement("canvas");
    const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    const ground = new Mesh(new CircleGeometry(0.42, 32), new MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.22, depthWrite: false }));
    try {
        renderer.setPixelRatio(1);
        renderer.setSize(THUMB_WIDTH, THUMB_HEIGHT, false);
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.toneMapping = ACESFilmicToneMapping;
        const scene = new Scene();
        scene.add(new HemisphereLight("#ffffff", "#7d8794", 1.25));
        const key = new DirectionalLight("#ffffff", 1.9);
        key.position.set(2.5, 4, 3.5);
        scene.add(key);
        const rim = new DirectionalLight("#b9d4ff", 0.9);
        rim.position.set(-3, 2.5, -3);
        scene.add(rim);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = 0.002;
        scene.add(ground);
        const camera = new PerspectiveCamera(THUMB_FOV, THUMB_WIDTH / THUMB_HEIGHT, 0.1, 50);
        camera.position.set(0, THUMB_TARGET_Y + 0.1, THUMB_DISTANCE);
        camera.lookAt(0, THUMB_TARGET_Y, 0);
        const pose = evaluatePrevisActorPose({ pose: "stand", keyframes: [] }, 0);
        for (const item of missing) {
            const actor = buildPrevisActorFromTemplate(item, { index: 0, color: THUMB_COLOR });
            const profile = resolvePrevisMannequinProfile(actor.archetype || "adult", actor.actorProfile);
            const mannequin = buildPrevisMannequin({ template, archetype: actor.archetype, profile, color: THUMB_COLOR, castShadow: false, receiveShadow: false });
            try {
                mannequin.setColor(THUMB_COLOR, false);
                mannequin.applyPose(pose);
                // 略转 3/4 侧，肩宽和体厚都能看出来。
                mannequin.root.rotation.y = -0.38;
                scene.add(mannequin.root);
                renderer.render(scene, camera);
                cache.set(item.id, canvas.toDataURL("image/png"));
            } finally {
                scene.remove(mannequin.root);
                mannequin.dispose();
            }
        }
    } finally {
        ground.geometry.dispose();
        (ground.material as MeshBasicMaterial).dispose();
        renderer.dispose();
        renderer.forceContextLoss();
    }
}

/** 返回模板 id → 缩略图 data URL；渲染完成前为空表或部分表。 */
export function usePrevisActorThumbnails(enabled: boolean): Record<string, string> {
    const [thumbnails, setThumbnails] = useState<Record<string, string>>(snapshot);
    useEffect(() => {
        if (!enabled || cache.size >= PREVIS_ACTOR_TEMPLATES.length) {
            setThumbnails(snapshot());
            return;
        }
        let alive = true;
        rendering ??= renderPrevisActorThumbnails().finally(() => {
            rendering = null;
        });
        rendering.then(
            () => alive && setThumbnails(snapshot()),
            (error) => console.warn("角色缩略图渲染失败，卡片保留文字说明", error),
        );
        return () => {
            alive = false;
        };
    }, [enabled]);
    return thumbnails;
}
