import { expect, test } from "bun:test";
import * as request from "../src/pages/create/creation-agent-request";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";

const base = {
    prompt: "请分析这张产品图并规划一套图片",
    idempotencyKey: "creation-test-key-123",
    textSelection: { logicalModelId: "text-1" },
    imageSelection: { logicalModelId: "image-1" },
    videoSelection: { channelId: "video-channel", channelModelKey: "video-model" },
    permissionMode: "request_approval" as const,
    attachments: [{ id: "file-1", name: "product.png", type: "image/png", storageKey: "resource:r-1", role: "product" as const }],
};

test("首页 Agent 请求使用 creation scope、独立媒体模型和受管附件", () => {
    const input = (request as any).buildCreationAgentRunInput?.(base);
    expect(input).toMatchObject({
        surface: "creation", contextSelection: { surface: "creation", scopes: [] },
        prompt: base.prompt, logicalModelId: "text-1", permissionMode: "request_approval",
        mediaSettings: { image: { selection: { logicalModelId: "image-1" }, parameterMode: "auto" }, video: { selection: { channelId: "video-channel", channelModelKey: "video-model" }, parameterMode: "auto" } },
        attachments: [{ resourceId: "r-1", storageKey: "resource:r-1", kind: "image", role: "product", name: "product.png" }],
    });
    expect(input.canvasId).toBeUndefined();
});

test("输出偏好传给服务端，保留真实用户提示词和生成参数", () => {
    for (const outputPreference of ["concise", "detailed"] as const) {
        const input = request.buildCreationAgentRunInput({ ...base, outputPreference });
        expect(input.outputPreference).toBe(outputPreference);
        expect(input.prompt).toBe(base.prompt);
        expect(input.mediaSettings).toEqual(request.buildCreationAgentRunInput(base).mediaSettings);
    }
    expect(request.buildCreationAgentRunInput(base).outputPreference).toBeUndefined();
});

test("只读权限的媒体任务预算恒为零，手动参数作为约束传递", () => {
    const input = (request as any).buildCreationAgentRunInput?.({ ...base, permissionMode: "read_only", imageParameters: { parameterMode: "manual", size: "1:1", quality: "high", count: 2 } });
    expect(input.budget).toMatchObject({ maxGenerationTasks: 0, maxVideoSeconds: 0 });
    expect(input.mediaSettings.image).toMatchObject({ parameterMode: "manual", size: "1:1", quality: "high", count: 2 });
});

test("不把本地 URL 或文档伪装成受管媒体附件", () => {
    expect(() => (request as any).buildCreationAgentRunInput?.({ ...base, attachments: [{ name: "a.png", type: "image/png", storageKey: "https://example.com/a.png" }] })).toThrow();
    expect(() => (request as any).buildCreationAgentRunInput?.({ ...base, attachments: [{ name: "a.pdf", type: "application/pdf", storageKey: "resource:r-1" }] })).toThrow();
});

test("从已配置的真实逻辑模型取得受管 selection", () => {
    const config = { ...defaultConfig, channels: [createModelChannel({ id: "system-1", scope: "system", models: ["text-x"], modelCosts: [{ model: "text-x", logicalModelId: "logical-text" }] as any })] };
    expect((request as any).creationManagedModelSelection?.(config, "text-x")).toEqual({ logicalModelId: "logical-text" });
    expect(() => (request as any).creationManagedModelSelection?.(defaultConfig, "unconfigured")).toThrow();
});

test("默认任务预算不再把五张图请求硬限为四张，显式上限仍原样保留", () => {
    const automatic = request.buildCreationAgentRunInput({ ...base, prompt: "请生成五张产品图" });
    expect(automatic.budget?.maxGenerationTasks).toBe(0);
    expect(request.buildCreationAgentRunInput({ ...base, budget: { maxCredits: 50, maxGenerationTasks: 2, maxVideoSeconds: 10 } }).budget).toEqual({ maxCredits: 50, maxGenerationTasks: 2, maxVideoSeconds: 10 });
});

