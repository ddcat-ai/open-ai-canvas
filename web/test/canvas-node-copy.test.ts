import { describe, expect, test } from "bun:test";

import { isolateCopiedNodeMetadata, nextCopiedNodeTitle } from "@/lib/canvas/canvas-node-copy";
import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

describe("canvas node copy title", () => {
    test("首次复制使用 copy1，后续按已有最大序号递增", () => {
        expect(nextCopiedNodeTitle("女明星角色三视图", ["女明星角色三视图"])).toBe("女明星角色三视图_copy1");
        expect(nextCopiedNodeTitle("女明星角色三视图", ["女明星角色三视图", "女明星角色三视图_copy1"])).toBe("女明星角色三视图_copy2");
        expect(nextCopiedNodeTitle("女明星角色三视图", ["女明星角色三视图_copy1", "女明星角色三视图_copy3"])).toBe("女明星角色三视图_copy4");
    });

    test("复制已有副本时仍使用原始名称计算下一序号", () => {
        expect(nextCopiedNodeTitle("女明星角色三视图_copy1", ["女明星角色三视图", "女明星角色三视图_copy1"])).toBe("女明星角色三视图_copy2");
    });

    test("兼容旧版空格 Copy 后缀", () => {
        expect(nextCopiedNodeTitle("女明星角色三视图 Copy", ["女明星角色三视图", "女明星角色三视图 Copy"])).toBe("女明星角色三视图_copy1");
    });

    test("同一批粘贴可以通过预留标题连续分配序号", () => {
        const titles = new Set(["节点", "节点_copy1"]);
        const first = nextCopiedNodeTitle("节点", titles);
        titles.add(first);
        const second = nextCopiedNodeTitle("节点", titles);
        expect([first, second]).toEqual(["节点_copy2", "节点_copy3"]);
    });
});

describe("canvas generation copy metadata", () => {
    test("媒体副本保留提示词与参考字段，并明确原地回填生成结果", () => {
        const source: CanvasNodeData = {
            id: "source",
            type: CanvasNodeType.Video,
            title: "镜头",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: {
                content: "video-url",
                prompt: "相同提示词",
                videoStartFrameNodeId: "reference-start",
                videoEndFrameNodeId: "reference-end",
                generationResultPlacement: "new-version",
            },
        };

        const metadata = isolateCopiedNodeMetadata(source, new Map([[source.id, "copy"]]));

        expect(metadata.prompt).toBe("相同提示词");
        expect(metadata.videoStartFrameNodeId).toBe("reference-start");
        expect(metadata.videoEndFrameNodeId).toBe("reference-end");
        expect(metadata.copiedFromNodeId).toBe("source");
        expect(metadata.generationResultPlacement).toBe("replace-node");
    });

    test("复制到副本的入边继续解析为同一张参考图", () => {
        const reference: CanvasNodeData = {
            id: "reference",
            type: CanvasNodeType.Image,
            title: "角色参考",
            position: { x: 0, y: 0 },
            width: 340,
            height: 240,
            metadata: { content: "reference-url", mimeType: "image/png" },
        };
        const copy: CanvasNodeData = {
            id: "copy",
            type: CanvasNodeType.Image,
            title: "结果_copy1",
            position: { x: 400, y: 0 },
            width: 340,
            height: 240,
            metadata: { content: "old-result", prompt: "保持角色一致", copiedFromNodeId: "source", generationResultPlacement: "replace-node" },
        };

        const context = buildNodeGenerationContext(copy.id, [reference, copy], [{ id: "copy-reference", fromNodeId: reference.id, toNodeId: copy.id }], copy.metadata!.prompt!, []);

        expect(context.prompt).toBe("保持角色一致");
        expect(context.referenceImages.map((image) => image.id)).toEqual([reference.id]);
    });
});
