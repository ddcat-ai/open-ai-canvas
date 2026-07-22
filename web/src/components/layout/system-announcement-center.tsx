import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { AnnouncementTimelineModal } from "@/components/ui/aceternity/announcement-timeline-modal";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { getAnnouncementFeed, markAnnouncementsRead, type SystemAnnouncement } from "@/services/api/announcements";

const ANNOUNCEMENT_REFRESH_INTERVAL_MS = 60_000;

type SystemAnnouncementCenterProps = {
    userId: string;
    className?: string;
    style?: CSSProperties;
};

export function SystemAnnouncementCenter({ userId, className, style }: SystemAnnouncementCenterProps) {
    const reducedMotion = useReducedMotion();
    const activeUserIdRef = useRef(userId);
    activeUserIdRef.current = userId;
    const [open, setOpen] = useState(false);
    const [announcements, setAnnouncements] = useState<SystemAnnouncement[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const refresh = useCallback(async (showLoading = false) => {
        if (!userId) return null;
        const requestUserId = userId;
        if (showLoading) setLoading(true);
        try {
            const feed = await getAnnouncementFeed();
            if (activeUserIdRef.current !== requestUserId) return null;
            setAnnouncements(feed.announcements || []);
            setUnreadCount(Math.max(0, feed.unreadCount || 0));
            setError("");
            return feed;
        } catch (requestError) {
            if (activeUserIdRef.current !== requestUserId) return null;
            setError(requestError instanceof Error ? requestError.message : "读取公告失败");
            return null;
        } finally {
            if (showLoading && activeUserIdRef.current === requestUserId) setLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        setAnnouncements([]);
        setUnreadCount(0);
        setError("");
        if (!userId) return;
        void refresh();
        const timer = window.setInterval(() => void refresh(), ANNOUNCEMENT_REFRESH_INTERVAL_MS);
        const onFocus = () => void refresh();
        const onVisibilityChange = () => {
            if (document.visibilityState === "visible") void refresh();
        };
        window.addEventListener("focus", onFocus);
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", onFocus);
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [refresh, userId]);

    const openAnnouncements = async () => {
        setOpen(true);
        const feed = await refresh(announcements.length === 0);
        if (!feed?.unreadCount) return;
        try {
            const result = await markAnnouncementsRead(feed.announcements.map((announcement) => announcement.id));
            const nextUnreadCount = Math.max(0, result.unreadCount || 0);
            setUnreadCount(nextUnreadCount);
            if (nextUnreadCount > 0) void refresh();
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
                whileHover={reducedMotion ? undefined : { y: -1, scale: 1.035 }}
                whileTap={reducedMotion ? undefined : { scale: 0.94 }}
                transition={aceternityMotion.spring.dock}
                onClick={() => void openAnnouncements()}
                aria-label={unreadCount ? `系统公告，${unreadCount} 条未读` : "系统公告"}
                title="系统公告"
            >
                <Bell className="size-4" />
                <AnimatePresence initial={false}>
                    {unreadCount > 0 ? (
                        <motion.span
                            key="badge"
                            initial={reducedMotion ? false : { opacity: 0, scale: 0.5 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.6 }}
                            transition={aceternityMotion.spring.dock}
                            className="absolute -right-1 -top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-background bg-red-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm"
                        >
                            {unreadCount > 99 ? "99+" : unreadCount}
                        </motion.span>
                    ) : null}
                </AnimatePresence>
            </motion.button>
            <AnnouncementTimelineModal open={open} announcements={announcements} loading={loading} error={announcements.length ? "" : error} onClose={() => setOpen(false)} onRetry={() => void refresh(true)} />
        </>
    );
}
