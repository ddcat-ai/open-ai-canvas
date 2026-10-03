import { expect, test } from "bun:test";
import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationComposer } from "../src/pages/create/creation-workspace";
import { AgentContextRing } from "../src/components/canvas/canvas-cloud-agent-panel-parts";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { emptyAgentContextUsage, presentAgentContextUsage } from "../src/lib/canvas/agent-context-usage";
import { defaultConfig } from "../src/stores/use-config-store";

const noop = () => {};
const profile = defaultModelCapabilityConfig();
const context = presentAgentContextUsage(emptyAgentContextUsage("run-layout"));
const props: ComponentProps<typeof CreationComposer> = {
    variant: "empty", mode: "agent", prompt: "测试创作", setPrompt: noop,
    busy: false, generationActive: false, referenceReplacementBusy: false,
    attachments: [], maxReferences: 9, references: [], onRemoveAttachment: noop,
    onClearAttachments: noop, onClearComposer: noop,
    onReorderAttachments: noop, onReplaceAttachment: noop, onReplaceReferenceFiles: noop,
    onPasteFiles: noop, onOpenLibrary: noop, onModeChange: noop, model: "",
    modelRequirements: {}, videoProfile: profile.video!, imageProfile: profile.image!,
    config: defaultConfig, onModelChange: noop, ratio: "1:1", setRatio: noop,
    seconds: "6", setSeconds: noop, quality: "auto", setQuality: noop,
    videoQuality: "720", setVideoQuality: noop, count: "1", setCount: noop,
    textStreaming: true, setTextStreaming: noop, textThinking: false, setTextThinking: noop,
    promptOptimizerProvider: null, smartCreationAvailable: false, smartCreationActive: false,
    smartCreationPlanning: false, referencePasteBusy: false, onToggleSmartCreation: noop,
    composerFocusRef: createRef<HTMLTextAreaElement>(), onPromptFocus: noop, onSubmit: noop,
    agentPermissionMode: "request_approval", onAgentPermissionChange: noop,
    agentContextView: context, agentImageModel: "", agentVideoModel: "",
    onAgentImageModelChange: noop, onAgentVideoModelChange: noop,
    agentImageParameterMode: "auto", agentVideoParameterMode: "auto",
    onAgentImageParameterModeChange: noop, onAgentVideoParameterModeChange: noop,
    agentMaxCredits: 200, agentMaxGenerationTasks: 4, agentMaxVideoSeconds: 30,
    onAgentBudgetChange: noop, agentImageSize: "1:1", agentImageQuality: "auto", agentImageCount: 1,
    agentVideoSize: "16:9", agentVideoQuality: "720p", agentVideoSeconds: 6,
    onAgentImageSettingChange: noop, onAgentVideoSettingChange: noop,
};

test("Agent 主栏固定对话模型，不再显示二级模型类型选择；设置入口是偏好", () => {
    const html = renderToStaticMarkup(<CreationComposer {...props} />);
    expect(html).not.toContain("creation-agent-model-tab");
    expect(html).toContain("选择对话模型");
    expect(html).toContain("Agent 创作偏好");
    expect(html).toContain(">偏好</span>");
});

test("首页只显示上下文圆环，保留可访问名称；画布默认保留读数", () => {
    const html = renderToStaticMarkup(<CreationComposer {...props} />);
    expect(html).toContain("agent-context-ring-visual");
    expect(html).not.toContain("agent-context-meter-copy");
    expect(html).toContain("点击查看明细");
    const canvas = renderToStaticMarkup(<AgentContextRing view={context} />);
    expect(canvas).toContain("agent-context-meter-copy");
    expect(canvas).toContain("<small>上下文</small>");
});

test("Agent 素材随会话上下文使用，Composer 不展示上轮素材开关", () => {
    const inherited = renderToStaticMarkup(<CreationComposer {...props} />);
    expect(inherited).not.toContain("沿用上轮");
    expect(inherited).not.toContain('aria-label="本轮不沿用上轮素材"');
});

test("Agent 附件只显示图片，不要求用户手动指定素材用途", () => {
    const html = renderToStaticMarkup(<CreationComposer {...props} attachments={[{ id: "product", name: "产品正面", type: "image/png", storageKey: "resource:product", previewUrl: "/product.png", width: 640, height: 640 }]} />);
    expect(html).toContain("产品正面");
    expect(html).not.toContain("的素材用途");
    expect(html).not.toContain("creation-attachment-role");
});

test("非视觉模型的图片提示保留素材并阻止发送", () => {
    const warning = "当前渠道的图片输入配置未开启或未声明，请联系管理员在“管理后台 → 渠道模型编辑 → 能力与参数 → 引用与限制 → 图片引用”确认配置；图片仍保留";
    const html = renderToStaticMarkup(<CreationComposer {...props} agentInputError={warning} />);
    expect(html).toContain(warning);
    expect(html).toContain('role="alert"');
    expect(html).toMatch(/<button[^>]*class="[^"]*creation-submit\s[^>]*disabled=""/);
});

for (const mode of ["agent", "image", "video"] as const) {
    test(`${mode} 模式语音放在右侧发送前，发送只有图标且保持禁用/忙状态`, () => {
        const html = renderToStaticMarkup(<CreationComposer {...props} mode={mode} />);
        const actions = html.slice(html.indexOf('class="creation-submit-wrap"'));
        expect(actions.indexOf("creation-voice-trigger")).toBeGreaterThan(0);
        expect(actions.indexOf("creation-voice-trigger")).toBeLessThan(actions.indexOf("creation-submit-action"));
        if (mode === "agent") expect(actions.indexOf("agent-context-ring")).toBeLessThan(actions.indexOf("creation-voice-trigger"));
        expect(actions).not.toContain("开始创作</span>");
        expect(actions).toContain('aria-label="发送"');
        const empty = renderToStaticMarkup(<CreationComposer {...props} mode={mode} prompt="" />);
        expect(empty).toMatch(/<button[^>]*class="[^"]*creation-submit\s[^>]*disabled=""/);
        const busy = renderToStaticMarkup(<CreationComposer {...props} mode={mode} busy />);
        expect(busy).toContain("animate-spin");
        expect(busy).toContain(`aria-label="${mode === "agent" ? "思考中" : "生成中"}"`);
        if (mode === "agent") expect(busy).not.toContain("生成中暂不能添加参考内容");
    });
}
