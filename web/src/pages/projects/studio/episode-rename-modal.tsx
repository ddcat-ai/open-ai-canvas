import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { App, Input } from "antd";

import { AppModal } from "@/components/ui/product/app-modal";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { renameDramaEpisode, type DramaEpisodeRow } from "@/services/api/drama";

export function EpisodeRenameModal({ projectId, episode, onClose }: { projectId: string; episode: DramaEpisodeRow; onClose: () => void }) {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const [title, setTitle] = useState(episode.title);
    const trimmed = title.trim();
    const rename = useMutation({
        mutationFn: () => renameDramaEpisode(projectId, episode.id, trimmed),
        onSuccess: async () => {
            await Promise.all([queryClient.invalidateQueries({ queryKey: dramaKeys.summary(projectId), exact: true }), queryClient.invalidateQueries({ queryKey: dramaKeys.episode(projectId, episode.id), exact: true })]);
            message.success("名称已保存");
            onClose();
        },
    });
    const canSave = Boolean(trimmed) && trimmed !== episode.title && !rename.isPending;
    const save = () => {
        if (canSave) rename.mutate();
    };

    return (
        <AppModal
            open
            centered
            width={440}
            rootClassName="drama-root"
            title="修改名称"
            okText="保存名称"
            cancelText="取消"
            confirmLoading={rename.isPending}
            okButtonProps={{ disabled: !canSave }}
            cancelButtonProps={{ disabled: rename.isPending }}
            closable={!rename.isPending}
            onOk={save}
            onCancel={() => {
                if (!rename.isPending) onClose();
            }}
        >
            <Input aria-label="分集名称" autoFocus value={title} maxLength={60} showCount disabled={rename.isPending} onChange={(event) => setTitle(event.target.value)} onFocus={(event) => event.currentTarget.select()} onPressEnter={save} />
            {rename.error ? (
                <p className="mt-2 text-sm text-destructive" role="alert">
                    {rename.error instanceof Error ? rename.error.message : "修改名称失败，请重试"}
                </p>
            ) : null}
        </AppModal>
    );
}
