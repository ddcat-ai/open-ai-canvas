import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginManifest, RegisteredPlugin } from "@/lib/plugins/plugin-types";

import { ART_CRITIQUE_NODE_TYPE, ART_CRITIQUE_PLUGIN_ID } from "@/lib/art-critique/contracts";

const manifest: PluginManifest = {
    apiVersion: "yingce.plugin/v1",
    id: ART_CRITIQUE_PLUGIN_ID,
    name: "AI 审美批改",
    version: "0.1.0",
    description: "分析图片的构图、色彩、光线和比例问题，输出结构化批改报告与可视化标注。",
    author: "内置工具",
    surfaces: ["node", "fullscreen"],
    permissions: ["canvas.read", "canvas.write", "media.read", "ai.text"],
    trusted: true,
    runtime: { backend: "trusted-backend", web: "declarative" },
    contributes: {
        canvasNodes: [
            {
                id: ART_CRITIQUE_NODE_TYPE,
                label: "AI 审美批改",
                defaultTitle: "AI 审美批改",
                defaultSize: { width: 560, height: 420 },
                schema: { type: "object", properties: { artCritique: { type: "object" } } },
                renderer: "declarative",
                acceptsInputKind: "image",
                showOutputConnection: false,
            },
        ],
    },
};

export const artCritiquePlugin: RegisteredPlugin = { manifest };

registerPlugin(artCritiquePlugin);
