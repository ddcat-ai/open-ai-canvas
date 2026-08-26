import { registerPlugin } from "../plugin-registry";
import { PLUGIN_API_VERSION, type PluginManifest, type RegisteredPlugin } from "../plugin-types";

export const RUNNINGHUB_PLUGIN_ID = "runninghub-workflow-provider";
export const COMFYUI_PLUGIN_ID = "comfyui-workflow-provider";

export type WorkflowProvider = "runninghub" | "comfyui";

export function workflowPluginId(provider: WorkflowProvider) {
    return provider === "runninghub" ? RUNNINGHUB_PLUGIN_ID : COMFYUI_PLUGIN_ID;
}

export function workflowProviderPluginEnabled(statuses: Record<string, string>, provider: WorkflowProvider) {
    return statuses[workflowPluginId(provider)] === "enabled";
}

function workflowContributions(providerId: string, label: string) {
    return (["image", "video", "audio"] as const).map((capability) => ({
        id: `${providerId}-${capability}`,
        label: `${label} · ${{ image: "图片", video: "视频", audio: "音频" }[capability]}`,
        providerId,
        capability,
        parameters: [],
    }));
}

const runningHubManifest: PluginManifest = {
        id: RUNNINGHUB_PLUGIN_ID,
        name: "RunningHub 工作流",
        version: "1.0.0",
        publishedAt: "2026-08-25",
        updatedAt: "2026-08-25",
        apiVersion: PLUGIN_API_VERSION,
        description: "在画布中拉取并执行 RunningHub Workflow 与 App，按工作流字段生成图片、视频和音频。",
        documentation:
            "# RunningHub 工作流\n\n该插件把 RunningHub 的 Workflow / App 接入画布工作流节点。API Key、工作流参数和字段映射仍由宿主安全保存并提交，插件本身不接触密钥。\n\n在插件设置中可以打开完整的 RunningHub 配置页，拉取工作流、编辑字段映射并测试请求。",
        author: "影策",
        surfaces: ["node", "settings"],
        permissions: ["generation.run", "external.open"],
        trusted: true,
        runtime: { backend: "trusted-backend", web: "trusted-backend" },
        contributes: { workflows: workflowContributions(RUNNINGHUB_PLUGIN_ID, "RunningHub") },
};

const comfyUIManifest: PluginManifest = {
        id: COMFYUI_PLUGIN_ID,
        name: "ComfyUI Bridge 工作流",
        version: "1.0.0",
        publishedAt: "2026-08-25",
        updatedAt: "2026-08-25",
        apiVersion: PLUGIN_API_VERSION,
        description: "通过本机或云端 Bridge 发现、映射并执行 ComfyUI API 工作流。",
        documentation:
            "# ComfyUI Bridge 工作流\n\n该插件把 ComfyUI API JSON 工作流接入画布工作流节点。Bridge 在能访问 ComfyUI 的机器上运行，工作流字段映射和执行请求由宿主处理。\n\n在插件设置中可以打开完整的 ComfyUI Bridge 配置页，注册设备、发现工作流并测试请求。",
        author: "影策",
        surfaces: ["node", "settings"],
        permissions: ["generation.run", "external.open"],
        trusted: true,
        runtime: { backend: "trusted-backend", web: "trusted-backend" },
        contributes: { workflows: workflowContributions(COMFYUI_PLUGIN_ID, "ComfyUI Bridge") },
};

registerPlugin({ manifest: runningHubManifest } satisfies RegisteredPlugin);
registerPlugin({ manifest: comfyUIManifest } satisfies RegisteredPlugin);
