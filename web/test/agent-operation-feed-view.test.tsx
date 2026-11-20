import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChatMessage, AgentActivityFeed, type CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { buildAgentFeedSegments } from "@/lib/canvas/agent-operation-feed";
import { canvasThemes } from "@/lib/canvas-theme";

const step = (id: string, title: string, text: string, detail: unknown = { eventType: "tool_completed" }): CloudAgentChatMessage => ({ id, role: "tool", title, text, detail });

const steps: CloudAgentChatMessage[] = [step("t1", "canvas_get_state", "工具执行成功"), step("t2", "model_list", "工具执行成功")];
const viewed = (id: string, title: string): CloudAgentChatMessage => step(id, "canvas_inspect_image", "工具执行成功", { eventType: "tool_completed", result: { nodeId: id, title } });

test("consecutive reasoning messages share one collapsed entry", () => {
    const messages: CloudAgentChatMessage[] = [
        { id: "r1", role: "assistant", text: "先检查画布", reasoning: true },
        { id: "r2", role: "assistant", text: "再选择模型", reasoning: true },
        { id: "a1", role: "assistant", text: "我开始处理。" },
    ];
    const segments = buildAgentFeedSegments(messages);
    expect(segments.map((segment) => segment.kind)).toEqual(["activity", "message"]);
    expect(segments[0]?.kind === "activity" ? segments[0].items : []).toHaveLength(2);

    const html = renderToStaticMarkup(<AgentActivityFeed items={messages.slice(0, 2)} theme={canvasThemes.light} />);
    expect(html).toContain("2 段思考");
    expect(html).toContain("再选择模型");
    expect(html).not.toContain("先检查画布");
    expect(html).not.toContain("is-live");
    expect(html).toContain('aria-expanded="false"');
});

test("operations fold into one line that reports only the latest action", () => {
    for (const theme of [canvasThemes.light, canvasThemes.dark]) {
        const html = renderToStaticMarkup(<AgentActivityFeed items={steps} theme={theme} />);
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain("已获取可用模型");
        expect(html).not.toContain("已读取画布清单");
        expect(html).not.toContain("agent-operation-list");
        expect(html).toContain("2 步");
        expect(html).toContain("读取信息");
        expect(html).toContain('class="agent-activity-glyph"');
        expect(html).toContain('data-agent-category="read"');
    }
});

test("messages and reasoning stay free of decorative side icons", () => {
    const assistant = renderToStaticMarkup(<AgentChatMessage item={{ id: "a1", role: "assistant", text: "已完成。" }} theme={canvasThemes.light} />);
    expect(assistant).not.toContain("agent-message-icon");
    expect(assistant).not.toContain("lucide-message-circle");

    const user = renderToStaticMarkup(<AgentChatMessage item={{ id: "u1", role: "user", text: "继续处理" }} theme={canvasThemes.light} />);
    expect(user).not.toContain("agent-message-icon");
    expect(user).not.toContain("lucide-user-round");

    const live = renderToStaticMarkup(<AgentActivityFeed items={[{ id: "r1", role: "assistant", text: "正在整理", reasoning: true, streaming: true }]} theme={canvasThemes.light} live />);
    expect(live).not.toContain("agent-reasoning-icon");
    expect(live).not.toContain("lucide-brain-circuit");
    expect(live).toContain("正在思考");
});

test("the folded line names the tier it is reporting", () => {
    const read = renderToStaticMarkup(<AgentActivityFeed items={[steps[0]]} theme={canvasThemes.light} />);
    expect(read).toContain("读取清单");
    expect(read).toContain('data-agent-category="read"');
    expect(read).not.toContain("操作画布");
    expect(read).toContain("已读取画布清单（未查看画面）");

    const vision = renderToStaticMarkup(<AgentActivityFeed items={[viewed("n1", "剧照1.png"), viewed("n2", "封面.png")]} theme={canvasThemes.light} />);
    expect(vision).toContain("查看画面");
    expect(vision).toContain('data-agent-category="vision"');
    expect(vision).toContain("查看了 2 张画面 · 最新《封面.png》");
    expect(vision).not.toContain("操作已完成");

    const operate = renderToStaticMarkup(<AgentActivityFeed items={[step("t9", "canvas_apply_ops", "工具执行成功", { eventType: "canvas_updated" })]} theme={canvasThemes.light} />);
    expect(operate).toContain("修改画布");
    expect(operate).toContain('data-agent-category="operate"');
});

test("a failed step remains visible in the summary without automatically expanding history", () => {
    const failed = [...steps, step("t3", "canvas_apply_ops", "", { eventType: "tool_failed", result: { taskId: "task-1" } })];
    const html = renderToStaticMarkup(<AgentActivityFeed items={failed} theme={canvasThemes.light} />);
    expect(html).toContain("1 步未完成");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("更新画布内容失败");
    expect(html).not.toContain("agent-operation-list");
    expect(html).not.toContain("已读取画布清单（未查看画面）");
    expect(html).toContain('data-agent-tone="error"');
    expect(html).not.toContain("#dc2626");
    expect(html).not.toContain("agent-tool-status");
});

test("the activity indicator only runs while the panel says the segment is live", () => {
    const idle = renderToStaticMarkup(<AgentActivityFeed items={steps} theme={canvasThemes.light} />);
    const running = renderToStaticMarkup(<AgentActivityFeed items={steps} theme={canvasThemes.light} live />);
    expect(idle).not.toContain("is-live");
    expect(running).toContain("is-live");
    // 失败的那一段即使是末尾也不流光：红色静态文字承担语义
    const failedLive = renderToStaticMarkup(<AgentActivityFeed items={[step("t3", "canvas_apply_ops", "", { eventType: "tool_failed" })]} theme={canvasThemes.light} live />);
    expect(failedLive).not.toContain("is-live");
});

test("expanded steps stay plain, live indicators and ink follow panel settings", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    // 展开后的每一步是无边框无内边距的纯文本行（状态勾/叉不渲染，由上面的渲染用例保证）
    expect(css).toContain(".agent-operation-list .agent-tool-row {");
    expect(css).toContain(".agent-activity.is-live .agent-activity-glyph::after");
    // 文字取色走面板注入的主题 token，不写字面值
    expect(css).toContain("--agent-activity-ink: var(--agent-ink, var(--foreground));");
});

test("style contract: 正文 / 工具调用 / 模型思考三档不再制造左侧公共竖轨", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    // 同一选择器可能在容器查询里被覆盖，这里把所有命中块拼起来看整体契约。
    const block = (selector: string) => [...css.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g"))].map((match) => match[1]).join("\n");

    // ① 对话正文从容器边缘开始，不为过程内容预留一条空的公共轴沟槽。
    const axis = block(".agent-conversation-messages");
    expect(axis).not.toContain("--agent-axis");
    expect(axis).not.toContain("padding-left: var(--agent-axis)");

    expect(block(".agent-operation-list")).not.toContain("border-left");
    expect(css).not.toContain(".agent-activity-body::before");

    // ④ 时间线标记只占自己的窄图标列，不再把状态正文推得过远。
    expect(block(".agent-timeline-marker")).toContain("width: 20px");
    expect(block(".agent-conversation-messages .agent-timeline-marker")).not.toContain("margin-left");
});
