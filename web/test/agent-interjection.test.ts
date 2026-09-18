import { expect, test } from "bun:test";

// 自研（2026-09-17）：Agent 运行中插话。
//
// 这条功能的核心是**取消一个此前刻意加上的限制**：运行时输入框本来是禁用的
// （旧代码 `disabled={busy || running || …}`），策略提示词也据此写着「运行中用户无法打字」。
// 所以这里的断言要盯住两件事：入口真的打开了，以及旧前提没有残留在代码里。
test("运行中不再锁死输入框，发送走插话而不是新建轮次", async () => {
    const panel = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url)).text();

    // 运行中走插话分支（不建轮次、不走那套扣费幂等记账）
    expect(panel).toContain("await interject(value)");
    expect(panel).toContain("sendAgentInterjection(activeRun.id, { text: value, messageId })");
    // 乐观落进时间线时带插话标记，与「开新一轮」的消息在界面上区分开
    expect(panel).toContain('interjection: "sent"');

    // 输入框的禁用条件里不能再有 running —— 只保留「连不上事件流」「历史/待确认未水合」这类真不能发的状态
    expect(panel).toContain('disabled={Boolean(run && connectionStatus !== "connected")');
    expect(panel).not.toContain("disabled={busy || running ||");
    // 停止按钮由 running 驱动，发送按钮由我们自己的请求驱动，两者不再互斥
    expect(panel).toContain("sending={busy}");
    expect(panel).toContain("running={running}");

    // 两个 SSE 事件都要处理：回显（多标签页）与未送达退回
    expect(panel).toContain('event.type === "user_interjection"');
    expect(panel).toContain('event.type === "user_interjection_dropped"');
    // 退回时要让文案能被再次发送
    expect(panel).toContain("setPrompt?.((current) => (current.trim() ? current : text))");
});

test("输入框运行中同时给出「发送（插话）」与「停止」", async () => {
    const composer = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent-chat-ui.tsx", import.meta.url)).text();

    // 关键改动：canStop 不再等于 sending —— 否则运行中两个动作只能二选一
    expect(composer).toContain("const canStop = Boolean(running && onStop);");
    expect(composer).toContain("const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length);");
    expect(composer).not.toContain("const canStop = Boolean(sending && onStop);");
    expect(composer).toContain('aria-label="停止本轮"');
    // 插话/未送达要有可见标记
    expect(composer).toContain('interjection?: "sent" | "undelivered";');
    expect(composer).toContain('item.interjection === "undelivered" ? "插话未送达" : "插话"');
});

test("插话走独立接口，不碰轮次接口", async () => {
    const api = await Bun.file(new URL("../src/services/api/agent.ts", import.meta.url)).text();

    expect(api).toContain("export function sendAgentInterjection(");
    expect(api).toContain("/interjections");
    expect(api).toContain("messageId: string");
});
