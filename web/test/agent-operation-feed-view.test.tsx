import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentOperationFeed, AgentReasoningFeed, type CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
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
    expect(segments.map((segment) => segment.kind)).toEqual(["reasoning", "message"]);
    expect(segments[0]?.kind === "reasoning" ? segments[0].items : []).toHaveLength(2);

    const html = renderToStaticMarkup(<AgentReasoningFeed items={messages.slice(0, 2)} theme={canvasThemes.light} />);
    expect(html).toContain("2 段 · 点击查看");
    expect(html).toContain('class="agent-reasoning-card"');
    expect(html).not.toContain(" open");
});

test("operations fold into one line that reports only the latest action", () => {
    for (const theme of [canvasThemes.light, canvasThemes.dark]) {
        const html = renderToStaticMarkup(<AgentOperationFeed items={steps} theme={theme} />);
        expect(html).toContain("agent-operation-feed");
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain("已获取可用模型");
        expect(html).not.toContain("已读取画布清单");
        expect(html).not.toContain("agent-operation-list");
        expect(html).toContain("2 步");
        expect(html).toContain("读取信息");
    }
});

test("the folded line names the tier it is reporting", () => {
    const read = renderToStaticMarkup(<AgentOperationFeed items={[steps[0]]} theme={canvasThemes.light} />);
    expect(read).toContain("读取清单");
    expect(read).toContain('data-agent-category="read"');
    expect(read).not.toContain("操作画布");
    expect(read).toContain('aria-label="展开 1 步读取清单记录，最新一步：已读取画布清单（未查看画面）"');
    // 只有一步时不加计数徽标
    expect(read).not.toContain('class="agent-operation-count"');

    const vision = renderToStaticMarkup(<AgentOperationFeed items={[viewed("n1", "剧照1.png"), viewed("n2", "封面.png")]} theme={canvasThemes.light} />);
    expect(vision).toContain("查看画面");
    expect(vision).toContain('data-agent-category="vision"');
    expect(vision).toContain("查看了 2 张画面 · 最新《封面.png》");
    expect(vision).not.toContain("操作已完成");

    const operate = renderToStaticMarkup(<AgentOperationFeed items={[step("t9", "canvas_apply_ops", "工具执行成功", { eventType: "canvas_updated" })]} theme={canvasThemes.light} />);
    expect(operate).toContain("修改画布");
    expect(operate).toContain('data-agent-category="operate"');
});

test("a failed step is marked and expanded instead of hidden behind the folded line", () => {
    const failed = [...steps, step("t3", "canvas_apply_ops", "", { eventType: "tool_failed", result: { taskId: "task-1" } })];
    const html = renderToStaticMarkup(<AgentOperationFeed items={failed} theme={canvasThemes.light} />);
    expect(html).toContain("is-failed");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("更新画布内容失败");
    expect(html).toContain("agent-operation-list");
    // 展开的完整记录仍然是原样的工具卡（含任务 ID 与历史步骤），失败那步的文字是红的
    expect(html).toContain("已读取画布清单（未查看画面）");
    expect(html).toContain("任务 ID：task-1");
    expect(html).toContain("#dc2626");
});

test("the shimmer only runs while the panel says the segment is live", () => {
    const idle = renderToStaticMarkup(<AgentOperationFeed items={steps} theme={canvasThemes.light} />);
    const running = renderToStaticMarkup(<AgentOperationFeed items={steps} theme={canvasThemes.light} live />);
    expect(idle).not.toContain("is-live");
    expect(running).toContain("is-live");
    // 失败的那一段即使是末尾也不流光：红色静态文字承担语义
    const failedLive = renderToStaticMarkup(<AgentOperationFeed items={[step("t3", "canvas_apply_ops", "", { eventType: "tool_failed" })]} theme={canvasThemes.light} live />);
    expect(failedLive).not.toContain("is-live");
});

test("style contract: no per-step status ticks, vision tint and shimmer stay token-driven", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    // 展开后的每一步不再渲染状态勾/叉（一列绿勾会把记录读成成绩单）
    expect(css).toContain(".agent-operation-list .agent-tool-status {");
    // 流光动画只挂在 .is-live 上：任务完成即停
    expect(css).toContain(".agent-operation-feed.is-live .agent-operation-latest {");
    // 类别取色走面板注入的主题 token，不写字面值
    expect(css).toContain("--agent-tool-accent: var(--agent-accent, var(--foreground));");
});

test("style contract: 正文 / 工具调用 / 模型思考三档不再制造左侧公共竖轨", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    // 同一选择器可能在容器查询里被覆盖，这里把所有命中块拼起来看整体契约。
    const block = (selector: string) => [...css.matchAll(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`, "g"))].map((match) => match[1]).join("\n");

    // ① 星标后面不再有圆底：只留图标本身
    const icon = block(".agent-reasoning-icon");
    expect(icon).toContain("background: transparent");
    expect(icon).not.toContain("border-radius: 50%");

    // ② 对话正文从容器边缘开始，不为过程内容预留一条空的公共轴沟槽。
    const axis = block(".agent-conversation-messages");
    expect(axis).not.toContain("--agent-axis");
    expect(axis).not.toContain("padding-left: var(--agent-axis)");

    // ③ 思维摘要与正文同一左边缘，不再用负 margin 把星标挂进沟槽。
    const reasoning = block(".agent-reasoning");
    expect(reasoning).not.toContain("margin-left");
    expect(reasoning).not.toContain("border-left");
    expect(block(".agent-reasoning-summary")).toContain("padding: 6px 0");

    // ④ 操作流是轻量文本收据，不再绘制竖线或额外左缩进。
    const feed = block(".agent-operation-feed");
    expect(feed).not.toContain("border-left");
    expect(feed).not.toContain("padding-left");

    // ⑤ 时间线标记只占自己的窄图标列，不再把状态正文推得过远。
    expect(block(".agent-timeline-marker")).toContain("width: 20px");
    expect(block(".agent-conversation-messages .agent-timeline-marker")).not.toContain("margin-left");
});
