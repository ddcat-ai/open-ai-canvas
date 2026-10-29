/**
 * Issue #305 P0 — 真实 Chrome E2E。
 *
 * 无新增依赖：只用 Bun/Node 内置 spawn / fetch / WebSocket / fs。
 * 自己启动 Vite DEV 与 headless Chrome，通过 CDP 驱动 /dev/previs-repro。
 * 所有等待都有硬超时；任何断言失败 → exit 1。
 * finally 只终止本脚本记录的 PID，只删除本脚本 mkdtemp 创建的 profile。
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

const CHROME_CANDIDATES = [
    process.env.CHROME_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

/** 唯一允许出现的浏览器噪声：精确匹配，其他一律判失败。 */
const ALLOWED_NOISE = ["Warning: [antd: InputNumber] `addonAfter` is deprecated. Please use `Space.Compact` instead.", "Warning: [antd: InputNumber] `addonBefore` is deprecated. Please use `Space.Compact` instead."];

/**
 * 网络与资源失败绝不放行：复现台必须是真正的同源本地确定性场景。
 * 出现 4xx/5xx/ERR_* 一律判失败，由根因修复，而不是扩大 allowlist。
 */

const results = [];
let failures = 0;

function pass(name, detail = "") {
    results.push({ ok: true, name, detail });
    console.log(`PASS  ${name}${detail ? " — " + detail : ""}`);
}

function fail(name, detail = "") {
    results.push({ ok: false, name, detail });
    failures += 1;
    console.log(`FAIL  ${name}${detail ? " — " + detail : ""}`);
}

function assert(condition, name, detail = "") {
    if (condition) pass(name, detail);
    else fail(name, detail);
    return Boolean(condition);
}

function resolveChrome() {
    for (const candidate of CHROME_CANDIDATES) {
        if (candidate && existsSync(candidate)) return candidate;
    }
    throw new Error("No Chrome binary found. Set CHROME_BIN or install google-chrome/chromium. Tried:\n  " + CHROME_CANDIDATES.join("\n  "));
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 启动 Vite DEV，等待 ready 行或 TCP 可连接；超时即抛。 */
async function launchVite(port) {
    // package.json 仍可由 Bun 直接执行；没有 Bun 时用 Node 调本地 Vite 入口。
    // 不能把 `vite` 同时当作 bunx 子命令和 Vite 根目录传入，否则会启动到
    // <web>/vite，SPA 根路径与 /dev/previs-repro 都会返回 404。
    const viteEntry = join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
    const command = process.versions.bun ? "bunx" : process.execPath;
    const args = process.versions.bun ? ["vite"] : [viteEntry];
    const child = spawn(command, [...args, "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    child.stdout.on("data", (d) => {
        log += d.toString();
    });
    child.stderr.on("data", (d) => {
        log += d.toString();
    });

    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Vite exited early (code ${child.exitCode}):\n${log}`);
        try {
            const res = await fetch(`http://127.0.0.1:${port}/dev/previs-repro`);
            if (res.ok) return child;
        } catch {
            // not up yet
        }
        await sleep(500);
    }
    throw new Error(`Vite did not become ready within 120s:\n${log}`);
}

/** 启动 headless Chrome 并等待 CDP /json/version；超时即抛。 */
async function launchChrome(chromePath, cdpPort, profileDir) {
    const args = [
        "--headless=new",
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--window-size=1440,1000",
        // 保留 WebGL：不要 --disable-gpu。SwiftShader 提供确定性软件渲染。
        "--enable-unsafe-swiftshader",
        "--use-angle=swiftshader",
    ];
    if (process.platform === "linux" || process.env.CI) args.push("--no-sandbox", "--disable-dev-shm-usage");
    args.push("about:blank");

    const child = spawn(chromePath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", (d) => {
        log += d.toString();
    });
    child.stderr.on("data", (d) => {
        log += d.toString();
    });

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error(`Chrome exited early (code ${child.exitCode}):\n${log}`);
        try {
            const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
            if (res.ok) return child;
        } catch {
            // not up yet
        }
        await sleep(400);
    }
    throw new Error(`Chrome CDP did not become ready within 60s:\n${log}`);
}

/**
 * CDP 客户端：id/pending map + 事件收集。
 * 只放行 ALLOWED_NOISE 精确匹配，其他异常/console error/网络失败全部记入 problems。
 */
