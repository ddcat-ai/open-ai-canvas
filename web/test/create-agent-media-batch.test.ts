import { expect, test } from "bun:test";
import * as conversation from "../src/pages/create/creation-agent-conversation";
import type { CreationMessage, CreationCommercePlan } from "../src/pages/create/creation-types";

const tasks = Array.from({ length: 6 }, (_, i): CreationMessage => ({ id: `task-${i}`, role: "assistant", mode: "image", content: `图 ${i + 1}`, createdAt: "2026-10-03T00:00:00Z", status: "pending", taskIds: [`${i}`], agentRunId: "run-1" }));
const reply: CreationMessage = { id: "run-1:assistant", role: "assistant", mode: "agent", content: "", createdAt: tasks[0].createdAt, agentRunId: "run-1", status: "streaming", commercePlan: { items: tasks.map((task) => ({ id: task.id, type: "image" })) } as CreationCommercePlan };
const project = (messages: CreationMessage[], parent = reply) => (conversation as any).projectCreationAgentMediaBatches(parent, messages) as CreationMessage[];
const success = (task: CreationMessage, outputs = 1): CreationMessage => ({ ...task, status: "done", resultStorageKeys: Array.from({ length: outputs }, (_, i) => `resource:${task.id}-${i}`), resultUrls: Array.from({ length: outputs }, (_, i) => `/images/${task.id}-${i}.png`) });

test("批量下载保留方案序号与场景简称，失败项重试成功后恢复原顺序", () => {
    const named = tasks.slice(0, 3).map((task, i) => ({ ...task, commerceItemId: ["hero", "scene", "steps"][i], content: ["白底商品主图", "核心场景展示图", "规格与使用步骤图"][i] }));
    const parent = { ...reply, commercePlan: { items: named.map((task) => ({ id: task.commerceItemId, type: "image", title: task.content })) } as CreationCommercePlan };
    const partial = project([success(named[2]), { ...named[1], status: "error" as const }, success(named[0])], parent)[0];
    expect(partial.resultUrls).toEqual(["/images/task-0-0.png", "/images/task-2-0.png"]);
    expect((partial as any).resultDownloadNames).toEqual(["01_主图", "03_规格步骤"]);
    const recovered = project([success(named[2]), success(named[1]), success(named[0], 2)], parent)[0];
    expect((recovered as any).resultDownloadNames).toEqual(["01_主图_1", "01_主图_2", "02_场景", "03_规格步骤"]);
    expect(recovered.resultStorageKeys).toEqual(["resource:task-0-0", "resource:task-0-1", "resource:task-1-0", "resource:task-2-0"]);
});

test("事件刷新恢复保留电商项目 ID，下载不依赖图片完成顺序", () => {
    const at = reply.createdAt;
    const restored = conversation.projectCreationAgentConversation({ id: "session-1", title: "套图", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at }, [{ id: "run-1", sessionId: "session-1", surface: "creation", userPrompt: "生成套图", status: "completed", createdAt: at, updatedAt: at, events: [{ runId: "run-1", seq: 1, createdAt: at, type: "generation_task_created", payload: { taskId: "scene-task", mode: "image", title: "核心场景展示图", commerceItemId: "scene" } }], activeMessage: { messageId: "answer", text: "完成" } } as any]);
    expect(restored.messages.find((task) => task.id === "task-scene-task")).toMatchObject({ commerceItemId: "scene" });
});

test("六个 Agent 图片任务投影成一张卡，第一项刚提交也显示 0/6", () => {
    expect(project(tasks.slice(0, 1))).toEqual([expect.objectContaining({ status: "pending", batchTotal: 6, batchCompletedCount: 0, taskIds: ["0"] })]);
    expect(project(tasks)).toHaveLength(1);
});

test("按成功任务数统计，部分成功与失败不提前结束整批", () => {
    const inputs = tasks.map((task, i) => i < 2 ? success(task, 2) : i === 2 ? { ...task, status: "error" as const, error: "模型暂时失败" } : task);
    expect(project(inputs)[0]).toMatchObject({ status: "pending", batchTotal: 6, batchCompletedCount: 2, batchFailedCount: 1 });
    expect(project(inputs)[0].resultStorageKeys).toHaveLength(4);
    expect(inputs[2].taskIds).toEqual(["2"]);
});

