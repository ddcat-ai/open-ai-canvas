import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Tag } from "antd";
import { Bell } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AnnouncementTimelineModal } from "@/components/ui/aceternity/announcement-timeline-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { getAnnouncementFeed, markAnnouncementsRead } from "@/services/api/announcements";

const ANNOUNCEMENT_REFRESH_INTERVAL_MS = 5 * 60_000;
const ANNOUNCEMENT_CACHE_TTL_MS = 60_000;

type AnnouncementFeed = Awaited<ReturnType<typeof getAnnouncementFeed>>;

type SystemAnnouncementCenterProps = {
    userId: string;
    className?: string;
    style?: CSSProperties;
    showLabel?: boolean;
    labelClassName?: string;
    staticMotion?: boolean;
};

export function SystemAnnouncementCenter({ userId, className, style, showLabel = false, labelClassName, staticMotion = false }: SystemAnnouncementCenterProps) {
    const reducedMotion = useReducedMotion();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const queryKey = ["system-announcements", userId] as const;
    const feedQuery = useQuery({
        queryKey,
        queryFn: getAnnouncementFeed,
        enabled: Boolean(userId),
        staleTime: ANNOUNCEMENT_CACHE_TTL_MS,
        refetchInterval: ANNOUNCEMENT_REFRESH_INTERVAL_MS,
        // 公告在打开面板时会显式 refetch；不把浏览器 focus 变成每个工作区实例的请求触发器。
        refetchOnWindowFocus: false,
    });
    const announcements = feedQuery.data?.announcements || [];
    const unreadCount = Math.max(0, feedQuery.data?.unreadCount || 0);
    const error = feedQuery.error instanceof Error ? feedQuery.error.message : feedQuery.error ? "读取公告失败" : "";

    const openAnnouncements = async () => {
        setOpen(true);
        const feed = (await feedQuery.refetch()).data;
        if (!feed?.unreadCount) return;
        try {
            const result = await markAnnouncementsRead(feed.announcements.map((announcement) => announcement.id));
            const nextUnreadCount = Math.max(0, result.unreadCount || 0);
            queryClient.setQueryData<AnnouncementFeed>(queryKey, (current) => current ? { ...current, unreadCount: nextUnreadCount } : current);
            if (nextUnreadCount > 0) void queryClient.invalidateQueries({ queryKey });
        } catch {
            // 已读状态是辅助读路径，失败时保留角标，下一次打开或轮询会继续尝试同步。
        }
    };

    return (
        <>
            <motion.button
                type="button"
                className={className}
                style={style}
                whileHover={reducedMotion || staticMotion ? undefined : { y: -1, scale: 1.035 }}
                whileTap={reducedMotion || staticMotion ? undefined : { scale: 0.94 }}
                transition={aceternityMotion.spring.dock}
                onClick={() => void openAnnouncements()}
                aria-label={unreadCount ? `系统公告，${unreadCount} 条未读` : "系统公告"}
                title="系统公告"
            >
                <span className="relative shrink-0">
                    <Bell className="size-4" />
                    <AnimatePresence initial={false}>
                        {unreadCount > 0 ? (
                            <motion.span
                                key="unread-dot"
                                initial={reducedMotion ? false : { opacity: 0, scale: 0.5 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.6 }}
                                transition={aceternityMotion.spring.dock}
                                className="absolute -right-1 -top-1 size-2 rounded-full border border-background bg-red-500"
                                aria-hidden
                            />
                        ) : null}
                    </AnimatePresence>
                </span>
                {showLabel ? (
                    <span className={`min-w-0 flex-1 items-center justify-between gap-2 whitespace-nowrap ${labelClassName || ""}`}>
                        <span>系统公告</span>
                        <Tag color={unreadCount > 0 ? "gold" : undefined} className="!m-0 !min-w-6 !px-1.5 !text-center !text-[var(--fs-micro)] !font-medium !leading-[18px] tabular-nums">{announcements.length}</Tag>
                    </span>
                ) : null}
            </motion.button>
            <AnnouncementTimelineModal open={open} announcements={announcements} loading={feedQuery.isFetching} error={announcements.length ? "" : error} onClose={() => setOpen(false)} onRetry={() => void feedQuery.refetch()} />
        </>
    );
}
