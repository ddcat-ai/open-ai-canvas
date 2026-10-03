import { registerPlugin } from "../plugin-registry";
import type { PluginHostContext, PluginManifest, PluginTextTool, RegisteredPlugin, SmartCreationAgentProvider, SmartCreationContribution } from "../plugin-types";
import { createSmartCreationPlanner, resolveSmartCreationPlannerStrategy, type SmartCreationPlannerStrategy } from "../smart-creation-agent";
import { DEFAULT_SMART_CREATION_PLAN_DEFAULTS } from "../smart-creation-contract";
import fallbackPlanner from "./igo-studio-planner.json";

export const IGO_STUDIO_PLUGIN_ID = "igo-studio-ecommerce-agent";

/**
 * 宿主内置的兜底策略，只在插件包 manifest 没有声明 planner 时使用。
 * 日常调整提示词、schema、默认值和执行参数请改插件包的 contributes.smartCreation，
 * 宿主会优先使用插件包里的版本。
 */
const fallbackStrategy: SmartCreationPlannerStrategy = {
    systemPrompt: fallbackPlanner.systemPrompt.join("\n"),
    tool: { type: "function", function: fallbackPlanner.tool as PluginTextTool["function"] },
    defaults: DEFAULT_SMART_CREATION_PLAN_DEFAULTS,
};

export function createSmartCreationAgent(context: PluginHostContext): SmartCreationAgentProvider {
    const contribution = context.manifest?.contributes.smartCreation as SmartCreationContribution | undefined;
    return createSmartCreationPlanner(context, resolveSmartCreationPlannerStrategy(contribution, fallbackStrategy), "电商智能创作");
}

export const igoStudioManifest: PluginManifest = {
    apiVersion: "yingce.plugin/v1",
    id: IGO_STUDIO_PLUGIN_ID,
    name: "电商智能创作",
    version: "0.2.0",
    author: "iGO Studio",
    description: "创作输入框里的对话式智能创作 Agent，支持 Amazon 套图规划。",
    documentation: "docs/interface.md",
    trusted: true,
    runtime: { web: "trusted-backend" },
    permissions: ["ai.text", "generation.run", "media.read", "asset.read"],
    contributes: {
        aiCapabilities: ["smart-creation", "amazon-set-planner", "amazon-style-lock"],
        smartCreation: { entry: "smart-creation", label: "智能创作" },
    },
};

export const igoStudioPlugin: RegisteredPlugin = {
    manifest: igoStudioManifest,
    createSmartCreationAgent,
};

registerPlugin(igoStudioPlugin);
