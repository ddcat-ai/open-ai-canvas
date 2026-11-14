require("./console-streams").protectConsoleStreams();
const { app, BrowserWindow, Menu, Tray, nativeImage, shell, dialog, ipcMain, Notification, safeStorage, session } = require("electron");
// 壳内品牌串统一出口：electron-builder 按 productName 注入 app.getName()——
// 完整版=PeekReel，精简版=electron-builder.lite.yml 覆盖的客户品牌（docs/LITE-EDITION.md）。
const APP_NAME = app.getName() || "PeekReel";
const path = require("path");
const fs = require("fs");
const { BackendProcess } = require("./backend-process");
const { DoubaoBridgeProcess } = require("./doubao-bridge-process");
const { syncDirectChannelsAtBoot } = require("./direct-channels");
const { ensurePaymentPlugins } = require("./plugin-fetch");
const { startLocalServer } = require("./local-server");
const { loadConfig, saveConfig } = require("./config");
const { prefetchUpdateInstaller } = require("./parallel-fetch");
const { storagePaths, prepareStorage, configureElectronStorage, migrateLegacyStorage, copyVerified } = require("./storage-paths");
const { getInstallationUpdater } = require("./installation-updater");
const { resolveLocalPort } = require("./local-origin");
const { DoubaoBrowserHost } = require("./doubao-browser-host");
const { isTrustedMainFrame } = require("./trusted-ipc");
const { createSessionVault, createYingceSessionClient, accountScope } = require("./yingce-session");
const { createYingceSystemRelay, createYingceAccountRelay } = require("./yingce-system-relay");
const { syncYingceSystemCatalogAtBoot } = require("./yingce-system-catalog");
const { createDesktopLogin } = require("./desktop-login");
const { registerYingceIpc } = require("./yingce-ipc");
const { createGenerationJournal } = require("./yingce-generation-journal");
const { localAccountCredentials, authenticateLocalBackend } = require("./local-account");
const { inspectLegacyProfile, hasImportedLegacyProfile, importLegacyProfile } = require("./legacy-profile-import");
const { createLiteAccountLifecycle } = require("./lite-account-lifecycle");
const { createLiteAccountStack } = require("./lite-account-stack");
const isLite = require("../package.json").peekreel?.edition === "lite";
const bootStarted = Date.now();
const startupMetric = (stage) => console.log(`[startup] ${stage} ${Date.now() - bootStarted}ms`);

// 冒烟测试模式：electron . --smoke-test
// 完整本地启动（后端 + 静态服务器 + 页面加载）成功打印 SMOKE OK 退出 0。
// 冒烟直接加载根路径，不经过激活门，验证的是本地栈本身。
const smokeTest = process.argv.includes("--smoke-test");
const legacyDefault = app.getPath("userData");
const legacyPeekReel = path.join(app.getPath("appData"), "PeekReel");
const legacyUserData = [...new Set([legacyDefault, legacyPeekReel].map((dir) => path.resolve(dir)))];
const installationDir = app.isPackaged ? path.dirname(app.getPath("exe")) : path.resolve(__dirname, "../../.local/desktop-runtime");
const runtimePaths = storagePaths(installationDir, { smoke: smokeTest });
try {
    fs.mkdirSync(runtimePaths.root, { recursive: true });
    // Set userData before acquiring the single-instance lock and before Chromium starts.
    app.setPath("userData", runtimePaths.root);
} catch (error) {
    dialog.showErrorBox("无法创建客户端数据目录", `请将客户端安装到可写目录。\n${error.message}`);
    app.exit(1);
    throw error;
}

// 真实显卡机器：视频走硬件叠加层（overlay plane）呈现时，与页面合成层不同步
// 会导致视频播放/大内容弹窗场景闪屏。只禁视频叠加层、其余 GPU 加速全保留
// （视频仍走正常合成，画面正常）。若个别机器仍闪，可设 YINGCE_KEEP_VIDEO_OVERLAY=1 还原。
if (process.env.YINGCE_KEEP_VIDEO_OVERLAY !== "1") {
    app.commandLine.appendSwitch("disable-direct-composition-video-overlays");
}

// 豆包页面由客户端自己的 Chromium 隐藏窗口托管。桥只通过本机随机令牌
// 控制端点附加 CDP，绝不启动或显示系统外部浏览器窗口。

/* ---------------- 内存与缓存上限（2026-11-11 实测后加） ----------------
 * 默认 Chromium 的磁盘缓存与 GPU 程序缓存「不设上限」：长期使用后 userData 会缓慢膨胀，
 * GPU 进程也会把着色器缓存一直养大（本机 gpu-process 实测 255 MB）。这里给出硬上限，
 * 让占用可预期，而不是随使用时长漂移。
 *   disk-cache-size           磁盘 HTTP 缓存上限 256 MB（本地静态资源本就走 no-store）
 *   gpu-program-cache-size-kb GPU 程序缓存上限 16 MB（默认 1 GB 量级）
 * 两者都只影响缓存复用，不影响渲染结果。 */
app.commandLine.appendSwitch("disk-cache-size", String(256 * 1024 * 1024));
app.commandLine.appendSwitch("gpu-program-cache-size-kb", String(16 * 1024));
let smokeTimer = null;

function finishSmoke(ok, detail) {
    if (!smokeTest) return;
    clearTimeout(smokeTimer);
    console.log(ok ? `SMOKE OK ${detail}` : `SMOKE FAIL ${detail}`);
    // app.exit 会跳过 before-quit，显式停后端与豆包桥再退出，避免孤儿进程。
    const stops = [];
    if (backend) stops.push(backend.stop());
    if (bridge) stops.push(bridge.stop());
    if (doubaoBrowserHost) stops.push(doubaoBrowserHost.stop());
    if (stops.length) {
        Promise.all(stops).finally(() => app.exit(ok ? 0 : 1));
    } else {
        app.exit(ok ? 0 : 1);
    }
}

let config = null;
let mainWindow = null;
let accountWindow = null;
let splashWindow = null;
let tray = null;
let backend = null;
let bridge = null;
let doubaoBrowserHost = null;
let doubaoBrowserHostStarting = null;
let retryingApp = false;
let retryingBridge = false;
let yingceClient = null;
let desktopLogin = null;
let liteLifecycle = null;
let liteStack = null;
let liteRemoteUserId = null;
let mainWindowScope = null;
let switchingWindows = false;
let updateTimerStarted = false;
let liteLogoutInFlight = null;
let liteAccountRevision = 0;

