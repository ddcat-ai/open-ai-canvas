import { AppDrawer } from "@/components/ui/product/app-drawer";
import { EmptyState } from "@/components/ui/product/empty-state";
import { App, Button, Dropdown, Grid, Input, Modal, Radio, Select, Spin } from "antd";
import { Check, ChevronDown, Cloud, Download, FileClock, History, RefreshCw, X, ArrowLeft, Archive, GitBranch, GitMerge, MoreHorizontal, Plus, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { getCanvasHistoryEntry, listCanvasHistory, listRemoteCanvasProjects, type CanvasHistoryEntry, type RemoteUserDataSummary } from "@/services/api/user-data";
import { archiveCanvasBranch, createCanvasBranch, getCanvasBranchContext, listCanvasBranches, previewCanvasBranchMerge, type CanvasBranchContext, type CanvasBranchMergePreview, type CanvasBranchSummary } from "@/services/api/canvas-collaboration";
import { readCanvasSyncDrafts, type CanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { mergeCanvasBranchWithSync, saveRemoteUserDataNow } from "@/services/user-data-sync";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { CanvasCollaborationMembers } from "./canvas-collaboration-members";
import "./canvas-version-history.css";

export type CanvasVersionPreviewState = {
    key: string;
    label: string;
    date: string;
    kind: "cloud" | "draft";
    snapshot?: CanvasHistoryEntry;
    project?: CanvasProject;
    loading?: boolean;
    error?: string;
};

export function useCanvasVersionHistory(projectId: string, onRestore: (snapshotId: string, revision: number) => Promise<void>) {
    const { message, modal } = App.useApp();
    const desktop = Boolean(Grid.useBreakpoint().lg);
    const scope = getActiveUserScope();
    const navigate = useNavigate();
    const contextRef = useRef({ projectId, scope });
    contextRef.current = { projectId, scope };
    const isCurrentContext = () => contextRef.current.projectId === projectId && contextRef.current.scope === scope && getActiveUserScope() === scope;
    const pendingDraftCount = useSyncProgressStore((state) => state.syncingProjects[projectId]?.draftCount || 0);
    const [open, setOpen] = useState(false);
    const [listOpen, setListOpen] = useState(true);
    const [tab, setTab] = useState<"cloud" | "draft" | "branches">("branches");
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
    const [branches, setBranches] = useState<CanvasBranchSummary[]>([]);
    const [branchContext, setBranchContext] = useState<CanvasBranchContext | null>(null);
    const [branchLoading, setBranchLoading] = useState(false);
    const [branchError, setBranchError] = useState("");
    const [branchName, setBranchName] = useState("");
    const [branchBaseRevision, setBranchBaseRevision] = useState<number>();
    const [branchCreating, setBranchCreating] = useState(false);
    const [branchCreateOpen, setBranchCreateOpen] = useState(false);
    const branchCreateInFlight = useRef(false);
    const [branchMerge, setBranchMerge] = useState<CanvasBranchMergePreview | null>(null);
    const [showAdvancedTarget, setShowAdvancedTarget] = useState(false);
    const [targetCanvases, setTargetCanvases] = useState<RemoteUserDataSummary[]>([]);
    const [targetError, setTargetError] = useState("");
    const [branchMerging, setBranchMerging] = useState(false);
    const [branchArchiving, setBranchArchiving] = useState<string | null>(null);
    const [branchPreviewingId, setBranchPreviewingId] = useState<string | null>(null);
    const [branchChoices, setBranchChoices] = useState<Record<string, "source" | "target">>({});
    const [reload, setReload] = useState(0);
    const previewRequest = useRef<AbortController | null>(null);
    const branchPreviewToken = useRef(0);
    const returnToCurrent = useCallback(() => {
        previewRequest.current?.abort();
        setPreview(null);
    }, []);
    const clearVersionSelection = useCallback(() => {
        setBranchBaseRevision(undefined);
        returnToCurrent();
    }, [returnToCurrent]);
    const close = useCallback(() => {
        if (!restoring) {
            setOpen(false);
            returnToCurrent();
        }
    }, [restoring, returnToCurrent]);

    useEffect(() => {
        setOpen(false);
        setTab("branches");
        setBranches([]);
        setTargetCanvases([]);
        setBranchMerge(null);
        setShowAdvancedTarget(false);
        setBranchBaseRevision(undefined);
        setBranchCreateOpen(false);
        setBranchName("");
        setDrafts([]);
        returnToCurrent();
    }, [projectId, scope, returnToCurrent]);

    useEffect(() => {
        let active = true;
        setBranchContext(null);
        void getCanvasBranchContext(projectId)
            .then((result) => {
                if (active && isCurrentContext()) setBranchContext(result.context);
            })
            .catch(() => {
                // A normal main canvas has no branch context. Keep this silent so
                // opening a canvas never shows a collaboration error.
            });
        return () => {
            active = false;
        };
    }, [projectId, scope, reload]);

    useEffect(() => {
        if (!open || tab !== "cloud") {
            setLoading(false);
            return;
        }
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
    }, [open, projectId, reload, scope, tab]);

    useEffect(() => {
        if (!open || tab !== "draft") return;
        let active = true;
        setDraftLoading(true);
        setDraftError("");
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
    }, [open, projectId, reload, scope, tab]);

    useEffect(() => {
        if (!open || tab !== "branches") return;
        let active = true;
        setBranchLoading(true);
        setBranchError("");
        void listCanvasBranches(projectId)
            .then((result) => {
                if (active && isCurrentContext()) setBranches(result.branches);
            })
            .catch((cause) => {
                if (active && isCurrentContext()) setBranchError(cause instanceof Error ? cause.message : "独立方案读取失败");
            })
            .finally(() => {
                if (active && isCurrentContext()) setBranchLoading(false);
            });
        return () => {
            active = false;
        };
    }, [open, projectId, reload, scope, tab]);

    useEffect(() => {
        if (!open || !showAdvancedTarget) return;
        let active = true;
        setTargetError("");
        void listRemoteCanvasProjects()
            .then((result) => {
                if (active && isCurrentContext()) setTargetCanvases(result.projects);
            })
            .catch(() => {
                if (active && isCurrentContext()) setTargetError("其他画布读取失败，请收起后重试");
            });
        return () => {
            active = false;
        };
    }, [open, showAdvancedTarget, projectId, scope]);

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
        const selection: CanvasVersionPreviewState = { key: entry.id, label: "历史状态", date: entry.contentUpdatedAt, kind: "cloud", snapshot: entry, loading: true };
        setPreview(selection);
        setListOpen(false);
        void getCanvasHistoryEntry(projectId, entry.id, controller.signal)
            .then(({ project }) => {
                if (!controller.signal.aborted && previewRequest.current === controller && isCurrentContext()) setPreview({ ...selection, project, loading: false });
            })
            .catch((cause) => {
                if (!controller.signal.aborted && previewRequest.current === controller && isCurrentContext()) setPreview({ ...selection, loading: false, error: cause instanceof Error ? cause.message : "预览读取失败，请重新选择版本" });
            });
    };

    const restore = () => {
        const selected = preview?.snapshot;
        if (!selected || !preview.project || currentRevision === undefined || restoring) return;
        setConfirming(true);
        modal.confirm({
            title: "恢复到这次状态？",
            content: "恢复前会保留当前画布和本地草稿，恢复后其他成员会看到新的画布状态。项目归属保持当前设置。",
            okText: "恢复此状态",
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
                    message.success("已恢复内容，其他成员会自动看到更新");
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

    const createBranch = async () => {
        const name = branchName.trim();
        if (!name || branchCreateInFlight.current) return;
        branchCreateInFlight.current = true;
        setBranchCreating(true);
        try {
            if (branchBaseRevision === undefined) await saveRemoteUserDataNow(projectId);
            if (!isCurrentContext()) return;
            const baseRevision = branchBaseRevision ?? useCanvasStore.getState().openProject(projectId)?.revision;
            if (baseRevision === undefined) throw new Error("请先同步当前画布，再创建方案");
            const result = await createCanvasBranch(projectId, { name, baseRevision });
            if (!isCurrentContext()) return;
            setBranchName("");
            setBranchBaseRevision(undefined);
            setBranches((items) => [result.branch, ...items.filter((item) => item.id !== result.branch.id)]);
            setBranchCreateOpen(false);
            message.success("已进入新方案，可随时返回来源画布");
            navigate(`/canvas/${encodeURIComponent(result.branch.branchCanvasId)}`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "独立方案创建失败");
        } finally {
            branchCreateInFlight.current = false;
            setBranchCreating(false);
        }
    };

    const openBranchMerge = async (branch: CanvasBranchSummary, targetCanvasId = branch.sourceCanvasId) => {
        const token = ++branchPreviewToken.current;
        setBranchPreviewingId(branch.id);
        try {
            await saveRemoteUserDataNow([...new Set([projectId, branch.branchCanvasId, targetCanvasId])]);
            if (token !== branchPreviewToken.current || !isCurrentContext()) return;
            const result = await previewCanvasBranchMerge(branch.id, { targetCanvasId });
            if (token !== branchPreviewToken.current || !isCurrentContext()) return;
            const conflicts = result.conflicts ?? [];
            // A conflict must be an explicit decision. Do not silently choose
            // one side just because the modal opened.
            setBranchChoices({});
            result.conflicts = conflicts;
            setBranchMerge(result);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "合并预览失败，请刷新后重试");
        } finally {
            if (token === branchPreviewToken.current) setBranchPreviewingId(null);
        }
    };

    const submitBranchMerge = async () => {
        if (!branchMerge || branchMerging || branchPreviewingId || !isCurrentContext()) return;
        const unresolved = branchMerge.conflicts.filter((conflict) => !branchChoices[conflict.path]);
        if (unresolved.length) {
            message.warning(`还有 ${unresolved.length} 处冲突未选择，请先确认保留哪一份内容`);
            return;
        }
        const branch = branchMerge.branch;
        const targetId = branchMerge.targetCanvasId;
        const targetTitle = branchMerge.targetProject.title || "来源画布";
        setBranchMerging(true);
        try {
            await saveRemoteUserDataNow([...new Set([projectId, branch.branchCanvasId, targetId])]);
            if (!isCurrentContext()) return;
            const mergedProject = applyBranchMergeChoices(branchMerge, branchChoices);
            await mergeCanvasBranchWithSync(branch.id, { targetCanvasId: targetId, expectedTargetRevision: branchMerge.targetRevision, sourceRevision: branchMerge.sourceRevision, mergedProject });
            if (!isCurrentContext()) return;
            setBranchMerge(null);
            setShowAdvancedTarget(false);
            setReload((value) => value + 1);
            message.success(`已合并到「${targetTitle}」`);
            if (targetId !== projectId) {
                navigate(`/canvas/${encodeURIComponent(targetId)}`);
            }
        } catch (cause) {
            const detail = cause instanceof Error ? cause.message : "合并失败，请重新打开预览";
            if (/刚刚有新修改|重新打开合并预览/.test(detail)) {
                setBranchMerge(null);
                message.warning("画布有新的修改，正在重新核对合并内容");
                await openBranchMerge(branch, targetId);
            } else {
                message.error(detail);
            }
        } finally {
            setBranchMerging(false);
        }
    };

    const archiveBranch = (branch: CanvasBranchSummary) => {
        if (branch.status !== "active" || branchArchiving) return;
        modal.confirm({
            title: `归档“${branch.name}”？`,
            content: "归档后方案会标记为已归档，仍可打开查看历史内容，也不会影响主画布。",
            okText: "归档方案",
            cancelText: "取消",
            onOk: async () => {
                setBranchArchiving(branch.id);
                try {
                    await archiveCanvasBranch(branch.id);
                    setBranches((items) => items.map((item) => (item.id === branch.id ? { ...item, status: "archived" } : item)));
                    message.success("独立方案已归档");
                } catch (cause) {
                    message.error(cause instanceof Error ? cause.message : "归档失败，请重试");
                } finally {
                    setBranchArchiving(null);
                }
            },
        });
    };

    return {
        projectId,
        open,
        listOpen,
        desktop,
        tab,
        entries,
        drafts,
        pendingDraftCount,
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
                setTab("branches");
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
        changeTab: (next: "cloud" | "draft" | "branches") => {
            setTab(next);
            setBranchError("");
            setBranchBaseRevision(undefined);
            setBranchCreateOpen(false);
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
        clearVersionSelection,
        restore,
        download,
        branches,
        branchContext,
        targetCanvases,
        branchLoading,
        branchError,
        branchName,
        branchBaseRevision,
        branchCreating,
        setBranchName,
        createBranch,
        openBranchMerge,
        branchPreviewingId,
        branchMerge,
        setBranchMerge,
        showAdvancedTarget,
        setShowAdvancedTarget,
        branchMerging,
        branchChoices,
        setBranchChoices,
        submitBranchMerge,
        archiveBranch,
        branchArchiving,
        branchCreateOpen,
        targetError,
        closeBranchMerge: () => {
            if (!branchMerging) {
                branchPreviewToken.current += 1;
                setBranchPreviewingId(null);
                setBranchMerge(null);
                setShowAdvancedTarget(false);
            }
        },
        startBranch: (fromPreview = false) => {
            setBranchBaseRevision(fromPreview ? preview?.snapshot?.revision : undefined);
            setBranchCreateOpen(true);
            setTab("branches");
            returnToCurrent();
        },
        cancelBranch: () => {
            if (!branchCreating) {
                setBranchCreateOpen(false);
                setBranchBaseRevision(undefined);
            }
        },
        openBranch: (branchCanvasId: string) => navigate(`/canvas/${encodeURIComponent(branchCanvasId)}`),
    };
}

export type CanvasVersionHistoryController = ReturnType<typeof useCanvasVersionHistory>;

export function CanvasVersionHistory({ history }: { history: CanvasVersionHistoryController }) {
    const { open, tab, entries, drafts, currentRevision, preview, loading, draftLoading, restoring, exporting, error, draftError, branchMerge, branchMerging, branchChoices } = history;
    if (!open) return null;
    const groups = new Map<string, CanvasHistoryEntry[]>();
    for (const entry of entries) {
        const day = new Date(entry.contentUpdatedAt).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
        groups.set(day, [...(groups.get(day) || []), entry]);
    }
    const title = tab === "cloud" ? "历史记录" : tab === "draft" ? "本机备份" : "协作";
    const content = (
        <div className="canvas-version-panel" data-canvas-no-zoom data-canvas-wheel-scroll>
            <header className="canvas-version-header">
                {tab === "branches" ? <Users size={17} /> : <Button type="text" size="small" aria-label="返回协作" icon={<ArrowLeft size={17} />} disabled={restoring} onClick={() => history.changeTab("branches")} />}
                <h2>{title}</h2>
                <Button type="text" size="small" aria-label={`刷新${title}`} icon={<RefreshCw size={15} />} disabled={restoring || loading || history.branchLoading} onClick={history.refresh} />
                <Button type="text" size="small" aria-label="关闭协作面板" icon={<X size={17} />} disabled={restoring} onClick={history.close} />
            </header>
            <div className="canvas-version-list" aria-label={title}>
                {tab === "cloud" ? (
                    <>
                        <p className="canvas-version-draft-note">查看之前保存的内容，需要时再恢复。</p>
                        {error ? (
                            <p role="alert" className="canvas-version-error">
                                {error}{" "}
                                <Button type="link" size="small" className="!px-1" onClick={history.refresh}>
                                    重试
                                </Button>
                            </p>
                        ) : null}
                        {loading ? (
                            <div className="canvas-version-empty">
                                <Spin size="small" />
                            </div>
                        ) : !entries.length && !error ? (
                            <EmptyState title="还没有历史记录" description="编辑后会自动保留" />
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
                ) : tab === "draft" ? (
                    <>
                        <p className="canvas-version-draft-note">同步或恢复时为你保留的内容，仅存于此浏览器。备份数量不代表还有未处理的冲突。</p>
                        {draftError ? (
                            <p role="alert" className="canvas-version-error">
                                {draftError}{" "}
                                <Button type="link" size="small" className="!px-1" onClick={history.refresh}>
                                    重试
                                </Button>
                            </p>
                        ) : null}
                        {draftLoading ? (
                            <div className="canvas-version-empty">
                                <Spin size="small" />
                            </div>
                        ) : !drafts.length && !draftError ? (
                            <EmptyState title="暂无本机备份" />
                        ) : null}
                        {drafts.map((draft) => (
                            <button type="button" key={draft.id} className="canvas-version-item canvas-version-draft" disabled={restoring} aria-pressed={preview?.key === draft.id} onClick={() => history.selectDraft(draft)}>
                                <span className="canvas-version-item-title">
                                    <FileClock size={15} />
                                    <strong>保留的草稿</strong>
                                </span>
                                <time dateTime={draft.savedAt}>{new Date(draft.savedAt).toLocaleString("zh-CN")}</time>
                                <small>
                                    {draft.project.nodes.length} 个节点 · {draft.project.connections.length} 条连线
                                </small>
                            </button>
                        ))}
                    </>
                ) : (
                    <BranchList history={history} />
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
                        {preview.loading ? (
                            <p className="canvas-version-hint" role="status">
                                <Spin size="small" /> 正在读取这次内容…
                            </p>
                        ) : null}
                        {preview.error ? (
                            <p role="alert" className="canvas-version-error">
                                {preview.error}
                            </p>
                        ) : null}
                        {preview.project?.nodes.some((node) => node.type === "drawing") ? <p className="canvas-version-hint">绘图仅保留已上传的预览，不含本机历史笔画。</p> : null}
                        <div className="canvas-version-actions">
                            {preview.kind === "cloud" ? (
                                <>
                                    <Button block type="primary" loading={restoring} disabled={preview.loading || !preview.project || currentRevision === undefined || loading} onClick={history.restore}>
                                        恢复到这次内容
                                    </Button>
                                    <Button block disabled={!preview.project || restoring} onClick={() => history.startBranch(true)}>
                                        从这次内容创建方案
                                    </Button>
                                </>
                            ) : null}
                            <Button block type={preview.kind === "draft" ? "primary" : "text"} icon={<Download size={14} />} loading={exporting} disabled={preview.loading || !preview.project || restoring} onClick={() => void history.download()}>
                                {preview.kind === "draft" ? "下载草稿" : "下载备份"}
                            </Button>
                        </div>
                    </>
                ) : tab === "branches" ? (
                    <nav className="canvas-collaboration-secondary" aria-label="找回内容">
                        <Button type="text" icon={<History size={14} />} onClick={() => history.changeTab("cloud")}>
                            历史记录
                        </Button>
                        <Button type="text" icon={<FileClock size={14} />} onClick={() => history.changeTab("draft")}>
                            本机备份
                        </Button>
                    </nav>
                ) : (
                    <p className="canvas-version-hint">{tab === "cloud" ? "恢复前会先备份当前画布。" : "选中一份备份可预览和下载。"}</p>
                )}
            </footer>
            <BranchMergeModal history={history} preview={branchMerge} choices={branchChoices} targetLabel={branchMerge?.targetProject.title || "来源画布"} open={Boolean(branchMerge)} merging={branchMerging} />
        </div>
    );

    return history.desktop ? (
        <aside className="canvas-version-sidebar" aria-label="协作面板">
            {content}
        </aside>
    ) : (
        <AppDrawer
            open={history.listOpen}
            focusable={{ trap: !history.confirming }}
            placement="right"
            title={null}
            closable={false}
            onClose={history.hideList}
            maskClosable={!restoring}
            keyboard={!restoring}
            width="min(350px, 92vw)"
            flush
            aria-label="协作面板"
        >
            {content}
        </AppDrawer>
    );
}

function formatTime(date: string) {
    return new Date(date).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function BranchList({ history }: { history: CanvasVersionHistoryController }) {
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === history.projectId));
    const currentBranch = history.branchContext?.branch;
    const otherBranches = history.branches.filter((item) => item.branchCanvasId !== history.projectId);
    const active = otherBranches.filter((item) => item.status !== "archived");
    const archived = otherBranches.filter((item) => item.status === "archived");
    return (
        <div className="canvas-collaboration-home">
            <CanvasCollaborationMembers key={history.projectId} projectId={history.projectId} />
            <div className="canvas-collaboration-context">
                <span className="canvas-version-tag">{currentBranch ? "当前方案" : "当前画布"}</span>
                <strong>{project?.title || "未命名画布"}</strong>
                <p>{currentBranch ? `来自「${currentBranch.sourceTitle || "来源画布"}」，这里的修改单独保存。` : "受邀成员可以在这里一起编辑，修改自动同步。"}</p>
                {currentBranch ? (
                    <Button
                        block
                        disabled={currentBranch.status !== "active" || Boolean(history.branchPreviewingId)}
                        loading={history.branchPreviewingId === currentBranch.id}
                        icon={<GitMerge size={14} />}
                        onClick={() => void history.openBranchMerge(currentBranch)}
                    >
                        合并到来源画布
                    </Button>
                ) : null}
            </div>
            <div className="canvas-collaboration-section-title">
                <h3>独立方案</h3>
                {!history.branchCreateOpen ? (
                    <Button type="text" size="small" aria-label="新建独立方案" icon={<Plus size={14} />} onClick={() => history.startBranch()}>
                        新建
                    </Button>
                ) : null}
            </div>
            {history.branchCreateOpen ? (
                <form
                    className="canvas-collaboration-create"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void history.createBranch();
                    }}
                >
                    <label htmlFor="canvas-branch-name">给新方案起个名字</label>
                    <Input id="canvas-branch-name" autoFocus maxLength={120} value={history.branchName} disabled={history.branchCreating} placeholder="例如：海边婚礼" onChange={(event) => history.setBranchName(event.target.value)} />
                    <p>{history.branchBaseRevision !== undefined ? "从刚才选择的历史记录创建。" : "先同步当前内容，再创建一份可独立编辑的方案。"}</p>
                    <div className="canvas-collaboration-create-actions">
                        <Button disabled={history.branchCreating} onClick={history.cancelBranch}>
                            取消
                        </Button>
                        <Button htmlType="submit" type="primary" loading={history.branchCreating} disabled={!history.branchName.trim()}>
                            创建并打开
                        </Button>
                    </div>
                </form>
            ) : (
                <p className="canvas-version-hint">想试试不同思路时再新建，完成后可以合并回来。</p>
            )}
            {history.branchError ? (
                <p role="alert" className="canvas-version-error">
                    {history.branchError}{" "}
                    <Button type="link" size="small" onClick={history.refresh}>
                        重试
                    </Button>
                </p>
            ) : history.branchLoading ? (
                <div className="canvas-version-empty">
                    <Spin size="small" />
                </div>
            ) : (
                <>
                    {active.length ? <BranchTree history={history} branches={active} /> : <p className="canvas-collaboration-empty">还没有其他方案，直接在当前画布创作即可。</p>}
                    {archived.length ? (
                        <details className="canvas-version-group">
                            <summary>
                                <ChevronDown size={14} />
                                <span>已归档</span>
                                <span className="canvas-version-count">{archived.length}</span>
                            </summary>
                            <BranchTree history={history} branches={archived} />
                        </details>
                    ) : null}
                </>
            )}
        </div>
    );
}

function BranchTree({ history, branches }: { history: CanvasVersionHistoryController; branches: CanvasBranchSummary[] }) {
    const children = new Map<string, CanvasBranchSummary[]>();
    for (const branch of branches) {
        const parent = branch.parentBranchId || (branch.sourceCanvasId === history.projectId ? "root" : `canvas:${branch.sourceCanvasId}`);
        children.set(parent, [...(children.get(parent) || []), branch]);
    }
    const render = (parent: string, depth = 0, lineage = new Set<string>()): ReactNode =>
        (children.get(parent) || []).map((branch) => {
            if (lineage.has(branch.id) || depth > 20)
                return (
                    <p key={branch.id} role="alert" className="canvas-version-error">
                        方案关系异常，请刷新后重试。
                    </p>
                );
            const nextLineage = new Set(lineage);
            nextLineage.add(branch.id);
            return (
                <div key={branch.id} className="canvas-collaboration-tree" style={{ marginLeft: depth > 0 && depth <= 4 ? "var(--space-3)" : 0 }}>
                    <article className="canvas-collaboration-branch">
                        <button type="button" className="canvas-collaboration-branch-open" aria-label={`打开方案：${branch.name}`} onClick={() => history.openBranch(branch.branchCanvasId)}>
                            <GitBranch size={15} />
                            <span>
                                <strong>{branch.name}</strong>
                                <small>
                                    {branch.sourceTitle ? `来自「${branch.sourceTitle}」` : "独立方案"} · {formatTime(branch.updatedAt)}
                                </small>
                            </span>
                        </button>
                        <div className="canvas-collaboration-branch-actions">
                            <span className="canvas-version-count">{branch.status === "archived" ? "已归档" : branch.lastMergedSourceRevision === branch.headRevision ? "已合并" : "可独立编辑"}</span>
                            {branch.status === "active" ? (
                                <>
                                    <Button size="small" type="text" loading={history.branchPreviewingId === branch.id} disabled={Boolean(history.branchPreviewingId)} icon={<GitMerge size={13} />} onClick={() => void history.openBranchMerge(branch)}>
                                        {branch.sourceCanvasId === history.projectId ? "合并到这里" : "合并到来源"}
                                    </Button>
                                    <Dropdown trigger={["click"]} menu={{ items: [{ key: "archive", label: "归档方案", icon: <Archive size={13} />, onClick: () => history.archiveBranch(branch) }] }}>
                                        <Button size="small" type="text" aria-label={`方案“${branch.name}”的更多操作`} loading={history.branchArchiving === branch.id} icon={<MoreHorizontal size={15} />} />
                                    </Dropdown>
                                </>
                            ) : null}
                        </div>
                    </article>
                    {render(branch.id, depth + 1, nextLineage)}
                </div>
            );
        });
    const branchIds = new Set(branches.map((branch) => branch.id));
    return (
        <div>
            {render("root")}
            {[...children.keys()]
                .filter((key) => key !== "root" && !branchIds.has(key))
                .map((key) => (
                    <div key={key}>{render(key)}</div>
                ))}
        </div>
    );
}

function BranchMergeModal({
    history,
    preview,
    choices,
    targetLabel,
    open,
    merging,
}: {
    history: CanvasVersionHistoryController;
    preview: CanvasBranchMergePreview | null;
    choices: Record<string, "source" | "target">;
    targetLabel: string;
    open: boolean;
    merging: boolean;
}) {
    if (!preview) return null;
    const unresolved = preview.conflicts.filter((conflict) => !choices[conflict.path]).length;
    const refreshing = Boolean(history.branchPreviewingId);
    const targets = new Map(history.targetCanvases.filter((item) => item.id !== preview.branch.branchCanvasId).map((item) => [item.id, { value: item.id, label: item.title || "未命名画布" }]));
    targets.set(preview.targetCanvasId, { value: preview.targetCanvasId, label: targetLabel });
    return (
        <Modal
            className="canvas-branch-merge-modal"
            open={open}
            width="min(760px, calc(100vw - 24px))"
            centered
            title={`将「${preview.branch.name}」合并到「${targetLabel}」`}
            maskClosable={false}
            onCancel={history.closeBranchMerge}
            okText={unresolved ? `还需确认 ${unresolved} 项` : "合并并查看结果"}
            cancelText="取消"
            confirmLoading={merging || refreshing}
            okButtonProps={{ disabled: unresolved > 0 || refreshing }}
            cancelButtonProps={{ disabled: merging }}
            onOk={() => void history.submitBranchMerge()}
        >
            <p className="canvas-version-hint">合并完成后打开「{targetLabel}」查看结果，原方案仍然保留。</p>
            <Button type="text" size="small" disabled={merging || refreshing} onClick={() => history.setShowAdvancedTarget((value) => !value)}>
                {history.showAdvancedTarget ? "收起" : "更换接收画布"}
            </Button>
            {history.showAdvancedTarget ? (
                <div className="my-3">
                    <Select
                        aria-label="选择接收画布"
                        className="w-full"
                        value={preview.targetCanvasId}
                        disabled={merging || refreshing}
                        loading={refreshing}
                        options={[...targets.values()]}
                        onChange={(id) => void history.openBranchMerge(preview.branch, id)}
                    />
                    {history.targetError ? (
                        <p role="alert" className="canvas-version-error">
                            {history.targetError}
                        </p>
                    ) : null}
                </div>
            ) : null}
            <div className="canvas-merge-summary">{preview.conflicts.length ? `有 ${preview.conflicts.length} 处内容需要你确认` : "没有冲突，可以直接合并"}</div>
            {preview.conflicts.length ? (
                <div className="max-h-[52vh] space-y-3 overflow-auto pr-1" data-canvas-wheel-scroll>
                    {preview.conflicts.map((conflict) => (
                        <div key={conflict.path} className="rounded-lg border border-border p-3">
                            <div className="mb-2 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <strong className="min-w-0 break-words text-sm">{branchConflictTitle(preview, conflict)}</strong>
                                <Radio.Group
                                    disabled={merging || refreshing}
                                    className="!flex !shrink-0 !flex-wrap"
                                    size="small"
                                    value={choices[conflict.path]}
                                    onChange={(event) => history.setBranchChoices((current) => ({ ...current, [conflict.path]: event.target.value }))}
                                >
                                    <Radio.Button value="source">用方案内容</Radio.Button>
                                    <Radio.Button value="target">用接收画布内容</Radio.Button>
                                </Radio.Group>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2">
                                <MergeValue label="方案内容" value={conflict.source} selected={choices[conflict.path] === "source"} />
                                <MergeValue label="接收画布内容" value={conflict.target} selected={choices[conflict.path] === "target"} />
                            </div>
                            <details className="mt-2 text-xs text-muted-foreground">
                                <summary className="cursor-pointer">查看修改前的内容</summary>
                                <MergeValue label="修改前" value={conflict.base} />
                            </details>
                        </div>
                    ))}
                </div>
            ) : null}
        </Modal>
    );
}

function MergeValue({ label, value, selected = false }: { label: string; value: unknown; selected?: boolean }) {
    return (
        <div className="canvas-merge-value" data-selected={selected}>
            <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
            {value === undefined ? <span className="text-muted-foreground">（已删除）</span> : <MergeConflictValue value={value} />}
        </div>
    );
}

function branchConflictTitle(preview: CanvasBranchMergePreview, conflict: CanvasBranchMergePreview["conflicts"][number]) {
    const [collection, id, ...fields] = conflict.path.split(".");
    const labels: Record<string, string> = {
        title: "节点名称",
        position: "节点位置",
        width: "节点宽度",
        height: "节点高度",
        type: "节点类型",
        metadata: "提示词与生成设置",
        prompt: "提示词",
        "metadata.prompt": "提示词",
        "metadata.composerContent": "提示词",
        backgroundMode: "画布背景",
        appearance: "画布外观",
        showImageInfo: "素材信息显示",
        chatSessions: "创作对话",
        activeChatId: "当前对话",
        timeline: "时间线",
        directorScenes: "导演场景",
    };
    if (collection === "nodes") {
        const node = preview.baseProject.nodes.find((item) => item.id === id) || preview.targetProject.nodes.find((item) => item.id === id) || preview.sourceProject.nodes.find((item) => item.id === id);
        const label = fields.length ? labels[fields.join(".")] || "节点设置" : conflict.label;
        return `${node?.title || "未命名节点"} · ${label}`;
    }
    return collection === "connections" ? "节点之间的连接" : labels[collection] || "画布设置";
}

function MergeConflictValue({ value }: { value: unknown }) {
    if (typeof value === "string") return <p className="m-0 max-h-28 overflow-auto whitespace-pre-wrap break-words">{value || "（空）"}</p>;
    const detail = JSON.stringify(value, null, 2);
    return (
        <details>
            <summary className="cursor-pointer list-inside text-foreground/80">{mergeValueSummary(value)}</summary>
            <pre className="m-0 mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words">{detail}</pre>
        </details>
    );
}

function mergeValueSummary(value: unknown) {
    if (typeof value === "string") return value ? (value.length > 100 ? `${value.slice(0, 100)}…` : value) : "（空）";
    if (Array.isArray(value)) return `列表，共 ${value.length} 项`;
    if (value && typeof value === "object") {
        const content = value as Record<string, unknown>;
        if (typeof content.x === "number" && typeof content.y === "number") return `横向 ${Math.round(content.x)}，纵向 ${Math.round(content.y)}`;
        for (const key of ["title", "prompt", "composerContent"]) {
            if (typeof content[key] === "string" && content[key]) return mergeValueSummary(content[key]);
        }
        const keys = Object.keys(value);
        return keys.length ? "查看具体设置" : "未设置";
    }
    return String(value);
}

function applyBranchMergeChoices(preview: CanvasBranchMergePreview, choices: Record<string, "source" | "target">): CanvasProject {
    const project = structuredClone(preview.autoMergedProject);
    for (const conflict of preview.conflicts) {
        const value = choices[conflict.path] === "target" ? conflict.target : conflict.source;
        const parts = conflict.path.split(".");
        if (parts.length === 1) {
            if (value === undefined) delete (project as unknown as Record<string, unknown>)[parts[0]];
            else (project as unknown as Record<string, unknown>)[parts[0]] = structuredClone(value);
            continue;
        }
        const collection = (parts[0] === "nodes" ? project.nodes : parts[0] === "connections" ? project.connections : null) as Array<{ id: string }> | null;
        if (!collection) throw new Error("合并预览已过期，请重新打开合并");
        const itemIndex = collection.findIndex((item) => item.id === parts[1]);
        if (parts.length === 2) {
            if (value === undefined) {
                if (itemIndex >= 0) collection.splice(itemIndex, 1);
            } else if (itemIndex >= 0) collection[itemIndex] = structuredClone(value) as { id: string };
            else collection.push(structuredClone(value) as { id: string });
            continue;
        }
        if (itemIndex < 0) throw new Error("合并内容已发生变化，请重新打开合并");
        const item = collection[itemIndex] as unknown as Record<string, unknown>;
        setNestedMergeValue(item, parts.slice(2), value);
    }
    const nodeIds = new Set(project.nodes.map((node) => node.id));
    project.connections = project.connections.filter((connection) => nodeIds.has(connection.fromNodeId) && nodeIds.has(connection.toNodeId));
    return project;
}

function setNestedMergeValue(target: Record<string, unknown>, path: string[], value: unknown) {
    if (!path.length) return;
    let cursor = target;
    for (const key of path.slice(0, -1)) {
        const current = cursor[key];
        if (!current || typeof current !== "object" || Array.isArray(current)) cursor[key] = {};
        cursor = cursor[key] as Record<string, unknown>;
    }
    const leaf = path[path.length - 1];
    if (value === undefined) delete cursor[leaf];
    else cursor[leaf] = structuredClone(value);
}
