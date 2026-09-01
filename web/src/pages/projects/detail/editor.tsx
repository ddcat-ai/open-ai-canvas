import { useEffect, useState } from "react";

import type { ProjectDetail } from "@/services/api/projects";
import { useEditorSlots, type EditorSlotRegistration } from "@/lib/plugins/editor-slot-registry";
import { EditorStoreProvider } from "@/components/editor/editor-context";
import { createEditorStore } from "@/stores/editor/editor-store";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { normalizeTimelineProject } from "@/lib/timeline/timeline-tracks";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

const EDITOR_TIMELINE_KEY = "editor-timeline";

/** M2.4 演示种子：首次进入项目编辑器且无本地时间线时初始化一个可交互示例。
 *  M4 接入真实数据源（画布节点 / 后端项目时间线）后移除。 */
function createEditorSeed(projectId: string): TimelineProject {
    const clips: TimelineClip[] = [
        { id: `${projectId}:demo-v1`, kind: "video", nodeId: "demo-node-a", trackId: "video-1", startMs: 0, durationMs: 5000, sourceStartMs: 0, sourceDurationMs: 5000 },
        { id: `${projectId}:demo-v2`, kind: "video", nodeId: "demo-node-b", trackId: "video-1", startMs: 6000, durationMs: 3000, sourceStartMs: 1000, sourceDurationMs: 8000 },
        { id: `${projectId}:demo-a1`, kind: "audio", nodeId: "demo-node-a", trackId: "audio-1", startMs: 0, durationMs: 5000, sourceStartMs: 0, sourceDurationMs: 5000, volume: 0.8 },
        { id: `${projectId}:demo-s1`, kind: "subtitle", nodeId: "demo-node-a", trackId: "subtitle-1", startMs: 500, durationMs: 2000, subtitleEntryIndex: 0, text: "示例字幕" },
    ];
    return normalizeTimelineProject({
        version: 2,
        tracks: [
            { id: "video-1", kind: "video", label: "视频 1", order: 0 },
            { id: "audio-1", kind: "audio", label: "音频 1", order: 1 },
            { id: "subtitle-1", kind: "subtitle", label: "字幕 1", order: 2 },
        ],
        clips,
        durationMs: 9000,
    });
}

/** 插槽堆叠：渲染某区域的全部插槽贡献；无贡献时显示空态（停用插件可见）。 */
function SlotStack({ slots, emptyHint }: { slots: EditorSlotRegistration[]; emptyHint: string }) {
    if (slots.length === 0) {
        return (
            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-4 text-center">
                <p className="max-w-md text-sm text-foreground/52">{emptyHint}</p>
            </div>
        );
    }
    return (
        <>
            {slots.map((slot) => (
                <div key={slot.id} className="min-h-0 flex-1 overflow-hidden">
                    {slot.render({ pluginId: slot.pluginId })}
                </div>
            ))}
        </>
    );
}

export default function ProjectEditorView({ detail }: { detail: ProjectDetail }) {
    // M3.8：编辑器视图按三段式布局渲染全部 8 种插槽（左：素材/转写；中：预览/时间线；右：检查器/字幕/导出/AI）。
    const previewSlots = useEditorSlots("preview-renderer");
    const timelineSlots = useEditorSlots("timeline-panel");
    const assetSlots = useEditorSlots("asset-ingest");
    const transcriptionSlots = useEditorSlots("transcription-provider");
    const inspectorSlots = useEditorSlots("inspector");
    const subtitleSlots = useEditorSlots("subtitle-tool");
    const exportSlots = useEditorSlots("export-renderer");
    const aiSlots = useEditorSlots("ai-assistant");

    const scope = getActiveUserScope();
    const projectId = detail.project.id;

    const store = useState(() =>
        createEditorStore({
            saveTimeline: async (project: TimelineProject) => {
                await localForageStorageForScope(scope).setItem(`${EDITOR_TIMELINE_KEY}:${projectId}`, JSON.stringify(project));
            },
        }),
    )[0];

    // 进入编辑器时加载本地时间线；无则初始化演示种子（不触发保存，历史从该状态起步）。
    useEffect(() => {
        let cancelled = false;
        (async () => {
            const storage = localForageStorageForScope(scope);
            const raw = await storage.getItem(`${EDITOR_TIMELINE_KEY}:${projectId}`);
            const loaded = raw ? normalizeTimelineProject(JSON.parse(raw)) : createEditorSeed(projectId);
            if (!cancelled) store.getState().load(loaded);
        })();
        return () => {
            cancelled = true;
        };
    }, [scope, projectId, store]);

    return (
        <EditorStoreProvider store={store} host={{ projectId, assets: detail.assets }}>
            <div className="flex h-full min-h-0 gap-px bg-border/40">
                {/* 左栏：素材库 + 转写 */}
                <aside className="flex h-full w-60 shrink-0 flex-col bg-[var(--workspace-surface)]">
                    <SlotStack slots={assetSlots} emptyHint="素材库插件未加载。" />
                    <SlotStack slots={transcriptionSlots} emptyHint="转写插件未加载。" />
                </aside>
                {/* 中栏：预览（上）+ 时间线（下） */}
                <main className="flex min-h-0 min-w-0 flex-1 flex-col">
                    <div className="min-h-0 flex-[2] overflow-hidden bg-[var(--workspace-surface)]">
                        <SlotStack slots={previewSlots} emptyHint="预览插件未加载。" />
                    </div>
                    <div className="min-h-0 flex-[3] overflow-hidden bg-[var(--workspace-surface)]">
                        <SlotStack slots={timelineSlots} emptyHint="时间线面板插件未加载。" />
                    </div>
                </main>
                {/* 右栏：检查器 + 字幕 + 导出 + AI */}
                <aside className="flex h-full w-72 shrink-0 flex-col bg-[var(--workspace-surface)]">
                    <SlotStack slots={inspectorSlots} emptyHint="检查器插件未加载。" />
                    <SlotStack slots={subtitleSlots} emptyHint="字幕工具插件未加载。" />
                    <SlotStack slots={exportSlots} emptyHint="导出插件未加载。" />
                    <SlotStack slots={aiSlots} emptyHint="AI 助手插件未加载。" />
                </aside>
            </div>
        </EditorStoreProvider>
    );
}
