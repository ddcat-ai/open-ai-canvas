import assert from "node:assert/strict";
import test from "node:test";

import {
    AGENT_MANIFESTS,
    buildRunPlan,
    createSemanticEvent,
    executeReadOnlySteps,
    formatReadOnlyExecution,
    formatRunPlan,
    readyRunSteps,
    validateRunPlan,
} from "../src/agent-orchestration.js";

test("根据请求生成声明式协作计划，并保持计划不携带原文", () => {
    const prompt = "请根据小说整理角色人设、分镜并生成视频";
    const plan = buildRunPlan({ prompt, canvasId: "canvas-1", projectId: "project-1", runId: "run-test", now: "2026-09-04T00:00:00.000Z" });

    assert.equal(plan.runId, "run-test");
    assert.equal(plan.canvasId, "canvas-1");
    assert.equal(plan.projectId, "project-1");
    assert.equal(plan.createdAt, "2026-09-04T00:00:00.000Z");
    assert.deepEqual(plan.steps.map((step) => step.agentId), ["director", "script", "art", "storyboard", "generation"]);
    assert.deepEqual(readyRunSteps(plan).map((step) => step.agentId), ["director"]);
    assert.equal(JSON.stringify(plan).includes(prompt), false);
    assert.equal(validateRunPlan(plan).ok, true);
});

test("分镜步骤只在其依赖步骤完成后变为可运行", () => {
    const plan = buildRunPlan({ prompt: "请做角色设定和分镜", runId: "run-ready" });
    const director = plan.steps.find((step) => step.agentId === "director");
    const art = plan.steps.find((step) => step.agentId === "art");
    const storyboard = plan.steps.find((step) => step.agentId === "storyboard");

    assert.ok(director);
    assert.ok(art);
    assert.ok(storyboard);
    assert.deepEqual(readyRunSteps(plan, new Set([director.id])).map((step) => step.agentId), ["art"]);
    assert.deepEqual(readyRunSteps(plan, new Set([director.id, art.id])).map((step) => step.agentId), ["storyboard"]);
});

test("拒绝循环运行计划，并使用稳定的事件幂等键", () => {
    const plan = buildRunPlan({ prompt: "普通画布编辑", runId: "run-cycle" });
    const first = plan.steps[0];
    const second = {
        ...first,
        id: "run-cycle:second",
        dependsOn: [first.id],
    };
    const cycle = {
        ...plan,
        steps: [
            { ...first, dependsOn: [second.id] },
            second,
        ],
    };
    assert.equal(validateRunPlan(cycle).ok, false);

    const event = createSemanticEvent({ runId: "run-cycle", type: "step.started", stepId: "run-cycle:director", attempt: 2, timestamp: "2026-09-04T00:00:00.000Z" });
    assert.equal(event.idempotencyKey, "run-cycle:step.started:run-cycle:director:2");
    assert.match(formatRunPlan(plan), /计划仅用于指导当前执行，不代表任何步骤已经完成/);
    assert.equal(AGENT_MANIFESTS.length, 5);
});

test("运行 id 含冒号时仍保持步骤 id 与依赖一致", () => {
    const plan = buildRunPlan({ prompt: "请整理小说", runId: "run:custom" });

    assert.deepEqual(plan.steps.map((step) => step.id), ["run:custom:director", "run:custom:script"]);
    assert.deepEqual(plan.steps[1].dependsOn, ["run:custom:director"]);
    assert.equal(validateRunPlan(plan).ok, true);
});

test("只读步骤按依赖分批并行，并对相同工具读取去重", async () => {
    const plan = buildRunPlan({ prompt: "请根据小说整理角色、分镜并生成视频", projectId: "project-1", runId: "run-read" });
    const calls: string[] = [];
    let active = 0;
    let maxActive = 0;
    const events: Array<{ type: string; stepId?: string }> = [];
    const execution = await executeReadOnlySteps(
        plan,
        async (name, input) => {
            calls.push(`${name}:${JSON.stringify(input)}`);
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active -= 1;
            return { name, input };
        },
        (type, payload) => {
            const event = payload as { type?: string; stepId?: string };
            if (type === "agent_event" && event.type) events.push(event);
        },
    );

    assert.equal(execution.blockedStepIds.length, 0);
    assert.equal(new Set(calls.map((call) => call.split(":")[0])).size, 4);
    assert.equal(calls.filter((call) => call.startsWith("project_get_context:")).length, 1);
    assert.ok(maxActive >= 2);
    assert.equal(events.filter((event) => event.type === "step.read.completed").length, 5);
    assert.match(formatReadOnlyExecution(execution), /只读预取事实/);
});

test("只读失败不会执行其依赖步骤，也不会伪造步骤完成", async () => {
    const plan = buildRunPlan({ prompt: "请整理小说并制作分镜", projectId: "project-1", runId: "run-read-fail" });
    const events: string[] = [];
    const execution = await executeReadOnlySteps(
        plan,
        async (name) => {
            if (name === "project_get_context") throw new Error("project unavailable");
            return { name };
        },
        (type, payload) => {
            const event = payload as { type?: string };
            if (type === "agent_event" && event.type) events.push(event.type);
        },
    );

    assert.ok(execution.blockedStepIds.includes("run-read-fail:storyboard"));
    assert.ok(execution.blockedStepIds.length > 0);
    assert.equal(events.includes("step.completed"), false);
    assert.ok(events.includes("step.read.failed"));
});