async function connectCdp(cdpPort) {
    const list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
    const target = list.find((t) => t.type === "page");
    if (!target) throw new Error("No CDP page target found");

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("CDP websocket open timeout")), 20000);
        ws.addEventListener(
            "open",
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
        ws.addEventListener(
            "error",
            (e) => {
                clearTimeout(timer);
                reject(new Error("CDP websocket error: " + String(e?.message || e)));
            },
            { once: true },
        );
    });

    const pending = new Map();
    let nextId = 0;
    const problems = [];
    const record = (kind, text) => {
        const clean = String(text ?? "").trim();
        if (!clean) return;
        if (ALLOWED_NOISE.includes(clean)) return;
        problems.push({ kind, text: clean });
    };

    ws.addEventListener("message", (ev) => {
        let msg;
        try {
            msg = JSON.parse(ev.data);
        } catch {
            return;
        }

        if (msg.id && pending.has(msg.id)) {
            const { resolve, reject } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
            else resolve(msg.result);
            return;
        }

        const p = msg.params;
        switch (msg.method) {
            case "Runtime.exceptionThrown":
                record("exception", p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text);
                break;
            case "Log.entryAdded":
                if (p?.entry?.level === "error") record("log.error", p.entry.text);
                break;
            case "Runtime.consoleAPICalled":
                if (p?.type === "error") record("console.error", (p.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
                break;
            case "Network.loadingFailed":
                record("network.failed", `${p?.type || "?"} ${p?.errorText || "?"}`);
                break;
            case "Network.responseReceived":
                if (typeof p?.response?.status === "number" && p.response.status >= 400) {
                    record("network.status", `${p.response.status} ${p.response.url}`);
                }
                break;
            default:
                break;
        }
    });

    const send = (method, params = {}) => {
        const id = ++nextId;
        return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => {
                if (pending.has(id)) {
                    pending.delete(id);
                    reject(new Error(`CDP timeout: ${method}`));
                }
            }, 30000);
        });
    };

    await send("Runtime.enable");
    await send("Page.enable");
    await send("Log.enable");
    await send("Network.enable");

    const evaluate = async (expression) => {
        const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) {
            throw new Error("evaluate threw: " + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
        }
        return r.result.value;
    };

    const poll = async (expression, label, timeout = 15000, interval = 250) => {
        const deadline = Date.now() + timeout;
        let last;
        while (Date.now() < deadline) {
            last = await evaluate(expression);
            if (last) return true;
            await sleep(interval);
        }
        console.log(`      (poll timed out after ${timeout}ms: ${label}, last=${JSON.stringify(last)})`);
        return false;
    };

    /**
     * 真实鼠标点击：等待目标中心稳定且位于最上层，再派发 Input.dispatchMouseEvent。
     * 不用 el.click()，因为那是 untrusted 合成事件，拿不到真实 user gesture。
     */
    const clickPoint = async (locatorExpression, label) => {
        const readInteractiveBox = () =>
            evaluate(`(() => {
            const el = ${locatorExpression};
            if (!(el instanceof HTMLElement)) return null;
            el.scrollIntoView({ block: "center", inline: "center" });
            const rect = el.getBoundingClientRect();
            const style = getComputedStyle(el);
            if (rect.width <= 0 || rect.height <= 0 || style.display === "none" || style.visibility === "hidden" || style.pointerEvents === "none" || Number(style.opacity) <= 0 || el.matches(":disabled") || el.getAttribute("aria-disabled") === "true") return null;
            // 入场缩放作用在弹窗祖先上，按钮本身的 opacity 和动画可能都是正常值。
            // 软件渲染可延迟首帧，让初始缩放坐标看似稳定；必须检查整条祖先链。
            for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
                const ancestorStyle = getComputedStyle(ancestor);
                if (ancestorStyle.display === "none" || ancestorStyle.visibility === "hidden" || Number(ancestorStyle.opacity) <= 0) return null;
                if (ancestor.getAnimations().some((animation) => animation.pending || animation.playState === "running")) return null;
            }
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return null;
            const hit = document.elementFromPoint(x, y);
            if (!hit || (hit !== el && !el.contains(hit))) return null;
            return { x: Math.round(x), y: Math.round(y) };
        })()`);
        // 目标必须"站稳"再点：AntD 弹窗/抽屉有约 200ms 入场动画，只要求相邻两次读数相同
        // 会在动画刚开始、坐标还没动的那一拍就下判定，真正派发鼠标事件时控件已经移位 ——
        // 点击落到遮罩上（mask.closable=false）就完全无效（"留在预演台" 曾这样偶发失败）。
        const deadline = Date.now() + 8000;
        let previous = null;
        let hovered = null;
        let stableSince = 0;
        let box = null;
        while (Date.now() < deadline) {
            const next = await readInteractiveBox();
            if (next && previous && next.x === previous.x && next.y === previous.y) {
                if (!stableSince) stableSince = Date.now();
                if (Date.now() - stableSince >= 300) {
                    if (hovered && hovered.x === next.x && hovered.y === next.y) {
                        box = next;
                        break;
                    }
                    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: next.x, y: next.y, button: "left", buttons: 0 });
                    hovered = next;
                    stableSince = 0;
                }
            } else {
                stableSince = 0;
            }
            previous = next;
            await sleep(100);
        }
        if (!box) {
            console.log(`      (click target not interactable: ${label})`);
            return false;
        }
        const point = { x: box.x, y: box.y, button: "left", pointerType: "mouse" };
        // 移入鼠标后已重新等待动画和坐标稳定，避免 hover 引起的位移造成误点。
        await send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, buttons: 1, clickCount: 1 });
        await sleep(50);
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, buttons: 0, clickCount: 1 });
        return true;
    };

    const click = (selector) => clickPoint(`document.querySelector(${JSON.stringify(selector)})`, selector);

    const clickText = (text, tag = "button") =>
        clickPoint(`[...document.querySelectorAll(${JSON.stringify(tag)})].find((element) => (element.textContent || "").trim() === ${JSON.stringify(text)} && element.getClientRects().length > 0)`, `${tag}:text-is(${text})`);

    /** 每个场景都从干净页面开始：诊断缓冲区与 store 都重置。 */
    const navigateFresh = async (url) => {
        // 必须在导航前清空：导航后再清会吞掉 bootstrap 阶段的真实异常。
        problems.length = 0;
        await send("Page.navigate", { url });
        const ok = await poll(`!!document.querySelector('[data-testid="inject-local-model"]')`, "lab mounted", 60000);
        if (!ok) throw new Error("Repro lab did not mount within 60s");
        return true;
    };

    return { send, evaluate, poll, click, clickText, clickPoint, navigateFresh, problems, close: () => ws.close() };
}

/**
 * 只终止本脚本记录的子进程：先 SIGTERM，有界等待后才对同一 PID SIGKILL。
 *
 * 被信号杀死的 Node 子进程 exitCode 仍为 null，只有 signalCode 有值，
 * 因此「已停止」必须同时看两者，否则会误判成还在运行并一路等到硬截止。
 */
async function stopExact(child, name) {
    if (!child) return;
    const stopped = () => child.exitCode !== null || child.signalCode !== null;
    if (stopped()) return;

    try {
        child.kill("SIGTERM");
    } catch {
        /* already gone */
    }
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !stopped()) await sleep(200);

    if (!stopped()) {
        try {
            child.kill("SIGKILL");
        } catch {
            /* already gone */
        }
        const hard = Date.now() + 4000;
        while (Date.now() < hard && !stopped()) await sleep(200);
    }

    if (!stopped()) {
        throw new Error(`Failed to stop ${name} (pid=${child.pid}) after SIGTERM and SIGKILL`);
    }
    console.log(`      stopped ${name} (pid=${child.pid}, exit=${child.exitCode}, signal=${child.signalCode})`);
}

/**
 * The single previs workbench is ready as soon as its layout context is visible.
 * There is no second page or mode-specific workbench to enter.
 */
async function openUnifiedWorkbench(cdp, label) {
    const ready = await cdp.poll(`!!document.querySelector('[data-canvas-previs-workbench]') && !!document.querySelector('.pv-layout') && !!document.querySelector('.previs-viewport-shell')`, `${label} unified previs workbench`, 20000);
    if (!ready) throw new Error(`${label}: unified previs workbench did not enter layout context`);
}