let localServer = null;
let quitting = false;
let updateListenerAttached = false;
let pendingUpdateVersion = null;
let channelSyncQueue = Promise.resolve();
// 更新状态快照：{ phase: "idle" | "downloading" | "ready", version, percent }
let updateState = { phase: "idle" };
let downloadInFlight = false;
let installingUpdate = false;

async function installDownloadedUpdate() {
    if (installingUpdate) return;
    installingUpdate = true;
    try {
        if (isLite && liteLifecycle) await liteLifecycle.deactivate();
        else await Promise.all([backend && backend.stop(), bridge && bridge.stop(), doubaoBrowserHost && doubaoBrowserHost.stop()].filter(Boolean));
        quitting = true;
        getInstallationUpdater(runtimePaths.updates).quitAndInstall(true, true);
    } catch (error) {
        installingUpdate = false;
        throw error;
    }
}

function broadcastUpdateState() {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send("app:update-state", updateState);
    }
}

// 资源解析：打包后资源在 resources/ 下；开发模式用仓库路径（可用环境变量覆盖）。
function resolveResources() {
    if (app.isPackaged) {
        const root = process.resourcesPath;
        return {
            webDist: path.join(root, "web-dist"),
            backendExe: path.join(root, "canvas-backend.exe"),
            doubaoBridgeDir: path.join(root, "doubao-bridge"),
            activationDir: path.join(root, "activation"),
            splash: path.join(root, "splash.png"),
            tray: path.join(root, "tray.png"),
        };
    }
    return {
        webDist: process.env.YINGCE_DEV_WEB_DIST || path.resolve(__dirname, "..", "..", "web", "dist"),
        backendExe:
            process.env.YINGCE_DEV_BACKEND_EXE ||
            path.resolve(__dirname, "..", "..", ".local", "canvas-backend-cgo.exe"),
        doubaoBridgeDir: path.resolve(__dirname, "..", "doubao-bridge"),
        activationDir: path.resolve(__dirname, "..", "activation"),
        splash: path.resolve(__dirname, "..", "build", "splash.png"),
        tray: path.resolve(__dirname, "..", "build", "tray.png"),
    };
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock && !smokeTest) {
    app.quit();
} else {
    try {
        if (!smokeTest) {
            // Older releases lock APPDATA, so the new lock alone cannot detect them.
            const savedBridgeDir = path.join(runtimePaths.root, "legacy-bridge");
            const oldBridgeDir = app.isPackaged ? path.join(process.resourcesPath, "doubao-bridge") : null;
            const layoutExists = fs.existsSync(path.join(runtimePaths.root, ".storage-layout.json"));
            const hasLegacyRoots = legacyUserData.some((dir) => fs.existsSync(dir) &&
                (!layoutExists || path.resolve(dir).toLowerCase() !== path.resolve(legacyPeekReel).toLowerCase()));
            const hasLegacyBridge = !layoutExists && [savedBridgeDir, oldBridgeDir].some((dir) => dir &&
                ["data/accounts.json", "data/tasks.json", "profiles"].some((name) => fs.existsSync(path.join(dir, name))));
            if (app.isPackaged && (hasLegacyRoots || hasLegacyBridge)) {
                const { execFileSync } = require("child_process");
                if (process.platform === "win32") {
                    // Lite and full releases can share the legacy APPDATA profile.
                    const names = [...new Set([path.basename(app.getPath("exe")), "PeekReel.exe", "PeekReel Lite.exe"])];
                    const filter = names.map((name) => `Name='${name.replace(/'/g, "''")}'`).join(" OR ");
                    const script = `@(Get-CimInstance Win32_Process -Filter "${filter}" | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.CommandLine -notmatch '--type=|server\\.js' }).Count`;
                    let count;
                    try {
                        count = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], { windowsHide: true, encoding: "utf8", timeout: 20000 }).trim();
                    } catch (error) {
                        throw new Error(`无法确认旧客户端是否退出，已暂停旧数据迁移并保留原数据：${error.message}`);
                    }
                    if (count !== "0") throw new Error("请先退出旧版客户端及其后台进程，再启动新版以迁移数据。");
                }
            }
            migrateLegacyStorage({ paths: runtimePaths, legacyUserData: app.isPackaged ? legacyUserData : [],
                legacyBridgeDir: fs.existsSync(savedBridgeDir) ? savedBridgeDir : oldBridgeDir, oldBridgeDir,
                preserveLegacyUserData: [legacyPeekReel] });
        }
        prepareStorage(runtimePaths);
        configureElectronStorage(app, runtimePaths);
        // Electron 以 0 申请随机 CDP 端口；宿主类会读取启动后生成的
        // DevToolsActivePort，并只把端口交给本机桥进程。
        fs.rmSync(path.join(runtimePaths.root, "DevToolsActivePort"), { force: true });
        app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
        app.commandLine.appendSwitch("remote-debugging-port", "0");
        // Match the previous managed Chrome configuration: opening a random CDP
        // port otherwise enables Chromium's AutomationControlled feature.
        app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");
    } catch (error) {
        dialog.showErrorBox("客户端数据初始化失败", `原数据已保留，请检查安装目录权限并退出旧版客户端后重试。\n${error.message}`);
        app.exit(1);
        throw error;
    }
    if (gotLock) {
        app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });
    }

