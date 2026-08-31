import { describe, expect, test } from "bun:test";

import { canvasLayoutLane, layoutCanvasAuto, layoutCanvasFlow, layoutCanvasNodesByMediaType } from "@/lib/canvas/canvas-layout";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function node(id: string, type: CanvasNodeType, width = 320, height = 180, locked = false): CanvasNodeData {
    return { id, type, title: id, position: { x: 100, y: 100 }, width, height, metadata: locked ? { locked: true } : undefined };
}

describe("canvas media-aware layout", () => {
    test("无连线时按文本、图片、视频、音频分成纵向泳道", () => {
        const text = node("text", CanvasNodeType.Text, 300, 120);
        const image = node("image", CanvasNodeType.Image, 420, 260);
        const video = node("video", CanvasNodeType.Video, 500, 280);
        const audio = node("audio", CanvasNodeType.Audio, 360, 100);
        const positions = layoutCanvasNodesByMediaType([video, text, audio, image]);

        expect(positions.get("text")!.y).toBeLessThan(positions.get("image")!.y);
        expect(positions.get("image")!.y).toBeLessThan(positions.get("video")!.y);
        expect(positions.get("video")!.y).toBeLessThan(positions.get("audio")!.y);
        expect(positions.get("image")!.y).toBeGreaterThanOrEqual(positions.get("text")!.y + text.height);
    });

    test("有连线时保持从左到右的拓扑层，同时分离媒体泳道", () => {
        const text = node("text", CanvasNodeType.Text);
        const image = node("image", CanvasNodeType.Image);
        const video = node("video", CanvasNodeType.Video);
        const connections: CanvasConnection[] = [
            { id: "a", fromNodeId: text.id, toNodeId: image.id },
            { id: "b", fromNodeId: image.id, toNodeId: video.id },
        ];
        const positions = layoutCanvasFlow([video, image, text], connections);

        expect(positions.get("text")!.x).toBeLessThan(positions.get("image")!.x);
        expect(positions.get("image")!.x).toBeLessThan(positions.get("video")!.x);
        expect(positions.get("text")!.y).toBeLessThan(positions.get("image")!.y);
        expect(positions.get("image")!.y).toBeLessThan(positions.get("video")!.y);
    });

    test("同一拓扑层和媒体泳道中的不同尺寸节点不会重叠", () => {
        const first = node("first", CanvasNodeType.Image, 420, 300);
        const second = node("second", CanvasNodeType.Image, 240, 120);
        const positions = layoutCanvasFlow([first, second], []);

        expect(positions.get("second")!.y).toBeGreaterThanOrEqual(positions.get("first")!.y + first.height);
    });

    test("自动整理只返回可移动节点，并忽略选区外连接", () => {
        const image = node("image", CanvasNodeType.Image);
        const video = node("video", CanvasNodeType.Video);
        const locked = node("locked", CanvasNodeType.Image, 320, 180, true);
        const frame = node("frame", CanvasNodeType.Frame);
        const positions = layoutCanvasAuto([image, video, locked, frame], [{ id: "external", fromNodeId: image.id, toNodeId: "outside" }]);

        expect([...positions.keys()].sort()).toEqual(["image", "video"]);
        expect(positions.get("image")!.y).toBeLessThan(positions.get("video")!.y);
    });

    test("节点类型映射为稳定的四类泳道", () => {
        expect(canvasLayoutLane(node("script", CanvasNodeType.Script))).toBe("text");
        expect(canvasLayoutLane(node("drawing", CanvasNodeType.Drawing))).toBe("image");
        expect(canvasLayoutLane(node("video", CanvasNodeType.Video))).toBe("video");
        expect(canvasLayoutLane(node("audio", CanvasNodeType.Audio))).toBe("audio");
    });
});