/** 使用当前产品流程从预设库加入一个真实道具，不依赖旧版快捷菜单。 */
async function addProp(cdp, name, label) {
    if (!(await cdp.click('[aria-label="添加到场景"]'))) throw new Error(`${label}: 添加到场景 button not clickable`);
    if (!(await cdp.poll(`!!document.querySelector('.previs-add-dialog [role="tab"]')`, `${label} add dialog`, 10000))) throw new Error(`${label}: add dialog did not open`);
    if (!(await cdp.clickText("道具", '[role="tab"]'))) throw new Error(`${label}: 道具 tab not clickable`);

    const card = `[...document.querySelectorAll('.previs-add-dialog__card')].find((button) => (button.textContent || '').includes(${JSON.stringify(name)}) && button.getClientRects().length > 0)`;
    if (!(await cdp.poll(`!!(${card})`, `${label} prop card`, 10000))) throw new Error(`${label}: ${name} prop card not visible`);
    if (!(await cdp.clickPoint(card, `${label}: prop ${name}`))) throw new Error(`${label}: ${name} prop card not clickable`);

    const confirmLabel = `加入「${name}」`;
    if (!(await cdp.clickText(confirmLabel, ".previs-add-dialog__footer button"))) throw new Error(`${label}: ${confirmLabel} button not clickable`);
    if (!(await cdp.poll(`!!document.querySelector(${JSON.stringify(`[aria-label="删除 ${name}"]`)})`, `${label} prop row`, 20000))) throw new Error(`${label}: ${name} row did not appear`);
}

async function smokeWorkbench(cdp, baseUrl) {
    console.log("\n=== A. workbench smoke ===");
    await cdp.navigateFresh(`${baseUrl}/dev/previs-repro`);

    const initial = await cdp.evaluate(`(() => {
        const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent || "");
        return {
            snapshot: headings.some((t) => t.includes('环境快照')),
            matrix15: headings.some((t) => t.includes('P0 手工复现矩阵（15）')),
            injectLocal: !!document.querySelector('[data-testid="inject-local-model"]'),
            injectMissing: !!document.querySelector('[data-testid="inject-missing-model"]'),
            shellCount: document.querySelectorAll('.previs-viewport-shell').length,
        };
    })()`);
    assert(initial.snapshot, "A1 环境快照 rendered");
    assert(initial.matrix15, "A2 P0 手工复现矩阵（15）rendered");
    assert(initial.injectLocal && initial.injectMissing, "A3 both inject buttons present");
    assert(initial.shellCount === 0, "A4 workbench closed initially", `shellCount=${initial.shellCount}`);

    const opened = await cdp.click('[data-testid="toggle-workbench"]');
    if (!opened) throw new Error("A: toggle-workbench not clickable");
    const hasCanvas = await cdp.poll(`(() => { const c = document.querySelector('.previs-viewport-shell canvas'); return !!c && c.clientWidth > 0; })()`, "canvas", 40000);
    assert(hasCanvas, "A5 real canvas present in viewport shell");
    const defaultLayoutMode = await cdp.evaluate(`document.querySelector('button[data-mode="layout"]')?.getAttribute('aria-pressed')`);
    assert(defaultLayoutMode === "true", "A5a 统一预演台默认进入布景上下文", `got ${JSON.stringify(defaultLayoutMode)}`);
    await openUnifiedWorkbench(cdp, "A");

    // 使用真实产品 dock（FloatingDock）验证提示的 hover 与键盘触发，不能只验证按钮存在。
    const dockSelector = '[role="toolbar"][aria-label="预演台视口工具"]';
    assert(await cdp.poll(`!!document.querySelector(${JSON.stringify(dockSelector)})`, "previs dock", 10000), "A5b 预演台视口工具条已渲染");
    assert(await cdp.evaluate(`!!document.querySelector('${dockSelector} [role="radiogroup"][aria-label="变换模式"] [role="radio"][aria-label="移动 (W)"]')`), "A5b 变换模式切换包含移动 (W)");
    const tooltipButton = `${dockSelector} button[aria-label="适配全部对象 (A)"]`;
    const tooltipMode = await cdp.evaluate(`(() => {
        const button = document.querySelector(${JSON.stringify(tooltipButton)});
        return button ? {
            nativeTitle: Boolean(button.title),
            coarsePointer: matchMedia('(pointer: coarse)').matches,
            narrow: innerWidth < 768,
            title: button.title,
            label: button.getAttribute('aria-label'),
        } : null;
    })()`);
    if (!tooltipMode) throw new Error("A: 适配全部对象 dock button disappeared");
    if (tooltipMode.nativeTitle) {
        // 窄屏/触控模式下产品有意使用原生 title，避免自定义浮层被可滚动 dock 裁切。
        assert(tooltipMode.title.includes("适配全部对象") && tooltipMode.label.includes("适配全部对象"), "A5b native Tooltip fallback names the actual control", JSON.stringify(tooltipMode));
        await cdp.evaluate(`document.querySelector(${JSON.stringify(tooltipButton)}).focus()`);
        assert(await cdp.poll(`document.activeElement === document.querySelector(${JSON.stringify(tooltipButton)})`, "native tooltip control focus", 5000), "A5c native Tooltip fallback keeps the control keyboard focusable");
        await cdp.evaluate("document.activeElement?.blur()");
    } else {
        const hoverPoint = await cdp.evaluate(`(() => { const b = document.querySelector(${JSON.stringify(tooltipButton)}); if (!b) return null; const r = b.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; })()`);
        if (!hoverPoint) throw new Error("A: 适配全部对象 dock button not visible");
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hoverPoint });
        const describedTooltip = `(() => { const b = document.querySelector(${JSON.stringify(tooltipButton)}); return !!b && [...(b.parentElement?.querySelectorAll('.aceternity-dock-tooltip') || [])].some((t) => (t.textContent || '').includes('适配全部对象')); })()`;
        assert(await cdp.poll(describedTooltip, "tooltip on hover", 5000), "A5b Tooltip hover describes the actual control");
        await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
        assert(await cdp.poll(`!(${describedTooltip})`, "tooltip dismiss", 5000), "A5b Tooltip dismisses when pointer leaves");
        await cdp.evaluate(`document.querySelector(${JSON.stringify(tooltipButton)}).focus()`);
        for (const modifiers of [8, 0]) {
            await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers });
            await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers });
        }
        assert(await cdp.poll(`document.activeElement === document.querySelector(${JSON.stringify(tooltipButton)}) && (${describedTooltip})`, "tooltip on keyboard focus", 5000), "A5c Tab focus opens Tooltip without an extra wrapper stop");
        await cdp.evaluate("document.activeElement?.blur()");
    }

    // 摆场模式不显示时间轴；切到动画模式才出现时间轴，且自动关键帧初始关闭。
    const readGating = `(() => ({
        workbench: !!document.querySelector('[data-canvas-previs-workbench]'),
        layout: !!document.querySelector('.pv-layout'),
        sequencer: document.querySelectorAll('.previs-sequencer').length,
        autoKey: document.querySelector('button[title="自动关键帧"]')?.getAttribute('aria-pressed') ?? null,
    }))()`;
    const layoutGating = await cdp.evaluate(readGating);
    assert(layoutGating.workbench && layoutGating.layout, "A6 统一预演台布局上下文已就绪", JSON.stringify(layoutGating));
    assert(layoutGating.sequencer === 0, "A6a 摆场模式不显示时间轴", JSON.stringify(layoutGating));
    if (!(await cdp.click('button[data-mode="animate"]'))) throw new Error("A: 动画模式按钮不可点击");
    assert(await cdp.poll(`document.querySelectorAll('.previs-sequencer').length === 1`, "animate sequencer", 10000), "A7 动画模式显示时间轴");
    const animateGating = await cdp.evaluate(readGating);
    assert(animateGating.autoKey === "false", "A7a AutoKey 默认关闭", JSON.stringify(animateGating));
    if (!(await cdp.click('button[data-mode="layout"]'))) throw new Error("A: 摆场模式按钮不可点击");
    assert(await cdp.poll(`document.querySelectorAll('.previs-sequencer').length === 0`, "layout hides sequencer", 10000), "A7b 回到摆场模式隐藏时间轴");

    await addProp(cdp, "单人沙发", "A");
    const propAppeared = await cdp.poll(`!!document.querySelector('[aria-label="删除 单人沙发"]')`, "prop row", 20000);
    assert(propAppeared, "A10 added prop appears in object list");

    const undone = await cdp.click('[aria-label="撤销"]');
    if (!undone) throw new Error("A: 撤销 button not clickable");
    const propGone = await cdp.poll(`!document.querySelector('[aria-label="删除 单人沙发"]')`, "prop removed by undo", 20000);
    assert(propGone, "A11 Undo removes the added prop");

    // 场景结束前必须真实关闭：下一个场景要重新导航，不能靠忽略 beforeunload 绕过未保存态。
    const closed = await cdp.click('[aria-label="关闭预演台"]');
    if (!closed) throw new Error("A: 关闭预演台 button not clickable");
    const shellGone = await cdp.poll(`document.querySelectorAll('.previs-viewport-shell').length === 0`, "workbench closed", 30000);
    assert(shellGone, "A12 workbench closed cleanly before leaving scenario A");

    assert(cdp.problems.length === 0, "A13 no browser problems in scenario A", JSON.stringify(cdp.problems));
}

