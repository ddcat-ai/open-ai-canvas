import type { CreateAgentRunInput, AgentCreationAttachment, AgentMediaChoice, AgentModelSelection, AgentOutputPreference, AgentPermissionMode } from "@/services/api/agent";
import { logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { modelCapabilityConfigFor } from "@/lib/model-capabilities";

type InputAttachment = { name: string; type: string; storageKey?: string; role?: "product" | "reference" | "competitor" | "style" | "source" | "person" };
type MediaParameters = Partial<Omit<AgentMediaChoice, "selection">>;
export const defaultCreationAgentBudget = { maxCredits: 200, maxGenerationTasks: 0, maxVideoSeconds: 30 };

export function creationAgentRetryPrompt(failedTaskId?: string) {
    const target = failedTaskId ? `仅重试任务 ${failedTaskId}：先核对它确实失败，保留其他已成功结果，使用 retryFailedTaskId 申请单项新报价与审批，不重新生成整套。` : "";
    return `${target}请重试上一轮失败的步骤，沿用本会话最新明确的用户目标和已确认约束；上一轮澄清回答只补充相应字段，不重新选择站点或文案语言。`;
}

export function creationAgentAttachmentSelection(attachments: InputAttachment[], previous: AgentCreationAttachment[]) {
    const existing = new Set(previous.map((item) => item.storageKey));
    return {
        attachmentMode: !attachments.length ? "inherit" as const : previous.length ? "append" as const : "replace" as const,
        imageCount: previous.filter((item) => item.kind === "image").length + attachments.filter((item) => item.type.startsWith("image/") && !existing.has(item.storageKey as `resource:${string}`)).length,
    };
}

export function creationAgentImageInputError(config: AiConfig, model: string, imageCount: number) {
    if (!imageCount || !model) return "";
    const configured = modelCapabilityConfigFor(config, model).text?.references.maxImages || 0;
    if (!configured) return "当前渠道的图片输入配置未开启或未声明，请联系管理员在“管理后台 → 渠道模型编辑 → 能力与参数 → 引用与限制 → 图片引用”确认配置；图片仍保留";
    const limit = creationAgentImageReferenceLimit(config, model);
    return imageCount > limit ? `当前会话最多可使用 ${limit} 张图片，请移除超出部分后再发送` : "";
}

export function creationAgentImageReferenceLimit(config: AiConfig, model: string) {
    return Math.min(16, Math.max(0, modelCapabilityConfigFor(config, model).text?.references.maxImages || 0));
}

export function creationManagedModelSelection(config: AiConfig, value: string): AgentModelSelection {
    if (!value.trim()) throw new Error("请先配置可用的受管模型");
    const selected = { ...config, model: value };
    const logicalModelId = logicalModelIDForConfig(selected);
    if (logicalModelId) return { logicalModelId };
    const channel = resolveModelRequestConfig(selected, value);
    const channelModelKey = modelOptionName(value);
    if (channel.channelId && channelModelKey) return { channelId: channel.channelId, channelModelKey };
    throw new Error(`模型 ${channelModelKey || value} 不是可用的受管模型，请在模型设置中选择系统渠道`);
}

export type CreationAgentRequestOptions = {
    prompt: string;
    idempotencyKey: string;
    sessionId?: string;
    permissionMode: AgentPermissionMode;
    outputPreference?: AgentOutputPreference;
    textSelection: AgentModelSelection;
    imageSelection?: AgentModelSelection;
    videoSelection?: AgentModelSelection;
    imageParameters?: MediaParameters;
    videoParameters?: MediaParameters;
    attachments?: InputAttachment[];
    attachmentMode?: "replace" | "inherit" | "append";
    budget?: { maxCredits: number; maxGenerationTasks: number; maxVideoSeconds: number };
    skillIds?: string[];
};

function managedAttachment(item: InputAttachment): AgentCreationAttachment {
    const key = item.storageKey?.trim() || "";
    const resourceId = key.startsWith("resource:") ? key.slice("resource:".length) : "";
    if (!resourceId || !/^[\w-]+$/.test(resourceId)) throw new Error(`${item.name || "参考素材"}尚未成为可用的云端资源，请先上传到素材库`);
    const kind = item.type.startsWith("image/") ? "image" : item.type.startsWith("video/") ? "video" : item.type.startsWith("audio/") ? "audio" : null;
    if (!kind) throw new Error(`${item.name || "文件"}暂不支持作为 Agent 附件；请使用图片、视频或音频`);
    return { resourceId, storageKey: key as `resource:${string}`, kind, role: item.role || "reference", name: item.name };
}

export function buildCreationAgentRunInput(input: CreationAgentRequestOptions): CreateAgentRunInput {
    const budget = input.budget || defaultCreationAgentBudget;
    const mediaChoice = (selection: AgentModelSelection | undefined, parameters?: MediaParameters): AgentMediaChoice | undefined => selection ? { selection, parameterMode: parameters?.parameterMode || "auto", ...(parameters?.parameterMode === "manual" ? { size: parameters.size, quality: parameters.quality, durationSeconds: parameters.durationSeconds, count: parameters.count } : {}) } : undefined;
    return {
        surface: "creation",
        prompt: input.prompt.trim(),
        idempotencyKey: input.idempotencyKey,
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        ...input.textSelection,
        permissionMode: input.permissionMode,
        ...(input.outputPreference ? { outputPreference: input.outputPreference } : {}),
        contextScope: [],
        contextSelection: { surface: "creation", scopes: [] },
        budget: { maxCredits: budget.maxCredits, maxGenerationTasks: input.permissionMode === "read_only" ? 0 : budget.maxGenerationTasks, maxVideoSeconds: input.permissionMode === "read_only" ? 0 : budget.maxVideoSeconds },
        ...(input.attachmentMode ? { attachmentMode: input.attachmentMode } : {}),
        ...(input.attachments?.length || input.attachmentMode === "replace" ? { attachments: (input.attachments || []).map(managedAttachment) } : {}),
        mediaSettings: { ...(mediaChoice(input.imageSelection, input.imageParameters) ? { image: mediaChoice(input.imageSelection, input.imageParameters) } : {}), ...(mediaChoice(input.videoSelection, input.videoParameters) ? { video: mediaChoice(input.videoSelection, input.videoParameters) } : {}) },
        ...(input.skillIds?.length ? { skillIds: input.skillIds } : {}),
    };
}