app.whenReady().then(async () => {
        // AUMID 必须与 NSIS 快捷方式里写入的值逐字符相同 —— Windows 靠它把运行中的窗口
        // 关联到已安装的快捷方式（任务栏图标、固定项、跳转列表、系统通知全依赖这个关联）。
        //
        // 旧实现从 app.getName()（即 productName）拼：`com.<name>.desktop`。
        // 完整版 productName="PeekReel" 恰好等于 appId="com.peekreel.desktop"，蒙对了；
        // 但 Lite 版 productName="PeekReel Lite" 会拼成 "com.peekreellite.desktop"，
        // 而 electron-builder 写进快捷方式的是 appId "com.peekreel.lite" —— 两者不一致，
        // 任务栏就找不到快捷方式，图标退化成系统默认的白纸（2026-11-10 实测确认）。
        //
        // 现在改为从 package.json 的 peekreel.appUserModelId 显式读取，由 electron-builder
        // 的 extraMetadata 按版本注入（完整版见 package.json，Lite 版见 electron-builder.lite.yml）。
        // 兜底保留旧的推导逻辑，保证不配也能起来；不一致时打日志，避免下次静默踩坑。
        const pkg = (() => { try { return require("../package.json"); } catch { return {}; } })();
        const declaredAumid = (pkg.peekreel && pkg.peekreel.appUserModelId) || "";
        const derivedAumid = "com." + APP_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "") + ".desktop";
        const aumid = declaredAumid || derivedAumid;
        if (declaredAumid && declaredAumid !== derivedAumid) {
            console.log(`[aumid] 使用显式 AUMID ${declaredAumid}（productName 推导值 ${derivedAumid} 与 appId 不一致，已忽略）`);
        } else if (!declaredAumid) {
            console.warn(`[aumid] 未声明 peekreel.appUserModelId，回落到 productName 推导值 ${derivedAumid}；` +
                `若 productName 与 electron-builder appId 不同，任务栏图标会失效`);
        }
        app.setAppUserModelId(aumid);
        if (!smokeTest) openSplash();
        startupMetric("splash");
        // Splash uses a nonpersistent session; terminate maintenance before opening the main session.
        try {
            const { runStorageMaintenanceWorker } = require("./storage-maintenance");
            const result = await runStorageMaintenanceWorker({ userDataDir: app.getPath("userData"), budgetMs: 250 });
            console.log(`[storage] ${JSON.stringify(result)}`);
            try { require("./main-log").writeMaintenanceLog(runtimePaths.logs, result); }
            catch (error) { console.warn(`[storage] 无法写入维护日志：${error.message}`); }
        } catch (error) {
            console.warn(`[storage] 启动维护失败（不影响启动）：${error.message}`);
            try { require("./main-log").writeMaintenanceLog(runtimePaths.logs, { error: true }); }
            catch (logError) { console.warn(`[storage] 无法写入维护日志：${logError.message}`); }
        }
        config = loadConfig(app);
        registerIpc();
        buildMenu();
        if (smokeTest) {
            smokeTimer = setTimeout(() => finishSmoke(false, "timeout"), 60000);
        }
        // 闪屏先于一切重活出现，遮住后端冷启动。
        if (quitting) return;
        try {
            await startApp();
        } catch (error) {
            if (smokeTest) {
                finishSmoke(false, error.message);
            } else {
                showErrorPage(error.message);
            }
        }
    });

    app.on("before-quit", async (event) => {
        if (quitting) return;
        quitting = true;
        if (liteLifecycle || backend || bridge || doubaoBrowserHost) {
            event.preventDefault();
            if (isLite && liteLifecycle) await liteLifecycle.deactivate();
            else await Promise.all([backend && backend.stop(), bridge && bridge.stop(), doubaoBrowserHost && doubaoBrowserHost.stop()].filter(Boolean));
            app.quit();
        }
    });

    app.on("window-all-closed", () => {
        // 托盘常驻：主窗口关闭不退出，从托盘菜单退出。
        if (!tray && !switchingWindows) app.quit();
    });
}

async function startApp() {
    if (quitting) return;
    const resources = resolveResources();
    for (const required of [resources.webDist, resources.backendExe]) {
        if (!fs.existsSync(required)) {
            throw new Error(`缺少运行资源：${required}`);
        }
    }

    const userData = app.getPath("userData");
    const localWebPort = resolveLocalPort(userData, config.localWebPort);
    if (isLite && !smokeTest) return startLiteApp(resources, localWebPort);
    const currentBackend = new BackendProcess(resources.backendExe, path.join(userData, "data"), path.join(userData, "logs"), {
        // 后端崩溃自愈（审计补强）：此前后端一死就静默失效到重启应用，而桥仍正常应答
        // /healthz，面板看起来「服务在线」实际全断。与桥同款冷却重启，复用同一端口，
        // 保证本地同源代理 /api → backend.baseUrl 不用重建。
        onUnexpectedExit: () => {
            if (!quitting && backend === currentBackend) currentBackend.scheduleRestart();
        },
        onRecovered: (baseUrl) => {
            console.warn(`[backend] 异常退出后已恢复 ${baseUrl}`);
        },
    });
    backend = currentBackend;
    // 豆包桥与后端并行冷启动；桥失败只记日志（豆包功能降级，不影响主应用）。
    startBridge(resources, `http://127.0.0.1:${localWebPort}`);
    await currentBackend.start();
    if (quitting || backend !== currentBackend) return;
    startupMetric("backend-ready");

    // 支付插件按需拉取（G1 瘦身）：安装包只带 105 个轻量插件，5 个支付适配器
    // （合计 12.7 MB）在首次启动后后台补齐，下次启动由后端加载。
    // 不阻塞主流程，也不重启正在服务的后端——支付是低频管理操作，多一次重启无感。
    ensurePaymentPlugins(path.join(path.dirname(resources.backendExe), "plugin-packages"), {
        log: (text) => console.log(`[plugin-fetch] ${text}`),
    }).catch((error) => console.error(`[plugin-fetch] ${error.message}`));

    localServer = await startLocalServer(resources.webDist, backend.baseUrl, {
        port: localWebPort,
        getDoubaoBridge: bridgeInfo,
        relayUrl: config.relayUrl,
        consoleUrl: config.consoleUrl,
        directChannelsUrl: config.directChannelsUrl,
        activationDir: resources.activationDir,
        appName: APP_NAME,
        onLogoutAttempt: () => {
            if (mainWindow && !quitting) {
                mainWindow.loadURL(`${localServer.url}/peekreel-activation`).catch(() => {});
            }
        },
    });
    if (config.localWebPort !== localServer.port) {
        config.localWebPort = localServer.port;
        saveConfig(app, config);
    }
    if (quitting) { localServer.server.close(); return; }
    startupMetric("frontend-ready");

    openMainWindow(smokeTest ? localServer.url : `${localServer.url}/peekreel-activation`);
    if (!smokeTest) createTray(resources.tray);
    // 直连渠道启动同步（非阻塞）：中转模型目录（新模型自动补齐/换钥自愈）+
    // 服务器目录（音频/视频）。激活页 bootstrap 的同步保留不动；
    // 这里是普通启动路径的自愈补强。失败只记日志，不影响使用。
    if (!smokeTest) {
        syncLocalChannels();
    }
}

