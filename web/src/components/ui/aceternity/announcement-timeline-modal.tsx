import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Modal } from "antd";
import { Bell, BellOff, CircleAlert, Info, ShieldAlert, Wrench } from "lucide-react";

import { aceternityMotion } from "@/lib/aceternity-motion";
import type { AnnouncementLevel, SystemAnnouncement } from "@/services/api/announcements";

type AnnouncementTimelineModalProps = {
    open: boolean;
    announcements: SystemAnnouncement[];
    loading?: boolean;
    error?: string;
    onClose: () => void;
    onRetry?: () => void;
};

const levelMeta: Record<AnnouncementLevel, { label: string; dot: string; icon: typeof Info }> = {
    info: { label: "平台通知", dot: "bg-sky-500", icon: Info },
    success: { label: "状态恢复", dot: "bg-emerald-500", icon: Wrench },
    warning: { label: "服务提醒", dot: "bg-amber-500", icon: CircleAlert },
    critical: { label: "重要通知", dot: "bg-red-500", icon: ShieldAlert },
};

export function AnnouncementTimelineModal({ open, announcements, loading = false, error = "", onClose, onRetry }: AnnouncementTimelineModalProps) {
    const reducedMotion = useReducedMotion();

    return (
        <Modal
            open={open}
            width={960}
            centered
            footer={null}
            onCancel={onClose}
            title={
                <div className="flex min-w-0 items-center gap-3 pr-8">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full border border-border bg-muted/45 text-foreground">
                        <Bell className="size-4.5" />
                    </span>
                    <div className="min-w-0">
                        <div className="text-lg font-semibold tracking-normal text-foreground">系统公告</div>
                        <div className="mt-0.5 text-xs font-normal text-foreground/45">{announcements.length ? `${announcements.length} 条当前公告` : "当前没有进行中的公告"}</div>
                    </div>
                </div>
            }
            styles={{ body: { paddingTop: 8, maxHeight: "min(72vh, 720px)", overflowY: "auto", overscrollBehavior: "contain" } }}
            modalRender={(node) => (
                <motion.div
                    initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.975 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: aceternityMotion.duration.panel, ease: aceternityMotion.easing.enter }}
                >
                    {node}
                </motion.div>
            )}
        >
            <AnimatePresence mode="wait" initial={false}>
                {loading ? (
                    <motion.div key="loading" role="status" className="grid min-h-60 place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                        <div className="flex flex-col items-center gap-3 text-sm text-foreground/50">
                            <motion.span aria-hidden className="size-7 rounded-full border-2 border-foreground/15 border-t-foreground/70" animate={reducedMotion ? undefined : { rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }} />
                            正在读取公告
                        </div>
                    </motion.div>
                ) : error ? (
                    <motion.div key="error" className="grid min-h-60 place-items-center text-center" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                        <div>
                            <CircleAlert className="mx-auto size-7 text-red-500" />
                            <p className="mt-3 text-sm font-medium text-foreground">公告读取失败</p>
                            <p className="mt-1 max-w-sm text-xs leading-5 text-foreground/50">{error}</p>
                            {onRetry ? <button type="button" className="mt-4 h-8 rounded-md border border-border px-3 text-xs font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onRetry}>重新加载</button> : null}
                        </div>
                    </motion.div>
                ) : announcements.length ? (
                    <motion.div key="timeline" className="py-3 sm:px-2" initial="hidden" animate="visible" variants={{ hidden: {}, visible: { transition: { staggerChildren: reducedMotion ? 0 : 0.055 } } }}>
                        {announcements.map((announcement, index) => (
                            <AnnouncementTimelineItem key={announcement.id} announcement={announcement} last={index === announcements.length - 1} reducedMotion={Boolean(reducedMotion)} />
                        ))}
                    </motion.div>
                ) : (
                    <motion.div key="empty" className="grid min-h-60 place-items-center text-center" initial={reducedMotion ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                        <div>
                            <span className="mx-auto grid size-12 place-items-center rounded-full border border-border bg-muted/40 text-foreground/45"><BellOff className="size-5" /></span>
                            <p className="mt-3 text-sm font-medium text-foreground">暂无系统公告</p>
                            <p className="mt-1 text-xs text-foreground/45">有新的服务动态时会在这里展示</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </Modal>
    );
}

function AnnouncementTimelineItem({ announcement, last, reducedMotion }: { announcement: SystemAnnouncement; last: boolean; reducedMotion: boolean }) {
    const meta = levelMeta[announcement.level] || levelMeta.info;
    const Icon = meta.icon;
    return (
        <motion.article
            variants={{ hidden: { opacity: 0, y: 10 }, visible: { opacity: 1, y: 0, transition: { duration: aceternityMotion.duration.state, ease: aceternityMotion.easing.enter } } }}
            whileHover={reducedMotion ? undefined : { x: 2 }}
            className="relative grid grid-cols-[26px_minmax(0,1fr)] gap-3 pb-7 last:pb-2 sm:grid-cols-[32px_minmax(0,1fr)] sm:gap-4"
        >
            <div className="relative flex justify-center pt-1.5" aria-hidden>
                {!last ? <span className="absolute left-1/2 top-5 h-[calc(100%+4px)] w-px -translate-x-1/2 bg-border" /> : null}
                <span className={`relative z-10 size-3.5 rounded-full border-[3px] border-background ${meta.dot}`} />
            </div>
            <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <h3 className="text-[15px] font-semibold leading-6 tracking-normal text-foreground sm:text-base">{announcement.title}</h3>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground/45"><Icon className="size-3" />{meta.label}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-foreground/75 sm:text-[15px]">{announcement.content}</p>
                <time dateTime={announcement.publishedAt} className="mt-2 block text-xs tabular-nums text-foreground/40">{relativeTime(announcement.publishedAt)} · {formatDateTime(announcement.publishedAt)}</time>
            </div>
        </motion.article>
    );
}

function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date).replaceAll("/", "-");
}

function relativeTime(value: string) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "刚刚";
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 60) return "刚刚";
    if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
    if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)} 天前`;
    return `${Math.floor(seconds / (86400 * 7))} 周前`;
}
