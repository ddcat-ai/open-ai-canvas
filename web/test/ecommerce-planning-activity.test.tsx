import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanningActivity } from "../src/pages/ecommerce/planning-activity";
import type { GenerationTask } from "../src/services/api/task-center";

function task(status: GenerationTask["status"], patch: Partial<GenerationTask> = {}): GenerationTask {
    return { id: "task", type: "canvas_text", status, prompt: "", attempts: 1, createdAt: "2026-11-09T06:25:25Z", updatedAt: "2026-11-09T06:25:25Z", ...patch };
}

function render(value?: GenerationTask, props: { references?: number; count?: number; automaticScreens?: boolean } = {}) {
    return renderToStaticMarkup(<PlanningActivity task={value} references={props.references ?? 3} count={props.count ?? 9} automaticScreens={props.automaticScreens} />);
}

describe("commerce planning activity", () => {
    test("without a task it reports reading the progress, not a model phase", () => {
        const markup = render();
        expect(markup).toContain("正在读取策划进度");
        expect(markup).not.toContain("正在提交策划资料");
        expect(markup).not.toContain("正在分析商品与构建方案");
        expect(markup).toContain("3 张参考图");
        expect(markup).toContain("9 张图片方案");
    });

    test("a queued task is reported as queued instead of active inference", () => {
        const markup = render(task("queued"));
        expect(markup).toContain("已排队，等待模型处理");
        expect(markup).toContain("等待模型处理");
        expect(markup).toContain("模型任务已排队");
        expect(markup).not.toContain("正在分析商品与构建方案");
    });

    test("a running task reports the cumulative server draft length, not a fabricated percentage", () => {
        const markup = render(task("running", { textDraft: "已收到十二个字的输出内容" }));
        expect(markup).toContain("正在分析商品与构建方案");
        expect(markup).toContain(`已收到 ${"已收到十二个字的输出内容".length} 字策划输出`);
        expect(markup).not.toMatch(/%/);
    });

    test("a finished task is shown as validation, before any plan becomes executable", () => {
        const markup = render(task("succeeded"));
        expect(markup).toContain("正在校验图片方案");
        expect(markup).toContain("校验结构与图片数量");
    });

    test("a finished task with a draft says the full plan is being validated", () => {
        const markup = render(task("succeeded", { textDraft: "完整策划" }));
        expect(markup).toContain("已收到 4 字策划输出，正在校验完整方案");
    });

    for (const status of ["failed", "cancelled"] as const) {
        test(`a ${status} task is never displayed as active analysis or success`, () => {
            const markup = render(task(status, { error: "上游暂时不可用", textDraft: "半截输出" }));
            expect(markup).toContain("策划任务已结束，正在整理结果");
            expect(markup).toContain("任务已结束");
            expect(markup).not.toContain("正在分析商品与构建方案");
            expect(markup).not.toContain("正在校验图片方案");
            expect(markup).not.toContain("校验结构与图片数量");
            expect(markup).not.toContain("已收到 3 字");
        });
    }

    test("an undetermined screen count is not rendered as a confirmed number", () => {
        const markup = render(undefined, { count: 9, automaticScreens: true });
        expect(markup).toContain("自动识别长图屏数");
        expect(markup).not.toContain("9 张图片方案");
    });

    test("invalid and future timestamps fall back to zero instead of negative or invented elapsed time", () => {
        const invalid = render(task("running", { createdAt: "not-a-date", startedAt: "also-bad" }));
        expect(invalid).toContain("0 秒");
        const future = render(task("running", { createdAt: new Date(Date.now() + 3_600_000).toISOString() }));
        expect(future).toContain("0 秒");
        expect(future).not.toMatch(/-\d+ 秒/);
    });

    test("elapsed time comes from the server timestamps", () => {
        const markup = render(task("running", { createdAt: new Date(Date.now() - 90_000).toISOString() }));
        expect(markup).toContain("1 分 30 秒");
    });

    test("an invalid start time falls back to a valid creation time before the mount time", () => {
        const markup = render(task("running", { createdAt: new Date(Date.now() - 90_000).toISOString(), startedAt: "also-bad" }));
        expect(markup).toContain("1 分 30 秒");
    });

    test("a finished task announces that it has ended instead of still running", () => {
        const markup = render(task("failed", { error: "上游失败" }));
        expect(markup).toContain('aria-label="Agent 策划已结束"');
        expect(markup).not.toContain('aria-busy="true"');
    });

    test("only the status line is a live region, so the ticking clock is not re-announced", () => {
        const markup = render(task("running", { textDraft: "输出" }));
        expect(markup.match(/role="status"/g)).toHaveLength(1);
        expect(markup).toMatch(/<strong role="status">[^<]*<\/strong>/);
        expect(markup).not.toContain("aria-live");
    });
});