async function startLiteApp(resources, localWebPort) {
    const yingceSystemRelay = createYingceSystemRelay({
        apiUrl: config.yingceApiUrl,
        getSession: () => liteRemoteUserId ? yingceClient?.sessionToken(liteRemoteUserId) : "",
        getRelayKey: () => liteStack?.relayKey || "",
        getLocalSession: () => liteStack?.localSession || "",
    });
    const yingceAccountRelay = createYingceAccountRelay({
        apiUrl: config.yingceApiUrl,
        getSession: () => liteRemoteUserId ? yingceClient?.sessionToken(liteRemoteUserId) : "",
        getLocalSession: () => liteStack?.localSession || "",
    });
    localServer = await startLocalServer(resources.webDist, null, {
        port: localWebPort, lite: true, activationDir: resources.activationDir,
        getDoubaoBridge: bridgeInfo,
        yingceSystemRelay,
        yingceAccountRelay,
        getYingceUser: () => yingceClient?.cachedUser?.() || null,
        onLogoutAttempt: () => { void logoutLite().catch((error) => console.error(`[account] ${error.message}`)); },
    });
    if (config.localWebPort !== localServer.port) {
        config.localWebPort = localServer.port;
        saveConfig(app, config);
    }
    liteLifecycle = createLiteAccountLifecycle({
        invalidate: () => {
            localServer?.setBackend(null);
            liteStack = null;
            liteRemoteUserId = null;
            backend = null;
            bridge = null;
            doubaoBrowserHost = null;
            if (mainWindowScope && mainWindow && !mainWindow.isDestroyed()) {
                switchingWindows = true;
                mainWindow.destroy();
                switchingWindows = false;
            }
            mainWindowScope = null;
        },
        prepare: (user) => {
            const account = localAccountCredentials({ root: runtimePaths.root, apiUrl: config.yingceApiUrl, userId: user.id, safeStorage });
            return createLiteAccountStack({
                account, origin: localServer.url,
                createBackend: (dataDir) => {
                    const current = new BackendProcess(resources.backendExe, dataDir, runtimePaths.logs, {
                        onUnexpectedExit: () => { if (!quitting && backend === current) current.scheduleRestart(); },
                    });
                    return current;
                },
                createBrowserHost: (scope) => new DoubaoBrowserHost({ BrowserWindow, userDataDir: runtimePaths.root, accountScope: scope, logger: console }),
                createBridge: (options) => new DoubaoBridgeProcess(resources.doubaoBridgeDir, runtimePaths.logs, path.join(options.profileDir, "acct1"), {
                    dataDir: options.dataDir, profileDir: options.profileDir, allowedOrigin: options.origin,
                    getBrowserHostInfo: options.getBrowserHostInfo, onStatus: options.onStatus,
                }),
                authenticate: authenticateLocalBackend,
                installCookie: (scope, value) => (account.legacyProfile ? session.defaultSession : session.fromPartition(`persist:lite-${scope}`)).cookies.set({
                    url: localServer.url, name: "open_ai_canvas_session", value, httpOnly: true, sameSite: "lax", path: "/",
                }),
                syncSystemCatalog: async ({ backend: localBackend, credentials, localSession, signal }) => {
                    const catalog = await yingceClient.modelCatalog();
                    let ecommerceSetting;
                    try { ecommerceSetting = await yingceClient.ecommerceOrchestrationSetting(); }
                    catch {
                        try { ecommerceSetting = await yingceClient.ecommerceAgentSetting(); }
                        catch { console.warn("[yingce-catalog] 电商模型配置同步失败"); }
                    }
                    await syncYingceSystemCatalogAtBoot({
                        backendBaseUrl: localBackend.baseUrl,
                        localOrigin: localServer.url,
                        localSession,
                        relayKey: credentials.relayKey,
                        catalog,
                        ecommerceSetting,
                        signal,
                    });
                },
                syncChannels: ({ backend: localBackend, bridge: localBridge, credentials, signal }) => syncDirectChannelsAtBoot({
                    backendBaseUrl: localBackend.baseUrl, catalogUrl: config.directChannelsUrl, activation: credentials,
                    localChannels: ["ready", "login-needed"].includes(localBridge.status.phase)
                        ? { doubao: { baseUrl: localBridge.baseUrl, apiKey: localBridge.adminToken } } : undefined,
                    activationDir: resources.activationDir, signal, log: (message) => console.log(`[direct-channels] ${message}`),
                }),
                onBridgeStatus: (status) => {
                    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("doubao:bridge-status", status);
                },
                log: (error) => console.error(`[account] ${error.message}`),
            });
        },
        publish: (candidate, user) => {
            candidate.publish();
            liteStack = candidate;
            liteRemoteUserId = String(user.id);
            backend = candidate.backend;
            bridge = candidate.bridge;
            doubaoBrowserHost = candidate.host;
            localServer.setBackend(candidate.backend.baseUrl);
        },
    });
    if (!tray) createTray(resources.tray);
    let current;
    try {
        current = (await yingceClient.session())?.user || null;
    } catch (error) {
        console.warn(`[account] 会话恢复失败：${error.message}`);
    }
    if (!current) {
        try { current = yingceClient.cachedUser(); }
        catch (error) { console.warn(`[account] 本地账号资料不可用：${error.message}`); }
    }
    if (current && await activateLiteAccount(current)) {
        enterLiteWorkspace();
        return;
    }
    if (!quitting) openMainWindow(`${localServer.url}/peekreel-activation`);
}

async function activateLiteAccount(user) {
    const revision = ++liteAccountRevision;
    await offerLegacyProfileImport(user, revision);
    if (revision !== liteAccountRevision) return false;
    return liteLifecycle.activate(user);
}

async function readLegacyBrowserScope() {
    if (!localServer) throw new Error("本地服务尚未就绪，无法读取旧版工作区");
    const probe = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    try {
        await probe.loadURL(`${localServer.url}/peekreel-activation`);
        const value = await probe.webContents.executeJavaScript("window.localStorage.getItem('yingce:active-user-scope') || 'guest'");
        return typeof value === "string" && value && value.length <= 200 ? value : "guest";
    } finally {
        if (!probe.isDestroyed()) probe.destroy();
    }
}

