import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantConsentCard } from "../src/pages/admin/agent-access/assistant-consent-card";

const consent = {
    clientId: "canvas_test",
    clientName: "Test Client",
    redirectUri: "http://127.0.0.1:1234/callback",
    resource: "https://canvas.example.test/api/admin-assistant/mcp",
    scopes: ["official-assets:read"],
};
const confirmationMode = { approvalMode: "request_approval" as const, onApprovalModeChange: () => {} };

test("只读授权展示中文模块并保留可核对的原始权限和连接详情", () => {
    const html = renderToStaticMarkup(<AssistantConsentCard {...confirmationMode} consent={consent} loading={false} busy={false} onAuthorize={() => {}} />);
    expect(html).toContain("官方素材库");
    expect(html).toContain("official-assets:read");
    expect(html).toContain("此请求仅包含读取权限");
    expect(html).toContain(consent.clientId);
    expect(html).toContain(consent.redirectUri);
    expect(html).not.toContain("<details open");
});

test("写入授权明确提示可修改数据并按模块合并权限", () => {
    const html = renderToStaticMarkup(<AssistantConsentCard {...confirmationMode} consent={{ ...consent, scopes: ["official-assets:read", "official-assets:write"] }} loading={false} busy={false} onAuthorize={() => {}} />);
    expect(html).toContain("1 个模块 · 2 项权限");
    expect(html).toContain("此请求包含写入权限");
    expect(html).not.toContain("此请求仅包含读取权限");
    expect(html).toContain("official-assets:write");
});

test("加载期间不提供授权操作，未知模块保留原标识", () => {
    const loading = renderToStaticMarkup(<AssistantConsentCard {...confirmationMode} loading busy={false} onAuthorize={() => {}} />);
    expect(loading).toContain("正在读取授权请求");
    expect(loading).not.toContain("同意并授权");
    const html = renderToStaticMarkup(<AssistantConsentCard {...confirmationMode} consent={{ ...consent, scopes: ["future-module:read"] }} loading={false} busy={true} onAuthorize={() => {}} />);
    expect(html).toContain("future-module:read");
    expect(html).toContain("disabled");
});

test("全权委托明确覆盖全部管理能力，只读请求不再展示为实际权限", () => {
    const html = renderToStaticMarkup(<AssistantConsentCard consent={consent} loading={false} busy={false} approvalMode="full_access" onApprovalModeChange={() => {}} onAuthorize={() => {}} />);
    expect(html).toContain("全权委托并连接");
    expect(html).toContain("删除、财务调整和系统配置");
    expect(html).toContain("不受客户端最初申请的只读范围限制");
    expect(html).not.toContain("此请求仅包含读取权限");
    expect(html).not.toContain("official-assets:read");
    expect(html).toContain("客户端自身的工具确认设置仍独立生效");
});
