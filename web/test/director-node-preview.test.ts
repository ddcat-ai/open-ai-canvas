import { describe, expect, test } from "bun:test";

import { gateDirectorPreviewFailure, resolveDirectorActiveShot, resolveDirectorPreviewSource, type DirectorNodeContentReader } from "../src/lib/canvas/director/director-preview";
import { createDirectorScene } from "../src/lib/canvas/director/director-scene";
import type { DirectorScene, DirectorShot } from "../src/types/director";

function scene(shots?: DirectorShot[]): DirectorScene {
    const base = createDirectorScene("镜头 1");
    return shots ? { ...base, shots, activeShotId: shots[0]?.id || base.activeShotId } : base;
}

/** 画布节点表；未登记的 id 视为已删除。 */
function reader(nodes: Record<string, string | undefined>): DirectorNodeContentReader {
    return (nodeId) => (nodeId ? nodes[nodeId] : undefined);
}

describe("预览来源优先级", () => {
    test("metadata preview 优先于 shot fallback", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "from-shot" };
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot,
            previewNodeId: "from-metadata",
            readNodeContent: reader({ "from-metadata": "data:image/png;base64,META", "from-shot": "data:image/png;base64,SHOT" }),
        });
        expect(source).toEqual({ kind: "image", url: "data:image/png;base64,META" });
    });

    test("metadata 缺失时回落到 shot.previewNodeId", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "from-shot" };
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot,
            previewNodeId: undefined,
            readNodeContent: reader({ "from-shot": "data:image/png;base64,SHOT" }),
        });
        expect(source).toEqual({ kind: "image", url: "data:image/png;base64,SHOT" });
    });

    test("metadata 指向的节点已删除时回落到 shot", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "from-shot" };
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot,
            previewNodeId: "deleted-node",
            readNodeContent: reader({ "from-shot": "data:image/png;base64,SHOT" }),
        });
        expect(source).toEqual({ kind: "image", url: "data:image/png;base64,SHOT" });
    });

    test("节点已删除且无 shot 预览时为空态，绝不产出 image", () => {
        const current = scene();
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot: current.shots[0],
            previewNodeId: "deleted-node",
            readNodeContent: reader({}),
        });
        expect(source).toEqual({ kind: "empty" });
    });

    test("空白/纯空格正文安全落空", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "blank-shot" };
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot,
                previewNodeId: "blank-meta",
                readNodeContent: reader({ "blank-meta": "", "blank-shot": "   \n\t " }),
            }),
        ).toEqual({ kind: "empty" });
    });

    test("首尾空白被剥离，URL 不会畸形地进入 <img src>", () => {
        const current = scene();
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot: current.shots[0],
                previewNodeId: "padded-meta",
                readNodeContent: reader({ "padded-meta": "  \n data:image/png;base64,PADDED \t " }),
            }),
        ).toEqual({ kind: "image", url: "data:image/png;base64,PADDED" });
    });

    test("shot 回落路径同样剥离首尾空白", () => {
        const current = scene();
        const shot = { ...current.shots[0], previewNodeId: "padded-shot" };
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot,
                previewNodeId: undefined,
                readNodeContent: reader({ "padded-shot": "\t https://cdn.example/preview.png \n" }),
            }),
        ).toEqual({ kind: "image", url: "https://cdn.example/preview.png" });
    });

    test("仅有空白的正文仍然落空，不因 trim 变成空字符串 URL", () => {
        const current = scene();
        const source = resolveDirectorPreviewSource({
            scene: current,
            shot: current.shots[0],
            previewNodeId: "ws-only",
            readNodeContent: reader({ "ws-only": "   \n\t\r  " }),
        });
        expect(source).toEqual({ kind: "empty" });
        expect(source).not.toHaveProperty("url");
    });

    test("scene 为 null 时是准备态而不是空态", () => {
        expect(resolveDirectorPreviewSource({ scene: null, shot: undefined, previewNodeId: undefined, readNodeContent: reader({}) })).toEqual({ kind: "loading" });
    });

    test("scene 为 null 但已有真实预览时仍优先显示图", () => {
        expect(
            resolveDirectorPreviewSource({
                scene: null,
                shot: undefined,
                previewNodeId: "from-metadata",
                readNodeContent: reader({ "from-metadata": "data:image/png;base64,META" }),
            }),
        ).toEqual({ kind: "image", url: "data:image/png;base64,META" });
    });

    test("有场景但从未回写构图时是诚实空态", () => {
        const current = scene();
        expect(resolveDirectorPreviewSource({ scene: current, shot: current.shots[0], previewNodeId: undefined, readNodeContent: reader({}) })).toEqual({ kind: "empty" });
    });

    test("Apply 写入 metadata 后由空态转为 image", () => {
        const current = scene();
        const before = resolveDirectorPreviewSource({ scene: current, shot: current.shots[0], previewNodeId: undefined, readNodeContent: reader({}) });
        expect(before).toEqual({ kind: "empty" });
        const after = resolveDirectorPreviewSource({
            scene: current,
            shot: current.shots[0],
            previewNodeId: "image-director-1",
            readNodeContent: reader({ "image-director-1": "data:image/png;base64,APPLIED" }),
        });
        expect(after).toEqual({ kind: "image", url: "data:image/png;base64,APPLIED" });
    });
});