/**
 * 场景 B：本地 triangle glTF。
 * 判据是集成层面的稳定窗口：5s 内不出现任何失败态且 canvas 持续可用。
 * 名称出现只证明对象在场景里，不等于 loader ready，因此不作为 ready 断言。
 */
async function localModel(cdp, baseUrl) {
    console.log("\n=== B. local triangle model ===");
    await cdp.navigateFresh(`${baseUrl}/dev/previs-repro`);

    const injected = await cdp.click('[data-testid="inject-local-model"]');
    if (!injected) throw new Error("B: inject-local-model not clickable");
    const counted = await cdp.poll(`(document.querySelector('[data-testid="object-count"]')?.textContent || "").includes('4')`, "object count 4", 15000);
    assert(counted, "B1 local model injected into scene");

    const opened = await cdp.click('[data-testid="toggle-workbench"]');
    if (!opened) throw new Error("B: toggle-workbench not clickable");
    await openUnifiedWorkbench(cdp, "B");

    const rowReady = await cdp.poll(`!!document.querySelector('[aria-label="删除 本地模型 repro triangle"]')`, "model row", 30000);
    assert(rowReady, "B2 local model row present in object list");
    const hasCanvas = await cdp.poll(`(() => { const c = document.querySelector('.previs-viewport-shell canvas'); return !!c && c.clientWidth > 0; })()`, "canvas", 40000);
    assert(hasCanvas, "B3 real canvas present");

    await sleep(5000);

    const stable = await cdp.evaluate(`(() => {
        const t = document.body.innerText || "";
        const c = document.querySelector('.previs-viewport-shell canvas');
        return {
            modelFailed: t.includes('个 3D 模型加载失败'),
            retryLoad: [...document.querySelectorAll('.previs-viewport-notice button')].some((b) => (b.textContent || "").includes('重试加载') && b.getClientRects().length > 0),
            renderFailed: t.includes('3D 视口渲染失败'),
            contextLost: t.includes('3D 显示上下文已丢失'),
            canvasUsable: !!c && c.clientWidth > 0 && c.clientHeight > 0,
        };
    })()`);
    assert(!stable.modelFailed, "B4 no model-load-failed notice", JSON.stringify(stable));
    assert(!stable.retryLoad, "B5 no retry-load affordance");
    assert(!stable.renderFailed, "B6 no viewport render failure");
    assert(!stable.contextLost, "B7 no WebGL context-lost notice");
    assert(stable.canvasUsable, "B8 5s 稳定窗口内无失败且 canvas 持续可用");

    assert(cdp.problems.length === 0, "B9 no browser problems in scenario B", JSON.stringify(cdp.problems));
}

/**
 * 场景 C：缺失模型失败 → 用户重试 → 第二轮失败。
 * 通过「提示消失再重新出现」证明重试真的重跑了加载，而不是命中陈旧提示。
 */
