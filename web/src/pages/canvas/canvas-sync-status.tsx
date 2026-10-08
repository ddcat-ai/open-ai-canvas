import { App, Button, Dropdown, Popover } from "antd";
import { CloudCheck, CloudOff, Download, FileClock, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { readAllCanvasSyncDrafts, readCanvasSyncDrafts, type CanvasSyncDraft } from "@/services/canvas-sync-drafts";
import { getActiveUserScope } from "@/lib/user-scope";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { retryRemoteUserDataSync } from "@/services/user-data-sync";
import "./canvas-sync-status.css";

export function CanvasSyncStatus({ projectId, onLoadLatest, onOpenVersions }: { projectId: string; onLoadLatest: () => Promise<void>; onOpenVersions?: () => void }) {
    const { message, modal } = App.useApp();
    const progress = useSyncProgressStore((state) => state.syncingProjects[projectId]);
    const [busy, setBusy] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const phase = progress?.phase;
    const conflict = phase === "conflict";
    const error = phase === "error";
    const retryScheduled = error && progress?.message?.includes("自动重试");
    const saving = phase === "pending" || phase === "saving" || phase === "uploading";
    const reconciling = phase === "reconciling";
    const tone = conflict ? "conflict" : error ? "error" : saving || reconciling ? "pending" : phase === "done" ? "done" : "idle";
    const label = conflict ? "需要处理冲突" : error ? "云端保存失败" : reconciling ? "正在自动合并" : saving ? "正在同步" : phase === "done" ? "已保存到云端" : "尚未同步";
    const description = conflict
        ? "本地与云端修改了同一字段，系统已保留本地草稿。"
        : error
          ? progress?.message || "本地内容仍然保留，云端暂未确认。"
          : reconciling
            ? progress?.message || "正在合并云端与本地修改，完成后会自动继续保存。"
            : saving
              ? progress?.message || "正在把本地修改同步到云端。"
              : phase === "done"
                ? progress?.message || "当前画布与云端版本一致。"
                : "本地内容会先保存到浏览器，再尝试同步到云端。";

    const run = async (operation: () => Promise<unknown>) => {
        setBusy(true);
        try {
            await operation();
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "操作失败，请重试");
            throw cause;
        } finally {
            setBusy(false);
        }
    };

    const confirmLoadLatest = () => {
        modal.confirm({
            title: "加载云端最新版本？",
            icon: <CloudOff className="canvas-sync-modal-icon" aria-hidden="true" />,
            content: (
                <div className="canvas-sync-confirm-copy">
                    <p>这不是合并操作：当前编辑器内容会替换为云端版本。</p>
                    <p>系统会先把本地修改保存为草稿，之后可从“版本记录”查看或下载，不会直接丢失。</p>
                </div>
            ),
            okText: "保留草稿并加载",
            cancelText: "继续编辑",
            okButtonProps: { danger: true },
            onOk: () =>
                run(async () => {
                    await onLoadLatest();
                    setStatusOpen(false);
                    message.success("云端版本已加载，本地内容已保留为草稿");
                }),
        });
    };

    return (
        <Popover
            trigger="click"
            placement="bottom"
            open={statusOpen}
            onOpenChange={setStatusOpen}
            arrow={false}
            classNames={{ root: "canvas-sync-popover", container: "canvas-sync-popover-surface", content: "canvas-sync-popover-content" }}
            content={
                <div className={`canvas-sync-panel canvas-sync-panel--${tone}`} data-canvas-no-zoom>
                    <div className="canvas-sync-panel__header">
                        <span className="canvas-sync-panel__status-icon" aria-hidden="true">
                            {saving ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : conflict || error ? <CloudOff /> : <CloudCheck />}
                        </span>
                        <div className="canvas-sync-panel__heading">
                            <span className="canvas-sync-panel__eyebrow">云端同步</span>
                            <strong>{label}</strong>
                        </div>
                    </div>
                    <p className="canvas-sync-panel__description" role="status">
                        {description}
                    </p>
                    {conflict ? (
                        <div className="canvas-sync-panel__callout">
                            <strong>先保护本地，再决定版本</strong>
                            <span>{progress?.draftCount ? `已保留 ${progress.draftCount} 份本地草稿。` : "加载云端版前会先保留本地草稿。"} 这是替换，不是合并。</span>
                        </div>
                    ) : error ? (
                        <div className="canvas-sync-panel__callout">
                            <strong>{retryScheduled ? "本地内容仍在，正在等待重试" : "本地内容仍在，未覆盖云端"}</strong>
                            <span>{retryScheduled ? "网络恢复后会自动重试；也可以点击“立即重试”。" : "请处理上面的错误后点击“立即重试”；在此之前本地内容不会被覆盖。"}</span>
                        </div>
                    ) : null}
                    <div className="canvas-sync-panel__actions">
                        {error ? (
                            <Button
                                type="primary"
                                block
                                icon={<RefreshCw className="size-3.5" />}
                                loading={busy}
                                onClick={() =>
                                    void run(() => retryRemoteUserDataSync(projectId))
                                        .then(() => setStatusOpen(false))
                                        .catch(() => undefined)
                                }
                            >
                                立即重试
                            </Button>
                        ) : null}
                        <Button block icon={<CloudOff className="size-3.5" />} disabled={busy || saving} onClick={confirmLoadLatest}>
                            加载云端版
                        </Button>
                        <div className="canvas-sync-panel__secondary-actions">
                            <Button
                                type="text"
                                size="small"
                                disabled={busy}
                                icon={<Download className="size-3.5" />}
                                onClick={() =>
                                    void run(async () => {
                                        const project = useCanvasStore.getState().openProject(projectId);
                                        if (project) await exportCanvasProjects([project], `${project.title}-本地副本`);
                                        message.success("当前内容已下载，可作为新画布导入");
                                    }).catch(() => undefined)
                                }
                            >
                                下载本地副本
                            </Button>
                            {onOpenVersions ? (
                                <Button
                                    type="text"
                                    size="small"
                                    disabled={busy}
                                    icon={<FileClock className="size-3.5" />}
                                    onClick={() => {
                                        setStatusOpen(false);
                                        onOpenVersions();
                                    }}
                                >
                                    版本记录{progress?.draftCount ? ` · ${progress.draftCount} 份草稿` : ""}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                </div>
            }
        >
            <Button
                type="text"
                size="small"
                className={`canvas-sync-status-trigger canvas-sync-status-trigger--${tone}`}
                aria-label={`画布保存状态：${label}`}
                aria-expanded={statusOpen}
                icon={saving ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : conflict || error ? <CloudOff className="size-3.5" /> : <CloudCheck className="size-3.5" />}
            >
                <span className="canvas-sync-status-label text-xs">{label}</span>
            </Button>
        </Popover>
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