async function offerLegacyProfileImport(user, revision) {
    if (!isLite || !user || !liteLifecycle || quitting) return false;
    const inspection = inspectLegacyProfile(runtimePaths.data, config.activation);
    if (inspection.reason === "empty_data" || inspection.reason === "missing_data") return false;

    let scope;
    try { scope = accountScope(config.yingceApiUrl, user.id); }
    catch { return false; }
    const accountDir = path.join(runtimePaths.root, "accounts", scope);
    if (fs.existsSync(accountDir) || hasImportedLegacyProfile({ root: runtimePaths.root, safeStorage })) return false;

    if (!inspection.available) {
        await dialog.showMessageBox(mainWindow || undefined, {
            type: "warning",
            title: "旧版本地资料无法导入",
            message: "发现旧版本地创作资料，但本地账户凭据缺失，无法安全导入。",
            detail: "旧档案仍保留在客户端数据目录；继续登录不会上传或删除它。",
            buttons: ["继续登录"],
            defaultId: 0,
        });
        return false;
    }

    const accountName = user.displayName || user.username || "当前影策账号";
    const choice = await dialog.showMessageBox(mainWindow || undefined, {
        type: "question",
        title: "旧版本地资料",
        message: `将旧版本地资料导入到“${accountName}”吗？`,
        detail: "导入会复制旧版本地数据库和资源到该影策账号的本机分区，并验证本地账户凭据。原档案保持不变；项目、对话和结果不会上传到云端。选择不导入后，此账号会创建新的本地分区。",
        buttons: ["保留旧资料并继续", "导入到当前账号"],
        defaultId: 0,
        cancelId: 0,
    });
    if (choice.response !== 1 || revision !== liteAccountRevision) return false;

    const legacySourceScope = await readLegacyBrowserScope();
    const resources = resolveResources();
    try {
        const imported = await importLegacyProfile({
            root: runtimePaths.root,
            dataDir: runtimePaths.data,
            scope,
            activation: config.activation,
            legacySourceScope,
            safeStorage,
            copyVerified,
            isCurrent: () => revision === liteAccountRevision && !quitting,
            verify: async ({ dataDir, credentials }) => {
                const validationBackend = new BackendProcess(resources.backendExe, dataDir, runtimePaths.logs);
                try {
                    const baseUrl = await validationBackend.start();
                    await authenticateLocalBackend({ baseUrl, credentials });
                } finally {
                    await validationBackend.stop();
                }
            },
        });
        console.log(`[account] imported legacy profile into local scope ${imported.scope}`);
        return true;
    } catch (error) {
        await dialog.showMessageBox(mainWindow || undefined, {
            type: "error",
            title: "旧版本地资料导入失败",
            message: "导入没有完成，原档案保持不变。",
            detail: error instanceof Error ? error.message : "请重试或联系支持人员。",
            buttons: ["返回"],
        });
        throw error;
    }
}

function enterLiteWorkspace() {
    const candidate = liteStack;
    if (!candidate || !localServer || quitting) return false;
    setTimeout(() => {
        if (liteStack !== candidate || quitting || !localServer) return;
        switchingWindows = true;
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
        mainWindowScope = candidate.scope;
        openMainWindow(localServer.url, candidate.legacyProfile ? undefined : `persist:lite-${candidate.scope}`);
        switchingWindows = false;
    }, 0);
    return true;
}

async function logoutLite() {
    if (liteLogoutInFlight?.revision === liteAccountRevision) return liteLogoutInFlight.promise;
    const revision = ++liteAccountRevision;
    const promise = (async () => {
        const results = await Promise.allSettled([liteLifecycle?.deactivate(), yingceClient.logout()]);
        try {
            const failure = results.find((result) => result.status === "rejected");
            if (failure) throw failure.reason;
            return results[1].value;
        } finally {
            if (revision === liteAccountRevision && !quitting && localServer && !liteStack) openMainWindow(`${localServer.url}/peekreel-activation`);
        }
    })();
    liteLogoutInFlight = { revision, promise };
    try { return await promise; }
    finally { if (liteLogoutInFlight?.promise === promise) liteLogoutInFlight = null; }
}

function bridgeInfo() {
    if (!bridge || !["ready", "login-needed"].includes(bridge.status.phase)) return null;
    return { baseUrl: bridge.baseUrl, adminToken: bridge.adminToken };
}

async function ensureDoubaoBrowserHost() {
    if (!doubaoBrowserHost) {
        doubaoBrowserHost = new DoubaoBrowserHost({
            BrowserWindow,
            userDataDir: runtimePaths.root,
            devToolsFile: path.join(runtimePaths.root, "DevToolsActivePort"),
            logger: console,
        });
    }
    if (doubaoBrowserHost.info) return doubaoBrowserHost.info;
    if (!doubaoBrowserHostStarting) {
        const current = doubaoBrowserHost;
        doubaoBrowserHostStarting = current.start().finally(() => { doubaoBrowserHostStarting = null; });
    }
    return doubaoBrowserHostStarting;
}

function syncLocalChannels() {
    channelSyncQueue = channelSyncQueue.then(async () => {
        if (smokeTest || quitting || !localServer || !backend) return { skipped: "unavailable" };
        const info = bridgeInfo();
        return syncDirectChannelsAtBoot({
            backendBaseUrl: backend.baseUrl, catalogUrl: config.directChannelsUrl,
            relayUrl: config.relayUrl, activation: config.activation,
            localChannels: info ? { doubao: { baseUrl: info.baseUrl, apiKey: info.adminToken } } : undefined,
            activationDir: resolveResources().activationDir,
            log: (text) => console.log(`[direct-channels] ${text}`),
        });
    }).catch((error) => {
        console.error(`[direct-channels] ${error.message}`);
        return { skipped: "failed" };
    });
    return channelSyncQueue;
}

function startBridge(resources, allowedOrigin = localServer?.url) {
    const current = new DoubaoBridgeProcess(resources.doubaoBridgeDir, runtimePaths.logs, path.join(runtimePaths.profiles, "acct1"), {
        dataDir: runtimePaths.bridgeData, profileDir: runtimePaths.profiles,
        allowedOrigin,
        getBrowserHostInfo: ensureDoubaoBrowserHost,
        getToken: () => config.doubaoBridgeToken,
        saveToken: (token) => { config.doubaoBridgeToken = token; saveConfig(app, config); },
        onStatus: (status) => {
            if (quitting || bridge !== current) return;
            for (const win of BrowserWindow.getAllWindows()) {
                if (!win.isDestroyed()) win.webContents.send("doubao:bridge-status", status);
            }
            if (["ready", "login-needed"].includes(status.phase)) {
                startupMetric("bridge-ready");
                syncLocalChannels();
            }
        },
    });
    bridge = current;
    void current.start().catch((error) => {
        console.error(`[doubao-bridge] ${error.message}`);
        if (!quitting && bridge === current) current.scheduleRestart();
    });
}

function openSplash() {
    const resources = resolveResources();
    if (!fs.existsSync(resources.splash)) return;
    splashWindow = new BrowserWindow({
        width: 320,
        height: 320,
        frame: false,
        transparent: true,
        resizable: false,
        center: true,
        show: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: "startup-splash" },
    });
    splashWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(splashHtml(resources.splash)));
}

