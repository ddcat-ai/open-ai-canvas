import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingContent } from "../src/components/canvas/canvas-node-status-content";
import { canvasThemes } from "../src/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

test("重生成保留旧视频时，任务状态面板仍有完整背景，不改变任务或媒体身份", () => {
    const node: CanvasNodeData = {
        id: "video-node",
        type: CanvasNodeType.Video,
        title: "视频",
        x: 0,
        y: 0,
        width: 400,
        height: 240,
        metadata: { status: "loading", taskId: "new-task", taskStatus: "succeeded", content: "/old-video.mp4", storageKey: "resource:old-video" },
    };
    const before = JSON.stringify(node);
    for (const theme of [canvasThemes.dark, canvasThemes.light]) {
        const html = renderToStaticMarkup(<LoadingContent node={node} theme={theme} />);
        expect(html).toContain(`background:${theme.node.fill}`);
        expect(html).toContain("h-full w-full");
        expect(html).toContain("rounded-[inherit]");
        expect(html).toContain("详情");
    }
    expect(JSON.stringify(node)).toBe(before);
});
