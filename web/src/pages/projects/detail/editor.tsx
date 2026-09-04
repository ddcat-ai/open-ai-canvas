import { useEffect, useRef, useState } from "react";
import {
    AlertTriangle,
    Check,
    CircleDot,
    Download,
    Loader2,
    Maximize,
    Minimize,
    PanelRightClose,
    PanelRightOpen,
    Redo2,
    Sparkles,
    Undo2,
    X,
} from "lucide-react";

import type { ProjectAsset, ProjectDetail, ShotArtifact } from "@/services/api/projects";
import { linkProjectAsset, listProjectAssets } from "@/services/api/projects";
import { useEditorSlots, type EditorSlotRegistration } from "@/lib/plugins/editor-slot-registry";
import { pluginMayRenderEditorSlot } from "@/lib/plugins/plugin-permission-check";
import { EditorStoreProvider } from "@/components/editor/editor-context";
import { createEditorStore } from "@/stores/editor/editor-store";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { normalizeTimelineProject } from "@/lib/timeline/timeline-tracks";
import { formatTimelineTime } from "@/lib/timeline/timeline-view";
import { useEditorStoreContext } from "@/components/editor/editor-context";
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

/** 插槽堆叠：渲染该区域权限通过的插槽贡献（fail-closed，M5.2）；
 *  缺权限插件不渲染，改为一行诊断提示；无贡献时显示空态（停用插件可见）。 */
function SlotStack({ slots, emptyHint }: { slots: EditorSlotRegistration[]; emptyHint: string }) {
    const allowed = slots.filter((slot) => pluginMayRenderEditorSlot(slot.pluginId, slot.slot).allowed);
    const denied = slots.filter((slot) => !pluginMayRenderEditorSlot(slot.pluginId, slot.slot).allowed);
    if (allowed.length === 0 && denied.length === 0) {
        return (
            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-4 text-center">
                <p className="max-w-md text-sm text-[var(--director-dock-fg)]">{emptyHint}</p>
            </div>
        );
    }
    return (
        <>
            {allowed.map((slot) => (
                <div key={slot.id} className="min-h-0 flex-1 overflow-hidden">
                    {slot.render({ pluginId: slot.pluginId })}
                </div>
            ))}
            {denied.map((slot) => {
                const verdict = pluginMayRenderEditorSlot(slot.pluginId, slot.slot);
                const missing =
                    verdict.allowed === false && verdict.reason === "missing-permission" ? verdict.missing : null;
                return (
                    <div
                        key={slot.id}
                        title={`插件 ${slot.pluginId} 缺少 ${missing ?? "注册"}，已按 fail-closed 拒绝渲染`}
                        className="flex min-h-8 shrink-0 items-center gap-2 bg-[var(--director-danger)]/10 px-3 text-[11px] text-[var(--director-danger)]"
                    >
                        <AlertTriangle className="size-3 shrink-0" />
                        <span className="truncate">
                            {missing
                                ? `插件 ${slot.pluginId} 缺少 ${missing} 权限，已停用该面板。`
                                : `插件 ${slot.pluginId} 未注册，已停用该面板。`}
                        </span>
                    </div>
                );
            })}
        </>
    );
}

/** 面板 Tab 条（Concat 式分类/属性切换）：只渲染激活槽，全部槽始终注册。 */
function PanelTabs({
    tabs,
    active,
    onChange,
    trailing,
}: {
    tabs: { id: string; label: string }[];
    active: string;
    onChange: (id: string) => void;
    trailing?: React.ReactNode;
}) {
    return (
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-1.5">
            {tabs.map((tab) => (
                <button
                    key={tab.id}
                    type="button"
                    onClick={() => onChange(tab.id)}
                    className={`h-7 rounded-md px-2.5 text-xs transition-colors ${
                        active === tab.id
                            ? "bg-[var(--director-dock-active-surface)] text-[var(--director-dock-fg-strong)]"
                            : "text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                    }`}
                >
                    {tab.label}
                </button>
            ))}
            <div className="flex-1" />
            {trailing}
        </div>
    );
}

