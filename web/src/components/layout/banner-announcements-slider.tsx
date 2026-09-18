import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { getActiveBanners, type BannerAnnouncement } from "@/services/api/announcements";
import {
    BannerAnnouncementLinkHint,
    BannerAnnouncementTitle,
    bannerAnnouncementBarStyle,
} from "@/components/layout/banner-announcement-content";
import { useUserStore } from "@/stores/use-user-store";

const BANNER_AUTO_SLIDE_MS = 4000;
const BANNER_DISMISS_STORAGE_PREFIX = "yingce.banner-announcements.dismissed";

export function BannerAnnouncementsSlider() {
    const navigate = useNavigate();
    const reducedMotion = useReducedMotion();
    const userId = useUserStore((state) => state.user?.id);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [dismissed, setDismissed] = useState(false);

    const { data } = useQuery({
        queryKey: ["active-banner-announcements"],
        queryFn: getActiveBanners,
        staleTime: 60_000,
        refetchInterval: 3 * 60_000,
    });

    const banners = data?.banners || [];
    const fingerprint = bannerFeedFingerprint(banners);
    const hasLink = Boolean(banners[currentIndex % Math.max(banners.length, 1)]?.link);

    useEffect(() => {
        if (banners.length <= 1) return;
        const timer = window.setInterval(() => {
            setCurrentIndex((prev) => (prev + 1) % banners.length);
        }, BANNER_AUTO_SLIDE_MS);
        return () => window.clearInterval(timer);
    }, [banners.length]);

    const handleClick = () => {
        const current = banners[currentIndex % Math.max(banners.length, 1)];
        if (!current?.link) return;
        if (/^https?:\/\//i.test(current.link)) {
            window.open(current.link, "_blank", "noopener,noreferrer");
            return;
        }
        navigate(current.link);
    };

    // banners 数量变化时把下标收拢到有效范围，避免残留越界值。
    useEffect(() => {
        if (banners.length > 0 && currentIndex >= banners.length) {
            setCurrentIndex(0);
        }
    }, [banners.length, currentIndex]);

    // 关闭状态按「用户 + 通知快照」记录：后台新增或重新编辑通知后快照变化，通知条会再次出现。
    useEffect(() => {
        setDismissed(fingerprint ? hasBannerDismissal(userId, fingerprint) : false);
    }, [fingerprint, userId]);

    const handleDismiss = () => {
        rememberBannerDismissal(userId, fingerprint);
        setDismissed(true);
    };

    if (!banners.length || dismissed) return null;
    const currentBanner = banners[currentIndex % banners.length];

    // 底色随每条通知的类型切换：加过渡让不同风格的条目轮播时平滑换色，与标题动画节奏一致。
    return (
        <div
            className="relative flex min-h-10 w-full shrink-0 items-center justify-center px-4 py-2 text-white transition-colors duration-300 ease-out"
            style={bannerAnnouncementBarStyle(currentBanner.noticeType)}
        >
            <button
                type="button"
                onClick={handleClick}
                disabled={!hasLink}
                className="group flex h-full w-full min-w-0 items-center justify-center px-8 transition-opacity enabled:hover:opacity-90 disabled:cursor-default"
                title={hasLink ? "点击查看详情" : undefined}
            >
                <span className="flex min-w-0 items-center justify-center gap-2.5">
                    {/* 标题内容区：通过外层弹性居中对齐，不用固定高度控制 */}
                    <span className="relative flex min-w-0 items-center justify-center">
                        <AnimatePresence mode="wait">
                            <motion.span
                                key={currentBanner.id}
                                initial={reducedMotion ? { opacity: 0, y: 0 } : { opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={reducedMotion ? { opacity: 0, y: 0 } : { opacity: 0, y: -10 }}
                                transition={{ duration: 0.3, ease: "easeOut" }}
                                className="inline-flex items-center justify-center truncate font-semibold tracking-wide drop-shadow-sm"
                            >
                                <BannerAnnouncementTitle runs={currentBanner.titleRuns} fallbackText={currentBanner.title} />
                            </motion.span>
                        </AnimatePresence>
                    </span>
                    {hasLink ? <BannerAnnouncementLinkHint chevronClassName="size-3.5 transition-transform group-hover:translate-x-0.5" /> : null}
                </span>
            </button>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label="关闭通知"
                title="关闭"
                className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-white transition-colors hover:bg-white/20"
            >
                <X className="size-3.5" aria-hidden="true" />
            </button>
        </div>
    );
}

function bannerFeedFingerprint(banners: BannerAnnouncement[]) {
    return banners
        .map((banner) => `${banner.id}:${banner.updatedAt}`)
        .sort()
        .join("|");
}

function bannerDismissalKey(userId?: string) {
    return `${BANNER_DISMISS_STORAGE_PREFIX}.${userId || "anonymous"}`;
}

function hasBannerDismissal(userId: string | undefined, fingerprint: string) {
    try {
        return localStorage.getItem(bannerDismissalKey(userId)) === fingerprint;
    } catch {
        return false;
    }
}

function rememberBannerDismissal(userId: string | undefined, fingerprint: string) {
    try {
        localStorage.setItem(bannerDismissalKey(userId), fingerprint);
    } catch {
        // 浏览器禁用存储时仍允许关闭，本次组件生命周期内不会重复出现。
    }
}
