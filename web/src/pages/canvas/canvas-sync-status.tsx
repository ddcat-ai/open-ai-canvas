import { App, Button, Popover } from "antd";
import { CloudCheck, CloudOff, FileClock, LoaderCircle, RefreshCw, UploadCloud } from "lucide-react";
import { useState } from "react";
import { flushCanvasStorePersistence } from "@/stores/canvas/use-canvas-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { overwriteRemoteCanvasProject, retryRemoteUserDataSync } from "@/services/user-data-sync";
import "./canvas-sync-status.css";

export function CanvasSyncStatus({ projectId, onLoadLatest, onOpenVersions }: { projectId: string; onLoadLatest: () => Promise<void>; onOpenVersions?: () => void }) {
    const { message } = App.useApp();
    const progress = useSyncProgressStore((state) => state.syncingProjects[projectId]);
    const [busy, setBusy] = useState(false);
    const [statusOpen, setStatusOpen] = useState(false);
    const phase = progress?.phase;
    const conflict = phase === "conflict";
    const cloudError = phase === "error";
    const localPhase = progress?.localPhase;
    const localError = localPhase === "error";
    const localPending = localPhase === "pending";
    const missingResources = progress?.errorKind === "resources";
    const retryScheduled = cloudError && progress?.message?.includes("自动重试");
    const saving = phase === "pending" || phase === "saving" || phase === "uploading";
    const reconciling = phase === "reconciling";
    const tone = conflict || cloudError || localError ? (conflict ? "conflict" : "error") : saving || reconciling || localPending ? "pending" : phase === "done" ? "done" : localPhase === "saved" ? "done" : "idle";
    const label = conflict
        ? "需要处理冲突"
        : cloudError
          ? "云端保存失败"
          : localError
            ? "本地保存失败"
            : reconciling
              ? "正在自动合并"
              : saving
                ? "正在同步云端"
                : localPending
                  ? "正在保存本地"
                  : phase === "done"
                    ? "已保存到云端"
                    : localPhase === "saved"
                      ? "已保存在本地"
                      : "尚未同步";
    const description = conflict
        ? progress?.message || "本地与云端存在冲突，当前编辑内容保持不变。"
        : cloudError
          ? missingResources
              ? "检测到云端缺失素材；可以先保留原始草稿，再用本地版强制覆盖并移除失效素材引用。"
              : progress?.message || "本地内容仍然保留，云端暂未确认。"
          : localError
            ? progress?.localError || "本地保存没有完成，请立即重试；当前编辑内容保持不变。"
            : reconciling
              ? progress?.message || "正在合并云端与本地修改，完成后会自动继续保存。"
              : saving
                ? progress?.message || "本地内容已保留，正在同步到云端。"
                : localPending
                  ? "正在把最近编辑写入浏览器本地存储。"
                  : phase === "done"
                    ? progress?.message || "当前画布与云端版本一致。"
                    : localPhase === "saved"
                      ? "当前编辑已保存到浏览器本地，登录后会继续同步到云端。"
                      : "本地内容会先保存到浏览器，再尝试同步到云端。";
    const localStatus = localError ? progress?.localError || "保存失败" : localPending ? "正在保存" : localPhase === "saved" ? `已保存${progress?.localSavedAt ? ` · ${new Date(progress.localSavedAt).toLocaleTimeString()}` : ""}` : "尚未确认";
    const cloudStatus = conflict
        ? "存在冲突"
        : cloudError
          ? progress?.message || "保存失败"
          : saving || reconciling
            ? "正在同步"
            : phase === "done"
              ? `已保存${progress?.cloudRevision !== undefined ? ` · 版本 ${progress.cloudRevision}` : ""}`
              : "尚未同步";

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

    const loadLatest = () => {
        void run(async () => {
            await onLoadLatest();
            setStatusOpen(false);
            message.success("云端版本已加载，本地内容已保留为草稿");
        }).catch(() => undefined);
    };

    const overwriteCloud = () => {
        void run(async () => {
            await overwriteRemoteCanvasProject(projectId);
            setStatusOpen(false);
            message.success("本地版本已覆盖云端");
        }).catch(() => undefined);
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
                            {saving || localPending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" /> : conflict || cloudError || localError ? <CloudOff /> : <CloudCheck />}
                        </span>
                        <div className="canvas-sync-panel__heading">
                            <span className="canvas-sync-panel__eyebrow">云端同步</span>
                            <strong>{label}</strong>
                        </div>
                    </div>
                    <p className="canvas-sync-panel__description" role="status">
                        {description}
                    </p>
                    <div className="canvas-sync-panel__details" aria-label="画布保存分层状态">
                        <div>
                            <span>本地浏览器</span>
                            <strong>{localStatus}</strong>
                        </div>
                        <div>
                            <span>云端画布</span>
                            <strong>{cloudStatus}</strong>
                        </div>
                        {progress?.pendingWrites ? <small>待写入 {progress.pendingWrites} 项</small> : null}
                    </div>
                    {progress?.draftError ? (
                        <div className="canvas-sync-panel__callout">
                            <strong>本地草稿保存未完成，已暂停版本替换</strong>
                            <span>{progress.draftError}</span>
                        </div>
                    ) : conflict ? (
                        <div className="canvas-sync-panel__callout">
                            <strong>请选择保留哪一版</strong>
                            <span>{progress?.draftCount ? `已保留 ${progress.draftCount} 份本地草稿。` : "本地内容仍在编辑器中。"} 加载云端版会替换当前编辑内容；用本地版覆盖会替换云端内容。</span>
                        </div>
                    ) : cloudError ? (
                        <div className="canvas-sync-panel__callout">
                            <strong>{retryScheduled ? "本地内容仍在，正在等待重试" : "本地内容仍在，未覆盖云端"}</strong>
                            <span>
                                {missingResources
                                    ? "可点击“用本地版强制覆盖云端”；操作前会自动保留本地草稿，失效图片节点会保留布局和提示词。"
                                    : retryScheduled
                                      ? "网络恢复后会自动重试；也可以点击“立即重试”。"
                                      : "请处理上面的错误后点击“立即重试”；在此之前本地内容不会被覆盖。"}
                            </span>
                        </div>
                    ) : localError ? (
                        <div className="canvas-sync-panel__callout">
                            <strong>本地保存没有完成</strong>
                            <span>{progress?.draftError || progress?.localError || "请立即重试；当前编辑内容保持不变。"}</span>
                        </div>
                    ) : null}
                    <div className="canvas-sync-panel__actions">
                        {cloudError ? (
                            <>
                                {!missingResources ? (
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
                                        立即重试云端同步
                                    </Button>
                                ) : null}
                                {missingResources ? (
                                    <Button
                                        type="primary"
                                        danger
                                        block
                                        icon={<UploadCloud className="size-3.5" />}
                                        loading={busy}
                                        onClick={() =>
                                            void run(() => overwriteRemoteCanvasProject(projectId))
                                                .then(() => setStatusOpen(false))
                                                .catch(() => undefined)
                                        }
                                    >
                                        修复并强制覆盖云端
                                    </Button>
                                ) : null}
                            </>
                        ) : localError ? (
                            <Button
                                type="primary"
                                block
                                icon={<RefreshCw className="size-3.5" />}
                                loading={busy}
                                onClick={() =>
                                    void run(() => flushCanvasStorePersistence())
                                        .then(() => setStatusOpen(false))
                                        .catch(() => undefined)
                                }
                            >
                                立即重试本地保存
                            </Button>
                        ) : null}
                        {conflict ? (
                            <div className="canvas-sync-panel__conflict-actions">
                                <Button block icon={<CloudOff className="size-3.5" />} disabled={busy || saving || localPending || localError} onClick={loadLatest}>
                                    加载云端版
                                </Button>
                                <Button type="primary" block icon={<UploadCloud className="size-3.5" />} danger disabled={busy || saving || localPending || localError || Boolean(progress?.draftError)} onClick={overwriteCloud}>
                                    用本地版覆盖云端
                                </Button>
                            </div>
                        ) : (
                            <Button block icon={<CloudOff className="size-3.5" />} disabled={busy || saving || localPending || localError} onClick={loadLatest}>
                                加载云端版
                            </Button>
                        )}
                        <div className="canvas-sync-panel__secondary-actions">
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
                icon={saving || localPending ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : conflict || cloudError || localError ? <CloudOff className="size-3.5" /> : <CloudCheck className="size-3.5" />}
            >
                <span className="canvas-sync-status-label text-xs">{label}</span>
            </Button>
        </Popover>
    );
}