function splashHtml(imagePath) {
    // 闪屏图以 base64 内嵌：安装路径含空格（如 D:\PeekReel Lite）时 file:// 拼接会加载失败。
    const image = fs.readFileSync(imagePath).toString("base64");
    return `<!DOCTYPE html><html><head><style>
      html,body{margin:0;height:100%;background:transparent;display:flex;align-items:center;justify-content:center}
      img{width:180px;height:180px;border-radius:36px;-webkit-app-region:no-drag}
      p{position:fixed;bottom:26px;width:100%;text-align:center;color:#9a9aa4;font:12px "Segoe UI","Microsoft YaHei",sans-serif}
    </style></head><body><img src="data:image/png;base64,${image}"/><p>正在启动 ${APP_NAME}…</p></body></html>`;
}

function closeSplash() {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
    }
    splashWindow = null;
}

function openMainWindow(appUrl, partition) {
    if (mainWindow) {
        void mainWindow.loadURL(appUrl);
        mainWindow.show();
        mainWindow.focus();
        return;
    }
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        show: false,
        backgroundColor: "#101014",
        title: APP_NAME,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            ...(partition ? { partition } : {}),
        },
    });
    const window = mainWindow;
    window.once("ready-to-show", () => {
        startupMetric("window-visible");
        if (!window.isDestroyed()) window.show();
        closeSplash();
    });
    window.on("closed", () => {
        if (mainWindow === window) mainWindow = null;
    });
    // 关闭 = 最小化到托盘；真正退出走托盘菜单或 before-quit。
    mainWindow.on("close", (event) => {
        if (!quitting && tray) {
            event.preventDefault();
            window.hide();
        }
    });

    if (smokeTest) {
        mainWindow.webContents.once("did-finish-load", () => {
            const title = mainWindow.webContents.getTitle();
            finishSmoke(true, `${appUrl} "${title}"`);
        });
        mainWindow.webContents.once("did-fail-load", (_event, code, description) => {
            finishSmoke(false, `load-failed code=${code} ${description || ""}`);
        });
    }

    // 新窗口一律交给系统浏览器（控制台、分享页等）。
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:/i.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });

    window.loadURL(appUrl).catch(() => {
        if (mainWindow === window && !window.isDestroyed() && !quitting) showErrorPage("页面加载失败");
    });

    if (config.updateFeed && !updateTimerStarted) {
        updateTimerStarted = true;
        checkForUpdates(false);
        // 周期复查（Joplin 节奏）：长驻会话也能在半天内发现新版本，配合退出自动安装实现无感。
        setInterval(() => checkForUpdates(false), 12 * 60 * 60 * 1000);
    }
}

function createTray(trayIconPath) {
    if (!fs.existsSync(trayIconPath)) return;
    tray = new Tray(nativeImage.createFromPath(trayIconPath));
    tray.setToolTip(`${APP_NAME} — 本地服务运行中`);
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: "打开主窗口", click: () => showMainWindow() },
            { label: "打开数据目录", click: () => shell.openPath(path.join(app.getPath("userData"), "data")) },
            { label: "打开日志目录", click: () => shell.openPath(path.join(app.getPath("userData"), "logs")) },
            { type: "separator" },
            {
                label: "退出",
                click: () => {
                    app.quit();
                },
            },
        ])
    );
    tray.on("click", () => showMainWindow());
}

function showMainWindow() {
    if (!mainWindow) {
        if (localServer && isLite && liteStack) {
            mainWindowScope = liteStack.scope;
            openMainWindow(localServer.url, liteStack.legacyProfile ? undefined : `persist:lite-${liteStack.scope}`);
        } else if (localServer) openMainWindow(`${localServer.url}/peekreel-activation`);
        return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

function showErrorPage(detail) {
    closeSplash();
    if (smokeTest) {
        finishSmoke(false, detail);
        return;
    }
    // 启动失败不代表不能更新：坏版本靠在线更新自愈的唯一入口。
    if (config.updateFeed) checkForUpdates(false);
    if (!mainWindow) {
        mainWindow = new BrowserWindow({
            width: 560,
            height: 460,
            show: true,
            webPreferences: {
                preload: path.join(__dirname, "preload.js"),
                contextIsolation: true,
                nodeIntegration: false,
                sandbox: true,
            },
        });
        mainWindow.on("closed", () => {
            mainWindow = null;
        });
    }
    const file = "file://" + path.join(__dirname, "..", "offline", "index.html").replace(/\\/g, "/");
    mainWindow.loadURL(file).then(() => {
        mainWindow.webContents
            .executeJavaScript(`window.__ERROR_DETAIL__ = ${JSON.stringify(detail)};`)
            .catch(() => {});
    }).catch(() => {});
}

// 账户与充值窗口：单例，加载激活页的 ?account=1 模式（余额/兑换码/令牌状态）。
function openAccountWindow() {
    if (isLite) {
        if (!liteStack) { showMainWindow(); return true; }
        const candidate = liteStack;
        void dialog.showMessageBox({
            type: "question", title: "影策账号", message: "退出当前影策账号？",
            detail: "退出后需要重新登录才能访问当前账号的本地作品。",
            buttons: ["取消", "退出账号"], defaultId: 0, cancelId: 0,
        }).then(({ response }) => {
            if (response === 1 && liteStack === candidate) return logoutLite();
        }).catch((error) => console.error(`[account] ${error.message}`));
        return true;
    }
    if (!localServer) return false;
    if (accountWindow) {
        if (accountWindow.isMinimized()) accountWindow.restore();
        accountWindow.show();
        accountWindow.focus();
        return true;
    }
    accountWindow = new BrowserWindow({
        width: 460,
        height: 680,
        minWidth: 400,
        minHeight: 560,
        backgroundColor: "#0B0B0F",
        title: "账户与充值",
        parent: mainWindow || undefined,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    });
    accountWindow.on("closed", () => {
        accountWindow = null;
    });
    accountWindow.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("http")) shell.openExternal(url);
        return { action: "deny" };
    });
    accountWindow.loadURL(`${localServer.url}/peekreel-activation?account=1`).catch(() => {
        if (accountWindow) accountWindow.close();
    });
    return true;
}