test("全部结束后按计划提交顺序聚合，部分失败保留所有成功图片", () => {
    const inputs = tasks.map((task, i) => i === 3 ? { ...task, status: "error" as const, error: "失败" } : success(task));
    expect(project([...inputs, inputs[0]], { ...reply, status: "done" })[0]).toMatchObject({ status: "done", batchCompletedCount: 5, batchFailedCount: 1, taskIds: ["0", "1", "2", "3", "4", "5"], resultStorageKeys: inputs.filter((task) => task.status === "done").flatMap((task) => task.resultStorageKeys || []) });
});

test("轮次和媒体类型保持独立，不把视频或其他轮次混入图片套图", () => {
    const video: CreationMessage = { ...tasks[0], id: "task-video", mode: "video", taskIds: ["video"] };
    const other: CreationMessage = { ...tasks[0], id: "task-other", agentRunId: "run-2", taskIds: ["other"] };
    const result = project([...tasks, video, other]);
    expect(result).toHaveLength(2);
    expect(result[0].batchTotal).toBe(6);
    expect(result[1]).toEqual(video);
});

test("刷新恢复六个任务后仍是一张结果卡，没有重复结果", () => {
    const at = reply.createdAt;
    const events = [{ eventId: "plan", runId: "run-1", seq: 1, createdAt: at, type: "plan_updated", payload: { items: [], plan: reply.commercePlan } }, ...tasks.map((task, i) => ({ eventId: task.id, runId: "run-1", seq: i + 2, createdAt: at, type: "generation_task_created", payload: { taskId: `${i}`, mode: "image", title: task.content } }))];
    let restored = conversation.projectCreationAgentConversation({ id: "session-1", title: "六图", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at }, [{ id: "run-1", sessionId: "session-1", surface: "creation", userPrompt: "六张图片", status: "completed", createdAt: at, updatedAt: at, events, activeMessage: { messageId: "answer", text: "完成" } } as any]);
    for (const task of tasks) restored = conversation.applyCreationAgentTaskState(restored, { id: task.taskIds![0], status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: `resource:${task.id}` }] }) } as any);
    const parent = restored.messages.find((message) => message.role === "assistant" && message.mode === "agent")!;
    const result = project(restored.messages.filter((message) => message.taskIds?.length), parent);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ status: "done", batchTotal: 6, batchCompletedCount: 6 });
    expect(result[0].resultStorageKeys).toHaveLength(6);
});

test("依赖未提交且运行已终止时收敛，取消不能显示为成功", () => {
    expect(project([success(tasks[0]), { ...tasks[1], status: "error", error: "失败" }], { ...reply, status: "error" })[0]).toMatchObject({ status: "done", batchCompletedCount: 1, batchFailedCount: 5 });
    expect(project(tasks.map((task) => ({ ...task, status: "cancelled" })))[0]).toMatchObject({ status: "cancelled", batchCompletedCount: 0 });
});

test("失败图的独立重试合并回原交付项，成功项和下载顺序不变", () => {
    const originals = tasks.map((task, i) => ({ ...task, commerceItemId: `item-${i}` }));
    const inputs = originals.map((task, i) => i === 2 ? { ...task, status: "error" as const, error: "审核失败" } : success(task));
    const retry = success({ ...originals[2], id: "task-retry", taskIds: ["retry"] });
    const result = project([...inputs, retry], { ...reply, status: "done" })[0];
    expect(result).toMatchObject({ batchTotal: 6, batchCompletedCount: 6, batchFailedCount: 0 });
    expect(result.resultStorageKeys).toHaveLength(6);
    expect(result.resultStorageKeys?.[2]).toBe("resource:task-retry-0");
});

test("所有原图结束但 Agent 仍在静默修复时整批继续生成中", () => {
    const inputs = tasks.map((task, i) => i === 2 ? { ...task, status: "error" as const, error: "审核失败" } : success(task));
    expect(project(inputs)[0]).toMatchObject({ status: "pending", batchCompletedCount: 5 });
});
