import { decodeChannelModel, modelOptionName, type AiConfig } from "@/stores/use-config-store";
import type { CanvasNodeMetadata } from "@/types/canvas";

/** 生成提交时记下的模型身份。RunningHub 任务提交的就是「RunningHub · 工作流名」。 */
export function submittedProducedModel(model: string | undefined): string | undefined {
    const value = model?.trim();
    return value || undefined;
}

export function producedModelCandidateForGeneration(config: { model?: string; taskWorkflowProvider?: string }): string | undefined {
    if (config.taskWorkflowProvider && config.taskWorkflowProvider !== "model") return undefined;
    return submittedProducedModel(config.model);
}

/**
 * 成功写入新媒体时冻结产出模型。优先用本次提交记下的候选，避免下拉框里的选用模型覆盖它。
 * 没有可用模型时清掉旧值，避免新内容继续显示上一次的模型。
 */
export function commitProducedModel(metadata: CanvasNodeMetadata, fallbackModel?: string): CanvasNodeMetadata {
    const producedModel = submittedProducedModel(metadata.producedModelCandidate) || submittedProducedModel(fallbackModel);
    const { producedModelCandidate: _candidate, producedModel: _previous, ...rest } = metadata;
    return producedModel ? { ...rest, producedModel } : rest;
}

/** 按当前模型目录解析角标。有展示名用展示名，否则用模型 ID，不把系统渠道收成「系统模型」。 */
export function producedModelLabel(config: Pick<AiConfig, "channels">, stored: string | undefined): string {
    const value = stored?.trim();
    if (!value) return "";
    const decoded = decodeChannelModel(value);
    const modelId = decoded?.model || value;
    if (decoded) {
        const channel = config.channels.find((item) => item.id === decoded.channelId);
        if (!channel) return modelId;
        return channel.modelCosts?.find((item) => item.model === modelId)?.displayName?.trim() || modelId;
    }
    for (const item of config.channels) {
        const named = item.modelCosts?.find((entry) => entry.model === modelId || entry.logicalModelId === modelId)?.displayName?.trim();
        if (named) return named;
    }
    return modelId;
}

export function producedModelSearchTerms(metadata: CanvasNodeMetadata | undefined, config?: AiConfig): string[] {
    const stored = metadata?.producedModel?.trim();
    if (!stored) return [];
    const modelId = modelOptionName(stored);
    const label = config ? producedModelLabel(config, stored) : modelId;
    return [stored, modelId, label].filter((value, index, all) => Boolean(value) && all.indexOf(value) === index);
}
