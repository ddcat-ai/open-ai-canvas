import { registerPlugin } from "../plugin-registry";
import type { RegisteredPlugin } from "../plugin-types";

export const RUNNINGHUB_PLUGIN_ID = "runninghub-workflow-provider";
export const COMFYUI_PLUGIN_ID = "comfyui-workflow-provider";

const runningHubPlugin: RegisteredPlugin = {
    manifest: {
        id: RUNNINGHUB_PLUGIN_ID,
        name: "RunningHub 工作流",
        version: "1.0.0",
        publishedAt: "2026-08-25",
        updatedAt: "2026-08-25",
        apiVersion: "1",
        category: "workflow",
        description: "在画布中拉取并执行 RunningHub Workflow 与 App，按工作流字段生成图片、视频和音频。",
        documentation: "# RunningHub 工作流\n\n该插件把 RunningHub 的 Workflow / App 接入画布工作流节点。API Key、工作流参数和字段映射仍由宿主安全保存并提交，插件本身不接触密钥。\n\n在插件设置中可以打开完整的 RunningHub 配置页，拉取工作流、编辑字段映射并测试请求。",
        author: "影策",
        surfaces: ["node", "fullscreen"],
        permissions: ["generation.run", "external.open"],
        trusted: true,
        kind: "ui",
        configuration: { fields: ["runningHubSettings"] },
    },
};

const comfyUIPlugin: RegisteredPlugin = {
    manifest: {
        id: COMFYUI_PLUGIN_ID,
        name: "ComfyUI Bridge 工作流",
        version: "1.0.0",
        publishedAt: "2026-08-25",
        updatedAt: "2026-08-25",
        apiVersion: "1",
        category: "workflow",
        description: "通过本机或云端 Bridge 发现、映射并执行 ComfyUI API 工作流。",
        documentation: "# ComfyUI Bridge 工作流\n\n该插件把 ComfyUI API JSON 工作流接入画布工作流节点。Bridge 在能访问 ComfyUI 的机器上运行，工作流字段映射和执行请求由宿主处理。\n\n在插件设置中可以打开完整的 ComfyUI Bridge 配置页，注册设备、发现工作流并测试请求。",
        author: "影策",
        surfaces: ["node", "fullscreen"],
        permissions: ["generation.run", "external.open"],
        trusted: true,
        kind: "ui",
        configuration: { fields: ["comfyUISettings"] },
    },
};

registerPlugin(runningHubPlugin);
registerPlugin(comfyUIPlugin);

