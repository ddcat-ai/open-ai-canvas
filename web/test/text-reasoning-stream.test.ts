import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { GenerationToolCard } from "../src/components/ai/generation-tool-card";
import type { ModelProtocol } from "../src/lib/model-protocols";
import { requestImageQuestion } from "../src/services/api/image";
import { createModelChannel, defaultConfig, type AiConfig } from "../src/stores/use-config-store";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function reasoningConfig(protocol: ModelProtocol | undefined, apiFormat: "openai" | "gemini" = "openai"): AiConfig {
    const channel = createModelChannel({
        id: "reasoning",
        name: "Reasoning",
        baseUrl: "https://reasoning.example/v1",
        apiKey: "synthetic-test-key",
        apiFormat,
        interfaceType: apiFormat === "gemini" ? undefined : protocol,
        models: ["reasoner"],
        modelCosts: [{ model: "reasoner", capability: "text", ...(protocol ? { protocol } : {}), billingMode: "fixed_request", unitPriceMicrocredits: 0 }],
    });
    return { ...defaultConfig, channels: [channel], model: "reasoning::reasoner", textModel: "reasoning::reasoner" };
}

function streamResponse(events: unknown[]) {
    const body = `${events.map((event) => `data: ${JSON.stringify(event)}`).join("\n\n")}\n\n`;
    return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

async function requestWithReasoning(config: AiConfig, events: unknown[]) {
    globalThis.fetch = (async () => streamResponse(events)) as typeof fetch;
    let content = "";
    let reasoning = "";
    const result = await requestImageQuestion(config, [{ role: "user", content: "请回答" }], (value) => { content = value; }, { onReasoning: (value) => { reasoning = value; } });
    return { result, content, reasoning };
}

describe("text reasoning streams", () => {
    test("separates Responses reasoning summaries from answer text", async () => {
        const output = await requestWithReasoning(reasoningConfig("openai-response"), [
            { type: "response.reasoning_summary_text.delta", delta: "先分析" },
            { type: "response.output_text.delta", delta: "最终答案" },
        ]);

        expect(output).toEqual({ result: "最终答案", content: "最终答案", reasoning: "先分析" });
    });

    test("separates Chat Completions reasoning_content from answer text", async () => {
        const output = await requestWithReasoning(reasoningConfig("chat-completion"), [
            { choices: [{ delta: { reasoning_content: "推理过程" } }] },
            { choices: [{ delta: { content: "回答内容" } }] },
        ]);

        expect(output).toEqual({ result: "回答内容", content: "回答内容", reasoning: "推理过程" });
    });

    test("does not duplicate Gemini thought parts into visible content", async () => {
        const output = await requestWithReasoning(reasoningConfig(undefined, "gemini"), [
            { candidates: [{ content: { parts: [{ text: "内部思考", thought: true }, { text: "可见回答" }] } }] },
        ]);

        expect(output).toEqual({ result: "可见回答", content: "可见回答", reasoning: "内部思考" });
    });

    test("keeps single results open and collapses completed bulk results on restore", () => {
        const single = renderToStaticMarkup(React.createElement(GenerationToolCard, { status: "completed", heading: "图像生成" }, React.createElement("span", null, "单图结果")));
        const bulk = renderToStaticMarkup(React.createElement(GenerationToolCard, { status: "completed", isBulk: true, heading: "图像生成" }, React.createElement("span", null, "批量结果")));

        expect(single).toContain("单图结果");
        expect(bulk).not.toContain("批量结果");
    });
});
