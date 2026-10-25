import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LoadingContent, ErrorContent } from "@/components/canvas/canvas-node-status-content";
import { canvasThemes } from "@/lib/canvas-theme";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node: CanvasNodeData = {
    id: "saving",
    type: CanvasNodeType.Image,
    position: { x: 0, y: 0 },
    width: 200,
    height: 200,
    metadata: { status: "loading", taskId: "task", taskStatus: "running", taskMediaStage: "upload", taskCreatedAt: "2020-01-01T00:00:00Z", storageKey: "task-source:task", content: "/api/tasks/task/source-image" },
};

test("已出图的保存阶段显示图片且不继续显示生成耗时", () => {
    const html = renderToStaticMarkup(<LoadingContent node={node} theme={canvasThemes.dark} />);
    expect(html).toContain("/api/tasks/task/source-image");
    expect(html).toContain("作品已生成，正在保存");
    expect(html).not.toContain("时");
});

test("保存失败仍保留图片与原任务保存重试入口", () => {
    const failed = { ...node, metadata: { ...node.metadata, status: "error" as const, taskStatus: "failed", taskCanRecoverMedia: true, errorDetails: "账号容量不足" } };
    const html = renderToStaticMarkup(<ErrorContent node={failed} theme={canvasThemes.light} />);
    expect(html).toContain("/api/tasks/task/source-image");
    expect(html).toContain("重试保存（不重新生成）");
    expect(html).toContain("账号容量不足");
});
