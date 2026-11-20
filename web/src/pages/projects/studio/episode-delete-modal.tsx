import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { App, Input } from "antd";
import { AlertTriangle } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { deleteDramaEpisode, DRAMA_ERROR_REASON, type DramaEpisodeRow } from "@/services/api/drama";
import { ApiError } from "@/services/api/request";

// 删除一集：生成过分镜视频的集要输入“第 N 集”才能删除，没有视频的集确认一次即可。
// 是否生成过以服务端为准：集列表统计不到重新改编前的旧视频，服务端要求确认时再切到输入确认。

const compact = (value: string) => value.replace(/\s+/g, "");

export function EpisodeDeleteModal({
    projectId,
    episode,
    blockedReason,
    onClose,
    onDeleted,
}: {
    projectId: string;
    /** 为 null 时不显示。 */
    episode: DramaEpisodeRow | null;
    blockedReason?: string;
    onClose: () => void;
    onDeleted: (episodeId: string) => void;
}) {
    return episode ? <DeleteEpisodeDialog key={episode.id} projectId={projectId} episode={episode} blockedReason={blockedReason} onClose={onClose} onDeleted={onDeleted} /> : null;
}

function DeleteEpisodeDialog({ projectId, episode, blockedReason, onClose, onDeleted }: { projectId: string; episode: DramaEpisodeRow; blockedReason?: string; onClose: () => void; onDeleted: (episodeId: string) => void }) {
    const { message } = App.useApp();
    const videos = episode.stats.videoGenerated;
    const [confirmText, setConfirmText] = useState<string | null>(videos > 0 || episode.finalResourceId ? `第 ${episode.number} 集` : null);
    const [typed, setTyped] = useState("");
    const matches = confirmText !== null && compact(typed) === compact(confirmText);
    const remove = useMutation({
        mutationFn: () => deleteDramaEpisode(projectId, episode.id, confirmText !== null ? typed.trim() : undefined),
        onSuccess: () => {
            message.success(`已删除第 ${episode.number} 集`);
            onDeleted(episode.id);
        },
        onError: (error) => {
            if (error instanceof ApiError && error.reason === DRAMA_ERROR_REASON.episodeConfirmRequired) {
                const text = error.details?.confirmText;
                setConfirmText(typeof text === "string" && text ? text : `第 ${episode.number} 集`);
                setTyped("");
                message.warning(error.message);
                return;
            }
            message.error(error instanceof Error ? error.message : "删除失败");
        },
    });
    const canSubmit = !blockedReason && (confirmText === null || matches);
    const submit = () => {
        if (canSubmit && !remove.isPending) remove.mutate();
    };
    return (
        <AppModal
            open
            centered
            width={480}
            rootClassName="drama-root"
            title={`删除第 ${episode.number} 集？`}
            okText="删除本集"
            cancelText="取消"
            okButtonProps={{ danger: true, disabled: !canSubmit }}
            confirmLoading={remove.isPending}
            onOk={submit}
            onCancel={onClose}
        >
            <div className="drama-episode-delete">
                <p>「{episode.title}」的剧本、分镜与剧情段会一并删除，后面各集的集号前移一位。本集原文退回「原著章节」，之后可以重新加入制作。</p>
                {confirmText !== null ? (
                    <>
                        <div className="drama-episode-delete-warn" role="alert">
                            <AlertTriangle className="size-4 shrink-0" />
                            <span>
                                本集已生成过分镜视频{videos > 0 ? `（${videos} 段）` : ""}
                                {episode.finalResourceId ? "和成片" : ""}。删除后这些视频、成片与历史版本都无法恢复，已花费的积分不会退回。
                            </span>
                        </div>
                        <label className="drama-episode-delete-field">
                            <span>
                                请输入 <b>{confirmText}</b> 确认删除
                            </span>
                            <Input autoFocus value={typed} placeholder={confirmText} aria-label={`输入“${confirmText}”确认删除`} disabled={Boolean(blockedReason)} onChange={(event) => setTyped(event.target.value)} onPressEnter={submit} />
                        </label>
                    </>
                ) : null}
                {blockedReason ? (
                    <div className="drama-composer-notice">
                        <AlertTriangle className="size-4 shrink-0" />
                        {blockedReason}
                    </div>
                ) : null}
            </div>
        </AppModal>
    );
}
