import { describe, expect, test } from "bun:test";

import { buildImageGenerationNodeTitle } from "@/lib/canvas/canvas-generation-title";
import { buildCanvasMediaDownloadFileName, canvasMediaFileExtension } from "@/lib/canvas/canvas-media-download";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function mediaNode(overrides: Partial<CanvasNodeData> = {}): CanvasNodeData {
    return {
        id: "image-1",
        type: CanvasNodeType.Image,
        title: "女明星角色三视图",
        position: { x: 0, y: 0 },
        width: 1024,
        height: 1024,
        metadata: { content: "data:image/png;base64,aW1hZ2U=", mimeType: "image/png", status: "success" },
        ...overrides,
    };
}

describe("canvas media download", () => {
    test("按画布名、节点名和本地日期生成文件名", () => {
        expect(buildCanvasMediaDownloadFileName("写给阿妈的情书", mediaNode(), new Date(2026, 7, 28, 12))).toBe("写给阿妈的情书_女明星角色三视图_20260828.png");
    });

    test("清理跨平台非法字符且保留中文可读名称", () => {
        const node = mediaNode({ title: "女明星/角色:三视图?" });
        expect(buildCanvasMediaDownloadFileName("写给阿妈的情书|终稿", node, new Date(2026, 7, 28, 12))).toBe("写给阿妈的情书_终稿_女明星_角色_三视图_20260828.png");
    });

    test("截断长名称后不会留下 Windows 不接受的结尾句点", () => {
        const node = mediaNode({ title: `${"a".repeat(79)}.extra` });
        expect(buildCanvasMediaDownloadFileName("画布", node, new Date(2026, 7, 28, 12))).toBe(`画布_${"a".repeat(79)}_20260828.png`);
    });

    test("优先按媒体 MIME 类型确定视频扩展名", () => {
        expect(canvasMediaFileExtension(mediaNode({ type: CanvasNodeType.Video, metadata: { content: "https://example.com/video", mimeType: "video/webm" } }))).toBe("webm");
        expect(canvasMediaFileExtension(mediaNode({ type: CanvasNodeType.Video, metadata: { content: "https://example.com/video", mimeType: "video/quicktime" } }))).toBe("mov");
    });

    test("MIME 类型不明确时从远程资源 URL 识别扩展名", () => {
        expect(canvasMediaFileExtension(mediaNode({ metadata: { content: "https://example.com/result.jpeg?token=hidden", mimeType: "image/*" } }))).toBe("jpg");
    });
});

describe("generated image title", () => {
    test("普通节点继续使用提示词摘要", () => {
        expect(buildImageGenerationNodeTitle("一座云层中的未来城市", mediaNode({ title: "原图" }))).toBe("一座云层中的未来城市");
    });

    test("快捷键复制节点生成后保留 copy 序号", () => {
        const source = mediaNode({ title: "未来城市_copy2", metadata: { copiedFromNodeId: "source" } });
        expect(buildImageGenerationNodeTitle("未来城市", source)).toBe("未来城市_copy2");
    });

    test("参数变体生成后保留版本字母", () => {
        const source = mediaNode({ title: "未来城市 · C", metadata: { versionOfNodeId: "source", versionLabel: "C" } });
        expect(buildImageGenerationNodeTitle("未来城市", source)).toBe("未来城市 · C");
    });

    test("复制变体和批量输出使用互不重复的标题", () => {
        const source = mediaNode({ title: "未来城市_copy1 · B", metadata: { copiedFromNodeId: "source", versionOfNodeId: "source", versionLabel: "B" } });
        expect([0, 1].map((index) => buildImageGenerationNodeTitle("未来城市", source, index, 2))).toEqual(["未来城市_copy1 · B · 1", "未来城市_copy1 · B · 2"]);
    });

    test("下载文件名继承 copy 和版本标识，不再互相重复", () => {
        const now = new Date(2026, 7, 29, 12);
        const copy = mediaNode({ title: buildImageGenerationNodeTitle("未来城市", mediaNode({ title: "未来城市_copy1", metadata: { copiedFromNodeId: "source" } })) });
        const variant = mediaNode({ title: buildImageGenerationNodeTitle("未来城市", mediaNode({ title: "未来城市 · C", metadata: { versionOfNodeId: "source", versionLabel: "C" } })) });
        expect(buildCanvasMediaDownloadFileName("自由画布", copy, now)).toBe("自由画布_未来城市_copy1_20260829.png");
        expect(buildCanvasMediaDownloadFileName("自由画布", variant, now)).toBe("自由画布_未来城市 · C_20260829.png");
    });
});
