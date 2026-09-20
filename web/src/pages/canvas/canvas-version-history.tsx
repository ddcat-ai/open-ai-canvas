import { AppDrawer } from "@/components/ui/product/app-drawer";
import { EmptyState } from "@/components/ui/product/empty-state";
import { App, Button, Grid, Spin } from "antd";
import { Check, ChevronDown, Cloud, Download, FileClock, History, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCanvasHistoryEntry, listCanvasHistory, type CanvasHistoryEntry } from "@/services/api/user-data";
import { readCanvasSyncDrafts, type CanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { getActiveUserScope } from "@/lib/user-scope";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import "./canvas-version-history.css";

export type CanvasVersionPreviewState = {
    key: string;
    label: string;
    date: string;
    kind: "cloud" | "draft";
    snapshot?: CanvasHistoryEntry;
    project?: CanvasProject;
    error?: string;
};

export function useCanvasVersionHistory(projectId: string, onRestore: (snapshotId: string, revision: number) => Promise<void>) {
    const { message, modal } = App.useApp();
    const desktop = Boolean(Grid.useBreakpoint().lg);
    const scope = getActiveUserScope();
    const contextRef = useRef({ projectId, scope });
    contextRef.current = { projectId, scope };
    const isCurrentContext = () => contextRef.current.projectId === projectId && contextRef.current.scope === scope && getActiveUserScope() === scope;
    const draftCount = useSyncProgressStore((state) => state.syncingProjects[projectId]?.draftCount);
    const [open, setOpen] = useState(false);
    const [listOpen, setListOpen] = useState(true);
    const [tab, setTab] = useState<"cloud" | "draft">("cloud");
    const [entries, setEntries] = useState<CanvasHistoryEntry[]>([]);
    const [drafts, setDrafts] = useState<CanvasSyncDraft[]>([]);
    const [currentRevision, setCurrentRevision] = useState<number>();
    const [preview, setPreview] = useState<CanvasVersionPreviewState | null>(null);
    const [loading, setLoading] = useState(false);
    const [draftLoading, setDraftLoading] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState("");
    const [draftError, setDraftError] = useState("");
    const [reload, setReload] = useState(0);
    const previewRequest = useRef<AbortController | null>(null);
    const returnToCurrent = useCallback(() => {
        previewRequest.current?.abort();
        setPreview(null);
    }, []);
    const close = useCallback(() => {
        if (!restoring) {
            setOpen(false);
            returnToCurrent();
        }
    }, [restoring, returnToCurrent]);

    useEffect(() => {
        setOpen(false);
        setTab("cloud");
        returnToCurrent();
    }, [projectId, scope, returnToCurrent]);

    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        setLoading(true);
        setError("");
        setEntries([]);
        setCurrentRevision(undefined);
        void listCanvasHistory(projectId, controller.signal)
            .then((result) => {
                if (controller.signal.aborted || !isCurrentContext()) return;
                setEntries(result.snapshots);
                // Keep the revision observed with this list as the restore precondition.
                setCurrentRevision(result.currentRevision);
            })
            .catch((cause) => {
                if (!controller.signal.aborted && isCurrentContext()) setError(cause instanceof Error ? cause.message : "历史版本读取失败");
            })
            .finally(() => {
                if (!controller.signal.aborted && isCurrentContext()) setLoading(false);
            });
        return () => controller.abort();
    }, [open, projectId, reload, scope]);

    useEffect(() => {
        if (!open) return;
        let active = true;
        setDraftLoading(true);
        setDraftError("");
        setDrafts([]);
        void readCanvasSyncDrafts(projectId, scope)
            .then((items) => {
                if (active && isCurrentContext()) setDrafts(items.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
            })
            .catch(() => {
                if (active && isCurrentContext()) setDraftError("本地草稿读取失败，请刷新重试");
            })
            .finally(() => {
                if (active && isCurrentContext()) setDraftLoading(false);
            });
        return () => {
            active = false;
        };
    }, [open, projectId, reload, scope, draftCount]);

    useEffect(
        () => () => {
            previewRequest.current?.abort();
        },
        [open, projectId, scope],
    );

    const selectVersion = (entry: CanvasHistoryEntry) => {
        previewRequest.current?.abort();
        const controller = new AbortController();
        previewRequest.current = controller;
        const selection: CanvasVersionPreviewState = { key: entry.id, label: `版本 ${entry.revision}`, date: entry.contentUpdatedAt, kind: "cloud", snapshot: entry };
        setPreview(selection);
        setListOpen(false);
        void getCanvasHistoryEntry(projectId, entry.id, controller.signal)
            .then(({ project }) => {
                if (!controller.signal.aborted && previewRequest.current === controller && isCurrentContext()) setPreview({ ...selection, project });
            })
            .catch((cause) => {
                if (!controller.signal.aborted && previewRequest.current === controller && isCurrentContext()) setPreview({ ...selection, error: cause instanceof Error ? cause.message : "预览读取失败，请重新选择版本" });
            });
    };

    const restore = () => {
        const selected = preview?.snapshot;
        if (!selected || !preview.project || currentRevision === undefined || restoring) return;
        setConfirming(true);
        modal.confirm({
            title: `恢复版本 ${selected.revision} 的内容？`,
            content: "恢复前会备份当前云端内容，并保留本地草稿。恢复后会生成一个新版本，画布的项目归属保持当前设置。",
            okText: "恢复此版本",
            cancelText: "取消",
            afterClose: () => setConfirming(false),
            onOk: async () => {
                if (!isCurrentContext()) {
                    message.error("画布或账号已切换，请重新打开版本记录");
                    return;
                }
                setRestoring(true);
                try {
                    await onRestore(selected.id, currentRevision);
                    returnToCurrent();
                    setReload((value) => value + 1);
                    message.success("已恢复内容并保存为新版本");
                } catch (cause) {
                    const detail = cause instanceof Error ? cause.message : "恢复失败，请重试";
                    setError(detail);
                    message.error(detail);
                } finally {
                    setRestoring(false);
                }
            },
        });
    };

    const download = async () => {
        if (!preview?.project || !isCurrentContext()) return;
        setExporting(true);
        try {
            // Drawing strokes are not versioned; never mix today's local strokes into an old snapshot.
            await exportCanvasProjects([preview.project], `${preview.project.title}-${preview.label}`, { includeLocalDrawings: false });
            message.success("已下载，可从画布列表导入为新画布");
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "下载失败，请重试");
        } finally {
            setExporting(false);
        }
    };

    return {
        open,
        listOpen,
        desktop,
        tab,
        entries,
        drafts,
        currentRevision,
        preview,
        loading,
        draftLoading,
        restoring,
        confirming,
        exporting,
        error,
        draftError,
        show: () => {
            setOpen(true);
            setListOpen(true);
        },
        toggle: () => {
            if (open && (desktop || listOpen)) close();
            else {
                setOpen(true);
                setListOpen(true);
            }
        },
        hideList: () => {
            if (!restoring) {
                setListOpen(false);
                if (!preview) setOpen(false);
            }
        },
        close,
        changeTab: (next: "cloud" | "draft") => {
            setTab(next);
            returnToCurrent();
        },
        refresh: () => {
            returnToCurrent();
            setReload((value) => value + 1);
        },
        selectVersion,
        selectDraft: (draft: CanvasSyncDraft) => {
            previewRequest.current?.abort();
            setPreview({ key: draft.id, label: "本地草稿", date: draft.savedAt, kind: "draft", project: draft.project });
            setListOpen(false);
        },
        returnToCurrent,
        restore,
        download,
    };
}