async function missingRetry(cdp, baseUrl) {
    console.log("\n=== C. missing model failure and retry ===");
    await cdp.navigateFresh(`${baseUrl}/dev/previs-repro`);

    const injected = await cdp.click('[data-testid="inject-missing-model"]');
    if (!injected) throw new Error("C: inject-missing-model not clickable");
    const counted = await cdp.poll(`(document.querySelector('[data-testid="object-count"]')?.textContent || "").includes('4')`, "object count 4", 15000);
    assert(counted, "C1 missing model injected into scene");

    const opened = await cdp.click('[data-testid="toggle-workbench"]');
    if (!opened) throw new Error("C: toggle-workbench not clickable");
    await openUnifiedWorkbench(cdp, "C");

    const failed = await cdp.poll(`/个 3D 模型加载失败/.test(document.body.innerText || "")`, "load-failed notice", 40000);
    assert(failed, "C2 model-load-failed notice appears");
    const retryVisible = await cdp.poll(`[...document.querySelectorAll('button')].some((b) => (b.textContent || "").includes('重试加载'))`, "retry affordance", 20000);
    assert(retryVisible, "C3 actionable 重试加载 affordance present");

    const clickedRetry = await cdp.clickText("重试加载");
    if (!clickedRetry) throw new Error("C: 重试加载 button not clickable");

    const noticeCleared = await cdp.poll(`!/个 3D 模型加载失败/.test(document.body.innerText || "")`, "notice cleared after retry", 20000);
    assert(noticeCleared, "C4 notice clears when retry restarts the load");
    const failedAgain = await cdp.poll(`/个 3D 模型加载失败/.test(document.body.innerText || "")`, "second-round failure", 40000);
    assert(failedAgain, "C5 second-round failure after retry");

    const closed = await cdp.click('[aria-label="关闭预演台"]');
    if (!closed) throw new Error("C: 关闭预演台 button not clickable");
    const shellGone = await cdp.poll(`document.querySelectorAll('.previs-viewport-shell').length === 0`, "workbench closed", 20000);
    assert(shellGone, "C6 workbench closed cleanly");

    const refreshed = await cdp.click('[data-testid="refresh-events"]');
    if (!refreshed) throw new Error("C: refresh-events not clickable");

    const hasRetryCode = await cdp.poll(`(document.body.innerText || "").includes('PREVIS_MODEL_LOAD_RETRY')`, "retry diagnostic", 20000);
    assert(hasRetryCode, "C7 PREVIS_MODEL_LOAD_RETRY recorded");
    const twoFailures = await cdp.poll(`((document.body.innerText || "").match(/PREVIS_MODEL_LOAD_FAILED/g) || []).length >= 2`, "two load failures", 20000);
    const failCount = await cdp.evaluate(`((document.body.innerText || "").match(/PREVIS_MODEL_LOAD_FAILED/g) || []).length`);
    assert(twoFailures, "C8 PREVIS_MODEL_LOAD_FAILED recorded at least twice", `count=${failCount}`);

    assert(cdp.problems.length === 0, "C9 no browser problems in scenario C", JSON.stringify(cdp.problems));
}

/**
 * 场景 D：加载中删除。
 * 用真实网络节流把 GLB 拉长到仍在飞行中，再立刻删除对象；
 * 恢复网络后必须没有晚到回流，也不能为已删除对象记任何失败诊断。
 */
async function deleteWhileLoading(cdp, baseUrl) {
    console.log("\n=== D. delete while loading (throttled) ===");
    await cdp.navigateFresh(`${baseUrl}/dev/previs-repro`);

    try {
        await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 3000,
            downloadThroughput: 20000,
            uploadThroughput: 20000,
            connectionType: "cellular3g",
        });

        const injected = await cdp.click('[data-testid="inject-local-model"]');
        if (!injected) throw new Error("D: inject-local-model not clickable");
        const opened = await cdp.click('[data-testid="toggle-workbench"]');
        if (!opened) throw new Error("D: toggle-workbench not clickable");
        await openUnifiedWorkbench(cdp, "D");

        const rowReady = await cdp.poll(`!!document.querySelector('[aria-label="删除 本地模型 repro triangle"]')`, "model row", 30000);
        assert(rowReady, "D1 model row present while load still in flight");

        const deleted = await cdp.click('[aria-label="删除 本地模型 repro triangle"]');
        if (!deleted) throw new Error("D: delete button not clickable");
        const gone = await cdp.poll(`!(document.body.innerText || "").includes('本地模型 repro triangle')`, "name removed", 20000);
        assert(gone, "D2 object removed while its load was in flight");
    } finally {
        await cdp.send("Network.emulateNetworkConditions", {
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
        });
    }

    await sleep(5000);

    const settled = await cdp.evaluate(`(() => {
        const t = document.body.innerText || "";
        const c = document.querySelector('.previs-viewport-shell canvas');
        return {
            nameBack: t.includes('本地模型 repro triangle'),
            modelFailed: t.includes('个 3D 模型加载失败'),
            retryLoad: [...document.querySelectorAll('.previs-viewport-notice button')].some((b) => (b.textContent || "").includes('重试加载') && b.getClientRects().length > 0),
            renderFailed: t.includes('3D 视口渲染失败'),
            contextLost: t.includes('3D 显示上下文已丢失'),
            canvasUsable: !!c && c.clientWidth > 0 && c.clientHeight > 0,
        };
    })()`);
    assert(!settled.nameBack, "D3 no late-arriving reflow of the deleted object", JSON.stringify(settled));
    assert(!settled.modelFailed && !settled.retryLoad, "D4 no failure/retry surfaced for deleted object");
    assert(!settled.renderFailed && !settled.contextLost, "D5 viewport stayed healthy");
    assert(settled.canvasUsable, "D6 canvas still usable after in-flight delete");

    const closed = await cdp.click('[aria-label="关闭预演台"]');
    if (!closed) throw new Error("D: 关闭预演台 button not clickable");
    const shellGone = await cdp.poll(`document.querySelectorAll('.previs-viewport-shell').length === 0`, "workbench closed", 20000);
    assert(shellGone, "D7 workbench closed cleanly");

    const refreshed = await cdp.click('[data-testid="refresh-events"]');
    if (!refreshed) throw new Error("D: refresh-events not clickable");
    await sleep(600);

    const localDiag = await cdp.evaluate(`(() => [...document.querySelectorAll('.ant-table-tbody tr.ant-table-row')]
        .map((r) => [...r.querySelectorAll('td')].map((td) => td.innerText).join(" "))
        .filter((row) => row.includes('repro-model-local') && (row.includes('PREVIS_MODEL_LOAD_FAILED') || row.includes('PREVIS_MODEL_ADOPT_FAILED'))))()`);
    assert(localDiag.length === 0, "D8 no LOAD_FAILED/ADOPT_FAILED for the deleted object", JSON.stringify(localDiag));

    assert(cdp.problems.length === 0, "D9 no browser problems in scenario D", JSON.stringify(cdp.problems));
}

/**
 * 场景 E：真实 WebGL 上下文丢失与恢复。
 * 用 WEBGL_lose_context 扩展驱动真实 GPU 事件，不伪造 DOM 状态。
 */
