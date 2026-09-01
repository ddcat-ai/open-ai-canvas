import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginManifestV2, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { registerEditorSlot } from "@/lib/plugins/editor-slot-registry";
import { EditorTimelinePanel } from "./editor-timeline-panel";

const manifest: PluginManifestV2 = {
    apiVersion: "yingce.plugin/v2",
    id: "editor-shell",
    name: "剪辑工作台（壳）",
    version: "0.1.0",
    description: "编辑器预设插件垂直切片：注册时间线面板插槽，验证 v2 插件插槽注册→渲染链路。",
    author: "影策团队",
    surfaces: ["fullscreen"],
    permissions: ["timeline.read"],
    trusted: true,
    runtime: { backend: "trusted-backend", web: "declarative" },
    contributes: {
        editorSlots: [{ slot: "timeline-panel", priority: 0 }],
    },
};

export const editorShellPlugin: RegisteredPlugin = {
    manifest,
    editorSlots: manifest.contributes.editorSlots ?? [],
};

registerPlugin(editorShellPlugin);

// M2.4：插槽渲染函数 = 真实时间线面板（命令状态机 + 手势）。
registerEditorSlot({
    pluginId: manifest.id,
    slot: "timeline-panel",
    render: () => <EditorTimelinePanel />,
});
