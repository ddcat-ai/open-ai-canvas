import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Tag } from "antd";
import { Bell } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { aceternityMotion } from "@/lib/aceternity-motion";
import { getAnnouncementFeed, markAnnouncementsRead } from "@/services/api/announcements";

const AnnouncementTimelineModal = lazy(() => import("@/components/ui/aceternity/announcement-timeline-modal").then((module) => ({ default: module.AnnouncementTimelineModal })));

const ANNOUNCEMENT_REFRESH_INTERVAL_MS = 5 * 60_000;
const ANNOUNCEMENT_CACHE_TTL_MS = 60_000;
const ANNOUNCEMENT_DISMISS_TODAY_PREFIX = "yingce.announcements.dismiss-today";

type AnnouncementFeed = Awaited<ReturnType<typeof getAnnouncementFeed>>;

type SystemAnnouncementCenterProps = {
    userId: string;
    className?: string;
    style?: CSSProperties;
    showLabel?: boolean;
    labelClassName?: string;
    staticMotion?: boolean;
    autoOpen?: boolean;
};

export function SystemAnnouncementCenter({ userId, className, style, showLabel = false, labelClassName, staticMotion = false, autoOpen = false }: SystemAnnouncementCenterProps) {
    const reducedMotion = useReducedMotion();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [automaticPrompt, setAutomaticPrompt] = useState(false);
    const [dismissedFingerprint, setDismissedFingerprint] = useState("");
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

    useEffect(() => {
        if (!autoOpen || open || !feedQuery.isSuccess || unreadCount <= 0 || announcements.length === 0) return;
        const fingerprint = announcementFeedFingerprint(announcements);
        if (!fingerprint || fingerprint === dismissedFingerprint || announcementAutoPromptSuppressed(userId)) return;
        setAutomaticPrompt(true);
        setOpen(true);
    }, [announcements, autoOpen, dismissedFingerprint, feedQuery.isSuccess, open, unreadCount, userId]);

    const openAnnouncements = async () => {
        setAutomaticPrompt(false);
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

    const dismissAutomaticPrompt = (duration: "once" | "today") => {
        const fingerprint = announcementFeedFingerprint(announcements);
        if (fingerprint) setDismissedFingerprint(fingerprint);
        if (duration === "today") rememberAnnouncementDismissalToday(userId);
        setAutomaticPrompt(false);
        setOpen(false);
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
            {open ? (
                <Suspense fallback={null}>
                    <AnnouncementTimelineModal
                        open
                        announcements={announcements}
                        loading={feedQuery.isFetching}
                        error={announcements.length ? "" : error}
                        automaticPrompt={automaticPrompt}
                        onClose={() => dismissAutomaticPrompt("once")}
                        onDismissOnce={() => dismissAutomaticPrompt("once")}
                        onDismissToday={() => dismissAutomaticPrompt("today")}
                        onRetry={() => void feedQuery.refetch()}
                    />
                </Suspense>
            ) : null}
        </>
    );
}

function announcementFeedFingerprint(announcements: AnnouncementFeed["announcements"]) {
    return announcements
        .map((announcement) => `${announcement.id}:${announcement.publishedAt}`)
        .sort()
        .join("|");
}

function announcementAutoPromptSuppressed(userId: string) {
    try {
        return localStorage.getItem(`${ANNOUNCEMENT_DISMISS_TODAY_PREFIX}.${userId}`) === localDateKey();
    } catch {
        return false;
    }
}

function rememberAnnouncementDismissalToday(userId: string) {
    try {
        localStorage.setItem(`${ANNOUNCEMENT_DISMISS_TODAY_PREFIX}.${userId}`, localDateKey());
    } catch {
        // 浏览器禁用存储时仍允许关闭弹窗，本次组件生命周期内不会重复打开。
    }
}

function localDateKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