async function webglLossRestore(cdp, baseUrl) {
    console.log("\n=== E. WebGL context lost and restored ===");
    await cdp.navigateFresh(`${baseUrl}/dev/previs-repro`);

    const opened = await cdp.click('[data-testid="toggle-workbench"]');
    if (!opened) throw new Error("E: toggle-workbench not clickable");
    const hasCanvas = await cdp.poll(`(() => { const c = document.querySelector('.previs-viewport-shell canvas'); return !!c && c.clientWidth > 0; })()`, "canvas", 40000);
    assert(hasCanvas, "E1 real canvas present before context loss");

    // 真实就绪门：capture context 已登记且未 lost，说明监听器已安装。
    // 早于此触发 loseContext 会让事件落在监听器安装之前。
    const rendererReady = await cdp.poll(`document.querySelector('.previs-viewport-shell')?.getAttribute('data-renderer-ready') === 'true'`, "renderer ready", 30000);
    assert(rendererReady, "E2 capture renderer registered before context loss");

    const prepared = await cdp.evaluate(`(() => {
        const canvas = document.querySelector('.previs-viewport-shell canvas');
        if (!canvas) return false;
        const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
        if (!gl) return false;
        const ext = gl.getExtension('WEBGL_lose_context');
        if (!ext || typeof ext.loseContext !== 'function' || typeof ext.restoreContext !== 'function') return false;
        window.__previsE2ELoseContext = ext;
        return true;
    })()`);
    if (!prepared) throw new Error("E: WEBGL_lose_context extension unavailable — cannot drive a real context loss");
    assert(prepared, "E3 WEBGL_lose_context extension acquired from live context");

    await cdp.evaluate(`(() => { window.__previsE2ELoseContext.loseContext(); return true; })()`);
    const lostNotice = await cdp.poll(`(document.body.innerText || "").includes('3D 显示上下文已丢失')`, "context-lost notice", 30000);
    assert(lostNotice, "E4 context-lost notice surfaced in DOM");

    await cdp.evaluate(`(() => { window.__previsE2ELoseContext.restoreContext(); return true; })()`);
    const restored = await cdp.poll(`!(document.body.innerText || "").includes('3D 显示上下文已丢失')`, "context-lost notice cleared", 30000);
    assert(restored, "E5 context-lost notice cleared after restore");
    const canvasUsable = await cdp.poll(`(() => { const c = document.querySelector('.previs-viewport-shell canvas'); return !!c && c.clientWidth > 0 && c.clientHeight > 0; })()`, "canvas usable after restore", 20000);
    assert(canvasUsable, "E6 canvas remains usable after restore");

    const closed = await cdp.click('[aria-label="关闭预演台"]');
    if (!closed) throw new Error("E: 关闭预演台 button not clickable");
    const shellGone = await cdp.poll(`document.querySelectorAll('.previs-viewport-shell').length === 0`, "workbench closed", 20000);
    assert(shellGone, "E7 workbench closed cleanly");

    const refreshed = await cdp.click('[data-testid="refresh-events"]');
    if (!refreshed) throw new Error("E: refresh-events not clickable");
    const hasLost = await cdp.poll(`(document.body.innerText || "").includes('PREVIS_VIEWPORT_CONTEXT_LOST')`, "lost diagnostic", 20000);
    assert(hasLost, "E8 PREVIS_VIEWPORT_CONTEXT_LOST recorded");
    const hasRestored = await cdp.poll(`(document.body.innerText || "").includes('PREVIS_VIEWPORT_CONTEXT_RESTORED')`, "restored diagnostic", 20000);
    assert(hasRestored, "E9 PREVIS_VIEWPORT_CONTEXT_RESTORED recorded");

    assert(cdp.problems.length === 0, "E10 no browser problems in scenario E", JSON.stringify(cdp.problems));
}

/**
 * 场景 F：强制保存失败 → 头部错误态与重试入口 → 关闭走确认保护。
 * 选择「留在预演台」后 workbench 必须仍然存在（onClose 不得被调用）。
 */
async function saveFailureCloseGuard(cdp, baseUrl) {
    console.log("\n=== F. save failure and close guard ===");
    await cdp.navigateFresh(`${baseUrl}/dev/previs-repro`);

    const toggledFailure = await cdp.click('[data-testid="force-save-failure"]');
    if (!toggledFailure) throw new Error("F: force-save-failure switch not clickable");
    const failureOn = await cdp.poll(`document.querySelector('[data-testid="force-save-failure"]')?.getAttribute('aria-checked') === 'true'`, "failure switch on", 15000);
    assert(failureOn, "F1 forced save failure enabled");

    const opened = await cdp.click('[data-testid="toggle-workbench"]');
    if (!opened) throw new Error("F: toggle-workbench not clickable");
    await openUnifiedWorkbench(cdp, "F");
    const hasCanvas = await cdp.poll(`(() => { const c = document.querySelector('.previs-viewport-shell canvas'); return !!c && c.clientWidth > 0; })()`, "canvas", 40000);
    assert(hasCanvas, "F2 workbench open with real canvas");

    await addProp(cdp, "单人沙发", "F");

    const errorState = await cdp.poll(`(document.body.innerText || "").includes('保存失败')`, "save failure header", 40000);
    assert(errorState, "F3 header surfaces 保存失败 after forced flush failure");
    const retryVisible = await cdp.poll(`[...document.querySelectorAll('button')].some((b) => (b.textContent || "").includes('重试保存'))`, "retry save affordance", 20000);
    assert(retryVisible, "F4 actionable 重试保存 affordance present");

    const closeClicked = await cdp.click('[aria-label="关闭预演台"]');
    if (!closeClicked) throw new Error("F: 关闭预演台 button not clickable");

    const modalShown = await cdp.poll(`!!document.querySelector('.ant-modal-confirm') && (document.body.innerText || "").includes('留在预演台')`, "close confirm modal", 40000);
    assert(modalShown, "F5 close is guarded by a confirm dialog, not silent exit");

    // 坐标点击成功派发不代表按钮收到了点击：CI 的动画/渲染调度可能让坐标落到遮罩。
    // 只对未送达的点击有限重试；一旦按钮收到真实点击，就保留原关闭断言，不重试业务操作。
    await cdp.evaluate(`(() => {
        const probe = { count: 0 };
        probe.listener = (event) => {
            const button = event.target instanceof Element ? event.target.closest('button') : null;
            if (event.isTrusted && button?.closest('.ant-modal-confirm') && (button.textContent || '').trim() === '留在预演台') probe.count++;
        };
        window.__previsStayClickProbe = probe;
        document.addEventListener('click', probe.listener, true);
    })()`);
    let stayClicked = false;
    try {
        for (let attempt = 0; attempt < 3 && !stayClicked; attempt++) {
            const dispatched = await cdp.clickText("留在预演台", ".ant-modal-confirm button");
            if (!dispatched) throw new Error("F: 留在预演台 button not clickable");
            stayClicked = await cdp.poll(`window.__previsStayClickProbe.count > 0`, "stay button received trusted click", 1500);
        }
        if (!stayClicked) throw new Error("F: 留在预演台 button did not receive a trusted click");
    } finally {
        await cdp.evaluate(`(() => {
            document.removeEventListener('click', window.__previsStayClickProbe.listener, true);
            delete window.__previsStayClickProbe;
        })()`);
    }
    const modalGone = await cdp.poll(
        `![...document.querySelectorAll('.ant-modal-confirm')].some((modal) => {
            const rect = modal.getBoundingClientRect();
            const style = getComputedStyle(modal);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0;
        })`,
        "modal dismissed",
        20000,
    );
    assert(modalGone, "F6 confirm dialog dismissed after choosing 留在预演台");

    await sleep(1000);
    const stillOpen = await cdp.evaluate(`document.querySelectorAll('.previs-viewport-shell').length`);
    assert(stillOpen === 1, "F7 unified workbench remains open after choosing 留在预演台", `shellCount=${stillOpen}`);

    assert(cdp.problems.length === 0, "F8 no browser problems in scenario F", JSON.stringify(cdp.problems));
}

