import { X } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import type { LibTVGalleryItem } from "@/types/libtv-gallery";

import { WorkDetailPane } from "./work-detail";

/**
 * 灵感广场点开作品用弹窗，不离开列表：Modal 挂在 body 上，背后的列表仍在下面。
 * 切换推荐作品时用 key 重建内容体，展开状态和待同步草稿不会串到另一条作品；关闭时销毁媒体，避免外链视频继续占用。
 */
export function LibTVWorkDetailDialog({
    templateUuid,
    recommended,
    onSelectWork,
    onClose,
}: {
    templateUuid?: string;
    recommended: LibTVGalleryItem[];
    onSelectWork: (item: LibTVGalleryItem) => void;
    onClose: () => void;
}) {
    return (
        <AppModal
            flush
            open={Boolean(templateUuid)}
            onCancel={onClose}
            footer={null}
            centered
            closeIcon={<X className="size-4" />}
            className="workspace-modal library-modal libtv-work-detail-dialog"
            styles={{ mask: { backdropFilter: "none", WebkitBackdropFilter: "none" } }}
        >
            {templateUuid ? <WorkDetailPane key={templateUuid} templateUuid={templateUuid} recommended={recommended} onSelectWork={onSelectWork} onClose={onClose} /> : null}
        </AppModal>
    );
}
