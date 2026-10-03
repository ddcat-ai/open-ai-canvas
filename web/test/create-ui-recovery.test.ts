import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const page = readFileSync(resolve(import.meta.dir, "../src/pages/create/index.tsx"), "utf8");
const workspace = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-workspace.tsx"), "utf8");
const styles = readFileSync(resolve(import.meta.dir, "../src/pages/create/creation-product.css"), "utf8");

test("首页复用原模型选择器，Agent 主栏是对话模型，图片视频模型进入偏好", () => {
    expect(workspace).toContain("<ModelPicker config={props.config}");
    expect(workspace).toContain('capability={creationModelCapability(props.mode)}');
    expect(workspace).toContain('value={props.agentImageModel} onChange={props.onAgentImageModelChange} capability="image"');
    expect(workspace).toContain('value={props.agentVideoModel} onChange={props.onAgentVideoModelChange} capability="video"');
    expect(workspace).not.toContain("CreationAgentModelPicker");
    expect(styles).not.toContain("creation-agent-model-panel");
    expect(page).toContain("model: selectedModel");
    expect(page).toContain('onModelChange: (value: string) => updateConfig(mode === "text" || mode === "agent" ? "textModel" : mode === "image" ? "imageModel" : "videoModel", value)');
});

test("首页 Agent 权限与自动参数接入实际服务端执行流程", () => {
    expect(workspace).toContain("<GenerationSettingsMenu {...props} />");
    expect(workspace).toContain("<DurationMenu profile={props.videoProfile}");
    expect(workspace).toContain("<AgentPermissionControl mode={props.agentPermissionMode}");
    expect(workspace).toContain("<AgentExecutionSettings {...props} />");
    expect(page).toContain('surface: "creation"');
    expect(page).toContain("buildCreationAgentRunInput");
    expect(workspace).not.toContain("creation-chat-control-agent-auto");
    expect(page).not.toContain("<CreationAgentEntry");
});

test("模式菜单脱离 Composer 裁切容器，同宽展开并自动避让", () => {
    expect(workspace).toContain('placement={variant === "thread" ? "topLeft" : "bottomLeft"} autoAdjustOverflow');
    expect(workspace).toContain('label: <span className="creation-mode-menu-item">{item.label}</span>');
    expect(workspace).not.toContain("item.description}</small>");
    expect(workspace).toContain('styles={{ root: popupStyle }} getPopupContainer={() => document.body}');
    expect(workspace).toContain('setPopupStyle({ width, minWidth: width');
    expect(styles).not.toContain(".creation-mode-dropdown .creation-mode-menu");
    expect(styles).toContain(".creation-mode-menu-item { display: block; min-width: 0; white-space: nowrap;");
});

test("首页移除虚构上下文进度，并只保留一个图标发送按钮", () => {
    expect(page).not.toContain("contextEstimate");
    expect(workspace).not.toContain("ContextEstimateRing");
    expect(styles).not.toContain("creation-context-estimate");
    expect(page).not.toContain("本地估算");
    expect(page).not.toContain("未测量");
    expect((workspace.match(/className="creation-submit is-icon-only"/g) || []).length).toBe(1);
    expect(page).toContain("onSubmit: () => void submit()");
});
