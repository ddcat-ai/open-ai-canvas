import type { PluginHostContext, PluginTextContentPart, PluginTextTool, SmartCreationAgentProvider, SmartCreationContribution } from "./plugin-types";
import { DEFAULT_SMART_CREATION_PLAN_DEFAULTS, parseSmartCreationPlan, type SmartCreationPlanDefaults, type SmartCreationPlatformDefaults } from "./smart-creation-contract";

/**
 * 通用智能创作规划器：宿主只负责把会话、参考图和 manifest 声明的策略交给文本模型，
 * 再按统一合同解析计划。提示词、工具 schema 和计划默认值全部来自插件包，缺省时
 * 回退到调用方传入的内置策略，保证插件包缺字段时行为不变。
 */
export type SmartCreationPlannerStrategy = {
    systemPrompt: string;
    tool: PluginTextTool;
    defaults: SmartCreationPlanDefaults;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function promptText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (Array.isArray(value) && value.every((line) => typeof line === "string")) return value.join("\n").trim();
    return "";
}

function stringList(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;
}

/** 合并插件声明的计划默认值；字段缺失或类型不对时保留内置默认，避免插件包写错导致计划不可用。 */
export function mergeSmartCreationDefaults(base: SmartCreationPlanDefaults, override: unknown): SmartCreationPlanDefaults {
    if (!isRecord(override)) return base;
    const taskSettings = { ...base.taskSettings };
    if (isRecord(override.taskSettings)) {
        for (const key of ["size", "aspectRatio", "quality"] as const) {
            const value = override.taskSettings[key];
            if (typeof value === "string" && value.trim()) taskSettings[key] = value.trim();
        }
    }
    const platforms = { ...base.platforms };
    if (isRecord(override.platforms)) {
        for (const platform of ["amazon", "generic"] as const) {
            const candidate = override.platforms[platform];
            if (!isRecord(candidate)) continue;
            const current: SmartCreationPlatformDefaults = platforms[platform] ?? { platformRules: [] };
            const market = candidate.market === "US" || candidate.market === "UK" || candidate.market === "DE" ? candidate.market : current.market;
            const visualDirection = typeof candidate.visualDirection === "string" && candidate.visualDirection.trim() ? candidate.visualDirection.trim() : current.visualDirection;
            platforms[platform] = { ...current, market, visualDirection, platformRules: stringList(candidate.platformRules) ?? current.platformRules };
        }
    }
    return { taskSettings, platforms };
}

/** 从 manifest 的 contributes.smartCreation 解析规划策略，缺失或无效的部分使用 fallback。 */
export function resolveSmartCreationPlannerStrategy(contribution: SmartCreationContribution | undefined, fallback: SmartCreationPlannerStrategy): SmartCreationPlannerStrategy {
    const planner = isRecord(contribution?.planner) ? contribution.planner : undefined;
    const systemPrompt = promptText(planner?.systemPrompt) || fallback.systemPrompt;
    const declaredTool = isRecord(planner?.tool) ? planner.tool : undefined;
    const toolName = typeof declaredTool?.name === "string" ? declaredTool.name.trim() : "";
    const tool: PluginTextTool = toolName && isRecord(declaredTool?.parameters)
        ? {
            type: "function",
            function: {
                name: toolName,
                description: typeof declaredTool.description === "string" ? declaredTool.description : fallback.tool.function.description,
                parameters: declaredTool.parameters,
            },
        }
        : fallback.tool;
    return { systemPrompt, tool, defaults: mergeSmartCreationDefaults(fallback.defaults, contribution?.defaults) };
}

export function createSmartCreationPlanner(context: PluginHostContext, strategy: SmartCreationPlannerStrategy, displayName = context.manifest.name): SmartCreationAgentProvider {
    const textService = context.services?.ai?.text;
    if (!textService) throw new Error(`${displayName} 智能创作暂未获得文本模型服务`);
    return {
        plan: async (input, options) => {
            const referenceParts: PluginTextContentPart[] = [];
            for (const [index, reference] of input.references.entries()) {
                referenceParts.push({ type: "text", text: `Image ${index + 1}: reference image；${reference.title || "用户提供的参考图"}${reference.text ? `；备注：${reference.text}` : ""}` });
                if (!reference.url && !reference.dataUrl && !reference.storageKey) continue;
                const resolved = context.services?.media?.resolve
                    ? await context.services.media.resolve({ title: reference.title, url: reference.url, dataUrl: reference.dataUrl, storageKey: reference.storageKey, kind: reference.kind || "image", mimeType: reference.mimeType }, options?.signal)
                    : { dataUrl: reference.dataUrl || reference.url || "", mimeType: reference.mimeType || "image/png" };
                referenceParts.push({ type: "image_url", image_url: { url: resolved.dataUrl } });
            }
            const toolName = strategy.tool.function.name;
            const response = await textService.requestToolResponse({
                messages: [
                    { role: "system", content: strategy.systemPrompt },
                    ...input.conversation,
                    {
                        role: "user",
                        content: [
                            { type: "text", text: JSON.stringify({ generationMode: input.generationMode, targetModel: input.targetModel, targetProtocol: input.targetProtocol, referenceCount: input.references.length }) },
                            ...referenceParts,
                        ],
                    },
                ],
                tools: [strategy.tool],
                toolChoice: { type: "function", name: toolName },
                signal: options?.signal,
                onDelta: options?.onDelta,
            });
            const toolCall = response.toolCalls.find((call) => call.name === toolName);
            const plan = parseSmartCreationPlan(toolCall?.arguments || response.content, strategy.defaults);
            const message = plan.questions.length
                ? `我只需要确认一个关键点：\n- ${plan.questions[0]}`
                : "我已根据你的提示词和参考图完成规划，正在按计划生成。";
            return { message, plan };
        },
    };
}

export type SmartCreationExecutionOptions = {
    maxTasks: number;
    maxConcurrency: number;
    anchorFirst: boolean;
    capacityWaitMs: number;
};

export const DEFAULT_SMART_CREATION_EXECUTION: SmartCreationExecutionOptions = { maxTasks: 12, maxConcurrency: 4, anchorFirst: false, capacityWaitMs: 10 * 60_000 };

function boundedInteger(value: unknown, min: number, max: number, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, Math.floor(value))) : fallback;
}

/** 执行参数由插件声明，宿主统一限幅；实际并发还会再与账号 activeTaskLimit 取最小值。 */
export function resolveSmartCreationExecution(contribution: SmartCreationContribution | undefined): SmartCreationExecutionOptions {
    const execution = isRecord(contribution?.execution) ? contribution.execution : {};
    return {
        maxTasks: boundedInteger(execution.maxTasks, 1, 15, DEFAULT_SMART_CREATION_EXECUTION.maxTasks),
        maxConcurrency: boundedInteger(execution.maxConcurrency, 1, 15, DEFAULT_SMART_CREATION_EXECUTION.maxConcurrency),
        anchorFirst: typeof execution.anchorFirst === "boolean" ? execution.anchorFirst : DEFAULT_SMART_CREATION_EXECUTION.anchorFirst,
        capacityWaitMs: boundedInteger(execution.capacityWaitMs, 0, 30 * 60_000, DEFAULT_SMART_CREATION_EXECUTION.capacityWaitMs),
    };
}
