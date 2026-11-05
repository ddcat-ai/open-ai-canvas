import { App, Button } from "antd";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import { translate } from "@/i18n";
import { generationNoticeKind, generationNoticePromptExcerpt, generationNoticeThumbnail } from "@/lib/generation-notice";
import { ApiError } from "@/services/api/request";
import { queryGenerationTask, type GenerationTask } from "@/services/api/task-center";
import { forgetGenerationTask, staleActiveGenerationTaskIds, subscribeGenerationTaskSuccess } from "@/services/generation-completion-tracker";
import { installNotificationAudioUnlock, playGenerationSuccessSound } from "@/services/notification-sound";
import { remindHiddenTab } from "@/services/tab-attention";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useNotificationPreferencesStore } from "@/stores/use-notification-preferences-store";
import { useUserStore } from "@/stores/use-user-store";

import "./generation-success-notifier.css";

/** 同一批（工作台多张、画布多图）在这个窗口内合并成一条通知、一声提示音。 */
const FLUSH_DELAY_MS = 600;
/** 页面自己的轮询停止后（例如离开画布），继续低频查询仍在运行的任务。 */
const WATCH_INTERVAL_MS = 10_000;
const WATCH_STALE_MS = 12_000;
const WATCH_MAX_AGE_MS = 3 * 60 * 60 * 1000;
const WATCH_LIMIT = 8;

/**
 * 生成完成提醒：页面可见时右上角弹出带动效的通知并播放提示音；标签页在后台时先出声并在标签上计数，
 * 回到页面再补一条汇总通知。开关在「设置 → 偏好设置 → 通知」，默认开启。
 */
export function GenerationSuccessNotifier() {
    const { notification } = App.useApp();
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const pathnameRef = useRef(pathname);
    pathnameRef.current = pathname;
    const userId = useUserStore((state) => state.user?.id || "");
    const taskCenterEnabled = useUserStore((state) => state.features.taskCenterEnabled);
    const taskCenterEnabledRef = useRef(taskCenterEnabled);
    taskCenterEnabledRef.current = taskCenterEnabled;

    useEffect(() => installNotificationAudioUnlock(), []);

    useEffect(() => {
        if (!userId) return;
        let buffer: GenerationTask[] = [];
        let awayTasks: GenerationTask[] = [];
        let flushTimer: ReturnType<typeof setTimeout> | undefined;

        const show = (tasks: GenerationTask[], away: boolean) => {
            const first = tasks[0];
            if (!first) return;
            const projects = useCanvasStore.getState().projects;
            const canvasIds = new Set(tasks.map((task) => task.projectId || ""));
            const canvasId = canvasIds.size === 1 && first.projectId && projects.some((project) => project.id === first.projectId) ? first.projectId : "";
            const canvasTitle = canvasId ? projects.find((project) => project.id === canvasId)?.title?.trim() || translate("nav.pageTitles.canvas") : "";
            const current = pathnameRef.current;
            const onCanvas = Boolean(canvasId) && (current === `/canvas/${canvasId}` || current.startsWith(`/canvas/${canvasId}/`));
            const target = canvasId ? (onCanvas ? "" : `/canvas/${encodeURIComponent(canvasId)}`) : taskCenterEnabledRef.current && current !== "/tasks" ? "/tasks" : "";
            const kind = generationNoticeKind(first);
            const title = tasks.length > 1 ? translate(away ? "shell.generationNotice.awayDone" : "shell.generationNotice.batchDone", { count: tasks.length }) : translate(`shell.generationNotice.done.${kind || "image"}`);
            const excerpt = tasks.length === 1 ? generationNoticePromptExcerpt(first.prompt) : "";
            const thumbnail = generationNoticeThumbnail(first);
            const key = `generation-success:${first.id}`;
            notification.open({
                key,
                className: "generation-success-notice",
                role: "status",
                duration: 6,
                icon: <GenerationSuccessMark />,
                title,
                description:
                    canvasTitle || excerpt || thumbnail ? (
                        <span className="generation-success-notice-body">
                            {thumbnail ? <NoticeThumbnail src={thumbnail} /> : null}
                            <span className="generation-success-notice-copy">
                                {canvasTitle ? <strong>{canvasTitle}</strong> : null}
                                {excerpt ? <span>{excerpt}</span> : null}
                            </span>
                        </span>
                    ) : undefined,
                actions: target ? (
                    <Button
                        size="small"
                        onClick={() => {
                            notification.destroy(key);
                            navigate(target);
                        }}
                    >
                        {translate(canvasId ? "shell.generationNotice.viewCanvas" : "shell.generationNotice.viewTasks")}
                    </Button>
                ) : undefined,
            });
        };

        const flush = () => {
            flushTimer = undefined;
            const tasks = buffer;
            buffer = [];
            const preferences = useNotificationPreferencesStore.getState();
            if (!tasks.length || !preferences.generationNotice) return;
            if (preferences.generationSound) playGenerationSuccessSound();
            if (remindHiddenTab(tasks.length)) {
                awayTasks.push(...tasks);
                return;
            }
            show(tasks, false);
        };

        const unsubscribe = subscribeGenerationTaskSuccess((task) => {
            if (!generationNoticeKind(task)) return;
            buffer.push(task);
            flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
        });

        // 后台期间的完成先只出声和计数；回到页面时补一条通知，用户才看得到动效与入口。
        const showAwayTasks = () => {
            if (document.visibilityState !== "visible" || !awayTasks.length) return;
            const tasks = awayTasks;
            awayTasks = [];
            if (useNotificationPreferencesStore.getState().generationNotice) show(tasks, true);
        };
        document.addEventListener("visibilitychange", showAwayTasks);

        const watch = window.setInterval(() => {
            if (!useNotificationPreferencesStore.getState().generationNotice) return;
            for (const id of staleActiveGenerationTaskIds(WATCH_STALE_MS, WATCH_MAX_AGE_MS, WATCH_LIMIT)) {
                // 查询结果经 task-center 汇入完成跟踪；任务已删除时停止跟踪，其余失败下一轮再试。
                void queryGenerationTask(id).catch((error) => {
                    if (error instanceof ApiError && (error.status === 404 || error.reason === "not_found")) forgetGenerationTask(id);
                });
            }
        }, WATCH_INTERVAL_MS);

        return () => {
            unsubscribe();
            if (flushTimer) clearTimeout(flushTimer);
            window.clearInterval(watch);
            document.removeEventListener("visibilitychange", showAwayTasks);
        };
    }, [navigate, notification, userId]);

    return null;
}

function GenerationSuccessMark() {
    return (
        <span className="generation-success-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path d="M7.5 12.4l3 3 6-6.4" pathLength={1} />
            </svg>
        </span>
    );
}

function NoticeThumbnail({ src }: { src: string }) {
    const [failed, setFailed] = useState(false);
    if (failed) return null;
    return <img className="generation-success-notice-thumb" src={src} alt="" width={44} height={44} onError={() => setFailed(true)} />;
}
