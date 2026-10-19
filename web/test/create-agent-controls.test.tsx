import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as agentParts from "../src/components/canvas/canvas-cloud-agent-panel-parts";
import { emptyAgentContextUsage, presentAgentContextUsage } from "../src/lib/canvas/agent-context-usage";

test("首页和画布可使用同一个上下文圆环，未知读数不显示百分比", () => {
    const html = renderToStaticMarkup(createElement(agentParts.AgentContextRing, { view: presentAgentContextUsage(emptyAgentContextUsage("run-1")) }));
    expect(html).toContain('class="agent-context-ring is-idle"');
    expect(html).not.toContain("<strong>0%</strong>");
});

test("权限图标控件共享画布三档语义", () => {
    expect(typeof (agentParts as any).AgentPermissionControl).toBe("function");
    const html = renderToStaticMarkup(createElement((agentParts as any).AgentPermissionControl, { mode: "request_approval", onChange: () => {} }));
    expect(html).toContain("执行权限：请求审批");
});

test("共享上下文弹层覆盖 Ant Design 6 容器，避免默认内边距触发画布裁切", async () => {
    const css = await Bun.file(new URL("../src/components/canvas/canvas-cloud-agent.css", import.meta.url)).text();
    expect(css).toMatch(/\.agent-context-popover \.ant-popover-container\s*\{[^}]*padding:\s*0;/);
});
