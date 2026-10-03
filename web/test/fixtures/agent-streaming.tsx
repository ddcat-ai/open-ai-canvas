import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { AgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { CreationMessageView } from "@/pages/create/creation-workspace-messages";
import { canvasThemes } from "@/lib/canvas-theme";

const specimen = document.getElementById("specimen")!;
const results = document.getElementById("results")!;
const status = document.getElementById("status")!;
const button = document.getElementById("run") as HTMLButtonElement;
const root = createRoot(specimen);
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const noop = () => {};
let message = 0;

function render(surface: "canvas" | "creation", text: string, streaming: boolean) {
    flushSync(() => root.render(<StrictMode>{surface === "canvas" ? (
        <AgentChatMessage key={message} item={{ id: String(message), role: "assistant", text }} theme={canvasThemes.light} isStreaming={streaming} />
    ) : (
        <CreationMessageView key={message} item={{ id: String(message), role: "assistant", mode: "agent", content: text, status: streaming ? "streaming" : "done", createdAt: "2026-10-03T00:00:00Z" }} shotNumber={0} onRetryFailure={noop} onCreateVariant={noop} onEditUserMessage={noop} onContinueCanvas={noop} openingCanvas={false} />
    )}</StrictMode>));
}

function visible() {
    return specimen.querySelector(".ai-message-markdown")?.textContent || "";
}

function assert(condition: boolean, detail: string) {
    if (!condition) throw new Error(detail);
}

button.onclick = async () => {
    button.disabled = true;
    results.replaceChildren();
    status.textContent = "正在验证";
    let passed = 0;
    let failed = 0;
    const test = async (name: string, run: () => Promise<void>) => {
        message++;
        const result = document.createElement("li");
        try {
            await run();
            result.className = "pass";
            result.textContent = `通过：${name}`;
            passed++;
        } catch (error) {
            result.className = "fail";
            result.textContent = `失败：${name} — ${error instanceof Error ? error.message : String(error)}`;
            failed++;
        }
        results.append(result);
    };
    for (const surface of ["canvas", "creation"] as const) {
        await test(`${surface}：突发文本逐步展开`, async () => {
            render(surface, "", true);
            await delay(40);
            const text = "文字流式输出应该连续自然。".repeat(12);
            render(surface, text, true);
            await delay(100);
            const shown = visible();
            assert(shown.length > 0 && shown.length < text.length, `100ms 后显示 ${shown.length}/${text.length} 个字符`);
            assert(text.startsWith(shown), "显示内容不是原文的连续前缀");
        });
        await test(`${surface}：高频增量不会反复重置吐字时钟`, async () => {
            render(surface, "", true);
            await delay(40);
            let text = "";
            for (let index = 0; index < 24; index++) {
                text += "连续";
                render(surface, text, true);
                await delay(10);
                if (index === 12) assert(visible().length > 0, "收到 130ms 高频增量后仍没有显示文字");
            }
            render(surface, text, false);
            await delay(300);
            assert(visible() === text, "高频增量结束后未完整收尾");
        });
        await test(`${surface}：长回复不会积压数秒`, async () => {
            render(surface, "", true);
            await delay(40);
            const text = "连续吐字保持全文完整。".repeat(60);
            render(surface, text, true);
            await delay(800);
            assert(visible().length >= text.length * 0.9, `800ms 后只显示 ${visible().length}/${text.length} 个字符`);
            render(surface, text, false);
            await delay(300);
            assert(visible() === text, "结束后仍未补齐全文");
        });
        await test(`${surface}：结束时平滑补齐剩余文字`, async () => {
            render(surface, "", true);
            await delay(40);
            const text = "模型输出完毕时应尽快完整展示。".repeat(25);
            render(surface, text, true);
            await delay(60);
            render(surface, text, false);
            await delay(300);
            assert(visible() === text, `结束 300ms 后只显示 ${visible().length}/${text.length} 个字符`);
        });
        await test(`${surface}：历史消息立即显示`, async () => {
            const text = "历史消息无需重新播放。".repeat(15);
            render(surface, text, false);
            assert(visible() === text, "历史消息被重新打字或隐藏");
        });
        await test(`${surface}：追加文本无重复、无遗漏`, async () => {
            render(surface, "", true);
            await delay(40);
            let text = "";
            for (const chunk of ["第一段中文，", "第二段 English，", "最后完整收尾。"] ) {
                text += chunk;
                render(surface, text, true);
                await delay(100);
                assert(text.startsWith(visible()), "追加时内容出现倒退、重复或乱序");
            }
            render(surface, text, false);
            await delay(300);
            assert(visible() === text, "最终文本与原文不一致");
        });
        await test(`${surface}：emoji 与组合字符完整显示`, async () => {
            render(surface, "", true);
            await delay(40);
            const text = "👩🏽‍💻e\u0301中文🇨🇳连续输出";
            const boundaries = new Set(["", ...Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (part) => text.slice(0, part.index + part.segment.length))]);
            const broken: string[] = [];
            const observer = new MutationObserver(() => { if (!boundaries.has(visible())) broken.push(visible()); });
            observer.observe(specimen, { childList: true, subtree: true, characterData: true });
            render(surface, text, true);
            await delay(400);
            observer.disconnect();
            assert(!broken.length, `出现被拆开的字符：${JSON.stringify(broken[0])}`);
        });
    }
    status.textContent = `验证完成：${passed} 项通过，${failed} 项失败`;
    status.dataset.failed = String(failed);
    button.disabled = false;
};