/** 从真实 React 组件取公开 viewport handle，不挂生产调试 API、不另建仿制页面。 */
async function shotOutputs(cdp, baseUrl) {
    console.log("\n=== G. shot capture, depth, recording and monitor ===");
    await cdp.navigateFresh(`${baseUrl}/dev/previs-repro`);
    await cdp.click('[data-testid="toggle-workbench"]');
    if (!(await cdp.poll(`document.querySelector('.previs-viewport-shell')?.dataset.rendererReady === 'true'`, "capture ready", 40000))) throw new Error("capture renderer unavailable");
    const setup = await cdp.evaluate(`(async () => {
        const el = document.querySelector('.previs-viewport-shell');
        let fiber = el[Object.keys(el).find(key => key.startsWith('__reactFiber'))];
        while (fiber && !fiber.ref?.current?.capture) fiber = fiber.return;
        const resources = performance.getEntriesByType('resource').map(item => item.name);
        const r3f = await import(resources.find(url => url.includes('/@react-three_fiber.js')));
        const root = [...r3f._roots.values()].find(item => item.store.getState().gl.domElement === el.querySelector('canvas')).store.getState();
        const three = await import(resources.find(url => url.includes('/three.js')));
        window.__previsCaptureTest = { handle: fiber.ref.current, data: fiber.memoizedProps.scene, root, three };
        return !!fiber.ref.current;
    })()`);
    assert(setup, "G1 actual viewport capture handle available");
    const result = await cdp.evaluate(`(async () => {
        const { handle, data, root, three } = window.__previsCaptureTest;
        const surface = handle.createShotSurface({ longEdge: 320, depthNear: 0, depthFar: 30 });
        const read = () => new Uint8ClampedArray(surface.canvas.getContext('2d').getImageData(0, 0, surface.canvas.width, surface.canvas.height).data);
        try {
            surface.render('depth', 0); const firstDepth = read();
            surface.render('beauty', 0); const beauty = read();
            surface.render('depth', 0); const secondDepth = read();
            const stableDepth = firstDepth.every((value, i) => value === secondDepth[i]);
            const { resolvePrevisViewFraming } = await import('/src/lib/canvas/previs/previs-view-modes.ts');
            const framing = resolvePrevisViewFraming({ scene: data, mode: 'camera', playhead: 0 });
            const camera = new three.PerspectiveCamera(framing.fov, surface.canvas.width / surface.canvas.height, framing.near, framing.far);
            camera.position.set(...framing.position); camera.up.set(...framing.up); camera.lookAt(...framing.target); camera.updateMatrixWorld(true);
            const meshes = [];
            root.scene.traverse(o => {
                let helper = false; for(let p=o;p;p=p.parent) if(p.userData.previsCaptureExclude || p.isTransformControlsGizmo || p.isTransformControlsPlane) helper=true;
                if(o.isMesh && o.visible && !helper) meshes.push(o);
            });
            const errors = [];
            for (const [u,v] of [[0.5,0.54],[0.5,0.78],[0.5,0.94]]) {
                const x=Math.floor(u*surface.canvas.width), y=Math.floor(v*surface.canvas.height);
                const ray = new three.Raycaster(); ray.setFromCamera(new three.Vector2((x+.5)/surface.canvas.width*2-1,1-(y+.5)/surface.canvas.height*2), camera);
                const hit=ray.intersectObjects(meshes,false)[0]; if(!hit) throw new Error('depth probe missed scene');
                const z=-hit.point.clone().applyMatrix4(camera.matrixWorldInverse).z;
                const expected=Math.round((1-Math.min(1,Math.max(0,z/30)))*255);
                errors.push(Math.abs(firstDepth[(y*surface.canvas.width+x)*4]-expected));
            }
            // 同一相机直接渲染到当前真实 renderer 默认帧缓冲，对比中心物体与地面色彩。
            const size=root.gl.getSize(new three.Vector2()), dpr=root.gl.getPixelRatio(), target=root.gl.getRenderTarget();
            const helpers=[];
            root.scene.traverse(o => { if(o.visible && (o.userData.previsCaptureExclude || o.isTransformControlsGizmo || o.isTransformControlsPlane)) { helpers.push(o);o.visible=false; } });
            let maxColorError=0;
            try {
                root.gl.setPixelRatio(1); root.gl.setSize(surface.canvas.width,surface.canvas.height,false); root.gl.setRenderTarget(null); root.gl.render(root.scene,camera);
                const copy=document.createElement('canvas'); copy.width=surface.canvas.width;copy.height=surface.canvas.height;
                copy.getContext('2d').drawImage(root.gl.domElement,0,0);
                const direct=copy.getContext('2d').getImageData(0,0,copy.width,copy.height).data;
                for(const [u,v] of [[.47,.54],[.5,.78],[.5,.2]]) {
                    const i=(Math.floor(v*copy.height)*copy.width+Math.floor(u*copy.width))*4;
                    for(let c=0;c<3;c++) maxColorError=Math.max(maxColorError,Math.abs(direct[i+c]-beauty[i+c]));
                }
            } finally { helpers.forEach(o=>o.visible=true);root.gl.setPixelRatio(dpr); root.gl.setSize(size.x,size.y,false);root.gl.setRenderTarget(target);root.invalidate(); }
            return { width:surface.canvas.width,height:surface.canvas.height,stableDepth,depthErrors:errors,maxColorError };
        } finally { surface.dispose(); }
    })()`);
    assert(result.width === 180 && result.height === 320, "G2 capture respects portrait shot ratio", JSON.stringify(result));
    assert(result.stableDepth, "G3 beauty/depth switching preserves exact depth bytes");
    assert(
        result.depthErrors.every((error) => error <= 1),
        "G4 linear metric depth matches raycast distance",
        JSON.stringify(result.depthErrors),
    );
    assert(result.maxColorError <= 2, "G5 beauty matches default framebuffer tone mapping", `max error=${result.maxColorError}`);
    const recording = await cdp.evaluate(`(async () => {
        const handle=window.__previsCaptureTest.handle;
        const blob=await handle.recordVideo(.6,12,'depth',{longEdge:320});
        const video=document.createElement('video'),url=URL.createObjectURL(blob);video.muted=true;
        try { await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('recording cannot decode'));video.src=url;});
            const abort=new AbortController();const pending=handle.recordVideo(2,12,'beauty',{longEdge:320,signal:abort.signal});abort.abort();
            let cancelled=false;try{await pending;}catch{cancelled=true;}
            return {bytes:blob.size,width:video.videoWidth,height:video.videoHeight,cancelled};
        } finally {video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
    })()`);
    assert(recording.bytes > 0 && recording.width === 180 && recording.height === 320, "G6 recording is decodable at shot dimensions", JSON.stringify(recording));
    assert(recording.cancelled, "G7 recording cancellation rejects and releases session");
    const monitorButton = 'button[title^="投放到第二屏幕"]';
    await cdp.evaluate(`(() => { const open=window.open.bind(window);window.open=(...args)=>{const popup=open(...args);window.__previsPopup=popup;return popup;}; })()`);
    if (!(await cdp.click(monitorButton))) throw new Error("G: 第二屏监看 button not clickable");
    assert(await cdp.poll(`window.__previsPopup?.document.querySelector('canvas')?.width === 1080`, "monitor frame", 20000), "G8 monitor displays full portrait shot");
    const reused = await cdp.evaluate(`(async () => {
        const {openPrevisMonitorWindow}=await import('/src/components/canvas/previs/previs-monitor-window.ts');
        let firstClosed=0,secondClosed=0;
        const first=openPrevisMonitorWindow({brandName:'监看测试',renderFrame:()=>null,onClosed:()=>firstClosed++});
        const second=openPrevisMonitorWindow({brandName:'监看测试',renderFrame:()=>null,onClosed:()=>secondClosed++});
        const count=window.__previsPopup.document.querySelectorAll('canvas').length;
        first.close();const live=!second.closed();second.close();
        return {count,live,firstClosed,secondClosed};
    })()`);
    assert(reused.count === 1 && reused.live && reused.firstClosed === 1 && reused.secondClosed === 1, "G9 named monitor reuse cleans old session without closing new window", JSON.stringify(reused));
    assert(await cdp.poll(`document.querySelector(${JSON.stringify(monitorButton)})?.getAttribute('aria-pressed') === 'false'`, "monitor closed"), "G10 monitor UI resets on close");
    assert(cdp.problems.length === 0, "G11 no browser problems in output scenario", JSON.stringify(cdp.problems));
}

