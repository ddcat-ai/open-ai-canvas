import { normalizeRunningHubCapability, type AiConfig, type RunningHubCapability, type RunningHubWorkflowKind, type WorkflowFieldMapping } from "@/stores/use-config-store";
import { workflowProviderPluginEnabled } from "@/lib/plugins/builtin/workflows";
import { usePluginStore } from "@/stores/use-plugin-store";

export type GenerationWorkflowMode = "text" | "image" | "video" | "audio";

export type GenerationWorkflowExecution = {
    provider: "runninghub" | "comfyui-bridge";
    kind: RunningHubWorkflowKind;
    capability: RunningHubCapability;
    interfaceType: string;
    name: string;
    taskModel: string;
    providerModel: string;
    workflowId: string;
    webappId: string;
    workflowJson: Record<string, unknown>;
    workflowFields: WorkflowFieldMapping[];
    bridgeId: string;
};

// 画布样式计划、任务记录和后端协议必须共用同一个工作流选择结果，避免再次回退到普通模型。
export function resolveGenerationWorkflowExecution(config: AiConfig, mode: GenerationWorkflowMode): GenerationWorkflowExecution | null {
    const workflowProvider = mode === "text" ? "model" : config.taskWorkflowProvider || "model";
    if (workflowProvider === "model") return null;

    if (workflowProvider === "runninghub") {
        if (!workflowProviderPluginEnabled(usePluginStore.getState().runtimeStatuses, "runninghub")) throw new Error("RunningHub 工作流插件未启用");
        const runningHub = config.runningHub;
        const workflowId = runningHub.workflowId.trim();
        const kind = runningHub.selectedKind === "app" ? "app" : "workflow";
        // RunningHub 工作流的参数拉取、提交和轮询固定使用积分 API Key；企业级 Key 只用于素材上传。
        const apiKey = runningHub.apiKey;
        if (!runningHub.enabled || !runningHub.baseUrl.trim() || !apiKey.trim() || !workflowId) {
            throw new Error("RunningHub 工作流配置不完整，请填写积分 API Key 并选择已保存条目");
        }
        const workflow = runningHub.workflows.find((item) => item.workflowId.trim() === workflowId && (item.kind === "app" ? "app" : "workflow") === kind);
        if (!workflow) throw new Error("当前 RunningHub 工作流条目不存在，请重新选择已保存条目");
        const capability = normalizeRunningHubCapability(workflow.capability, normalizeRunningHubCapability(runningHub.capability));
        assertWorkflowCapability("RunningHub", capability, mode);
        const webappId = kind === "app" ? (workflow.webappId || workflow.workflowId).trim() : "";
        const name = workflow.title?.trim() || webappId || workflowId;
        return {
            provider: "runninghub",
            kind,
            capability,
            interfaceType: `runninghub-workflow-${capability}`,
            name,
            taskModel: workflowTaskModel("RunningHub · ", name),
            providerModel: workflowId,
            workflowId: kind === "workflow" ? workflowId : "",
            webappId,
            workflowJson: workflow.workflowJson || {},
            workflowFields: workflow.fields || [],
            bridgeId: "",
        };
    }

    if (!workflowProviderPluginEnabled(usePluginStore.getState().runtimeStatuses, "comfyui")) throw new Error("ComfyUI Bridge 工作流插件未启用");
    const comfyBridge = config.comfyBridge;
    const workflowId = comfyBridge.workflowId.trim();
    if (!comfyBridge.enabled || !comfyBridge.bridgeId.trim() || !workflowId) {
        throw new Error("ComfyUI Bridge 配置不完整，请检查 Bridge 在线状态和已保存工作流");
    }
    const workflow = comfyBridge.workflows.find((item) => item.workflowId.trim() === workflowId);
    if (!workflow) throw new Error("当前 ComfyUI 工作流条目不存在，请重新选择已保存条目");
    const capability = normalizeRunningHubCapability(workflow.capability, normalizeRunningHubCapability(comfyBridge.capability));
    assertWorkflowCapability("ComfyUI", capability, mode);
    const name = workflow.title?.trim() || workflowId;
    return {
        provider: "comfyui-bridge",
        kind: "workflow",
        capability,
        interfaceType: `comfyui-bridge-${capability}`,
        name,
        taskModel: workflowTaskModel("ComfyUI · ", name),
        providerModel: workflowId,
        workflowId,
        webappId: "",
        workflowJson: workflow.workflowJson || {},
        workflowFields: workflow.fields || [],
        bridgeId: comfyBridge.bridgeId.trim(),
    };
}

function assertWorkflowCapability(providerName: string, capability: RunningHubCapability, mode: GenerationWorkflowMode) {
    if (capability === mode) return;
    const capabilityName = workflowCapabilityName(capability);
    const modeName = workflowCapabilityName(mode);
    throw new Error(`${providerName} 已保存条目的用途为${capabilityName}，当前节点是${modeName}生成，请切换匹配的工作流`);
}

function workflowCapabilityName(value: GenerationWorkflowMode) {
    if (value === "video") return "视频";
    if (value === "audio") return "音频";
    if (value === "text") return "文本";
    return "图片";
}

function workflowTaskModel(prefix: string, name: string) {
    return `${prefix}${Array.from(name)
        .slice(0, Math.max(0, 120 - prefix.length))
        .join("")}`;
}