function registerIpc() {
    if (isLite) {
        yingceClient = createYingceSessionClient({ apiUrl: config.yingceApiUrl, vault: createSessionVault({ directory: runtimePaths.root, safeStorage }) });
        desktopLogin = createDesktopLogin({ consoleUrl: config.consoleUrl, shell, client: yingceClient });
        registerYingceIpc({
            ipcMain,
            client: yingceClient,
            desktopLogin,
            getWindows: () => [mainWindow, accountWindow],
            getOrigin: () => localServer?.url,
            canGenerate: (event) => Boolean(liteStack && mainWindowScope === liteStack.scope && mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents),
            getAccountScope: () => liteStack.scope,
            getLegacyWorkspaceImport: () => liteStack?.legacyProfile ? { enabled: true, sourceScope: liteStack.legacySourceScope } : { enabled: false },
            journal: createGenerationJournal(runtimePaths.root),
            activate: activateLiteAccount,
            logout: logoutLite,
            enter: enterLiteWorkspace,
        });
    }
    ipcMain.handle("app:retry", async () => {
        if (retryingApp || quitting) return { ok: false, error: "正在重启服务" };
        retryingApp = true;
        // 重试 = 完整重启本地栈：停后端、重新拉起、重载页面。
        try {
            if (isLite && liteLifecycle) {
                await liteLifecycle.deactivate();
                liteLifecycle = null;
            } else if (backend) await backend.stop();
            backend = null;
            if (bridge && !isLite) await bridge.stop();
            bridge = null;
            if (localServer) {
                const server = localServer.server;
                server.closeAllConnections();
                await new Promise((resolve) => server.close(resolve));
            }
            localServer = null;
            await startApp();
            return { ok: true };
        } catch (error) {
            showErrorPage(error.message);
            return { ok: false, error: error.message };
        } finally { retryingApp = false; }
    });

    // 豆包桥连接信息：桌面托管令牌与实际端口交给自家 UI（仅本机回环桥）。
    // 完成提示音：用系统 beep，不走渲染进程的 WebAudio。
    // 原因（2026-11-11 实测）：页面只要 new AudioContext() 一次，Chromium 就会拉起
    // audio.mojom.AudioService 子进程，常驻 103 MB——为一声「叮」付 7% 的内存不划算。
    // 系统 beep 由主进程直接发声，渲染进程不再持有任何音频上下文。
    // 成功 = 一声；失败 = 两声（短间隔），仍然可区分但不需要音调合成。
    ipcMain.handle("app:beep", (_event, kind) => {
        const times = kind === "error" ? 2 : 1;
        for (let i = 0; i < times; i += 1) {
            setTimeout(() => {
                try { shell.beep(); } catch { /* 无音频设备时静默 */ }
            }, i * 220);
        }
        return true;
    });

    const requireBridgeCaller = (event) => {
        if (!isTrustedMainFrame(event, mainWindow, localServer?.url)) throw new Error("Untrusted bridge IPC caller");
    };
    ipcMain.handle("doubao:bridge-info", (event) => {
        requireBridgeCaller(event);
        return localServer ? { baseUrl: `${localServer.url}/doubao-bridge`, adminToken: "" } : null;
    });
    ipcMain.handle("doubao:bridge-status", (event) => { requireBridgeCaller(event); return bridge?.status || { phase: "preparing" }; });
    ipcMain.handle("doubao:bridge-retry", async (event) => {
        requireBridgeCaller(event);
        if (quitting || retryingBridge || retryingApp) return false;
        retryingBridge = true;
        try {
            if (isLite) {
                const candidate = liteStack;
                return candidate ? await candidate.retryBridge() : false;
            }
            if (bridge) await bridge.stop();
            if (quitting) return false;
            startBridge(resolveResources());
            return true;
        } finally { retryingBridge = false; }
    });

    ipcMain.handle("app:open-data-dir", () => {
        shell.openPath(path.join(app.getPath("userData"), "data"));
        return true;
    });

    ipcMain.handle("app:open-log-dir", () => {
        shell.openPath(path.join(app.getPath("userData"), "logs"));
        return true;
    });

    ipcMain.handle("app:check-update", () => checkForUpdates(true));
    // 页内更新提示：渲染层查询当前状态 / 触发静默安装（激活页横幅使用）。
    ipcMain.handle("app:get-update-state", () => updateState);
    ipcMain.handle("app:apply-update", async () => {
        await installDownloadedUpdate();
        return true;
    });

    // ===== PeekReel 激活流 =====
    ipcMain.handle("peekreel:activation-get", () => isLite ? null : config.activation || null);

    ipcMain.handle("peekreel:sync-local-channels", (event) => {
        if (!isTrustedMainFrame(event, mainWindow, localServer?.url) &&
            !isTrustedMainFrame(event, accountWindow, localServer?.url)) throw new Error("Untrusted channel sync caller");
        return isLite ? liteStack?.sync() : syncLocalChannels();
    });

    ipcMain.handle("peekreel:activation-save", (_event, state) => {
        if (isLite) throw new Error("旧激活流程不可用");
        config.activation = {
            username: String(state.username || ""),
            password: String(state.password || ""),
            apiKey: String(state.apiKey || ""),
            activatedAt: Number(state.activatedAt) || 0,
            passportUsername: String(state.passportUsername || ""),
            passportPassword: String(state.passportPassword || ""),
        };
        saveConfig(app, config);
        return true;
    });

    ipcMain.handle("peekreel:activation-clear", () => {
        if (isLite) throw new Error("旧激活流程不可用");
        config.activation = null;
        saveConfig(app, config);
        return true;
    });

    ipcMain.handle("peekreel:open-console", () => {
        if (config.consoleUrl) shell.openExternal(config.consoleUrl);
        return true;
    });

    ipcMain.handle("peekreel:open-account", () => openAccountWindow());

    // 数据冲突恢复：清空本地数据后重启，重新走首运行激活。
    ipcMain.handle("peekreel:reset-data", async () => {
        if (isLite) throw new Error("此操作不适用于影策账号");
        quitting = true;
        if (backend) await backend.stop();
        if (bridge) await bridge.stop();
        if (doubaoBrowserHost) await doubaoBrowserHost.stop();
        const dataDir = path.join(app.getPath("userData"), "data");
        try {
            fs.rmSync(dataDir, { recursive: true, force: true });
        } catch (error) {
            app.exit(1);
            throw new Error(`清理本地数据失败：${error.message}`);
        }
        config.activation = null;
        saveConfig(app, config);
        app.relaunch();
        app.exit(0);
        return true;
    });
}

