import { ChevronRight } from "lucide-react";

import { bannerNoticeSurfaceCSS } from "@/lib/announcements/banner-notice";
import { bannerTitleRunStyle, type BannerTitleRun } from "@/lib/announcements/banner-title";

/**
 * 通知条的展示单元：底色、富文本标题、详情入口。
 *
 * 首页通知条与后台「前台效果预览」共用这里的每一个部件——后台 DIY 出来的结果之所以能原样回显，
 * 靠的就是两处不各写一份渲染，而不是靠两边样式对齐。
 * 图标素材（emoji）是标题文本的一部分，随 BannerAnnouncementTitle 一起渲染，这里不单独处理。
 */

/** 通知条底色：由通知类型决定，明暗两档交给 token 在各自主题下解析，组件不感知主题。 */
export function bannerAnnouncementBarStyle(noticeType?: string | null) {
    return { backgroundColor: bannerNoticeSurfaceCSS(noticeType) };
}

/** 「详情 ›」入口；仅在通知可点击时由调用方渲染。 */
export function BannerAnnouncementLinkHint({ chevronClassName }: { chevronClassName?: string }) {
    return (
        <span className="flex shrink-0 items-center gap-1 text-[var(--fs-label)] font-semibold text-white">
            <span>详情</span>
            <ChevronRight className={chevronClassName || "size-3.5"} aria-hidden="true" />
        </span>
    );
}

/**
 * 通知标题：按样式分段输出行内 span，未设置样式的维度沿用外层类名（通知条为白色 12px 半粗）。
 * 分段为空时回落到纯文本标题，避免旧数据不显示。
 */
export function BannerAnnouncementTitle({ runs, fallbackText }: { runs?: BannerTitleRun[] | null; fallbackText?: string }) {
    if (!runs || !runs.length) {
        return <>{fallbackText || ""}</>;
    }
    return (
        <>
            {runs.map((run, index) => {
                const style = bannerTitleRunStyle(run);
                return (
                    <span
                        key={`${index}:${run.text}`}
                        style={style}
                        className={!run.color ? "text-white" : undefined}
                    >
                        {run.text}
                    </span>
                );
            })}
        </>
    );
}
