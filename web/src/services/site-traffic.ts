import type { createBrowserRouter } from "react-router";
import { createClientUUID } from "@/lib/client-id";
import { isGuestWorkspacePath } from "@/lib/guest-workspace";
import { resolveSiteTrafficPage, siteTrafficActionLabels, type SiteTrafficAction } from "@/lib/site-traffic";
import { useUserStore } from "@/stores/use-user-store";
import { ApiError } from "@/services/api/request";
import { collectSiteTraffic, type SiteTrafficEvent } from "@/services/api/site-traffic";

export type SiteTrafficRouter = Pick<ReturnType<typeof createBrowserRouter>, "state" | "subscribe">;
type PageMemory = { pathname?: string; unavailable?: boolean };
type Session = { id: string; updatedAt: number };
type QueuedEvent = { event: SiteTrafficEvent; failures: number };
type Diagnostic = "storage_unavailable" | "coordination_unavailable" | "identity_unavailable" | "queue_full" | "endpoint_unavailable" | "retry_exhausted" | "request_rejected";
const VISITOR_KEY = "site-traffic:visitor";
const SESSION_KEY = "site-traffic:session";
const SESSION_LOCK = "site-traffic:identity";
const SESSION_IDLE_MS = 30 * 60 * 1000;
const MAX_QUEUE = 100;
const BATCH_SIZE = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readSession(raw: string | null): Session | undefined {
    try {
        const value = JSON.parse(raw || "null") as Session | null;
        if (value && typeof value.id === "string" && UUID.test(value.id) && Number.isFinite(value.updatedAt) && value.updatedAt > 0) return { id: value.id, updatedAt: value.updatedAt };
    } catch {
        // 只重建本统计的小型会话配置，不扫描或清理其他浏览器存储。
    }
}

