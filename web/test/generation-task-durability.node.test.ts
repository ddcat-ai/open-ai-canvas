import assert from "node:assert/strict";
import { test } from "node:test";

import type { GenerationTask } from "../src/services/api/task-center";
import { applyGenerationConsumerEffect } from "../src/services/generation-consumer-dedupe";
import { createGenerationTaskMaterializer, type GenerationTaskEffectResult, type GenerationTaskEffectStore } from "../src/services/generation-task-materializer";
import { buildBackendToolRequests } from "../src/services/api/image";

test("managed canvas agent task keeps tool definitions and tool results", () => {
    const requests = buildBackendToolRequests(
        [
            { role: "user", content: "读取画布" },
            { type: "function_call", call_id: "call-1", name: "canvas_get_state", arguments: "{}" },
            { role: "tool", tool_call_id: "call-1", content: "{\"nodes\":[]}" },
        ],
        [{ type: "function", function: { name: "canvas_get_state", parameters: { type: "object" } } }],
        "required",
    );

    assert.equal(requests.responses.tool_choice, "required");
    assert.deepEqual(requests.responses.input, [
        { role: "user", content: "读取画布" },
        { type: "function_call", call_id: "call-1", name: "canvas_get_state", arguments: "{}" },
        { type: "function_call_output", call_id: "call-1", output: "{\"nodes\":[]}" },
    ]);
    assert.deepEqual(requests.chatCompletion.messages, [
        { role: "user", content: "读取画布" },
        { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "canvas_get_state", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "call-1", content: "{\"nodes\":[]}" },
    ]);
});

test("node message and agent consumers receive stable effect keys across three replays", async () => {
    const completed = new Map<string, GenerationTaskEffectResult>();
    const claimed = new Set<string>();
    const effects: GenerationTaskEffectStore = {
        async claim(effectKey) {
            const result = completed.get(effectKey);
            if (result) return { status: "completed", result };
            if (claimed.has(effectKey)) return { status: "busy" };
            claimed.add(effectKey);
            return { status: "claimed", fence: 1 };
        },
        async renew() {
            return { fence: 1 };
        },
        async complete(effectKey, _taskId, result) {
            claimed.delete(effectKey);
            completed.set(effectKey, result);
        },
        async release(effectKey) {
            claimed.delete(effectKey);
        },
    };
    const materializer = createGenerationTaskMaterializer({
        effects,
        async materializeOutput() {
            throw new Error("already materialized");
        },
    });
    const task: GenerationTask = {
        id: "task-consumer-effect-keys",
        type: "image",
        status: "succeeded",
        prompt: "redacted",
        attempts: 1,
        resultState: "READY",
        outputs: [{ outputIndex: 0, mediaType: "image", materializedAssetId: "asset-stable-id" }],
        createdAt: "2026-08-13T00:00:00.000Z",
        updatedAt: "2026-08-13T00:00:00.000Z",
    };
    const seen: string[] = [];

    for (let replay = 0; replay < 3; replay += 1) {
        await materializer.attachNode(task, "node-safe-id", 0, async ({ effectKey }) => {
            seen.push(effectKey);
        });
        await materializer.attachMessage(task, "message-safe-id", 0, async ({ effectKey }) => {
            seen.push(effectKey);
        });
        await materializer.resumeAgent(task, "continuation-safe-id", async ({ effectKey }) => {
            seen.push(effectKey);
        });
    }

    assert.deepEqual(seen, ["attach-node:task-consumer-effect-keys:node-safe-id:0", "attach-message:task-consumer-effect-keys:message-safe-id:0", "agent-resume:task-consumer-effect-keys:continuation-safe-id"]);
});

test("production-shaped node message and agent records replay three times with one side effect", () => {
    const effectKeys = {
        node: "attach-node:task-consumer:node-safe-id:0",
        message: "attach-message:task-consumer:message-safe-id:0",
        agent: "agent-resume:task-consumer:continuation-safe-id",
    };
    const calls = { node: 0, message: 0, agent: 0 };
    let node = { generationEffectKeys: [] as string[], content: "" };
    let message = { generationEffectKeys: [] as string[], resultUrls: [] as string[] };
    let agent = { generationEffectKeys: [] as string[], resumed: false };

    for (let replay = 0; replay < 3; replay += 1) {
        node = applyGenerationConsumerEffect(node, effectKeys.node, (current) => {
            calls.node += 1;
            return { ...current, content: "opaque://asset" };
        }).value;
        message = applyGenerationConsumerEffect(message, effectKeys.message, (current) => {
            calls.message += 1;
            return { ...current, resultUrls: ["opaque://asset"] };
        }).value;
        agent = applyGenerationConsumerEffect(agent, effectKeys.agent, (current) => {
            calls.agent += 1;
            return { ...current, resumed: true };
        }).value;
    }

    node = structuredClone(node);
    message = structuredClone(message);
    agent = structuredClone(agent);
    node = applyGenerationConsumerEffect(node, effectKeys.node, () => {
        calls.node += 1;
        return node;
    }).value;
    message = applyGenerationConsumerEffect(message, effectKeys.message, () => {
        calls.message += 1;
        return message;
    }).value;
    agent = applyGenerationConsumerEffect(agent, effectKeys.agent, () => {
        calls.agent += 1;
        return agent;
    }).value;

    assert.deepEqual(calls, { node: 1, message: 1, agent: 1 });
    assert.equal(node.generationEffectKeys.length, 1);
    assert.equal(message.generationEffectKeys.length, 1);
    assert.equal(agent.generationEffectKeys.length, 1);
});