async function main() {
    const chromePath = resolveChrome();
    console.log(`Chrome binary: ${chromePath}`);

    const vitePort = await freePort();
    const cdpPort = await freePort();
    const baseUrl = `http://127.0.0.1:${vitePort}`;
    const profileDir = mkdtempSync(join(tmpdir(), "previs-p0-e2e-"));

    let vite = null;
    let chrome = null;
    let cdp = null;

    try {
        console.log(`Starting Vite on ${baseUrl} ...`);
        vite = await launchVite(vitePort);
        console.log(`      vite pid=${vite.pid}`);

        console.log(`Starting Chrome with CDP on 127.0.0.1:${cdpPort} ...`);
        chrome = await launchChrome(chromePath, cdpPort, profileDir);
        console.log(`      chrome pid=${chrome.pid}, profile=${profileDir}`);

        cdp = await connectCdp(cdpPort);
        console.log("      CDP connected (Runtime, Page, Log, Network enabled)");

        // 故意保存失败的场景最后运行：它保留 beforeunload 保护，后续导航会被浏览器拦住。
        const scenarios = [smokeWorkbench, localModel, missingRetry, deleteWhileLoading, webglLossRestore, shotOutputs, saveFailureCloseGuard];
        const selected = process.env.PREVIS_E2E_SCENARIO;
        if (selected && !scenarios.some((scenario) => scenario.name === selected)) throw new Error(`Unknown scenario: ${selected}`);
        for (const scenario of scenarios.filter((scenario) => !selected || scenario.name === selected)) {
            try {
                await scenario(cdp, baseUrl);
            } catch (error) {
                fail(`${scenario.name} threw`, String(error?.message || error));
            }
        }
    } finally {
        try {
            cdp?.close();
        } catch {
            /* socket already closed */
        }
        // 三个清理步骤互不阻塞：任一失败都记为断言失败（最终 exit 1），但不吞掉其余清理。
        try {
            await stopExact(chrome, "chrome");
        } catch (error) {
            fail("cleanup: stop chrome", String(error?.message || error));
        }
        try {
            await stopExact(vite, "vite");
        } catch (error) {
            fail("cleanup: stop vite", String(error?.message || error));
        }
        try {
            rmSync(profileDir, { recursive: true, force: true });
            console.log(`      removed profile ${profileDir}`);
        } catch (error) {
            fail("cleanup: remove profile", `${profileDir}: ${String(error?.message || error)}`);
        }
    }

    const passed = results.filter((r) => r.ok).length;
    console.log("\n================ SUMMARY ================");
    console.log(`assertions: ${passed} passed, ${failures} failed, ${results.length} total`);
    for (const r of results.filter((x) => !x.ok)) console.log(`  FAILED: ${r.name}${r.detail ? " — " + r.detail : ""}`);
    console.log("=========================================");

    if (failures > 0) {
        console.error(`\nPrevis P0 Chrome E2E FAILED (${failures} assertion(s)).`);
        process.exit(1);
    }
    console.log("\nPrevis P0 Chrome E2E PASSED.");
}

main().catch((error) => {
    console.error("\nPrevis P0 Chrome E2E crashed:", error?.stack || error);
    process.exit(1);
});
