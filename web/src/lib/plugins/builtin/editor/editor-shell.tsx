import { registerPlugin } from "@/lib/plugins/plugin-registry";
import type { PluginManifestV2, RegisteredPlugin } from "@/lib/plugins/plugin-types";
import { registerEditorSlot } from "@/lib/plugins/editor-slot-registry";
import { EditorTimelinePanel } from "./editor-timeline-panel";
import { EditorPreviewMonitor } from "./editor-preview-monitor";
import { EditorSubtitleTools } from "./editor-subtitle-tools";
import { EditorInspector } from "./editor-inspector";
import { EditorAssetIngest } from "./editor-asset-ingest";
import { EditorTranscription } from "./editor-transcription";
import { EditorExport } from "./editor-export";
import { EditorAiAssistant } from "./editor-ai-assistant";

export const EDITOR_SHELL_PLUGIN_ID = "editor-shell";

const manifest: PluginManifestV2 = {
    apiVersion: "yingce.plugin/v2",
    id: EDITOR_SHELL_PLUGIN_ID,
    name: "剪辑工作台",
    version: "0.1.0",
    description: "注册时间线、预览、检查器、素材、字幕、转写、导出和 AI 编辑八个工作台插槽。",
    author: "影策团队",
    surfaces: ["fullscreen"],
    permissions: ["timeline.read", "timeline.command", "export.run"],
    trusted: true,
    runtime: { backend: "trusted-backend", web: "declarative" },
    contributes: {
        editorSlots: [
            { slot: "timeline-panel", priority: 0 },
            { slot: "preview-renderer", priority: 0 },
            { slot: "inspector", priority: 0 },
            { slot: "asset-ingest", priority: 0 },
            { slot: "subtitle-tool", priority: 0 },
            { slot: "transcription-provider", priority: 0 },
            { slot: "export-renderer", priority: 0 },
            { slot: "ai-assistant", priority: 0 },
        ],
    },
};

export const editorShellPlugin: RegisteredPlugin = {
    manifest,
    editorSlots: manifest.contributes.editorSlots ?? [],
};

registerPlugin(editorShellPlugin);

registerEditorSlot({
    pluginId: manifest.id,
    slot: "timeline-panel",
    render: () => <EditorTimelinePanel />,
});

registerEditorSlot({
    pluginId: manifest.id,
    slot: "preview-renderer",
    render: () => <EditorPreviewMonitor />,
});
registerEditorSlot({
    pluginId: manifest.id,
    slot: "inspector",
    render: () => <EditorInspector />,
});

registerEditorSlot({
    pluginId: manifest.id,
    slot: "asset-ingest",
    render: () => <EditorAssetIngest />,
});

registerEditorSlot({
    pluginId: manifest.id,
    slot: "subtitle-tool",
    render: () => <EditorSubtitleTools />,
});

registerEditorSlot({
    pluginId: manifest.id,
    slot: "transcription-provider",
    render: () => <EditorTranscription />,
});

registerEditorSlot({
    pluginId: manifest.id,
    slot: "export-renderer",
    render: () => <EditorExport />,
});

registerEditorSlot({
    pluginId: manifest.id,
    slot: "ai-assistant",
    render: () => <EditorAiAssistant />,
});
