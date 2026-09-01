import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginManifestV2, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { registerEditorSlot } from "@/lib/plugins/editor-slot-registry";
import { EditorTimelinePanel } from "./editor-timeline-panel";
import { EditorPreviewMonitor } from "./editor-preview-monitor";
import { EditorInspector } from "./editor-inspector";
import { EditorAssetIngest } from "./editor-asset-ingest";
import { EditorSubtitleTools } from "./editor-subtitle-tools";

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
        editorSlots: [
            { slot: "timeline-panel", priority: 0 },
            { slot: "preview-renderer", priority: 0 },
            { slot: "inspector", priority: 0 },
            { slot: "asset-ingest", priority: 0 },
            { slot: "subtitle-tool", priority: 0 },
        ],
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

// M3.2：插槽渲染函数 = 预览监视器（浏览器内近似预览 + 播放头）。
registerEditorSlot({
    pluginId: manifest.id,
    slot: "preview-renderer",
    render: () => <EditorPreviewMonitor />,
});
// M3.3：插槽渲染函数 = 片段检查器（属性编辑入队可撤销）。
registerEditorSlot({
    pluginId: manifest.id,
    slot: "inspector",
    render: () => <EditorInspector />,
});

// M3.4：插槽渲染函数 = 素材库（点击资产 → addClip 入轨）。
registerEditorSlot({
    pluginId: manifest.id,
    slot: "asset-ingest",
    render: () => <EditorAssetIngest />,
});

// M3.5：插槽渲染函数 = 字幕工具（SRT 导入导出 + 从节点重建字幕快照）。
registerEditorSlot({
    pluginId: manifest.id,
    slot: "subtitle-tool",
    render: () => <EditorSubtitleTools />,
});