/** 每个浏览器文档一个实例；工厂也允许专项用两个独立窗口验证跨 tab 合同。 */
export function createSiteTrafficCollector(browser: Window, send: typeof collectSiteTraffic = collectSiteTraffic, pageMemory: PageMemory = {}) {
    let router: SiteTrafficRouter | undefined;
    let references = 0;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeAuth: (() => void) | undefined;
    let lifetime = new AbortController();
    let timer: number | undefined;
    let queue: QueuedEvent[] = [];
    let inFlight: QueuedEvent[] = [];
    let pendingCount = 0;
    let pending = Promise.resolve();
    let storageUnavailable = false;
    let visitorId: string | undefined;
    let session: Session | undefined;
    const diagnostics = new Set<Diagnostic>();

    const diagnose = (category: Diagnostic, count = 1) => {
        if (diagnostics.has(category)) return;
        diagnostics.add(category);
        // 不记录异常对象、URL、身份标识或后端错误正文，也不向用户弹提示。
        console.warn("[site-traffic]", category, count);
    };
    const allowed = () => {
        const navigator = browser.navigator as Navigator & { globalPrivacyControl?: boolean };
        const dnt = navigator.doNotTrack || (browser as Window & { doNotTrack?: string }).doNotTrack;
        return dnt !== "1" && dnt !== "yes" && navigator.globalPrivacyControl !== true;
    };
    const active = () => references > 0 && !lifetime.signal.aborted && !pageMemory.unavailable;
    const clearTimer = () => {
        if (timer !== undefined) browser.clearTimeout(timer);
        timer = undefined;
    };
    const currentPage = () => {
        if (router && (!router.state.initialized || router.state.navigation.state !== "idle")) return null;
        const auth = router ? useUserStore.getState() : undefined;
        if (auth && !auth.hydrated) return null;
        const location = router?.state.location || browser.location;
        const pathname = location.pathname.replace(/\/+$/, "") || "/";
        // 画布的自动新建/最近/交接页只有跳转占位，不把中间屏当页面展示。
        if (pathname.toLowerCase() === "/canvas" && ["new", "recent", "handoff"].includes(new URLSearchParams(location.search).get("mode") || "")) return null;
        const page = resolveSiteTrafficPage(pathname);
        // RequireAuth 的跳转发生在组件中，router idle 仍可能只显示认证加载/重定向。
        if (auth && !auth.user && !isGuestWorkspacePath(pathname)) return null;
        // 功能关闭时路由只展示门禁页，不能计入对应业务页面。
        if (
            auth &&
            ((page === "tools_image" && !auth.features.imageWorkbenchEnabled) ||
                (page === "tools_video" && !auth.features.videoWorkbenchEnabled) ||
                (page === "history" && !auth.features.taskCenterEnabled) ||
                (page === "drama" && !auth.features.shortDramaEnabled))
        )
            return null;
        return page ? { pathname, page } : null;
    };
    const updateSession = () => {
        const now = Date.now();
        visitorId ||= createClientUUID();
        session = !session || now - session.updatedAt >= SESSION_IDLE_MS ? { id: createClientUUID(), updatedAt: now } : { id: session.id, updatedAt: Math.max(now, session.updatedAt) };
        return { visitorId, sessionId: session.id };
    };
    const readAndTouchIdentity = () => {
        if (!allowed()) return null;
        if (!storageUnavailable) {
            try {
                const storage = browser.localStorage;
                const storedVisitor = storage.getItem(VISITOR_KEY);
                visitorId = storedVisitor && UUID.test(storedVisitor) ? storedVisitor : undefined;
                session = readSession(storage.getItem(SESSION_KEY));
                const identity = updateSession();
                if (storedVisitor !== visitorId) storage.setItem(VISITOR_KEY, identity.visitorId);
                storage.setItem(SESSION_KEY, JSON.stringify(session));
                return identity;
            } catch {
                // 禁存储时仅保留本页内存身份，不指纹识别，也不改用账号或其他持久存储。
                storageUnavailable = true;
                diagnose("storage_unavailable");
            }
        }
        return updateSession();
    };
    const identityForEvent = (signal: AbortSignal) => {
        if (browser.navigator.locks?.request) return browser.navigator.locks.request(SESSION_LOCK, { signal }, readAndTouchIdentity);
        // 无 Web Locks 的环境仍逐次读取共享 localStorage，并通过 storage 通知同步；不声称具有原子跨 tab 锁。
        diagnose("coordination_unavailable");
        return Promise.resolve(readAndTouchIdentity());
    };
    const schedule = (delay = 600) => {
        if (!active() || timer !== undefined || inFlight.length || !queue.length) return;
        timer = browser.setTimeout(() => {
            timer = undefined;
            void flush();
        }, delay);
    };
    const flush = async () => {
        if (!active() || inFlight.length) return;
        clearTimer();
        if (!allowed()) {
            queue = [];
            return;
        }
        if (!queue.length) return;
        const batch = queue.splice(0, BATCH_SIZE);
        inFlight = batch;
        const signal = lifetime.signal;
        let delay = 600;
        try {
            await send(
                batch.map(({ event }) => event),
                { signal },
            );
        } catch (error) {
            if (signal.aborted || !active() || !allowed()) return;
            if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
                // 旧后端在本次文档生命周期内停止采集，后续点击不再不断探测不存在的端点。
                pageMemory.unavailable = true;
                queue = [];
                diagnose("endpoint_unavailable", batch.length);
            } else if (error instanceof ApiError && error.retryable && batch.every((item) => item.failures < 2)) {
                batch.forEach((item) => {
                    item.failures += 1;
                });
                queue.unshift(...batch);
                delay = Math.min(30_000, Math.max(1000 * 2 ** (batch[0].failures - 1), error.retryAfterMs || 0));
            } else {
                diagnose(error instanceof ApiError && error.retryable ? "retry_exhausted" : "request_rejected", batch.length);
            }
        } finally {
            if (inFlight === batch) inFlight = [];
            schedule(delay);
        }
    };
    const record = (page: NonNullable<ReturnType<typeof resolveSiteTrafficPage>>, action?: SiteTrafficAction) => {
        if (!active() || !allowed() || browser.document.visibilityState !== "visible") return;
        if (queue.length + inFlight.length + pendingCount >= MAX_QUEUE) {
            diagnose("queue_full");
            return;
        }
        const signal = lifetime.signal;
        pendingCount += 1;
        // 串行并有界地分配身份，Web Lock 的回调内只做同步小配置读写，不持锁等待网络。
        pending = pending
            .then(async () => {
                if (signal.aborted || !active() || !allowed()) return;
                const identity = await identityForEvent(signal);
                if (!identity || signal.aborted || !active() || !allowed()) return;
                const base = { id: createClientUUID(), ...identity, page };
                queue.push({ event: action ? { ...base, type: "action", action } : { ...base, type: "page_view" }, failures: 0 });
                schedule();
            })
            .catch(() => {
                if (!signal.aborted) diagnose("identity_unavailable");
            })
            .finally(() => {
                pendingCount -= 1;
            });
    };
    const observePage = () => {
        if (!active() || !allowed() || browser.document.visibilityState !== "visible") return;
        const current = currentPage();
        if (!current) {
            // 离开可采集页面后再返回仍是一次展示，但不在导航或认证加载期间改动去重状态。
            if (!router || (router.state.initialized && router.state.navigation.state === "idle" && useUserStore.getState().hydrated)) pageMemory.pathname = undefined;
            return;
        }
        if (pageMemory.pathname === current.pathname) return;
        pageMemory.pathname = current.pathname;
        record(current.page);
    };
    const onStorage = (event: StorageEvent) => {
        if (!allowed() || storageUnavailable) return;
        if (event.key === VISITOR_KEY || event.key === null) visitorId = event.newValue && UUID.test(event.newValue) ? event.newValue : undefined;
        if (event.key === SESSION_KEY || event.key === null) session = readSession(event.newValue);
    };
    const onPageHide = () => {
        void flush();
    };
    const dispose = () => {
        references = 0;
        unsubscribe?.();
        unsubscribe = undefined;
        unsubscribeAuth?.();
        unsubscribeAuth = undefined;
        browser.document.removeEventListener("visibilitychange", observePage);
        browser.removeEventListener("storage", onStorage);
        browser.removeEventListener("pagehide", onPageHide);
        clearTimer();
        lifetime.abort();
        queue = [];
        inFlight = [];
    };
    const install = (source?: SiteTrafficRouter) => {
        references += 1;
        if (references === 1) {
            lifetime = new AbortController();
            router = source;
            unsubscribe = router?.subscribe(observePage);
            if (router)
                unsubscribeAuth = useUserStore.subscribe((state, previous) => {
                    if (state.hydrated !== previous.hydrated || Boolean(state.user) !== Boolean(previous.user) || state.features !== previous.features) observePage();
                });
            browser.document.addEventListener("visibilitychange", observePage);
            browser.addEventListener("storage", onStorage);
            browser.addEventListener("pagehide", onPageHide);
            observePage();
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            if (references > 0 && --references === 0) dispose();
        };
    };
    const trackAction = (action: SiteTrafficAction) => {
        if (!active() || !allowed() || !Object.hasOwn(siteTrafficActionLabels, action)) return;
        const current = currentPage();
        if (current) record(current.page, action);
    };
    return { install, trackAction, dispose };
}

const pageMemory: PageMemory = import.meta.hot?.data.siteTrafficPageMemory || {};
let collector: ReturnType<typeof createSiteTrafficCollector> | undefined;

export function installSiteTrafficCollector(router?: SiteTrafficRouter) {
    collector ||= createSiteTrafficCollector(window, collectSiteTraffic, pageMemory);
    return collector.install(router);
}

/** 显式用户意图的非等待旁路，不能接到底层自动生成、保存或全局点击监听。 */
export function trackSiteTrafficAction(action: SiteTrafficAction) {
    collector?.trackAction(action);
}

if (import.meta.hot)
    import.meta.hot.dispose((data) => {
        data.siteTrafficPageMemory = pageMemory;
        collector?.dispose();
    });