export type CanvasVersionHistoryController = ReturnType<typeof useCanvasVersionHistory>;

export function CanvasVersionHistory({ history }: { history: CanvasVersionHistoryController }) {
    const { open, tab, entries, drafts, currentRevision, preview, loading, draftLoading, restoring, exporting, error, draftError } = history;
    if (!open) return null;
    const groups = new Map<string, CanvasHistoryEntry[]>();
    for (const entry of entries) {
        const day = new Date(entry.contentUpdatedAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
        groups.set(day, [...(groups.get(day) || []), entry]);
    }
    const content = (
        <div className="canvas-version-panel" data-canvas-no-zoom data-canvas-wheel-scroll>
            <header className="canvas-version-header">
                <History size={17} />
                <h2>版本记录</h2>
                <Button type="text" size="small" aria-label="刷新版本记录" icon={<RefreshCw size={15} />} disabled={restoring || loading} onClick={history.refresh} />
                <Button type="text" size="small" aria-label="关闭版本记录" icon={<X size={17} />} disabled={restoring} onClick={history.close} />
            </header>
            <div
                className="canvas-version-tabs"
                role="tablist"
                aria-label="版本来源"
                onKeyDown={(event) => {
                    if (restoring || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    const next = event.key === "Home" ? "cloud" : event.key === "End" ? "draft" : tab === "cloud" ? "draft" : "cloud";
                    history.changeTab(next);
                    event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
                }}
            >
                <button
                    type="button"
                    id="canvas-cloud-tab"
                    role="tab"
                    data-tab="cloud"
                    aria-selected={tab === "cloud"}
                    aria-controls="canvas-version-list"
                    tabIndex={tab === "cloud" ? 0 : -1}
                    disabled={restoring}
                    onClick={() => history.changeTab("cloud")}
                >
                    <Cloud size={14} />
                    云端历史
                </button>
                <button
                    type="button"
                    id="canvas-draft-tab"
                    role="tab"
                    data-tab="draft"
                    aria-selected={tab === "draft"}
                    aria-controls="canvas-version-list"
                    tabIndex={tab === "draft" ? 0 : -1}
                    disabled={restoring}
                    onClick={() => history.changeTab("draft")}
                >
                    <FileClock size={14} />
                    本地草稿 <span className="canvas-version-count">{drafts.length}</span>
                </button>
            </div>
            <div id="canvas-version-list" role="tabpanel" aria-labelledby={tab === "cloud" ? "canvas-cloud-tab" : "canvas-draft-tab"} className="canvas-version-list">
                {tab === "cloud" ? (
                    <>
                        <button type="button" className="canvas-version-current" aria-pressed={!preview} disabled={restoring} onClick={history.returnToCurrent}>
                            <span className="canvas-version-dot">
                                <Check size={12} />
                            </span>
                            <span>
                                <strong>当前画布</strong>
                                <small>{currentRevision === undefined ? "云端版本待确认" : `打开记录时云端为 v${currentRevision}`}</small>
                            </span>
                            {!preview ? <span className="canvas-version-tag">当前</span> : null}
                        </button>
                        <p className="canvas-version-hint">查看旧版不会修改当前画布</p>
                        {error ? (
                            <p role="alert" className="canvas-version-error">
                                {error}
                            </p>
                        ) : null}
                        {loading ? (
                            <div className="canvas-version-empty">
                                <Spin size="small" />
                            </div>
                        ) : !entries.length && !error ? (
                            <EmptyState size="compact" description="暂无历史版本，后续保存时会自动保留" />
                        ) : null}
                        {[...groups].map(([day, items]) => (
                            <details className="canvas-version-group" key={day} open>
                                <summary>
                                    <ChevronDown size={14} />
                                    <span>{day}</span>
                                    <span className="canvas-version-count">{items.length}</span>
                                </summary>
                                <div className="canvas-version-branches">
                                    {items.map((entry) => (
                                        <button type="button" key={entry.id} className="canvas-version-item" disabled={restoring} aria-pressed={preview?.key === entry.id} onClick={() => history.selectVersion(entry)}>
                                            <span className="canvas-version-item-title">
                                                <time dateTime={entry.contentUpdatedAt}>{formatTime(entry.contentUpdatedAt)}</time>
                                                <span className="canvas-version-tag">v{entry.revision}</span>
                                            </span>
                                            <span className="canvas-version-reason">{entry.reason === "before_restore" ? "恢复前备份" : "自动保存"}</span>
                                            <small>
                                                {entry.nodeCount} 个节点 · {entry.connectionCount} 条连线
                                            </small>
                                        </button>
                                    ))}
                                </div>
                            </details>
                        ))}
                    </>
                ) : (
                    <>
                        <p className="canvas-version-draft-note">发生冲突或恢复版本时保留的本机备份。下载后可从画布列表导入为新画布。</p>
                        {draftError ? (
                            <p role="alert" className="canvas-version-error">
                                {draftError}
                            </p>
                        ) : null}
                        {draftLoading ? (
                            <div className="canvas-version-empty">
                                <Spin size="small" />
                            </div>
                        ) : !drafts.length && !draftError ? (
                            <EmptyState size="compact" description="暂无本地草稿" />
                        ) : null}
                        {drafts.map((draft) => (
                            <button type="button" key={draft.id} className="canvas-version-item canvas-version-draft" disabled={restoring} aria-pressed={preview?.key === draft.id} onClick={() => history.selectDraft(draft)}>
                                <span className="canvas-version-item-title">
                                    <FileClock size={15} />
                                    <strong>本机备份</strong>
                                    {draft.project.revision !== undefined ? <span className="canvas-version-tag">基于 v{draft.project.revision}</span> : null}
                                </span>
                                <time dateTime={draft.savedAt}>{new Date(draft.savedAt).toLocaleString("zh-CN")}</time>
                                <small>
                                    {draft.project.nodes.length} 个节点 · {draft.project.connections.length} 条连线
                                </small>
                            </button>
                        ))}
                    </>
                )}
            </div>
            <footer className="canvas-version-footer">
                {preview ? (
                    <>
                        <div className="canvas-version-item-title">
                            <strong>{preview.label}</strong>
                            <span className="canvas-version-tag">只读预览</span>
                        </div>
                        <small>{new Date(preview.date).toLocaleString("zh-CN")}</small>
                        {preview.project ? (
                            <small>
                                {preview.project.nodes.length} 个节点 · {preview.project.connections.length} 条连线
                            </small>
                        ) : null}
                        {preview.project?.nodes.some((node) => node.type === "drawing") ? <p className="canvas-version-hint">绘图仅保留已上传的预览，不含本机历史笔画。</p> : null}
                        <div className="canvas-version-actions">
                            {preview.kind === "cloud" ? (
                                <Button block type="primary" loading={restoring} disabled={!preview.project || currentRevision === undefined || loading} onClick={history.restore}>
                                    恢复此版本
                                </Button>
                            ) : null}
                            <Button block type={preview.kind === "draft" ? "primary" : "default"} icon={<Download size={14} />} loading={exporting} disabled={!preview.project || restoring} onClick={() => void history.download()}>
                                {preview.kind === "draft" ? "下载草稿" : "下载此版本"}
                            </Button>
                        </div>
                    </>
                ) : (
                    <p className="canvas-version-hint">{tab === "cloud" ? "内容变化时最多每 5 分钟保留一份，保留最近 20 份。恢复前额外备份。" : "草稿仅存于此浏览器，建议及时下载保留。"}</p>
                )}
            </footer>
        </div>
    );

    return history.desktop ? (
        <aside className="canvas-version-sidebar" aria-label="版本记录">
            {content}
        </aside>
    ) : (
        <AppDrawer
            flush
            open={history.listOpen}
            focusable={{ trap: !history.confirming }}
            placement="right"
            title={null}
            closable={false}
            onClose={history.hideList}
            maskClosable={!restoring}
            keyboard={!restoring}
            size="min(350px, 92vw)"
            aria-label="版本记录"
        >
            {content}
        </AppDrawer>
    );
}

function formatTime(date: string) {
    return new Date(date).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}
