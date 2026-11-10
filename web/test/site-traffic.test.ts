import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolveSiteTrafficPage, siteTrafficActionLabels, siteTrafficPageLabels } from "../src/lib/site-traffic";
import { ApiError } from "../src/services/api/request";
import type { collectSiteTraffic, SiteTrafficEvent } from "../src/services/api/site-traffic";
import { createSiteTrafficCollector, type SiteTrafficRouter } from "../src/services/site-traffic";
import { useUserStore } from "../src/stores/use-user-store";

const restores: Array<() => void> = [];
beforeEach(() => {
    const previous = useUserStore.getState();
    useUserStore.setState({ hydrated: true, user: null });
    restores.push(() => useUserStore.setState(previous, true));
});
afterEach(() => {
    restores
        .splice(0)
        .reverse()
        .forEach((restore) => restore());
});

async function settle() {
    // 队列最多 100 条，排空其有界身份分配链；不启动真实网络、计时器或浏览器。
    for (let index = 0; index < 1500; index += 1) await Promise.resolve();
}

function makeClock() {
    let now = Date.UTC(2026, 10, 10);
    let nextId = 0;
    const tasks = new Map<number, { at: number; run: () => void }>();
    const dateSpy = spyOn(Date, "now").mockImplementation(() => now);
    restores.push(() => dateSpy.mockRestore());
    return {
        tasks,
        setTimeout: (run: () => void, delay = 0) => {
            const id = ++nextId;
            tasks.set(id, { at: now + delay, run });
            return id;
        },
        clearTimeout: (id: number) => {
            tasks.delete(id);
        },
        async advance(ms: number) {
            await settle();
            const target = now + ms;
            for (let guard = 0; guard < 100; guard += 1) {
                const next = [...tasks].sort((a, b) => a[1].at - b[1].at)[0];
                if (!next || next[1].at > target) break;
                now = next[1].at;
                tasks.delete(next[0]);
                next[1].run();
                await settle();
            }
            now = target;
        },
    };
}

function makeShared() {
    const values = new Map<string, string>();
    const tabs = new Set<EventTarget>();
    let lockTail = Promise.resolve();
    const locks = {
        request(_name: string, options: { signal: AbortSignal }, run: () => unknown) {
            const result = lockTail.then(() => {
                if (options.signal.aborted) throw new DOMException("cancelled", "AbortError");
                return run();
            });
            lockTail = result.then(
                () => undefined,
                () => undefined,
            );
            return result;
        },
    };
    return { values, tabs, locks };
}

function makeTab(clock: ReturnType<typeof makeClock>, options: { path?: string; hidden?: boolean; shared?: ReturnType<typeof makeShared>; dnt?: string; gpc?: boolean; noLocks?: boolean; blockedStorage?: boolean; send?: typeof collectSiteTraffic } = {}) {
    const shared = options.shared || makeShared();
    const target = new EventTarget();
    shared.tabs.add(target);
    const document = Object.assign(new EventTarget(), { visibilityState: options.hidden ? "hidden" : "visible" });
    const location = new URL(options.path || "/", "https://traffic.invalid");
    const batches: SiteTrafficEvent[][] = [];
    const signals: Array<AbortSignal | undefined> = [];
    let reads = 0;
    let writes = 0;
    let blockedStorage = options.blockedStorage || false;
    const send: typeof collectSiteTraffic =
        options.send ||
        (async (events, requestOptions = {}) => {
            batches.push(events.map((event) => ({ ...event })));
            signals.push(requestOptions.signal);
            return { accepted: events.length };
        });
    const browser = Object.assign(target, {
        document,
        location,
        navigator: { doNotTrack: options.dnt, globalPrivacyControl: options.gpc, locks: options.noLocks ? undefined : shared.locks },
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
    });
    Object.defineProperty(browser, "localStorage", {
        get() {
            reads += 1;
            if (blockedStorage) throw new DOMException("denied", "SecurityError");
            return {
                getItem: (key: string) => shared.values.get(key) || null,
                setItem: (key: string, value: string) => {
                    writes += 1;
                    shared.values.set(key, value);
                    for (const other of shared.tabs) if (other !== target) other.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
                },
            };
        },
    });
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    restores.push(() => warning.mockRestore());
    const collector = createSiteTrafficCollector(browser as unknown as Window, send);
    restores.push(collector.dispose);
    return {
        collector,
        browser: browser as unknown as Window,
        batches,
        signals,
        shared,
        warning,
        reads: () => reads,
        writes: () => writes,
        blockStorage: () => {
            blockedStorage = true;
        },
        visible(value: boolean) {
            document.visibilityState = value ? "visible" : "hidden";
            document.dispatchEvent(new Event("visibilitychange"));
        },
        pagehide() {
            target.dispatchEvent(new Event("pagehide"));
        },
    };
}