describe("加载失败门控", () => {
    const image = { kind: "image", url: "data:image/png;base64,A" } as const;

    test("失败 URL 与当前 URL 一致时立即变空态", () => {
        expect(gateDirectorPreviewFailure(image, image.url)).toEqual({ kind: "empty" });
    });

    test("URL 变化后自动恢复，无需清理布尔标记", () => {
        expect(gateDirectorPreviewFailure({ kind: "image", url: "data:image/png;base64,B" }, image.url)).toEqual({ kind: "image", url: "data:image/png;base64,B" });
    });

    test("无失败记录时原样通过", () => {
        expect(gateDirectorPreviewFailure(image, null)).toBe(image);
    });

    test("非 image 来源不受门控影响", () => {
        expect(gateDirectorPreviewFailure({ kind: "loading" }, image.url)).toEqual({ kind: "loading" });
        expect(gateDirectorPreviewFailure({ kind: "empty" }, image.url)).toEqual({ kind: "empty" });
    });

    test("失败后 Apply 出新图仍能显示（同一次会话内）", () => {
        const next = resolveDirectorPreviewSource({
            scene: scene(),
            shot: undefined,
            previewNodeId: "n1",
            readNodeContent: reader({ n1: "data:image/png;base64,NEW" }),
        });
        expect(gateDirectorPreviewFailure(next, "data:image/png;base64,OLD")).toEqual({ kind: "image", url: "data:image/png;base64,NEW" });
    });
});

describe("当前镜头解析", () => {
    test("优先 metadata 指定的 shot", () => {
        const first = createDirectorScene("s").shots[0];
        const second: DirectorShot = { ...first, id: "shot-2", name: "镜头 2", previewNodeId: "p2" };
        const current = scene([first, second]);
        expect(resolveDirectorActiveShot(current, "shot-2")?.id).toBe("shot-2");
    });

    test("metadata 未指定或未命中时退回第一个 shot", () => {
        const current = scene();
        expect(resolveDirectorActiveShot(current, undefined)?.id).toBe(current.shots[0].id);
        expect(resolveDirectorActiveShot(current, "missing")?.id).toBe(current.shots[0].id);
    });

    test("scene 为 null 时没有镜头", () => {
        expect(resolveDirectorActiveShot(null, "shot-1")).toBeUndefined();
    });

    test("指定 shot 的 previewNodeId 参与回落，而不是第一个 shot 的", () => {
        const first = { ...createDirectorScene("s").shots[0], previewNodeId: "p1" };
        const second: DirectorShot = { ...first, id: "shot-2", previewNodeId: "p2" };
        const current = scene([first, second]);
        const shot = resolveDirectorActiveShot(current, "shot-2");
        expect(
            resolveDirectorPreviewSource({
                scene: current,
                shot,
                previewNodeId: undefined,
                readNodeContent: reader({ p1: "data:image/png;base64,ONE", p2: "data:image/png;base64,TWO" }),
            }),
        ).toEqual({ kind: "image", url: "data:image/png;base64,TWO" });
    });
});
