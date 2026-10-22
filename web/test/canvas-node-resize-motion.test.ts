import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { createCanvasNodeResizeMotion } from "../src/lib/canvas/canvas-node-resize-motion";
import { applyNodeConfigPatch } from "../src/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

function image(): CanvasNodeData {
    return { id: "image", type: CanvasNodeType.Image, title: "图片", position: { x: 100, y: 200 }, width: 520, height: 520, metadata: { size: "1:1" } };
}

function setup() {
    const animations: Array<{ update: (progress: number) => void; complete: () => void; stopped: boolean }> = [];
    const motion = createCanvasNodeResizeMotion((update, complete) => {
        const animation = { update, complete, stopped: false };
        animations.push(animation);
        return () => {
            animation.stopped = true;
        };
    });
    return { motion, animations };
}

describe("画布比例切换的临时几何", () => {
    test("位置与宽高共享进度、保持中心，业务数据始终只有最终值", () => {
        const { motion, animations } = setup();
        const before = image();
        const after = applyNodeConfigPatch(before, { size: "16:9" });
        const persisted = JSON.stringify(after);
        motion.sync([before], true);
        expect(animations).toHaveLength(0);
        motion.sync([after], true);
        expect(motion.resolveNode(after).width).toBe(before.width);
        animations[0].update(0.5);
        const displayed = motion.resolveNode(after);
        expect(displayed.width).toBe((before.width + after.width) / 2);
        expect(displayed.height).toBe((before.height + after.height) / 2);
        expect(displayed.position.x + displayed.width / 2).toBe(before.position.x + before.width / 2);
        expect(displayed.position.y + displayed.height / 2).toBe(before.position.y + before.height / 2);
        expect(JSON.stringify(after)).toBe(persisted);
        animations[0].complete();
        expect(motion.resolveNode(after)).toBe(after);
    });

    test("快速往返切换从当前显示值接续，旧回调不能覆盖新目标", () => {
        const { motion, animations } = setup();
        const before = image();
        const landscape = applyNodeConfigPatch(before, { size: "16:9" });
        const portrait = applyNodeConfigPatch(landscape, { size: "9:16" });
        motion.sync([before], true);
        motion.sync([landscape], true);
        animations[0].update(0.4);
        const current = motion.getGeometry(before.id);
        motion.sync([portrait], true);
        expect(animations[0].stopped).toBe(true);
        expect(motion.getGeometry(before.id)).toEqual(current);
        animations[0].update(0.9);
        animations[0].complete();
        expect(motion.getGeometry(before.id)).toEqual(current);
        animations[1].complete();
        expect(motion.resolveNode(portrait)).toBe(portrait);
    });

    test("拖拽接管或手动拉伸立即落到真实几何，不播放追赶动画", () => {
        const { motion, animations } = setup();
        const before = image();
        const after = applyNodeConfigPatch(before, { size: "16:9" });
        motion.sync([before], true);
        motion.sync([after], true);
        animations[0].update(0.2);
        motion.finishAll();
        expect(motion.resolveNode(after)).toBe(after);
        animations[0].update(0.8);
        expect(motion.getGeometry(before.id)).toBeUndefined();
        const resized = { ...after, width: 800, position: { x: 250, y: 200 }, metadata: { ...after.metadata, manualSize: true } };
        motion.sync([resized], true);
        expect(animations).toHaveLength(1);
        expect(motion.resolveNode(resized)).toBe(resized);
    });

    test("动画中收到手动几何更新会终止动画；普通 metadata 更新不重启", () => {
        const { motion, animations } = setup();
        const before = image();
        const after = applyNodeConfigPatch(before, { size: "16:9" });
        motion.sync([before], true);
        motion.sync([after], true);
        const renamed = { ...after, title: "新名称" };
        motion.sync([renamed], true);
        expect(animations).toHaveLength(1);
        expect(motion.resolveNode(renamed).title).toBe("新名称");
        motion.sync([{ ...renamed, width: 800 }], true);
        expect(animations[0].stopped).toBe(true);
        expect(motion.getGeometry(before.id)).toBeUndefined();
    });

    test("减少动态效果、节点卸载和项目重置会取消过渡", () => {
        for (const action of ["disable", "unmount", "reset"] as const) {
            const { motion, animations } = setup();
            const before = image();
            const after = applyNodeConfigPatch(before, { size: "9:16" });
            motion.sync([before], true);
            motion.sync([after], true);
            if (action === "reset") motion.reset();
            else motion.sync(action === "unmount" ? [] : [after], action !== "disable");
            expect(animations[0].stopped).toBe(true);
            expect(motion.getGeometry(before.id)).toBeUndefined();
            animations[0].update(0.5);
            expect(motion.getGeometry(before.id)).toBeUndefined();
        }
    });

    test("图片与视频空节点可过渡，已有媒体、锁定、手动尺寸和无效几何跳过", () => {
        for (const patch of [
            {},
            { type: CanvasNodeType.Video },
            { metadata: { size: "1:1", content: "image.png" } },
            { metadata: { size: "1:1", manualSize: true } },
            { metadata: { size: "1:1", locked: true } },
            { metadata: { size: "1:1", freeResize: true } },
            { width: Number.NaN },
            { type: CanvasNodeType.Text },
        ]) {
            const { motion, animations } = setup();
            const before = { ...image(), ...patch } as CanvasNodeData;
            const after = { ...before, width: 600, metadata: { ...before.metadata, size: "16:9" } };
            motion.sync([before], true);
            motion.sync([after], true);
            expect(animations.length).toBe(Object.keys(patch).length === 0 || patch.type === CanvasNodeType.Video ? 1 : 0);
        }
    });

    test("媒体回填或锁定在几何不变时也会结束未完成的动画", () => {
        for (const metadata of [{ content: "image.png" }, { locked: true }, { manualSize: true }]) {
            const { motion, animations } = setup();
            const before = image();
            const after = applyNodeConfigPatch(before, { size: "16:9" });
            motion.sync([before], true);
            motion.sync([after], true);
            motion.sync([{ ...after, metadata: { ...after.metadata, ...metadata } }], true);
            expect(animations[0].stopped).toBe(true);
            expect(motion.getGeometry(before.id)).toBeUndefined();
        }
    });

    test("每帧只通知相关节点，取消订阅后不再收到更新", () => {
        const { motion, animations } = setup();
        let affected = 0;
        let other = 0;
        let frames = 0;
        const unsubscribe = motion.subscribeNode("image", () => affected++);
        motion.subscribeNode("other", () => other++);
        motion.subscribe(() => frames++);
        const before = image();
        motion.sync([before], true);
        motion.sync([applyNodeConfigPatch(before, { size: "16:9" })], true);
        animations[0].update(0.5);
        expect(affected).toBe(2);
        expect(other).toBe(0);
        expect(frames).toBe(2);
        unsubscribe();
        animations[0].complete();
        expect(affected).toBe(2);
    });
});

test("真实节点、连线路径、连续切换和动效偏好共享显示几何", () => {
    const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-node-resize-motion.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
    const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
    expect(output).toContain("0 fail");
    expect(result.exitCode, output).toBe(0);
});
