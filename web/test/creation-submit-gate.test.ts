import { readFileSync } from "node:fs";
import { expect, test } from "bun:test";

import { createCreationSubmitGate, createCreationSubmitGateRelease, withCreationSubmitGate } from "../src/pages/create/creation-submit-gate";
import { moduleGroupSource } from "./helpers/module-group-source";

test("creation submit gate rejects a second submit until the first submit releases it", () => {
    const gate = createCreationSubmitGate();

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.release();

    expect(gate.tryAcquire()).toBe(true);
});

test("普通创作提交闸门只允许一个异步任务，并在失败后释放", async () => {
    const gate = createCreationSubmitGate();
    let started = 0;
    let releaseTask!: () => void;
    const task = () => {
        started += 1;
        return new Promise<void>((resolve) => { releaseTask = resolve; });
    };

    const first = withCreationSubmitGate(gate, task);
    const second = await withCreationSubmitGate(gate, task);
    expect(second.accepted).toBe(false);
    expect(started).toBe(1);

    releaseTask();
    expect((await first).accepted).toBe(true);
    expect((await withCreationSubmitGate(gate, async () => undefined)).accepted).toBe(true);
});

test("普通任务交接后释放提交闸门，旧任务收尾不能解锁下一条任务", () => {
    const gate = createCreationSubmitGate();

    expect(gate.tryAcquire()).toBe(true);
    const releaseFirst = createCreationSubmitGateRelease(gate);
    releaseFirst();

    expect(gate.tryAcquire()).toBe(true);
    releaseFirst();
    expect(gate.tryAcquire()).toBe(false);

    const createPage = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");
    expect(createPage).toContain("const taskAccepted = task.status !== \"failed\" && task.status !== \"cancelled\" && !task.errorCode;");
    expect(createPage).toContain("if (taskAccepted) releaseSubmitGate();");
});

test("历史任务的 pending 状态不再把创作输入框显示成生成中", () => {
    const source = readFileSync(new URL("../src/pages/create/creation-workspace.tsx", import.meta.url), "utf8");

    expect(source).toContain("const showWorkingSpinner = interactionBusy;");
    expect(source).toContain("const showWorkingGlow = interactionBusy;");
    expect(source).not.toContain("props.generationActive && !canSubmit");
});

test("智能规划与计划内生成使用不同的提交闸门", () => {
    const createPage = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");

    expect(createPage).toContain("const smartPlanningGateRef = useRef(createCreationSubmitGate());");
    expect(createPage).toContain("withCreationSubmitGate(smartPlanningGateRef.current, submitSmartCreation)");
});

test("智能规划后的生图执行失败会回写到对话消息", () => {
    const createPage = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");

    expect(createPage).toContain("let executionStarted = false;");
    expect(createPage).toContain("executionStarted = true;");
    expect(createPage).toContain("if (!planningCompleted || executionStarted)");
});

test("智能任务的质量参数不把模型不认识的语义值直接送到计价路由", () => {
    const createPage = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");

    expect(createPage).toContain("generationOverride?.source === \"smart-creation-agent\"");
    expect(createPage).toContain("imageProfile.quality.default || \"auto\"");
});

test("智能套图一次性提交每个独立任务，不把多张附图合并成一个请求", () => {
    const createPage = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");

    expect(createPage).toContain("expandSmartCreationPlan(plan, smartCreationExecution)");
    expect(createPage).toContain("runSmartCreationSchedule(generationTasks");
    expect(createPage).toContain("queueSize: generationTasks.length");
    expect(createPage).toContain("imageCount: 1");
    expect(createPage).toContain("const settled = await Promise.allSettled(");
    expect(createPage).not.toContain("const groups = new Map<string, typeof tasks>();");
});

test("智能套图复用一个父消息聚合多个独立请求，普通多图仍走同一消息结果", () => {
    const createPage = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");
    const workspace = moduleGroupSource("pages/create/creation-workspace.tsx");
    const styles = readFileSync(new URL("../src/styles/globals.css", import.meta.url), "utf8");
    const types = readFileSync(new URL("../src/pages/create/creation-types.ts", import.meta.url), "utf8");

    expect(createPage).toContain("batchMessageId");
    expect(createPage).toContain("batchTotal: generationTasks.length");
    expect(createPage).toContain(".concat(batchAssistantMessage)");
    expect(createPage).toContain("generationOverride?.batchMessageId");
    expect(types).toContain("batchTotal?: number;");
    expect(types).toContain("batchCompletedCount?: number;");
    expect(workspace).toContain("creation-image-result-stack");
    expect(workspace).toContain("displayResultUrls.length > 1");
    expect(workspace).toContain("batchExpanded");
    expect(workspace).toContain("creation-image-result-grid-expanded");
    expect(workspace).toContain('batchExpanded ? "收起" : "展开"');
    expect(workspace).toContain("creation-image-result-stack-controls");
    expect(workspace).toContain("creation-image-result-grid is-single");
    expect(workspace).toContain("上一张生成图片");
    expect(workspace).toContain("下一张生成图片");
    expect(workspace).toContain("展开预览");
    expect(workspace).toContain("(current + direction + displayResultUrls.length) % displayResultUrls.length");
    expect(workspace).toContain("creation-image-batch-preview-viewer");
    expect(workspace).toContain("creation-image-batch-preview-thumbs");
    expect(styles).toContain(".creation-home .creation-image-result-stack { width: min(360px, 100%); height: 360px; }");
    expect(styles).toContain("margin-bottom: 24px; overflow: visible");
    expect(styles).toContain(".creation-home .creation-image-result-grid.is-single .creation-image-result { width: 360px; height: 360px;");
});

test("智能套图执行不重复追加用户提示词，只追加结果父消息", () => {
    const createPage = readFileSync(new URL("../src/pages/create/index.tsx", import.meta.url), "utf8");
    const conversations = readFileSync(new URL("../src/pages/create/creation-conversations.ts", import.meta.url), "utf8");

    expect(createPage).toContain("parentUserMessageId?: string");
    expect(createPage).toContain("const nextMessages = parentUserMessageId");
    expect(createPage).toContain("messages: nextMessages");
    expect(createPage).toContain("executeSmartCreationPlan(plan, requestAttachments, text, planningUserMessage.id)");
    expect(conversations).toContain("message.batchTotal || task?.clientContext?.batchCount || message.taskIds.length");
    expect(conversations).toContain("messages.slice(0, messageIndex).reverse().find((candidate) => candidate.role === \"user\")");
    expect(createPage).toContain(".slice(0, index).reverse().find((message) => message.role === \"user\")");
});
