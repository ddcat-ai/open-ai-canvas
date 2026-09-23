import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginManifest, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { registerPluginNodeRenderer } from "@/lib/plugins/plugin-node-renderers";
import { registerAddNodeMenuCommands, type AddNodeMenuCommand } from "@/lib/canvas/tool-registry";
import { registerNodeDefinitions } from "@/lib/canvas/node-registry";

import { MINIMAX_T2A_NODE_TYPE, MINIMAX_T2A_PLUGIN_ID } from "./contracts";
import { MinimaxT2ANodeContent } from "./MinimaxT2ANodeContent";
import { MiniMaxT2AIcon } from "./icons";

const manifest: PluginManifest = {
    apiVersion: "yingce.plugin/v1",
    id: MINIMAX_T2A_PLUGIN_ID,
    name: "MiniMax T2A 语音合成",
    version: "0.1.0",
    description: "文本转语音：语音合成、音色设计、音色克隆（独立于 IndexTTS）。",
    author: "趣影团队",
    surfaces: ["node"],
    permissions: [
        "canvas.read",
        "canvas.write",
        "media.read",
        "generation.run",
    ],
    trusted: true,
    runtime: { backend: "trusted-backend", web: "sandbox" },
    contributes: {
        canvasNodes: [
            {
                id: MINIMAX_T2A_NODE_TYPE,
                label: "MiniMax T2A 语音合成",
                defaultTitle: "MiniMax T2A 语音合成",
                defaultSize: { width: 420, height: 560 },
                schema: { type: "object", properties: {} },
                renderer: "sandbox",
            },
        ],
    },
};

export const minimaxT2APlugin: RegisteredPlugin = { manifest };

const addNodeMenuCommands: AddNodeMenuCommand[] = [
    {
        id: MINIMAX_T2A_NODE_TYPE,
        label: "MiniMax T2A 语音合成",
        icon: <MiniMaxT2AIcon />,
        badge: "语音",
        section: "node",
        defaultOrder: 200,
        run: (ctx) => ctx.handlers.onAddExtensionNode(MINIMAX_T2A_NODE_TYPE),
    },
];

registerPlugin(minimaxT2APlugin);
// 同时注册裸 key 与 scoped key：即使节点 metadata 缺 pluginId，渲染器也能命中。
registerPluginNodeRenderer(MINIMAX_T2A_NODE_TYPE, MinimaxT2ANodeContent);
registerPluginNodeRenderer(MINIMAX_T2A_NODE_TYPE, MinimaxT2ANodeContent, MINIMAX_T2A_PLUGIN_ID);
registerAddNodeMenuCommands(addNodeMenuCommands);

// 覆盖注册：给插件节点补节点定义（尺寸/元数据/创建菜单）。
registerNodeDefinitions([{
    type: MINIMAX_T2A_NODE_TYPE,
    label: "MiniMax T2A 语音合成",
    icon: <MiniMaxT2AIcon />,
    defaultTitle: "MiniMax T2A 语音合成",
    defaultSize: { width: 420, height: 560 },
    minSize: { width: 260, height: 180 },
    defaultMetadata: { pluginId: MINIMAX_T2A_PLUGIN_ID, pluginNodeId: MINIMAX_T2A_NODE_TYPE, pluginData: {}, content: "" },
    showInCreateMenu: false,
    // 音频生成节点 + 文本输入（可连线上游文本节点）
    generationMode: () => "audio",
    inputKind: "text",
    plugin: { pluginId: MINIMAX_T2A_PLUGIN_ID, renderer: "sandbox", schema: {} },
}], MINIMAX_T2A_PLUGIN_ID);