function makeRouter(path = "/") {
    const listeners = new Set<() => void>();
    const state = { initialized: true, navigation: { state: "idle" }, location: new URL(path, "https://traffic.invalid") };
    const source = {
        state,
        subscribe: (listener: () => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    } as unknown as SiteTrafficRouter;
    return {
        source,
        state,
        listeners,
        notify: () => listeners.forEach((listener) => listener()),
        commit(next: string) {
            state.initialized = true;
            state.navigation.state = "idle";
            state.location = new URL(next, "https://traffic.invalid");
            listeners.forEach((listener) => listener());
        },
    };
}

function events(tab: ReturnType<typeof makeTab>) {
    return tab.batches.flat();
}

const excludedAccountPaths = ["/settings", "/login", "/register", "/forgot-password"].flatMap((path) => [path, `${path}/`, path.toUpperCase(), `${path}?next=private&section=models#private`, `${path.toUpperCase()}/?next=private#private`]);

describe("site traffic fixed registry", () => {
    test("normalizes the actual router paths without exposing dynamic values", () => {
        const cases = [
            ["/", "create"],
            ["/create", "create"],
            ["/canvas", "canvas_list"],
            ["/canvas/private-project?title=private#prompt", "canvas"],
            ["/assets", "assets"],
            ["/tasks", "history"],
            ["/ecommerce", "ecommerce"],
            ["/projects/new", "drama"],
            ["/projects/private/e/private-episode", "drama"],
            ["/skills/private/edit", "skills"],
            ["/referral", "referral"],
            ["/toolbox/image", "tools_image"],
            ["/toolbox/video", "tools_video"],
        ];
        for (const [path, page] of cases) expect(resolveSiteTrafficPage(path)).toBe(page);
        expect(Object.keys(siteTrafficPageLabels)).toHaveLength(13);
        expect(Object.keys(siteTrafficActionLabels)).toHaveLength(7);
    });

    test("excludes disabled pages, unknown paths, admin, labs and redirect-only screens", () => {
        for (const path of [
            "/inspirations",
            "/ecommerce-pipeline/private-folder",
            "/welcome/",
            "/plugins",
            "/plugins/eagle",
            "/share/canvas/private-token",
            "/library",
            "/runninghub",
            "/home",
            "/toolbox/unknown",
            "/admin",
            "/admin/traffic",
            "/ADMIN/traffic",
            "/Dev/previs-repro",
            "/dev/previs-repro",
            "/__fixture/private",
            "/test-voice-recording",
            "/wallet",
            "/ark-portrait/result",
            "/projects/private/legacy",
            ...excludedAccountPaths,
        ]) {
            expect(resolveSiteTrafficPage(path)).toBeNull();
        }
    });
});

describe("site traffic page lifecycle and privacy", () => {
    test("disabled pages never allocate identity or enqueue PV/actions", async () => {
        const clock = makeClock();
        for (const path of ["/inspirations", "/ecommerce-pipeline/private-folder", "/welcome", "/plugins", "/plugins/eagle", "/share/canvas/private-token", "/library", "/runninghub", "/home", "/unknown/private", ...excludedAccountPaths]) {
            const tab = makeTab(clock, { path });
            tab.collector.install();
            tab.collector.trackAction("open_create");
            await clock.advance(600);
            expect(events(tab)).toHaveLength(0);
            expect(tab.reads()).toBe(0);
            expect(tab.writes()).toBe(0);
            expect(tab.shared.values.size).toBe(0);
        }
        const tab = makeTab(clock);
        const router = makeRouter();
        tab.collector.install(router.source);
        for (const path of ["/plugins", ...excludedAccountPaths]) {
            router.commit(path);
            tab.collector.trackAction("open_create");
        }
        router.commit("/create");
        await clock.advance(600);
        expect(events(tab).map((event) => [event.type, event.page])).toEqual([
            ["page_view", "create"],
            ["page_view", "create"],
        ]);
    });

    test("image and video tool routes enqueue separate page and action sources", async () => {
        const clock = makeClock();
        for (const [path, page] of [
            ["/toolbox/image", "tools_image"],
            ["/toolbox/video", "tools_video"],
        ]) {
            const tab = makeTab(clock, { path });
            tab.collector.install();
            tab.collector.trackAction("open_create");
            await clock.advance(600);
            expect(events(tab).map((event) => [event.type, event.page])).toEqual([
                ["page_view", page],
                ["action", page],
            ]);
        }
    });

    test("anonymous direct protected routes wait for auth and never count the redirecting page", async () => {
        const clock = makeClock();
        for (const pathname of ["/ecommerce", "/referral", "/canvas/guest-project", "/assets"]) {
            useUserStore.setState({ hydrated: false, user: null });
            const tab = makeTab(clock);
            const router = makeRouter(pathname);
            const dispose = tab.collector.install(router.source);
            await clock.advance(1000);
            expect(events(tab)).toHaveLength(0);
            expect(tab.reads()).toBe(0);
            useUserStore.setState({ hydrated: true });
            tab.collector.trackAction("open_ecommerce");
            router.notify();
            await clock.advance(1000);
            expect(events(tab)).toHaveLength(0);
            expect(tab.reads()).toBe(0);
            // 与 RequireAuth 的页面模式跳转结果一致；路由通知前不人为触发采集。
            router.commit(`/login?next=${encodeURIComponent(pathname)}`);
            tab.collector.trackAction("open_create");
            await clock.advance(600);
            expect(events(tab)).toHaveLength(0);
            expect(tab.reads()).toBe(0);
            expect(tab.writes()).toBe(0);
            router.commit("/");
            await clock.advance(600);
            expect(events(tab).map((event) => event.page)).toEqual(["create"]);
            dispose();
        }
    });

    test("closed feature gates allocate no identity and reopening the same route records one visible page", async () => {
        const clock = makeClock();
        useUserStore.setState({ user: { id: "account", username: "user", displayName: "name", role: "user", status: "active" } });
        for (const [path, page, feature] of [
            ["/toolbox/image", "tools_image", "imageWorkbenchEnabled"],
            ["/toolbox/video", "tools_video", "videoWorkbenchEnabled"],
            ["/tasks", "history", "taskCenterEnabled"],
            ["/projects", "drama", "shortDramaEnabled"],
            ["/projects/new", "drama", "shortDramaEnabled"],
            ["/projects/private/e/episode", "drama", "shortDramaEnabled"],
        ] as const) {
            useUserStore.setState({ features: { ...useUserStore.getState().features, [feature]: false } });
            const tab = makeTab(clock);
            const router = makeRouter(path);
            const dispose = tab.collector.install(router.source);
            tab.collector.trackAction("open_create");
            router.notify();
            await clock.advance(600);
            expect(events(tab)).toHaveLength(0);
            expect(tab.reads()).toBe(0);
            expect(tab.writes()).toBe(0);
            useUserStore.setState({ features: { ...useUserStore.getState().features, [feature]: true } });
            router.notify();
            await clock.advance(600);
            expect(events(tab).map((event) => [event.type, event.page])).toEqual([["page_view", page]]);
            useUserStore.setState({ features: { ...useUserStore.getState().features } });
            await clock.advance(600);
            expect(events(tab)).toHaveLength(1);
            useUserStore.setState({ features: { ...useUserStore.getState().features, [feature]: false } });
            tab.collector.trackAction("open_create");
            await clock.advance(600);
            expect(events(tab)).toHaveLength(1);
            useUserStore.setState({ features: { ...useUserStore.getState().features, [feature]: true } });
            await clock.advance(600);
            expect(events(tab).map((event) => event.page)).toEqual([page, page]);
            dispose();
        }
    });

    test("restored authenticated session counts the initially protected page once without another navigation", async () => {
        const clock = makeClock();
        useUserStore.setState({ hydrated: false, user: null });
        const tab = makeTab(clock);
        const router = makeRouter("/ecommerce");
        const dispose = tab.collector.install(router.source);
        useUserStore.setState({ user: { id: "private-account-not-collected", username: "private-user", displayName: "private-name", role: "user", status: "active" } });
        await clock.advance(1000);
        expect(events(tab)).toHaveLength(0);
        expect(tab.reads()).toBe(0);
        useUserStore.setState({ hydrated: true });
        await clock.advance(600);
        expect(events(tab).map((event) => event.page)).toEqual(["ecommerce"]);
        router.notify();
        useUserStore.setState({ user: { ...useUserStore.getState().user!, displayName: "another-private-name" } });
        await clock.advance(600);
        expect(events(tab)).toHaveLength(1);
        expect(JSON.stringify(events(tab))).not.toContain("private");
        dispose();
        useUserStore.setState({ hydrated: false, user: null });
        useUserStore.setState({ hydrated: true, user: { id: "private-after-dispose", username: "private", displayName: "private", role: "user", status: "active" } });
        await clock.advance(1000);
        expect(events(tab)).toHaveLength(1);
        expect(clock.tasks.size).toBe(0);
    });

    test("guest workspace pages wait for authentication readiness but remain visible anonymously", async () => {
        const clock = makeClock();
        for (const [pathname, page] of [
            ["/", "create"],
            ["/create", "create"],
        ]) {
            useUserStore.setState({ hydrated: false, user: null });
            const tab = makeTab(clock);
            const router = makeRouter(pathname);
            const dispose = tab.collector.install(router.source);
            await clock.advance(1000);
            expect(tab.reads()).toBe(0);
            useUserStore.setState({ hydrated: true });
            await clock.advance(600);
            expect(events(tab).map((event) => event.page)).toEqual([page]);
            router.notify();
            await clock.advance(600);
            expect(events(tab)).toHaveLength(1);
            dispose();
        }
        // 欢迎页已停采，独立挂载采集器也不能分配身份或记录操作。
        useUserStore.setState({ hydrated: false, user: null });
        const welcome = makeTab(clock, { path: "/welcome" });
        welcome.collector.install();
        welcome.collector.trackAction("open_create");
        await clock.advance(600);
        expect(events(welcome)).toHaveLength(0);
        expect(welcome.reads()).toBe(0);
    });

    test("waits for initialized idle routing; ignores revalidation, query/hash and prefetch notifications", async () => {
        const clock = makeClock();
        const tab = makeTab(clock);
        const router = makeRouter();
        router.state.initialized = false;
        tab.collector.install(router.source);
        await clock.advance(1000);
        expect(tab.reads()).toBe(0);
        router.state.initialized = true;
        router.state.navigation.state = "loading";
        router.notify();
        await clock.advance(1000);
        expect(events(tab)).toHaveLength(0);
        router.commit("/?sort=private#private");
        await clock.advance(600);
        router.notify();
        router.commit("/?sort=another#another");
        await clock.advance(600);
        expect(events(tab).map((event) => event.page)).toEqual(["create"]);
        useUserStore.setState({ user: { id: "account", username: "user", displayName: "name", role: "user", status: "active" } });
        router.commit("/canvas/project-a");
        router.commit("/canvas/project-b");
        router.commit("/canvas/project-b?prompt=private#private");
        await clock.advance(600);
        expect(events(tab).map((event) => event.page)).toEqual(["create", "canvas", "canvas"]);
        expect(JSON.stringify(events(tab))).not.toContain("private");
        expect(JSON.stringify(events(tab))).not.toContain("project-");
    });

    test("counts each completed SPA page and excludes canvas auto-create intermediary", async () => {
        const clock = makeClock();
        useUserStore.setState({ user: { id: "account", username: "user", displayName: "name", role: "user", status: "active" } });
        const tab = makeTab(clock);
        const router = makeRouter();
        tab.collector.install(router.source);
        tab.collector.trackAction("new_canvas");
        router.commit("/canvas?mode=new");
        router.commit("/canvas/new-private-id?mode=new");
        router.commit("/admin/settings");
        router.commit("/create");
        await clock.advance(600);
        expect(events(tab).map((event) => [event.type, event.page])).toEqual([
            ["page_view", "create"],
            ["action", "create"],
            ["page_view", "canvas"],
            ["page_view", "create"],
        ]);
        expect(events(tab).filter((event) => event.type === "action")).toHaveLength(1);
    });

    test("duplicate installs share one subscription and focus/visibility never add a second PV", async () => {
        const clock = makeClock();
        const tab = makeTab(clock);
        const router = makeRouter();
        const first = tab.collector.install(router.source);
        const second = tab.collector.install(router.source);
        expect(router.listeners.size).toBe(1);
        first();
        first();
        expect(router.listeners.size).toBe(1);
        tab.visible(false);
        tab.visible(true);
        tab.visible(true);
        tab.browser.dispatchEvent(new Event("focus"));
        await clock.advance(600);
        expect(events(tab)).toHaveLength(1);
        second();
        expect(router.listeners.size).toBe(0);
        expect(clock.tasks.size).toBe(0);
    });

    test("HMR page memory suppresses a repeated installation, while a new document refresh counts", async () => {
        const clock = makeClock();
        const tab = makeTab(clock);
        const memory = {};
        const send: typeof collectSiteTraffic = async (batch) => {
            tab.batches.push([...batch]);
            return { accepted: batch.length };
        };
        const first = createSiteTrafficCollector(tab.browser, send, memory);
        first.install();
        await clock.advance(600);
        first.dispose();
        const replacement = createSiteTrafficCollector(tab.browser, send, memory);
        restores.push(replacement.dispose);
        replacement.install();
        await clock.advance(600);
        expect(events(tab)).toHaveLength(1);
        replacement.dispose();
        tab.collector.install();
        await clock.advance(600);
        expect(events(tab)).toHaveLength(2);
        expect(events(tab)[0].visitorId).toBe(events(tab)[1].visitorId);
    });

    test("a hidden first open waits until visible; standalone creation uses the same collector", async () => {
        const clock = makeClock();
        const tab = makeTab(clock, { hidden: true, path: "/" });
        tab.collector.install();
        await clock.advance(1000);
        expect(tab.reads()).toBe(0);
        tab.visible(true);
        await clock.advance(600);
        tab.visible(false);
        tab.visible(true);
        await clock.advance(600);
        expect(events(tab).map((event) => event.page)).toEqual(["create"]);
    });

    test("DNT and GPC never read or write identifiers, enqueue actions or call the API", async () => {
        const clock = makeClock();
        for (const privacy of [{ dnt: "1" }, { dnt: "yes" }, { gpc: true }]) {
            const tab = makeTab(clock, { ...privacy, blockedStorage: true });
            tab.collector.install();
            tab.collector.trackAction("open_create");
            tab.visible(false);
            tab.visible(true);
            tab.pagehide();
            await clock.advance(60_000);
            expect(tab.reads()).toBe(0);
            expect(tab.writes()).toBe(0);
            expect(events(tab)).toHaveLength(0);
        }
    });

    test("storage denial falls back to stable in-memory UUIDs with fixed non-sensitive diagnostics", async () => {
        const clock = makeClock();
        const tab = makeTab(clock, { blockedStorage: true });
        tab.collector.install();
        tab.collector.trackAction("creation_submit_text");
        await clock.advance(600);
        expect(events(tab)).toHaveLength(2);
        expect(events(tab)[0].visitorId).toBe(events(tab)[1].visitorId);
        expect(events(tab)[0].sessionId).toBe(events(tab)[1].sessionId);
        expect(events(tab)[0].visitorId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        expect(tab.shared.values.size).toBe(0);
        expect(tab.warning.mock.calls).toEqual([["[site-traffic]", "storage_unavailable", 1]]);
        for (const event of events(tab)) expect(Object.keys(event).sort()).toEqual((event.type === "action" ? ["action", "id", "page", "sessionId", "type", "visitorId"] : ["id", "page", "sessionId", "type", "visitorId"]).sort());
    });

    test("two tabs share one 30-minute activity session and visitor without account identity", async () => {
        const clock = makeClock();
        const shared = makeShared();
        const left = makeTab(clock, { shared });
        const right = makeTab(clock, { shared, path: "/create" });
        left.collector.install();
        right.collector.install();
        await clock.advance(600);
        const original = events(left)[0];
        expect(events(right)[0].visitorId).toBe(original.visitorId);
        expect(events(right)[0].sessionId).toBe(original.sessionId);
        await clock.advance(29 * 60_000);
        left.collector.trackAction("open_create");
        await clock.advance(600);
        await clock.advance(29 * 60_000);
        right.collector.trackAction("open_ecommerce");
        await clock.advance(600);
        expect(events(right)[1].sessionId).toBe(original.sessionId);
        const lastActivity = shared.values.get("site-traffic:session");
        await clock.advance(30 * 60_000);
        right.visible(false);
        right.visible(true);
        await settle();
        expect(shared.values.get("site-traffic:session")).toBe(lastActivity);
        expect(events(right)).toHaveLength(2);
        left.collector.trackAction("creation_submit_agent");
        await clock.advance(600);
        expect(events(left).at(-1)?.sessionId).not.toBe(original.sessionId);
        expect(events(left).at(-1)?.visitorId).toBe(original.visitorId);
        expect(shared.values.size).toBe(2);
    });

    test("without Web Locks it reuses shared storage and explicitly diagnoses non-atomic coordination", async () => {
        const clock = makeClock();
        const shared = makeShared();
        const left = makeTab(clock, { shared, noLocks: true });
        left.collector.install();
        await clock.advance(600);
        const right = makeTab(clock, { shared, noLocks: true });
        right.collector.install();
        await clock.advance(600);
        expect(events(left)[0].sessionId).toBe(events(right)[0].sessionId);
        expect(events(left)[0].visitorId).toBe(events(right)[0].visitorId);
        expect(right.warning.mock.calls.some((call) => call[1] === "coordination_unavailable")).toBe(true);
    });
});

describe("site traffic explicit production wiring", () => {
    const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");

    test("main and standalone welcome own installation outside StrictMode and dispose on HMR", async () => {
        const main = await source("application.tsx");
        expect(main).toContain("const disposeTraffic = installSiteTrafficCollector(router)");
        expect(main.indexOf("installSiteTrafficCollector(router)")).toBeGreaterThan(main.indexOf("</React.StrictMode>"));
        expect(main).toContain("import.meta.hot.dispose(disposeTraffic)");
        const welcome = await source("welcome-application.tsx");
        expect(welcome).toContain("disposeTraffic = installSiteTrafficCollector()");
        expect(welcome.indexOf("disposeTraffic = installSiteTrafficCollector()")).toBeGreaterThan(welcome.indexOf("welcomeEnabled !== true"));
        expect(welcome).toContain("disposeTraffic?.()");
        expect(await source("lib/site-traffic.ts")).not.toMatch(/from ["'].*services/);
    });

    test("composer intent is wired once at the shared button/keyboard submit rather than automatic tasks", async () => {
        const create = await source("pages/create/index.tsx");
        const onSubmit = create.slice(create.indexOf("        onSubmit: () => {"), create.indexOf("    };", create.indexOf("        onSubmit: () => {")));
        expect(onSubmit.match(/trackSiteTrafficAction\(/g)).toHaveLength(1);
        for (const mode of ["text", "image", "video"]) expect(onSubmit).toContain(`creation_submit_${mode}`);
        expect(create).not.toContain("creation_submit_agent");
        expect(onSubmit).toContain("prompt.trim()");
        expect(onSubmit).toContain("referenceReplacementBusy");
        expect(onSubmit).not.toContain("isEmpty");
        expect(create.match(/trackSiteTrafficAction\(/g)).toHaveLength(1);
        const composer = await source("pages/create/creation-workspace.tsx");
        expect(composer).toContain("onSubmit={props.onSubmit}");
        expect(composer).toContain("onClick={interactionBusy ? undefined : props.onSubmit}");
    });

    test("new-canvas explicit handlers count once and destination auto-create effects do not count", async () => {
        const canvas = await source("pages/canvas/index.tsx");
        expect(canvas).toMatch(/const createAndEnter = \(\) => \{\s*trackSiteTrafficAction\("new_canvas"\);/);
        expect(canvas.match(/trackSiteTrafficAction\(/g)).toHaveLength(1);
        expect(await source("pages/canvas/use-canvas-project-lifecycle.ts")).toMatch(/const createAndOpenProject = useCallback\(\(\) => \{\s*trackSiteTrafficAction\("new_canvas"\);/);
        expect(await source("pages/create/creation-recent-canvases.tsx")).toContain('trackSiteTrafficAction("new_canvas")');
        expect(await source("pages/inspirations/index.tsx")).not.toContain("trackSiteTrafficAction");
        expect(await source("pages/create/creation-agent-entry.tsx")).not.toContain("trackSiteTrafficAction");
        const sidebar = await source("components/layout/workspace-sidebar-nav.tsx");
        expect(sidebar).toContain('if (item.to === "/" || item.to === "/create") trackSiteTrafficAction("open_create")');
        expect(sidebar).toContain('if (item.to === "/ecommerce") trackSiteTrafficAction("open_ecommerce")');
    });
});

describe("site traffic bounded delivery", () => {
    test("retries a failed batch twice with unchanged event IDs, then stops timers", async () => {
        const clock = makeClock();
        const attempts: SiteTrafficEvent[][] = [];
        const tab = makeTab(clock, {
            send: async (batch) => {
                attempts.push([...batch]);
                throw new ApiError("private upstream details", { status: 503, retryable: true });
            },
        });
        tab.collector.install();
        tab.collector.trackAction("open_create");
        await clock.advance(600);
        expect(attempts).toHaveLength(1);
        await clock.advance(999);
        expect(attempts).toHaveLength(1);
        await clock.advance(1);
        expect(attempts).toHaveLength(2);
        await clock.advance(2000);
        expect(attempts).toHaveLength(3);
        expect(attempts[1]).toEqual(attempts[0]);
        expect(attempts[2]).toEqual(attempts[0]);
        await clock.advance(60_000);
        expect(attempts).toHaveLength(3);
        expect(clock.tasks.size).toBe(0);
        expect(tab.warning.mock.calls).toEqual([["[site-traffic]", "retry_exhausted", 2]]);
    });

    test("a missing old-backend endpoint disables future requests and never logs the server error", async () => {
        const clock = makeClock();
        let calls = 0;
        const tab = makeTab(clock, {
            send: async () => {
                calls += 1;
                throw new ApiError("sensitive error", { status: 404 });
            },
        });
        const router = makeRouter();
        tab.collector.install(router.source);
        await clock.advance(600);
        for (let index = 0; index < 200; index += 1) tab.collector.trackAction("open_create");
        router.commit("/create");
        await clock.advance(600_000);
        expect(calls).toBe(1);
        expect(clock.tasks.size).toBe(0);
        expect(tab.warning.mock.calls).toEqual([["[site-traffic]", "endpoint_unavailable", 1]]);
    });

    test("counts pending identities and the in-flight batch against the 100-event bound; batches never exceed 20", async () => {
        const clock = makeClock();
        const attempts: SiteTrafficEvent[][] = [];
        let release: (() => void) | undefined;
        const tab = makeTab(clock, {
            send: async (batch) => {
                attempts.push([...batch]);
                if (attempts.length === 1)
                    await new Promise<void>((resolve) => {
                        release = resolve;
                    });
                return { accepted: batch.length };
            },
        });
        tab.collector.install();
        for (let index = 0; index < 300; index += 1) tab.collector.trackAction("open_create");
        await clock.advance(600);
        expect(attempts).toHaveLength(1);
        for (let index = 0; index < 200; index += 1) tab.collector.trackAction("open_ecommerce");
        await clock.advance(60_000);
        expect(attempts).toHaveLength(1);
        release?.();
        await clock.advance(5000);
        const delivered = attempts.flat();
        expect(delivered).toHaveLength(100);
        expect(attempts.every((batch) => batch.length <= 20)).toBe(true);
        expect(new Set(delivered.map((event) => event.id)).size).toBe(100);
        expect(tab.warning.mock.calls.filter((call) => call[1] === "queue_full")).toHaveLength(1);
        expect(clock.tasks.size).toBe(0);
    });

    test("dispose aborts delivery, subscriptions and timers without retries or toasts", async () => {
        const clock = makeClock();
        let signal: AbortSignal | undefined;
        let calls = 0;
        const tab = makeTab(clock, {
            send: (_batch, options) => {
                calls += 1;
                signal = options?.signal;
                return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true }));
            },
        });
        const router = makeRouter();
        const dispose = tab.collector.install(router.source);
        await clock.advance(600);
        expect(calls).toBe(1);
        dispose();
        expect(signal?.aborted).toBe(true);
        expect(router.listeners.size).toBe(0);
        router.commit("/create");
        tab.collector.trackAction("creation_submit_image");
        await clock.advance(60_000);
        expect(calls).toBe(1);
        expect(clock.tasks.size).toBe(0);
        expect(tab.warning.mock.calls).toHaveLength(0);
    });
});
