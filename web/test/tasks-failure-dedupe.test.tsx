import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskGridCard } from "@/pages/tasks/task-grid-card";
import { TaskListRow } from "@/pages/tasks/task-list-row";
import { taskDistinctFailureDetail } from "@/pages/tasks/task-shared";

import type { GenerationTask } from "@/services/api/task-center";
import { defaultConfig } from "@/stores/use-config-store";

function makeTask(patch: Partial<GenerationTask> = {}): GenerationTask {
    return {
        id: "task-1",
        type: "video_text_to_video",
        status: "failed",
        prompt: "商品开箱 · 镜头推进（验收样本）",
        attempts: 1,
        createdAt: "2026-11-27T02:00:00.000Z",
        updatedAt: "2026-11-27T02:00:00.000Z",
        ...patch,
    };
}

describe("任务列表与网格显示失败原因", () => {
    test("无具体错误原因或错误文案仅重复状态名时，不再渲染第二行重复红字", () => {
        const bareFailed = makeTask({ status: "failed", stage: "failed", error: "" });
        expect(taskDistinctFailureDetail(bareFailed)).toBe("");

        const duplicateTextFailed = makeTask({ status: "failed", error: "失败" });
        expect(taskDistinctFailureDetail(duplicateTextFailed)).toBe("");

        const noStageFailed = makeTask({ status: "failed", stage: "", error: "" });
        expect(taskDistinctFailureDetail(noStageFailed)).toBe("");

        const plainCancelled = makeTask({ status: "cancelled" });
        expect(taskDistinctFailureDetail(plainCancelled)).toBe("");

        const rowHtml = renderToStaticMarkup(
            <TaskListRow task={bareFailed} canvasById={new Map()} projectNameById={new Map()} effectiveConfig={defaultConfig} creditsEnabled={false} actingId="" onOpen={() => {}} onRetry={() => {}} onPreview={() => {}} />,
        );
        expect(rowHtml).toContain("task-center-status");
        expect(rowHtml).not.toContain("task-center-row-error");
        expect(rowHtml.match(/失败/g)?.length).toBe(1);

        const cardHtml = renderToStaticMarkup(<TaskGridCard task={bareFailed} effectiveConfig={defaultConfig} actingId="" onOpen={() => {}} onRetry={() => {}} />);
        expect(cardHtml).toContain("task-center-status");
        expect(cardHtml).not.toContain("task-center-card-error");
        expect(cardHtml).toContain("task-center-card-meta");
    });

    test("有具体失败原因或媒体交付阶段异常时，仍保留可读的错误说明", () => {
        const detailedFailed = makeTask({ status: "failed", error: "余额不足，请充值" });
        expect(taskDistinctFailureDetail(detailedFailed)).toBe("余额不足，请充值");

        const rowHtml = renderToStaticMarkup(
            <TaskListRow task={detailedFailed} canvasById={new Map()} projectNameById={new Map()} effectiveConfig={defaultConfig} creditsEnabled={false} actingId="" onOpen={() => {}} onRetry={() => {}} onPreview={() => {}} />,
        );
        expect(rowHtml).toContain("task-center-row-error");
        expect(rowHtml).toContain("余额不足，请充值");

        const mediaFailed = makeTask({ status: "failed", mediaStage: "local_save" });
        expect(taskDistinctFailureDetail(mediaFailed)).toContain("保存文件失败");

        const backendSafeClassified = makeTask({ status: "failed", error: "模型服务暂时不可用，请稍后再试。" });
        expect(taskDistinctFailureDetail(backendSafeClassified)).toBe("模型服务暂时不可用，请稍后再试。");
        const classifiedRowHtml = renderToStaticMarkup(
            <TaskListRow task={backendSafeClassified} canvasById={new Map()} projectNameById={new Map()} effectiveConfig={defaultConfig} creditsEnabled={false} actingId="" onOpen={() => {}} onRetry={() => {}} onPreview={() => {}} />,
        );
        expect(classifiedRowHtml).toContain("task-center-row-error");
        expect(classifiedRowHtml).toContain("模型服务暂时不可用，请稍后再试。");
        const classifiedCardHtml = renderToStaticMarkup(<TaskGridCard task={backendSafeClassified} effectiveConfig={defaultConfig} actingId="" onOpen={() => {}} onRetry={() => {}} />);
        expect(classifiedCardHtml).toContain("task-center-card-error");
        expect(classifiedCardHtml).toContain("模型服务暂时不可用，请稍后再试。");

        const cancelRequested = makeTask({ status: "cancelled", providerCancelStatus: "requested" });
        expect(taskDistinctFailureDetail(cancelRequested)).toBeTruthy();
    });
});