/** 顶部工具栏（Concat 主菜单区）：项目名 + 全局撤销/重做 + 保存状态 + 导出主按钮。 */
function EditorTopBar({
    onExport,
    isFullscreen,
    onToggleFullscreen,
    aiOpen,
    onToggleAi,
}: {
    onExport: () => void;
    isFullscreen: boolean;
    onToggleFullscreen: () => void;
    aiOpen: boolean;
    onToggleAi: () => void;
}) {
    const { project, history, isDirty, saving, saveError, undo, redo } = useEditorStoreContext();
    const canUndo = (history?.undoStack.length ?? 0) > 0;
    const canRedo = (history?.redoStack.length ?? 0) > 0;

    return (
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3">
            <button
                type="button"
                aria-label="撤销"
                title="撤销（Cmd/Ctrl+Z）"
                onClick={undo}
                disabled={!canUndo}
                className="grid size-8 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] disabled:pointer-events-none disabled:opacity-35"
            >
                <Undo2 className="size-4" />
            </button>
            <button
                type="button"
                aria-label="重做"
                title="重做（Cmd/Ctrl+Shift+Z）"
                onClick={redo}
                disabled={!canRedo}
                className="grid size-8 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] disabled:pointer-events-none disabled:opacity-35"
            >
                <Redo2 className="size-4" />
            </button>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5">
                <span className="grid size-8 place-items-center" title={saveError ?? (saving ? "保存中" : isDirty ? "有未保存的更改" : "已保存")}>
                    {saveError ? (
                        <AlertTriangle className="size-4 text-[var(--director-danger)]" aria-label="保存失败" />
                    ) : saving ? (
                        <Loader2 className="size-4 animate-spin text-[var(--director-dock-fg)]" aria-label="保存中" />
                    ) : isDirty ? (
                        <CircleDot className="size-3.5 text-[var(--director-warning)]" aria-label="未保存" />
                    ) : (
                        <Check className="size-4 text-[var(--director-success)]" aria-label="已保存" />
                    )}
                </span>
                <button
                    type="button"
                    aria-label="AI 剪辑助手"
                    aria-pressed={aiOpen}
                    title="AI 剪辑助手（编辑意图转时间线指令）"
                    onClick={onToggleAi}
                    className={`grid size-8 place-items-center rounded-md transition-colors ${
                        aiOpen
                            ? "bg-[var(--director-dock-active-surface)] text-[var(--director-dock-fg-strong)]"
                            : "text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                    }`}
                >
                    <Sparkles className="size-4" />
                </button>
                <button
                    type="button"
                    aria-label={isFullscreen ? "退出全屏" : "全屏编辑"}
                    title={isFullscreen ? "退出全屏（Esc）" : "全屏编辑"}
                    onClick={onToggleFullscreen}
                    className="grid size-8 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                >
                    {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
                </button>
                <button
                    type="button"
                    aria-label="导出"
                    title="导出"
                    onClick={onExport}
className="grid size-8 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] hover:text-[var(--director-dock-fg-strong)]"
                >
                    <Download className="size-4" />
                </button>
            </div>
        </header>
    );
}

/** 底部状态栏：时长 / 片段数 / 轨道数 / 快捷键提示。 */
function EditorStatusBar({ projectName }: { projectName: string }) {
    const { project } = useEditorStoreContext();
    const clipCount = project?.clips.length ?? 0;
    const trackCount = project?.tracks.length ?? 0;
    const durationMs = project?.durationMs ?? 0;

    return (
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3 text-[10px] text-[var(--director-dock-fg)]">
            <span className="truncate text-[var(--director-dock-fg-strong)]">{projectName}</span>
            <span className="tabular-nums">时长 {formatTimelineTime(durationMs)}</span>
            <span>片段 {clipCount}</span>
            <span>轨道 {trackCount}</span>
            <div className="flex-1" />
            <span className="hidden sm:inline">⌘Z 撤销 · ⇧⌘Z 重做 · 拖拽移动 / 边缘裁剪片段</span>
        </footer>
    );
}

export default function ProjectEditorView({ detail }: { detail: ProjectDetail }) {
    // 插槽注册（全部 8 种始终注册；左/右栏 Tab 决定当前渲染哪个）。
    const previewSlots = useEditorSlots("preview-renderer");
    const timelineSlots = useEditorSlots("timeline-panel");
    const assetSlots = useEditorSlots("asset-ingest");
    const transcriptionSlots = useEditorSlots("transcription-provider");
    const inspectorSlots = useEditorSlots("inspector");
    const subtitleSlots = useEditorSlots("subtitle-tool");
    const exportSlots = useEditorSlots("export-renderer");
    const aiSlots = useEditorSlots("ai-assistant");

    const [leftTab, setLeftTab] = useState("asset");
    const [rightTab, setRightTab] = useState("inspector");

    const [rightCollapsed, setRightCollapsed] = useState(false);
    const [assets, setAssets] = useState<ProjectAsset[]>(detail.assets);
    const workbenchRef = useRef<HTMLDivElement | null>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    // AI 助手浮层（顶部工具按钮触发，M6.3；Esc / 点击遮罩关闭）。
    const [aiOpen, setAiOpen] = useState(false);
    useEffect(() => {
        if (!aiOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setAiOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [aiOpen]);

    // 底部时间线高度（px）：分隔条拖拽调整（120–480）。
    const [timelineH, setTimelineH] = useState(240);
    const splitterRef = useRef<{ startY: number; startH: number } | null>(null);

    const refreshAssets = async (): Promise<ProjectAsset[] | null> => {
        try {
            const list = (await listProjectAssets(projectId)).assets;
            setAssets(list);
            return list;
        } catch {
            // 刷新失败保留现有列表；调用方可据此决定是否重试
            return null;
        }
    };

    useEffect(() => {
        const onFsChange = () => setIsFullscreen(document.fullscreenElement === workbenchRef.current);
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);

    const toggleFullscreen = () => {
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => {});
        } else {
            void workbenchRef.current?.requestFullscreen().catch(() => {});
        }
    };

    const scope = getActiveUserScope();
    const projectId = detail.project.id;

    // 挂载/切换项目时以服务端为准同步一次资产：detail.assets 只是详情页快照，
    // 上个会话导入但详情未携带（或导入后未刷新）的素材会在进入编辑器后补现。
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            const list = await refreshAssets();
            if (!cancelled && list) setAssets(list);
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId]);

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
            // 卸载前冲刷尚未落盘的改动（如切页发生在防抖窗口内），避免最后几次操作丢失。
            void store.getState().flushSave?.().catch(() => {});
        };
    }, [scope, projectId, store]);

    // 画布产物自动同步：detail.shotArtifacts 中当前采用(storyboard/action_board/
    // 分镜/导出成片，且 ready + 有资源)尚未作为素材进本项目时，自动
    // linkProjectAsset(source=canvas) 并入素材库 —— 剪辑器“素材选项”直接可用画布产物。
    // 后端幂等(已链接直接返回)，失败静默，下次进入编辑器自动补同步；
    // 已完成集合记录在 ref，避免同一会话重复请求。
    const syncedCanvasResourcesRef = useRef<Set<string>>(new Set());
    const canvasSyncKeys = detail.shotArtifacts
        .filter(
            (a): a is ShotArtifact & { resourceId: string } =>
                a.selected &&
                a.status === "ready" &&
                !!a.resourceId &&
                ["storyboard", "action_board", "start_frame", "end_frame", "video", "delivery"].includes(a.type),
        )
        .map((a) => `resource:${a.resourceId}`)
        .join(",");
    useEffect(() => {
        if (!canvasSyncKeys) return;
        const keys = canvasSyncKeys.split(",");
        // 已同步过的(本会话 ref)或已存在于项目素材的(storageKey 命中)均跳过 ——
        // storageKey 与 assetFromUploadedResource 合成格式一致(resource:<id>)。
        const existing = new Set(assets.map((a) => a.storageKey));
        const pending = keys.filter((key) => !syncedCanvasResourcesRef.current.has(key) && !existing.has(key));
        if (!pending.length) return;
        let cancelled = false;
        void (async () => {
            for (const key of pending) {
                if (cancelled) break;
                const resourceId = key.slice("resource:".length);
                try {
                    await linkProjectAsset(projectId, { assetId: resourceId, category: "material", source: "canvas" });
                    syncedCanvasResourcesRef.current.add(key);
                } catch {
                    // 单个同步失败不阻塞其余；留待下次进入编辑器重试
                }
            }
            if (!cancelled) {
                // 直接拉取最新列表(setAssets 稳定)而非经 refreshAssets，
                // 避免闭包依赖变化导致 effect 反复触发
                try {
                    const list = (await listProjectAssets(projectId)).assets;
                    if (!cancelled) setAssets(list);
                } catch {
                    // 刷新失败保留现有列表，下次进入编辑器再同步
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [canvasSyncKeys, projectId, assets]);

    return (
        <EditorStoreProvider store={store} host={{ projectId, assets, refreshAssets }}>
            <div ref={workbenchRef} className="editor-workbench relative flex h-full min-h-0 flex-col bg-[var(--director-workspace-bg)]">
                <EditorTopBar
                    onExport={() => setRightTab("export")}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={toggleFullscreen}
                    aiOpen={aiOpen}
                    onToggleAi={() => setAiOpen((v) => !v)}
                />
                {/* AI 助手浮层：常驻挂载、随开关显隐，关闭再开保留会话与输入（状态在 SlotStack 内）。 */}
                <div className={aiOpen ? "contents" : "hidden"}>
                    <button
                        type="button"
                        aria-label="关闭 AI 助手"
                        tabIndex={-1}
                        className="fixed inset-0 z-30 cursor-default bg-transparent"
                        onClick={() => setAiOpen(false)}
                    />
                    <div className="absolute right-2 top-14 z-40 flex h-[640px] max-h-[calc(100%-3.75rem)] w-[460px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface)] shadow-[0_12px_40px_rgba(0,0,0,0.5)]">
                        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--director-sequencer-border)] px-3">
                            <Sparkles className="size-4 text-[var(--director-dock-fg)]/80" />
                            <span className="text-xs font-medium text-[var(--director-dock-fg-strong)]">AI 剪辑助手</span>
                            <span className="hidden truncate text-[10px] text-[var(--director-dock-fg)]/45 sm:inline">
                                编辑意图 → 时间线指令（宿主校验）
                            </span>
                            <div className="flex-1" />
                            <button
                                type="button"
                                aria-label="关闭"
                                title="关闭（Esc）"
                                onClick={() => setAiOpen(false)}
                                className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                            >
                                <X className="size-4" />
                            </button>
                        </div>
                        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                            <SlotStack slots={aiSlots} emptyHint="AI 助手插件未加载。" />
                        </div>
                    </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
                    {/* 上区：左栏 + 预览 + 右栏 */}
                    <div className="flex min-h-0 flex-1 gap-2">
                        {/* 左栏：素材 / 转写（Tab 化） */}
                        <aside className="flex h-full w-64 shrink-0 flex-col overflow-hidden rounded-xl bg-[var(--director-sequencer-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                            <PanelTabs
                                tabs={[
                                    { id: "asset", label: "素材" },
                                    { id: "transcription", label: "转写" },
                                ]}
                                active={leftTab}
                                onChange={setLeftTab}
                            />
                            {leftTab === "asset" ? (
                                <SlotStack slots={assetSlots} emptyHint="素材库插件未加载。" />
                            ) : (
                                <SlotStack slots={transcriptionSlots} emptyHint="转写插件未加载。" />
                            )}
                        </aside>

                        {/* 中栏：预览（占满剩余高度） */}
                        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-[var(--director-sequencer-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                            <SlotStack slots={previewSlots} emptyHint="预览插件未加载。" />
                        </main>

                        {/* 右栏：检查 / 字幕 / 导出（Tab 化，可折叠为窄条；AI 助手已移至顶栏浮层） */}
                        {rightCollapsed ? (
                            <aside className="flex h-full w-9 shrink-0 flex-col items-center overflow-hidden rounded-xl bg-[var(--director-sequencer-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                                <button
                                    type="button"
                                    aria-label="展开检查器"
                                    title="展开检查器"
                                    onClick={() => setRightCollapsed(false)}
                                    className="mt-1.5 grid size-8 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                                >
                                    <PanelRightOpen className="size-4" />
                                </button>
                            </aside>
                        ) : (
                            <aside className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-xl bg-[var(--director-sequencer-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
                                <PanelTabs
                                    tabs={[
                                        { id: "inspector", label: "检查" },
                                        { id: "subtitle", label: "字幕" },
                                        { id: "export", label: "导出" },
                                    ]}
                                    active={rightTab}
                                    onChange={setRightTab}
                                    trailing={
                                        <button
                                            type="button"
                                            aria-label="折叠检查器"
                                            title="折叠检查器"
                                            onClick={() => setRightCollapsed(true)}
                                            className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                                        >
                                            <PanelRightClose className="size-3.5" />
                                        </button>
                                    }
                                />
                                {rightTab === "inspector" ? (
                                    <SlotStack slots={inspectorSlots} emptyHint="检查器插件未加载。" />
                                ) : rightTab === "subtitle" ? (
                                    <SlotStack slots={subtitleSlots} emptyHint="字幕工具插件未加载。" />
                                ) : (
                                    <SlotStack slots={exportSlots} emptyHint="导出插件未加载。" />
                                )}
                            </aside>
                        )}
                    </div>

                    {/* 预览/时间线拖拽分隔条（pointer capture，data-canvas-no-zoom 防画布缩放） */}
                    <div
                        className="group relative z-10 -my-1 flex h-3 shrink-0 cursor-row-resize touch-none items-center justify-center"
                        role="separator"
                        aria-orientation="horizontal"
                        aria-label="调整时间线高度"
                        data-canvas-no-zoom
                        onPointerDown={(e) => {
                            splitterRef.current = { startY: e.clientY, startH: timelineH };
                            e.currentTarget.setPointerCapture(e.pointerId);
                        }}
                        onPointerMove={(e) => {
                            const drag = splitterRef.current;
                            if (!drag) return;
                            const next = drag.startH - (e.clientY - drag.startY);
                            setTimelineH(Math.min(480, Math.max(120, next)));
                        }}
                        onPointerUp={() => {
                            splitterRef.current = null;
                        }}
                        onPointerCancel={() => {
                            splitterRef.current = null;
                        }}
                    >
                        <div className="h-1 w-10 rounded-full bg-[var(--director-sequencer-border)] transition-colors group-hover:bg-[var(--director-dock-fg-strong)]/60" />
                    </div>

                    {/* 时间线：横跨编辑面板全宽（左栏到右栏） */}
                    <div className="flex h-full shrink-0 flex-col overflow-hidden rounded-xl bg-[var(--director-sequencer-surface)] shadow-[0_1px_2px_rgba(0,0,0,0.3)]" style={{ height: `${timelineH}px` }}>
                        <SlotStack slots={timelineSlots} emptyHint="时间线面板插件未加载。" />
                    </div>
                </div>

                <EditorStatusBar projectName={detail.project.name} />
            </div>
        </EditorStoreProvider>
    );
}
