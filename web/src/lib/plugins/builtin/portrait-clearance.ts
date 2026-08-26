import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginManifest, RegisteredPlugin } from "@/lib/plugins/plugin-types";

import { PORTRAIT_CLEARANCE_NODE_TYPE, PORTRAIT_CLEARANCE_PLUGIN_ID } from "@/lib/portrait-clearance/contracts";

const manifest: PluginManifest = {
    apiVersion: "yingce.plugin/v1",
    id: PORTRAIT_CLEARANCE_PLUGIN_ID,
    name: "肖像权可识别性排查",
    version: "0.1.0",
    description: "对虚拟人和人物图片执行本地人脸预检、网络候选排查与审慎风险报告。",
    author: "影策团队",
    surfaces: ["node", "fullscreen"],
    permissions: [
        "canvas.read",
        "canvas.write",
        "asset.read",
        "asset.import",
        "ai.text",
        "external.open",
    ],
    trusted: true,
    runtime: { backend: "trusted-backend", web: "declarative" },
    contributes: {
        canvasNodes: [
            {
                id: PORTRAIT_CLEARANCE_NODE_TYPE,
                label: "肖像排查",
                defaultTitle: "肖像可识别性排查",
                defaultSize: { width: 560, height: 420 },
                schema: { type: "object", properties: { portraitClearance: { type: "object" } } },
                renderer: "declarative",
            },
        ],
    },
};

export const portraitClearancePlugin: RegisteredPlugin = { manifest };

registerPlugin(portraitClearancePlugin);
