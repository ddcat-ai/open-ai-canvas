import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasNode } from "../src/components/canvas/canvas-node";
import { canvasNodeCanResyncTask } from "../src/lib/canvas/canvas-task-state";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const noop = () => {};
const createdAt = new Date(Date.now() - 103_000).toISOString();

function renderNode(metadata: CanvasNodeData["metadata"], type: CanvasNodeData["type"] = CanvasNodeType.Image) {
    return renderToStaticMarkup(
        <CanvasNode
            data={{ id: "node", type, title: "去掉水印", position: { x: 0, y: 0 }, width: 240, height: 420, metadata }}
            scale={1}
            isSelected={false}
            isRelated={false}
            isFocusRelated={false}
            isConnectionTarget={false}
            showImageInfo={false}
            onMouseDown={noop}
            onHoverStart={noop}
            onHoverEnd={noop}
            onConnectStart={noop}
            onResize={noop}
            onContentChange={noop}
            onContextMenu={noop}
            onOpenTaskDetails={noop}
            onRetry={noop}
            onReloadResource={noop}
        />,
    );
}

const occurrences = (markup: string, text: string) => markup.split(text).length - 1;

describe("画布节点生成中", () => {
    test("保存阶段只说一次正在保存，不再重复后端阶段原文，也不叠加“生成中”徽章", () => {
        const markup = renderNode({ status: "loading", taskId: "3897c08303cb-task", taskStatus: "running", taskStage: "作品已生成，正在保存", taskMediaStage: "upload", taskCreatedAt: createdAt });
        expect(markup).toContain('data-phase="saving"');
        expect(occurrences(markup, "正在保存图片")).toBe(1);
        expect(markup).not.toContain("作品已生成，正在保存");
        expect(markup).not.toContain("生成中");
        expect(markup).not.toContain("canvas-node-status-chip");
        expect(markup).toContain("已用时 1分");
        expect(markup).toContain("查看详情");
        // 保存是三段进度的最后一段：排队与生成已完成。
        expect(markup).toMatch(/data-state="done"[\s\S]*data-state="done"[\s\S]*data-state="active"/);
    });

    test("保存失败后自动重试时如实显示，不再显示成正常保存", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "作品已生成，保存遇到问题，正在自动恢复", taskMediaStage: "download", taskCreatedAt: createdAt });
        expect(markup).toContain('data-saving="retrying"');
        expect(markup).toContain("保存遇到问题，正在重试");
        expect(markup).toContain("不会重新生成");
        expect(markup).not.toContain("正在存入素材库");
    });

    test("排队、提交和供应商英文阶段都翻译成用户能懂的阶段", () => {
        const queued = renderNode({ status: "loading", taskId: "task", taskStatus: "queued", taskStage: "等待队列调度", taskCreatedAt: createdAt });
        expect(queued).toContain("排队中");
        expect(queued).toContain("轮到后自动开始");

        const submitting = renderNode({ status: "loading", taskStage: "正在准备生成任务", taskCreatedAt: createdAt });
        expect(submitting).toContain("正在提交");
        expect(submitting).not.toContain("正在准备生成任务");
        expect(submitting).not.toContain("查看详情");

        const provider = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "provider_processing", taskCreatedAt: createdAt });
        expect(provider).toContain("正在生成图片");
        expect(provider).not.toContain("provider_processing");
    });

    test("恢复监听留下的诊断在生成中节点上可见", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "上游生成中", taskCreatedAt: createdAt, errorDetails: "任务恢复暂不可用，请到任务中心核对。" });
        expect(markup).toContain("canvas-gen-diagnostic");
        expect(markup).toContain("任务恢复暂不可用，请到任务中心核对。");
    });

    test("视频有真实进度时显示百分比并提示离开页面也会继续", () => {
        const markup = renderNode({ status: "loading", taskId: "task", taskStatus: "running", taskStage: "上游生成中", taskProgress: 42, taskCreatedAt: createdAt }, CanvasNodeType.Video);
        expect(markup).toContain("正在生成视频");
        expect(markup).toContain("42%");
        expect(markup).toContain("离开页面也会继续生成");
        expect(markup).toContain('data-determinate="true"');
    });
});

describe("画布节点失败态按下一步动作分类", () => {
    test("轮询中断时任务仍在跑：只建议重新获取，不把等待中断说成生成失败", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "running", errorDetails: "网络异常。" });
        expect(markup).toContain("状态同步中断");
        expect(markup).toContain("重新获取");
        expect(markup).toContain("重新生成");
        expect(markup).not.toContain("生成失败");
    });

    test("结果已生成但回写失败：提示作品已生成，可重新获取", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "succeeded", resourceReloadAvailable: true, errorDetails: "结果已生成，应用结果失败：资源读取失败（503）" });
        expect(markup).toContain("作品载入失败");
        expect(markup).toContain("重新获取");
    });

    test("作品已生成但保存失败：重新保存，不重新生成", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "failed", taskMediaStage: "upload", taskCanRecoverMedia: true, errorDetails: "作品已生成，但保存未完成：上传 OSS" });
        expect(markup).toContain("作品保存未完成");
        expect(markup).toContain("重新保存");
        expect(markup).not.toContain("重新获取");
    });

    test("后端确认失败才建议重新生成", () => {
        const markup = renderNode({ status: "error", taskId: "task", taskStatus: "failed", errorDetails: "模型服务处理失败，请稍后重试或换用其他模型。" });
        expect(markup).toContain("生成失败");
        expect(markup).toContain("重新生成");
        expect(markup).not.toContain("重新获取");
    });

    test("可重新获取的判定只认后端没确认失败的任务", () => {
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "running" })).toBe(true);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "queued" })).toBe(true);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "succeeded", resourceReloadAvailable: true })).toBe(true);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "succeeded" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "failed" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskStatus: "running" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "running", taskStage: "submission_unknown" })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "error", taskId: "task", taskStatus: "running", isBatchRoot: true })).toBe(false);
        expect(canvasNodeCanResyncTask({ status: "loading", taskId: "task", taskStatus: "running" })).toBe(false);
    });
});

describe("画布节点完成反馈", () => {
    test("刷新或重新挂载的已完成节点不重放完成徽章和出现动画", () => {
        const markup = renderNode({ status: "success", taskId: "task", taskStatus: "succeeded", content: "/image.png", storageKey: "resource:image" });
        expect(markup).not.toContain("canvas-node-status-chip");
        expect(markup).not.toContain("已完成");
        expect(markup).not.toContain("data-generation-reveal");
    });

    test("真实 DOM：生成中转为完成只播放一次完成反馈，窗口结束后自行撤掉", () => {
        const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-node-generation-reveal.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 15000 });
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(output).toContain("0 fail");
        expect(result.exitCode, output).toBe(0);
    });
});
