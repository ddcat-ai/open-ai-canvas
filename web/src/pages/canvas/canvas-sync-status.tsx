import { App, Button, Dropdown, Modal, Popover } from "antd";
import { CloudCheck, CloudOff, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { readAllCanvasSyncDrafts, readCanvasSyncDrafts, type CanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { readCanvasConflict, type CanvasConflictSnapshot } from "@/services/canvas-conflicts";
import { CanvasConflictResolverModal } from "./canvas-conflict-resolver";
import { saveRemoteUserDataNow } from "@/services/user-data-sync";

export function CanvasSyncStatus({ projectId, onLoadLatest, onOpenVersions }: { projectId: string; onLoadLatest: () => Promise<void>; onOpenVersions?: (tab?: "cloud" | "draft") => void }) {
    const { message } = App.useApp();
    const progress = useSyncProgressStore((state) => state.syncingProjects[projectId]);
    const project = useCanvasStore((state) => state.projects.find((item) => item.id === projectId));
    const [busy, setBusy] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const [conflictModalOpen, setConflictModalOpen] = useState(false);
    const [resolverOpen, setResolverOpen] = useState(false);
    const [conflictSnapshot, setConflictSnapshot] = useState<CanvasConflictSnapshot | null>(null);
    const [conflictSnapshotLoading, setConflictSnapshotLoading] = useState(false);
    const [conflictSnapshotError, setConflictSnapshotError] = useState("");
    const lastConflictKey = useRef("");
    const conflictSnapshotLoadKey = useRef("");
    const conflictRequestRef = useRef<{ key: string; token: number; promise: Promise<void> } | null>(null);
    const conflictRequestToken = useRef(0);
    const latestLoadRef = useRef<Promise<void> | null>(null);
    const phase = progress?.phase;
    const conflict = phase === "conflict";
    const failed = phase === "error" || conflict;
    const saving = phase === "pending" || phase === "saving" || phase === "uploading";
    const label = conflict ? "需要确认" : !phase ? "未同步" : failed ? "同步未完成" : saving ? "同步中" : "已同步";
    const loadLatest = useCallback(async () => {
        if (latestLoadRef.current) return latestLoadRef.current;
        const promise = onLoadLatest().finally(() => {
            if (latestLoadRef.current === promise) latestLoadRef.current = null;
        });
        latestLoadRef.current = promise;
        return promise;
    }, [onLoadLatest]);
    const run = async (operation: () => Promise<unknown>, onError?: () => void) => {
        setBusy(true);
        try {
            await operation();
        } catch (error) {
            onError?.();
            message.error(error instanceof Error ? error.message : "操作失败，请重试");
        } finally {
            setBusy(false);
        }
    };

    const loadConflictSnapshot = useCallback(async () => {
        const key = `${projectId}:${progress?.message || "conflict"}:${progress?.draftCount || 0}`;
        const existing = conflictRequestRef.current;
        if (existing?.key === key) return existing.promise;
        const token = ++conflictRequestToken.current;
        setConflictSnapshotLoading(true);
        setConflictSnapshotError("");
        const promise = (async () => {
            try {
                const snapshot = await readCanvasConflict(projectId);
                if (token !== conflictRequestToken.current) return;
                setConflictSnapshot(snapshot);
                if (!snapshot) setConflictSnapshotError("本地草稿正在准备，请稍后再试；内容仍保存在本机。");
            } catch {
                if (token !== conflictRequestToken.current) return;
                setConflictSnapshot(null);
                setConflictSnapshotError("本地草稿读取失败，请重试；原始内容仍保存在本机。");
            } finally {
                if (token === conflictRequestToken.current) setConflictSnapshotLoading(false);
            }
        })();
        conflictRequestRef.current = { key, token, promise };
        void promise.finally(() => {
            if (conflictRequestRef.current?.token === token) conflictRequestRef.current = null;
        });
        return promise;
    }, [projectId, progress?.draftCount, progress?.message]);

    useEffect(() => {
        if (!conflict || !progress?.message) {
            lastConflictKey.current = "";
            return;
        }
        const conflictKey = `${projectId}:${progress.message}`;
        if (lastConflictKey.current === conflictKey) return;
        lastConflictKey.current = conflictKey;
        setConflictModalOpen(true);
    }, [conflict, progress?.message, projectId]);

    useEffect(() => {
        if (!conflict) {
            conflictSnapshotLoadKey.current = "";
            setConflictSnapshot(null);
            setConflictSnapshotError("");
            setResolverOpen(false);
            return;
        }
        const loadKey = `${projectId}:${progress?.message || "conflict"}:${progress?.draftCount || 0}`;
        if (conflictSnapshotLoadKey.current === loadKey && conflictSnapshot) return;
        if (conflictSnapshotLoadKey.current === loadKey) return;
        conflictSnapshotLoadKey.current = loadKey;
        const load = () => void loadConflictSnapshot();
        load();
        // The conflict phase is published before the remote snapshot is written;
        // retry once after the draft write completes so the resolver appears in
        // the same turn as the conflict notification.
        const retry = window.setTimeout(load, 600);
        return () => {
            window.clearTimeout(retry);
        };
    }, [conflict, conflictSnapshot, loadConflictSnapshot, progress?.draftCount, progress?.message, projectId]);

    return (
        <>
            <Modal
                open={conflictModalOpen && conflict}
                title="有人刚刚修改了这个画布"
                width="min(520px, calc(100vw - 24px))"
                centered
                zIndex={1200}
                maskClosable={false}
                onCancel={() => setConflictModalOpen(false)}
                footer={
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button type="text" onClick={() => setConflictModalOpen(false)}>
                            稍后处理
                        </Button>
                        {!conflictSnapshot && conflictSnapshotError ? (
                            <Button loading={conflictSnapshotLoading} onClick={() => void loadConflictSnapshot()}>
                                重试
                            </Button>
                        ) : null}
                        <Button
                            loading={busy}
                            onClick={() => {
                                setConflictModalOpen(false);
                                void run(
                                    async () => {
                                        await loadLatest();
                                        message.success("已加载最新内容，原草稿保留在“协作 → 本机备份”中");
                                    },
                                    () => setConflictModalOpen(true),
                                );
                            }}
                            disabled={busy || (!conflictSnapshot && Boolean(conflictSnapshotError))}
                        >
                            先看最新内容
                        </Button>
                        <Button
                            type="primary"
                            disabled={!conflictSnapshot}
                            onClick={() => {
                                setConflictModalOpen(false);
                                setResolverOpen(true);
                            }}
                        >
                            查看并处理
                        </Button>
                    </div>
                }
            >
                <div className="space-y-3" data-canvas-no-zoom>
                    <p className="text-sm leading-6">{progress?.message || "其他成员刚刚更新了这个画布。你的修改已经保留，可以选择合并。"}</p>
                    {progress?.draftCount ? <p className="m-0 text-xs text-muted-foreground">已保留 {progress.draftCount} 份本地草稿，处理前不会覆盖你的内容。</p> : null}
                    {conflictSnapshotError ? (
                        <p role="alert" className="text-xs leading-5 text-destructive">
                            {conflictSnapshotError}
                        </p>
                    ) : null}
                    <div className="rounded-lg border border-border bg-muted px-3 py-2.5 text-xs leading-5 text-foreground">
                        {conflictSnapshot ? "查看双方修改并确认后，可以继续同步。若先加载最新内容，原草稿会留在“协作 → 本机备份”供查看和下载。" : "系统暂时无法确认本地草稿是否可读取，请先重试；确认前不要关闭页面。"}
                    </div>
                    <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer select-none">查看发生了什么</summary>
                        <p className="mt-2 leading-5">系统发现云端内容和你的草稿改过同一部分。为避免覆盖其他成员的修改，当前画布暂不自动提交。</p>
                    </details>
                </div>
            </Modal>
            <CanvasConflictResolverModal
                open={resolverOpen && Boolean(conflictSnapshot)}
                snapshot={conflictSnapshot}
                onCancel={() => setResolverOpen(false)}
                onResolved={() => {
                    setResolverOpen(false);
                    setConflictModalOpen(false);
                    setConflictSnapshot(null);
                }}
            />
            <Popover
                trigger="click"
                placement="bottom"
                open={statusOpen}
                onOpenChange={setStatusOpen}
                content={
                    <div className="max-w-80 space-y-3" data-canvas-no-zoom>
                        <p role="status" className="text-sm">
                            {conflict ? "有一处修改需要你确认" : progress?.message || (phase === "done" ? "画布已同步到云端" : "修改会自动同步到云端")}
                        </p>
                        {conflict ? (
                            <p className="m-0 text-xs leading-5 text-muted-foreground">你的修改已经保留为草稿，不会覆盖其他成员的内容。</p>
                        ) : project?.collaborationEnabled ? (
                            <p className="m-0 text-xs leading-5 text-muted-foreground">其他成员的修改会自动出现在画布上。</p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                            {conflict ? (
                                <Button
                                    size="small"
                                    type="primary"
                                    disabled={!conflictSnapshot}
                                    onClick={() => {
                                        setStatusOpen(false);
                                        setResolverOpen(true);
                                    }}
                                >
                                    处理修改
                                </Button>
                            ) : phase === "error" ? (
                                <Button size="small" type="primary" loading={busy} onClick={() => void run(() => saveRemoteUserDataNow(projectId))}>
                                    重试同步
                                </Button>
                            ) : null}
                            {onOpenVersions ? (
                                <Button
                                    size="small"
                                    onClick={() => {
                                        setStatusOpen(false);
                                        onOpenVersions(conflict ? "draft" : undefined);
                                    }}
                                >
                                    查看协作
                                </Button>
                            ) : null}
                        </div>
                    </div>
                }
            >
                <Button
                    type="text"
                    size="small"
                    className="canvas-sync-status-button"
                    data-sync-state={conflict ? "conflict" : phase === "error" ? "error" : saving ? "saving" : "ok"}
                    danger={failed}
                    aria-label={`画布同步状态：${label}`}
                    icon={saving ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : failed ? <CloudOff className="size-3.5" /> : <CloudCheck className="size-3.5" />}
                >
                    <span className="canvas-sync-status-label text-xs">{label}</span>
                </Button>
            </Popover>
        </>
    );
}

export function CanvasSyncDraftMenu({ projectId }: { projectId?: string }) {
    const { message } = App.useApp();
    const [drafts, setDrafts] = useState<CanvasSyncDraft[]>([]);
    const [draftScope, setDraftScope] = useState("");
    const [loading, setLoading] = useState(false);
    const [exporting, setExporting] = useState(false);
    return (
        <Dropdown
            trigger={["click"]}
            onOpenChange={(open) => {
                if (!open) return;
                const scope = getActiveUserScope();
                setDraftScope(scope);
                setDrafts([]);
                setLoading(true);
                void (projectId ? readCanvasSyncDrafts(projectId, scope) : readAllCanvasSyncDrafts(scope))
                    .then((items) => {
                        if (getActiveUserScope() === scope) setDrafts(items.reverse());
                    })
                    .catch(() => message.error("读取本地草稿失败"))
                    .finally(() => setLoading(false));
            }}
            menu={{
                items: drafts.length
                    ? drafts.map((draft) => ({
                          key: draft.id,
                          label: `${draft.project.title} · ${new Date(draft.savedAt).toLocaleString()}`,
                          onClick: () => {
                              if (getActiveUserScope() !== draftScope) {
                                  setDrafts([]);
                                  message.error("账号已切换，请重新打开本地草稿");
                                  return;
                              }
                              setExporting(true);
                              void exportCanvasProjects([draft.project], `${draft.project.title}-本地草稿`, { includeLocalDrawings: false })
                                  .then(() => message.success("草稿已下载，可从画布列表导入为新画布"))
                                  .catch(() => message.error("草稿下载失败，请重试"))
                                  .finally(() => setExporting(false));
                          },
                      }))
                    : [{ key: "empty", label: loading ? "正在读取草稿…" : "暂无本地草稿", disabled: true }],
            }}
        >
            <Button size={projectId ? "small" : "middle"} loading={exporting}>
                本地草稿
            </Button>
        </Dropdown>
    );
}
