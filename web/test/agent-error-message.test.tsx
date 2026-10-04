import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChatMessage, type CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { canvasThemes } from "@/lib/canvas-theme";

const error: CloudAgentChatMessage = { id: "error", role: "error", title: "Agent 执行失败", text: "Agent 执行失败" };

test("generic failure renders its title only once in both canvas themes", () => {
    for (const theme of [canvasThemes.light, canvasThemes.dark]) {
        const html = renderToStaticMarkup(<AgentChatMessage item={error} theme={theme} />);
        expect(html.match(/Agent 执行失败/g)).toHaveLength(1);
        expect(html).not.toContain("agent-error-detail");
        expect(html).toContain('role="status"');
    }
});

test("diagnostic identifiers are preserved in a closed disclosure, not the main description", () => {
    const html = renderToStaticMarkup(<AgentChatMessage item={{ ...error, text: "Agent 执行中断，请重新发送消息；如反复出现，请把诊断号 ag-test-run 反馈给管理员" }} theme={canvasThemes.dark} />);
    expect(html).toContain("Agent 执行中断，请重新发送消息</p>");
    expect(html).toContain("诊断信息");
    expect(html).toContain("<details");
    expect(html).not.toContain("open=");
    expect(html).toContain("<code>ag-test-run</code>");
});

test("specific business failures and recovery guidance remain visible and are escaped", () => {
    const html = renderToStaticMarkup(<AgentChatMessage item={{ ...error, text: "余额不足 <script>bad()</script>", meta: "请联系管理员检查配额" }} theme={canvasThemes.light} />);
    expect(html).toContain("余额不足 &lt;script&gt;bad()&lt;/script&gt;");
    expect(html).toContain("请联系管理员检查配额");
    expect(html).not.toContain("<details");
});

test("retry stays disabled while retrying and warnings retain a distinct tone", () => {
    const html = renderToStaticMarkup(<AgentChatMessage item={{ ...error, errorSeverity: "warning" }} theme={canvasThemes.dark} onRetry={() => {}} retrying />);
    expect(html).toContain("agent-status-message--warning");
    expect(html).toContain("disabled=");
    expect(html).toContain("重试中");
});
