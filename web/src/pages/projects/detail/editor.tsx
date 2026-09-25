import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { usePluginStore } from "@/stores/use-plugin-store";
import type { TimelineProject } from "@/types/timeline";

const EDITOR_TIMELINE_KEY = "editor-timeline";

/**
 * 为尚未产生本地时间线的项目建立一个可编辑的初始时间线。
 * 该时间线只写入当前用户与项目作用域的本地存储，不代表服务端已有成片数据。
 */
function createEmptyEditorTimeline(): TimelineProject {
    // 没有真实素材时返回空时间线，避免把不存在的 demo node 当成可剪辑资产。
    // 用户添加素材后由编辑器命令创建轨道和片段；空项目不应被伪造为已有成片。
    return normalizeTimelineProject({ version: 2, tracks: [], clips: [], durationMs: 0 });
}

/** 插槽堆叠：只渲染通过权限检查的插件贡献；无可用插件时显示明确的缺失能力提示。
 *  缺权限插件不渲染，改为一行诊断提示；无贡献时显示空态（停用插件可见）。 */
function SlotStack({ slots, emptyHint }: { slots: EditorSlotRegistration[]; emptyHint: string }) {
    const pluginStates = usePluginStore((state) => state.pluginStates);
    // 插件停用（含未读到服务端状态）时不渲染其贡献，落到下方空态提示。
    const enabledSlots = slots.filter((slot) => pluginStates[slot.pluginId]?.effectiveEnabled === true);
    const allowed = enabledSlots.filter((slot) => pluginMayRenderEditorSlot(slot.pluginId, slot.slot).allowed);
    const denied = enabledSlots.filter((slot) => !pluginMayRenderEditorSlot(slot.pluginId, slot.slot).allowed);
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
    // AI 助手浮层由顶栏按钮打开，支持 Esc 和遮罩点击关闭，避免长期遮挡编辑区。
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
    const scope = getActiveUserScope();
    const projectId = detail.project.id;
    const assetOwnerKey = JSON.stringify([scope, projectId]);
    const activeAssetOwnerKeyRef = useRef(assetOwnerKey);
    const assetRefreshSequenceRef = useRef(0);
    activeAssetOwnerKeyRef.current = assetOwnerKey;

    const refreshAssets = useCallback(async (): Promise<ProjectAsset[] | null> => {
        const requestedOwnerKey = assetOwnerKey;
        const requestSequence = assetRefreshSequenceRef.current + 1;
        assetRefreshSequenceRef.current = requestSequence;
        try {
            const list = (await listProjectAssets(projectId)).assets;
            // 项目、账号或刷新序号变化都说明当前响应已经过期；旧响应不得覆盖新上下文的素材快照。
            if (
                activeAssetOwnerKeyRef.current !== requestedOwnerKey ||
                assetRefreshSequenceRef.current !== requestSequence
            ) {
                return null;
            }
            setAssets(list);
            return list;
        } catch (error) {
            // 过期请求的错误不属于当前编辑器上下文，也不应产生误导性告警。
            if (activeAssetOwnerKeyRef.current !== requestedOwnerKey) return null;
            // 资产列表属于读展示路径：保留当前快照，避免网络抖动让编辑器清空素材。
            // 但不能把快照当成同步成功；记录项目上下文，便于定位并在下次进入时重试。
            console.warn("刷新项目素材列表失败，已保留当前快照", { projectId, scope, error });
            return null;
        }
    }, [assetOwnerKey, projectId, scope]);

    useEffect(() => {
        const onFsChange = () => setIsFullscreen(document.fullscreenElement === workbenchRef.current);
        document.addEventListener("fullscreenchange", onFsChange);
        return () => document.removeEventListener("fullscreenchange", onFsChange);
    }, []);

    const toggleFullscreen = () => {
        const operation = document.fullscreenElement
            ? document.exitFullscreen()
            : workbenchRef.current?.requestFullscreen();
        void operation?.catch((error) => {
            console.warn("切换编辑器全屏状态失败", { projectId, error });
        });
    };

    const detailAssetsRef = useRef(detail.assets);
    detailAssetsRef.current = detail.assets;

    // 挂载、切换项目或切换账号时先恢复详情快照，再以服务端列表校准。
    // detail.assets 只用于切换瞬间占位；refreshAssets 内部负责丢弃过期和乱序响应。
    useEffect(() => {
        setAssets(detailAssetsRef.current);
        void refreshAssets();
        return () => {
            // 使当前 owner 下仍在途的请求失效，避免组件卸载后提交 state。
            assetRefreshSequenceRef.current += 1;
        };
    }, [assetOwnerKey, refreshAssets]);

    const store = useMemo(
        () =>
            createEditorStore({
                saveTimeline: async (project: TimelineProject) => {
                    await localForageStorageForScope(scope).setItem(`${EDITOR_TIMELINE_KEY}:${projectId}`, JSON.stringify(project));
                },
            }),
        [projectId, scope],
    );

    // 进入编辑器时只加载当前用户和项目作用域的本地时间线；没有真实数据时保持空时间线，禁止注入虚构片段。
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const storage = localForageStorageForScope(scope);
                const raw = await storage.getItem(`${EDITOR_TIMELINE_KEY}:${projectId}`);
                let loaded = createEmptyEditorTimeline();
                if (raw) {
                    try {
                        loaded = normalizeTimelineProject(JSON.parse(raw));
                    } catch (error) {
                        // 本地历史数据属于读展示路径：坏记录不能阻塞编辑器启动，
                        // 但必须记录项目和存储键，后续可按键清理或迁移，而不是把坏数据伪装成有效时间线。
                        console.warn("读取编辑器本地时间线失败，已使用空时间线", {
                            projectId,
                            storageKey: `${EDITOR_TIMELINE_KEY}:${projectId}`,
                            error,
                        });
                    }
                }
                if (!cancelled) store.getState().load(loaded);
            } catch (error) {
                // IndexedDB/localforage 不可用时不写入空时间线，避免覆盖可能仍可恢复的本地数据。
                console.error("读取编辑器本地时间线存储失败，保留编辑器初始状态", { projectId, error });
            }
        })();
        return () => {
            cancelled = true;
            // 卸载前冲刷尚未落盘的改动（如切页发生在防抖窗口内），避免最后几次操作丢失。
            // flushSave 失败时 editor-store 会保留 isDirty；这里必须留下错误证据，不能假装已保存。
            const flushSave = store.getState().flushSave;
            if (flushSave) {
                void flushSave().catch((error) => {
                    console.error("编辑器卸载前保存时间线失败，待下次操作重试", { projectId, error });
                });
            }
        };
    }, [scope, projectId, store]);

    // 画布产物自动同步：detail.shotArtifacts 中当前采用(storyboard/action_board/
    // 分镜/导出成片，且 ready + 有资源)尚未作为素材进本项目时，自动
    // linkProjectAsset(source=canvas) 并入素材库 —— 剪辑器“素材选项”直接可用画布产物。
    // 后端幂等（已链接直接返回）；单个失败不阻塞其余资源，但会记录告警，
    // 下次进入编辑器时再次尝试补同步。
    // 该集合只表示“当前用户、当前项目会话已处理过”，切换账号或项目时必须清空，避免跨作用域复用 resource ID。
    const syncedCanvasResourcesRef = useRef<Set<string>>(new Set());
    const syncedAssetOwnerKeyRef = useRef(assetOwnerKey);
    useEffect(() => {
        if (syncedAssetOwnerKeyRef.current === assetOwnerKey) return;
        syncedAssetOwnerKeyRef.current = assetOwnerKey;
        syncedCanvasResourcesRef.current.clear();
    }, [assetOwnerKey]);
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
                    // 请求返回时组件可能已经切换项目；旧请求不能把结果记入新项目的会话集合。
                    if (cancelled) break;
                    syncedCanvasResourcesRef.current.add(key);
                } catch (error) {
                    // 单个资源同步失败不阻塞其他资源；失败项不加入已完成集合，
                    // 这样下次进入编辑器仍会重试，而不是把未同步伪装成成功。
                    console.warn("画布产物同步到项目素材失败", { projectId, resourceId, error });
                }
            }
            if (!cancelled) {
                // 统一经过带 owner 与请求序号校验的刷新入口，防止同步后的旧请求覆盖新项目快照。
                await refreshAssets();
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [assets, canvasSyncKeys, projectId, refreshAssets]);

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