function buildMenu() {
    const devtoolsVisible = config.allowDevtools || !app.isPackaged;
    const menu = Menu.buildFromTemplate([
        {
            label: "文件",
            submenu: [
                { label: isLite ? "影策账号" : "账户与充值", click: () => openAccountWindow() },
                {
                    // 渠道与模型管理（直连渠道、模型启停）。
                    label: "渠道与模型",
                    click: () => {
                        if (mainWindow && localServer) {
                            mainWindow.show();
                            mainWindow.loadURL(`${localServer.url}/admin/channels`).catch(() => {});
                        }
                    },
                },
                { type: "separator" },
                { label: "打开数据目录", click: () => shell.openPath(path.join(app.getPath("userData"), "data")) },
                { label: "打开日志目录", click: () => shell.openPath(path.join(app.getPath("userData"), "logs")) },
                { type: "separator" },
                { role: "quit", label: "退出" },
            ],
        },
        {
            label: "视图",
            submenu: [
                { role: "reload", label: "重新加载" },
                { role: "forceReload", label: "强制重新加载" },
                { role: "toggleDevTools", label: "开发者工具", visible: devtoolsVisible },
                { type: "separator" },
                { role: "resetZoom", label: "实际大小" },
                { role: "zoomIn", label: "放大" },
                { role: "zoomOut", label: "缩小" },
                { role: "togglefullscreen", label: "全屏" },
            ],
        },
        {
            label: "帮助",
            submenu: [
                { label: "检查更新", click: () => checkForUpdates(true) },
                {
                    label: pendingUpdateVersion
                        ? `重启以更新到 v${pendingUpdateVersion}`
                        : "重启以更新",
                    visible: Boolean(pendingUpdateVersion),
                    click: () => {
                        installDownloadedUpdate().catch((error) => dialog.showErrorBox("更新失败", error.message));
                    },
                },
                {
                    label: `${APP_NAME} 控制台`,
                    click: () => {
                        if (config.consoleUrl) shell.openExternal(config.consoleUrl);
                    },
                },
                {
                    label: "关于",
                    click: () => {
                        dialog.showMessageBox({
                            type: "info",
                            title: `关于 ${APP_NAME}`,
                            message: `${APP_NAME} ${app.getVersion()}`,
                            detail: `本地优先的 AI 影视创作工作台\n数据目录：${path.join(app.getPath("userData"), "data")}`,
                        });
                    },
                },
            ],
        },
    ]);
    Menu.setApplicationMenu(menu);
}

function checkForUpdates(interactive) {
    if (!config.updateFeed) {
        if (interactive) {
            dialog.showMessageBox({ type: "info", title: "检查更新", message: "未配置更新源" });
        }
        return Promise.resolve({ ok: false, reason: "no-feed" });
    }
    try {
        const autoUpdater = getInstallationUpdater(runtimePaths.updates);
        autoUpdater.setFeedURL({ provider: "generic", url: config.updateFeed });
        // 下载接管：electron-updater 的差分与全量都走单 TCP 连接，跨境被限到几十 KB/s；
        // 先用 6 连接分块预取到它的缓存（sha512 一致即复用），关 autoDownload 防止双下载。
        // 预取失败自动回退 updater 原生路径。
        autoUpdater.autoDownload = false;
        autoUpdater.autoInstallOnAppQuit = true;
        // 更新必须装回当前运行目录（否则 NSIS 会落到默认目录，用户 D 盘安装会漂到 C 盘）。
        // 注意：属性初始为 undefined，不能用存在性判断，直接无条件赋值。
        try {
            autoUpdater.installDirectory = path.dirname(app.getPath("exe"));
        } catch {
            // 非 NSIS 平台无此属性，忽略。
        }
        // 下载流程：版本检查 → 并行预取（页内横幅显示进度）→ 预取完成调 downloadUpdate
        // （缓存命中时 updater 仅做校验不走网络）→ update-downloaded → 退出自动装/一键重启。
        async function downloadViaPrefetch(updateInfo) {
            updateState = { phase: "downloading", version: updateInfo.version, percent: 0 };
            broadcastUpdateState();
            const helper = await autoUpdater.getOrCreateDownloadHelper();
            await prefetchUpdateInstaller(config.updateFeed, updateInfo, (percent) => {
                updateState = { phase: "downloading", version: updateInfo.version, percent };
                broadcastUpdateState();
            }, helper.cacheDir);
            autoUpdater.downloadUpdate().catch(() => { /* 错误由 error 事件统一处理 */ });
        }
        // 监听器只注册一次（checkForUpdates 会被启动/错误页/菜单多处调用）。
        if (!updateListenerAttached) {
            updateListenerAttached = true;
            autoUpdater.on("update-available", (info) => {
                if (downloadInFlight) return; // 周期检查与手动检查并发时只跑一次
                downloadInFlight = true;
                downloadViaPrefetch(info).finally(() => { downloadInFlight = false; });
            });
            autoUpdater.on("download-progress", (progress) => {
                // 预取失败回退 updater 原生下载时才有原生进度；预取路径则由 downloadViaPrefetch 推送。
                if (updateState && updateState.phase === "downloading" && updateState.percent >= 100) return;
                updateState = { phase: "downloading", version: updateState ? updateState.version : "", percent: Math.round(progress.percent) };
                broadcastUpdateState();
            });
            autoUpdater.on("update-downloaded", (event) => {
                updateState = { phase: "ready", version: event.version, percent: 100 };
                pendingUpdateVersion = event.version;
                buildMenu(); // 菜单点亮"重启以更新"（VS Code 式非阻塞提示）
                broadcastUpdateState();
                // 系统通知：可选补充（权限被拒时页内横幅仍在，不阻塞更新）
                try {
                    const notify = new Notification({
                        title: `${APP_NAME} 可用更新`,
                        body: `新版本 v${event.version} 已就绪：退出时自动安装，或点此立即重启生效。`,
                    });
                    notify.on("click", () => {
                        installDownloadedUpdate().catch((error) => dialog.showErrorBox("更新失败", error.message));
                    });
                    notify.show();
                } catch {
                    // 通知权限被拒等场景：页内横幅与菜单项提示仍在。
                }
            });
        }
        // CDN 源失败（tunnel 抖动/域名被墙）时回退旧直连源重查一次；成功则本会话固定用回退源。
        const feed = config.updateFeed;
        const fallback = config.updateFeedFallback;
        return autoUpdater
            .checkForUpdates()
            .then(() => ({ ok: true }))
            .catch((error) => {
                if (fallback && fallback !== feed) {
                    console.warn(`[update] 主更新源失败（${error.message}），回退 ${fallback}`);
                    config.updateFeed = fallback;
                    autoUpdater.setFeedURL({ provider: "generic", url: fallback });
                    return autoUpdater
                        .checkForUpdates()
                        .then(() => ({ ok: true, fallbackFeed: true }))
                        .catch((fallbackError) => reportUpdateFailure(fallbackError, interactive, fallbackError.message));
                }
                return reportUpdateFailure(error, interactive, error.message);
            });
    } catch (error) {
        return Promise.resolve({ ok: false, reason: error.message });
    }
}

function reportUpdateFailure(error, interactive, message) {
    if (interactive) {
        dialog.showMessageBox({
            type: "warning",
            title: "检查更新",
            message: `检查更新失败：${message}`,
        });
    }
    return { ok: false, reason: message };
}
