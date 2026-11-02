import { expect, test } from "bun:test";
import { moduleGroupSource } from "./helpers/module-group-source";

// 自研（2026-09-17）：Agent 运行中插话。
//
// 这条功能的核心是**取消一个此前刻意加上的限制**：运行时输入框本来是禁用的
// （旧代码 `disabled={busy || running || …}`），策略提示词也据此写着「运行中用户无法打字」。
// 所以这里的断言要盯住两件事：入口真的打开了，以及旧前提没有残留在代码里。
test("运行中不锁死输入框：Enter 排队，⌘/Ctrl+Enter 插话，都不新建轮次", async () => {
    // 面板拆分为主组件、展示组件与事件归约三个模块，源码约束覆盖整个模块组。
    const panel = moduleGroupSource("components/canvas/canvas-cloud-agent-panel.tsx");

    // 运行中默认排队；修饰键走插话（先生成队列项，失败时这条留在队首）。
    expect(panel).toContain("if (enqueueOutboxItem(outboxItemFromDraft(value, options, composerExtras))) {");
    expect(panel).toContain("const interjectOutboxItem = async (item: AgentOutboxItem) => {");
    expect(panel).toContain("sendAgentInterjection(activeRun.id, { text: value, messageId })");
    // messageId 取队列项 ID，重试时服务端按它去重。
    expect(panel).toContain("const messageId = agentOutboxMessageId(item.id);");
    // 乐观落进时间线时带插话标记，与「开新一轮」的消息在界面上区分开
    expect(panel).toContain('interjection: "sending"');
    expect(panel).toContain('interjection: "sent"');

    // 主按钮禁用条件不含 busy/running：运行中仍能排队或插话。
    expect(panel).toContain("submitDisabled={composerSubmitDisabled}");
    const composer = panel.match(/<AgentChatComposer[\s\S]*?submitDisabled=\{([^\n]+)\}/)?.[1];
    expect(composer).toBe("composerSubmitDisabled");
    // 停止按钮由 running 驱动，发送按钮由我们自己的请求驱动，两者不再互斥
    expect(panel).toContain("sending={busy}");
    expect(panel).toContain("running={running}");

    // 两个 SSE 事件都要处理：回显（多标签页）与未送达；未送达不再改写输入框，改由气泡上的按钮转为下一轮。
    expect(panel).toContain('event.type === "user_interjection"');
    expect(panel).toContain('event.type === "user_interjection_dropped"');
    expect(panel).not.toContain("setPrompt?.(");
    expect(panel).toContain('const requeueInterjection = (messageId: string, mode: "send" | "edit") => {');
});

test("本轮以停止、失败、拒绝或提问结束时暂停队列", async () => {
    const panel = moduleGroupSource("components/canvas/canvas-cloud-agent-panel.tsx");
    expect(panel).toContain('pauseOutbox("stopped");');
    expect(panel).toContain("const reason = agentOutboxPauseForRunEnd(run.status, Boolean(pendingQuestion));");
    // 回答了提问（新一轮被接受）自动解除提问暂停。
    expect(panel).toContain('clearAgentOutboxPause(current, "question")');
});

test("输入框运行中同时给出「发送（插话）」与「停止」", async () => {
    // 输入区已拆到 canvas-cloud-agent-composer.tsx，与消息渲染一起检查。
    const composer = (await Promise.all(["canvas-cloud-agent-chat-ui.tsx", "canvas-cloud-agent-composer.tsx"].map((file) => Bun.file(new URL(`../src/components/canvas/${file}`, import.meta.url)).text()))).join("\n");

    // 关键改动：canStop 不再等于 sending —— 否则运行中两个动作只能二选一
    expect(composer).toContain("const canStop = Boolean(running && onStop);");
    // 请求进行中只拦「发送」，排队和保存不受影响；附件上传中、超出字数时（blockedReason）都不能提交。
    expect(composer).toContain('const canSubmit = !disabled && !submitDisabled && !blockedReason && !(sending && submitMode === "send") && Boolean(prompt.trim() || attachments.length);');
    expect(composer).not.toContain("const canStop = Boolean(sending && onStop);");
    expect(composer).toContain('aria-label="停止本轮"');
    // 插话/未送达要有可见标记
    expect(composer).toContain("interjection?: CloudAgentInterjectionState;");
    expect(composer).toContain('return "插话未送达";');
    expect(composer).toContain("作为下一轮发送");
    // 撤回插话是独立入口，只在等待送达时出现；停止按钮不能是唯一的"取消"手段。
    expect(composer).toContain('item.interjection === "sent" && onWithdrawInterjection');
    expect(composer).toContain('aria-label="撤回这句插话"');
});

test("撤回插话走独立接口，不停止本轮", async () => {
    const api = await Bun.file(new URL("../src/services/api/agent.ts", import.meta.url)).text();
    const panel = moduleGroupSource("components/canvas/canvas-cloud-agent-panel.tsx");

    expect(api).toContain("export function withdrawAgentInterjection(");
    expect(api).toContain("http.delete<{ withdrawn: boolean }>");
    expect(panel).toContain("await withdrawAgentInterjection(activeRun.id, messageId)");
    expect(panel).not.toMatch(/withdrawInterjection[\s\S]{0,400}cancelAgentRun/);
});

test("插话走独立接口，不碰轮次接口", async () => {
    const api = await Bun.file(new URL("../src/services/api/agent.ts", import.meta.url)).text();

    expect(api).toContain("export function sendAgentInterjection(");
    expect(api).toContain("/interjections");
    expect(api).toContain("messageId: string");
});