test("显式附件替换保留空集合，追加和继承模式独立传递", () => {
    expect(request.buildCreationAgentRunInput({ ...base, attachmentMode: "replace", attachments: [] } as any)).toMatchObject({ attachmentMode: "replace", attachments: [] });
    expect(request.buildCreationAgentRunInput({ ...base, attachmentMode: "append" } as any)).toMatchObject({ attachmentMode: "append", attachments: [{ resourceId: "r-1" }] });
    expect(request.buildCreationAgentRunInput({ ...base, attachmentMode: "inherit", attachments: [] } as any)).toMatchObject({ attachmentMode: "inherit" });
});

test("Agent 会话保留历史素材顺序，后续上传追加而非替换竞品图", () => {
    const previous = [{ resourceId: "old", storageKey: "resource:old", kind: "image", role: "reference", name: "旧图" }];
    expect(request.creationAgentAttachmentSelection([], previous as any)).toEqual({ attachmentMode: "inherit", imageCount: 1 });
    expect(request.creationAgentAttachmentSelection(base.attachments, previous as any)).toEqual({ attachmentMode: "append", imageCount: 2 });
    expect(request.creationAgentAttachmentSelection([], [])).toEqual({ attachmentMode: "inherit", imageCount: 0 });
    expect(request.creationAgentAttachmentSelection([{ name: "同一图", type: "image/png", storageKey: "resource:old" }], previous as any)).toEqual({ attachmentMode: "append", imageCount: 1 });
});

test("非视觉模型遇到有效图片明确提示，不自动改选其他模型", () => {
    const profile = defaultModelCapabilityConfig();
    const config = { ...defaultConfig, textModel: "text-only", channels: [createModelChannel({ id: "system", scope: "system", models: ["text-only", "vision"], modelCosts: [
        { model: "text-only", capabilityConfig: profile },
        { model: "vision", capabilityConfig: { ...profile, text: { ...profile.text!, references: { ...profile.text!.references, maxImages: 4 } } } },
    ] as any })] };
    expect((request as any).creationAgentImageInputError?.(config, "text-only", 1)).toBe("当前渠道的图片输入配置未开启或未声明，请联系管理员在“管理后台 → 渠道模型编辑 → 能力与参数 → 引用与限制 → 图片引用”确认配置；图片仍保留");
    expect((request as any).creationAgentImageInputError?.(config, "vision", 1)).toBe("");
    expect((request as any).creationAgentImageInputError?.(config, "text-only", 0)).toBe("");
    expect(config.textModel).toBe("text-only");
});

test("首页图片限额取渠道文本模型配置与服务端总素材上限，不静默丢图", () => {
    const profile = defaultModelCapabilityConfig();
    const config = { ...defaultConfig, channels: [createModelChannel({ id: "channel", scope: "system", models: ["vision"], modelCosts: [
        { model: "vision", capabilityConfig: { ...profile, text: { ...profile.text!, references: { ...profile.text!.references, maxImages: 20 } } } },
    ] as any })] };
    expect(request.creationAgentImageReferenceLimit(config, "vision")).toBe(16);
    expect(request.creationAgentImageInputError(config, "vision", 17)).toContain("16");
    config.channels[0].modelCosts![0].capabilityConfig!.text!.references.maxImages = 10;
    expect(request.creationAgentImageReferenceLimit(config, "vision")).toBe(10);
    expect(request.creationAgentImageInputError(config, "vision", 11)).toContain("10");
});

test("失败重试延续最新会话目标，不把上一条澄清回答改写为完整新需求", () => {
    const retry = request.creationAgentRetryPrompt();
    expect(retry).toContain("最新明确的用户目标");
    expect(retry).toContain("上一轮澄清回答只补充相应字段");
    expect(retry).not.toContain("画面英文文案由我撰写");
});

test("聚合结果的单项重试携带原失败任务，不要求重做成功图片", () => {
    const retry = request.creationAgentRetryPrompt("failed-detail-task");
    expect(retry).toContain("仅重试任务 failed-detail-task");
    expect(retry).toContain("retryFailedTaskId");
    expect(retry).toContain("单项新报价与审批");
    expect(retry).toContain("保留其他已成功结果");
});
