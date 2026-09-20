import { expect, test } from "bun:test";
import { submitStoryboardTask } from "../src/services/storyboard-submission";
import { creationRuns, type CreationSubmission } from "../src/services/api/creation-runs";
import type { CreateTaskInput } from "../src/services/api/task-center";

const request = { type: "canvas_text", operation: "storyboard", projectId: "canvas", prompt: "剧本" } as CreateTaskInput;
function harness(expiresAt = "2099-01-01") {
    const calls: string[] = [];
    const run = { id: "run", executionEpoch: 1, executionOwner: "owner" };
    const submission = { id: "quote", quote: { expiresAt } } as CreationSubmission;
    const api = {
        ...creationRuns,
        create: async () => ({ run, submissions: [] }), claim: async () => run,
        prepare: async () => { calls.push("prepare"); return submission; },
        approve: async () => { calls.push("approve"); return { submissions: [{ ...submission, approvedAt: "now" }] }; },
        execute: async () => { calls.push("execute"); return { id: "task" }; },
        release: async () => { calls.push("release"); return { released: true }; },
    } as typeof creationRuns;
    return { api, calls };
}
test("取消专业拆镜费用确认不会批准或提交任务", async () => {
    const h = harness();
    expect(await submitStoryboardTask(request, { signal: new AbortController().signal, assertCurrent() {}, confirm: async () => false }, h.api)).toBeUndefined();
    expect(h.calls).toEqual(["prepare", "release"]);
});
test("确认后提交原报价对应的专业任务", async () => {
    const h = harness();
    expect((await submitStoryboardTask(request, { signal: new AbortController().signal, assertCurrent() {}, confirm: async () => true }, h.api))?.id).toBe("task");
    expect(h.calls).toEqual(["prepare", "approve", "execute", "release"]);
});
test("过期报价或确认期间编辑分镜均阻止提交", async () => {
    for (const changed of [false, true]) {
        const h = harness(changed ? "2099-01-01" : "2000-01-01");
        await expect(submitStoryboardTask(request, { signal: new AbortController().signal, assertCurrent() { if (changed) throw new Error("分镜已编辑"); }, confirm: async () => true }, h.api)).rejects.toThrow();
        expect(h.calls).toEqual(["prepare", "release"]);
    }
});
