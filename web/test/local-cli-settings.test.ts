import { expect, test } from "bun:test";

test("Local CLI settings automatically connects without any browser-confirmation flow or connection secrets", async () => {
    const module = await import("../src/pages/settings/local-cli-settings").catch(() => ({}));
    const present = (
        module as {
            localCliSettingsPresentation?: typeof presentationContract;
        }
    ).localCliSettingsPresentation;
    const copy = (
        module as {
            LOCAL_CLI_SETTINGS_COPY?: typeof compactCopyContract;
        }
    ).LOCAL_CLI_SETTINGS_COPY;
    expect(typeof present).toBe("function");
    expect(copy).toEqual(compactCopyContract);
    expect("openLocalRuntimePairing" in module).toBe(false);
    if (!present) return;

    const obsoleteConnectionState = present({
        connection: "obsolete_browser_confirmation",
        moduleAvailable: false,
        dreamina: undefined,
    });
    expect(obsoleteConnectionState).toMatchObject({
        runtime: { label: "尚未检测", action: "refresh" },
        dreamina: { label: "连接本机服务后自动检测", action: null },
    });

    const reconnect = present({
        connection: "origin_not_trusted",
        moduleAvailable: false,
        dreamina: undefined,
    });
    expect(reconnect).toMatchObject({
        runtime: { label: "需要重新连接", action: "refresh", actionLabel: "重新连接" },
        dreamina: { label: "连接本机服务后自动检测", action: null },
    });

    const installed = present({
        connection: "connected",
        moduleAvailable: true,
        dreamina: {
            provider: "dreamina-cli",
            state: "installed",
            installed: true,
            authenticated: false,
            code: "dreamina_login_required",
            message: "Dreamina CLI 已安装，需要登录",
            version: "1.2.3",
        },
    });
    expect(installed).toMatchObject({
        runtime: { label: "已连接", action: "refresh" },
        dreamina: { label: "未登录", action: "login" },
    });

    const authenticated = present({
        connection: "connected",
        moduleAvailable: true,
        dreamina: {
            provider: "dreamina-cli",
            state: "authenticated",
            installed: true,
            authenticated: true,
            message: "Dreamina CLI 已登录",
            totalCredit: 24_940,
        },
    });
    expect(authenticated.dreamina).toMatchObject({
        label: "已登录",
        action: "logout",
    });
    expect(authenticated.dreamina.creditLabel).toBeUndefined();

    const serialized = JSON.stringify([obsoleteConnectionState, installed, authenticated]);
    expect(serialized).not.toContain("endpoint");
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("session");
});

test("Dreamina model and credit cache scope follows accountBinding plus sessionEpoch and credits expose observedAt", async () => {
    const modelStore = await import("../src/stores/use-local-dreamina-model-store").catch(() => ({}));
    const scopeKey = (
        modelStore as {
            dreaminaModelCacheScopeKey?: (scope: { accountBinding: string; sessionEpoch: number }) => string;
        }
    ).dreaminaModelCacheScopeKey;
    expect(typeof scopeKey).toBe("function");
    if (scopeKey) {
        expect(scopeKey({ accountBinding: "account-binding-a", sessionEpoch: 7 })).toBe("account-binding-a:7");
        expect(scopeKey({ accountBinding: "account-binding-a", sessionEpoch: 8 })).not.toBe(scopeKey({ accountBinding: "account-binding-a", sessionEpoch: 7 }));
        expect(scopeKey({ accountBinding: "account-binding-b", sessionEpoch: 7 })).not.toBe(scopeKey({ accountBinding: "account-binding-a", sessionEpoch: 7 }));
    }

    const settings = await import("../src/pages/settings/local-cli-settings").catch(() => ({}));
    const present = (
        settings as {
            localCliSettingsPresentation?: (input: {
                connection: string;
                moduleAvailable: boolean;
                timeZone?: string;
                dreamina?: {
                    provider: "dreamina-cli";
                    state: "authenticated";
                    installed: true;
                    authenticated: true;
                    message: string;
                    totalCredit: number;
                    creditObservedAt: string;
                    accountBinding: string;
                    sessionEpoch: number;
                };
            }) => { dreamina: { creditLabel?: string; creditObservedAtLabel?: string } };
        }
    ).localCliSettingsPresentation;
    expect(typeof present).toBe("function");
    if (!present) return;
    const authenticated = present({
        connection: "connected",
        moduleAvailable: true,
        timeZone: "Asia/Shanghai",
        dreamina: {
            provider: "dreamina-cli",
            state: "authenticated",
            installed: true,
            authenticated: true,
            message: "Dreamina CLI 已登录",
            totalCredit: 24_940,
            creditObservedAt: "2026-08-13T12:34:56.000Z",
            accountBinding: "account-binding-a",
            sessionEpoch: 7,
        },
    });
    expect(authenticated.dreamina.creditLabel).toBe("即梦积分 24,940");
    expect(authenticated.dreamina.creditObservedAtLabel).toBe("上次刷新积分 20:34");

    const invalidObservedAt = present({
        connection: "connected",
        moduleAvailable: true,
        timeZone: "Asia/Shanghai",
        dreamina: {
            provider: "dreamina-cli",
            state: "authenticated",
            installed: true,
            authenticated: true,
            message: "Dreamina CLI 已登录",
            totalCredit: 24_940,
            creditObservedAt: "not-an-iso-time",
            accountBinding: "account-binding-a",
            sessionEpoch: 7,
        },
    });
    expect(invalidObservedAt.dreamina.creditLabel).toBeUndefined();
    expect(invalidObservedAt.dreamina.creditObservedAtLabel).toBeUndefined();
});

test("Local CLI settings keeps the Runtime compact and uses the official Dreamina CLI copy", async () => {
    const module = await import("../src/pages/settings/local-cli-settings").catch(() => ({}));
    const copy = (
        module as {
            LOCAL_CLI_SETTINGS_COPY?: typeof compactCopyContract;
        }
    ).LOCAL_CLI_SETTINGS_COPY;
    expect(copy).toEqual(compactCopyContract);

    const source = await Bun.file(new URL("../src/pages/settings/local-cli-settings.tsx", import.meta.url)).text();
    expect(source.match(/void connect\(controller\.signal\)/g)).toHaveLength(1);
    expect(source).not.toContain("runtimeController");
    expect(source).toContain('void runDreamina("refresh")');
    expect(source.match(/官方 CLI 登录资料保存在本机；本页面不读取或上传 Cookie、浏览器 Profile 或登录令牌。/g)).toHaveLength(1);
    expect(source.match(/LOCAL_CLI_SETTINGS_COPY\.dreaminaAccountSwitch/g)).toHaveLength(1);
    expect(source).not.toContain("dreaminaSafety");
    expect(source).not.toContain("Framefield 不读取或上传 Cookie、浏览器 Profile 或登录令牌。");
    expect(source).not.toContain("无需重复授权");
    expect(source).not.toContain("runtime?.version");
    expect(source).not.toContain("自动发现本机 Framefield Runtime");
    expect(source).not.toContain("Canvas 与 OAuth CLI 共用同一个进程");
    expect(source).not.toContain("当前浏览器密钥自动重连");
    expect(source).not.toContain("页面未授权，以页面发起/完成授权为准");

    const architecture = await Bun.file(new URL("../../canvas-agent/README.md", import.meta.url)).text();
    expect(architecture).toContain("外部程序直接切换 Dreamina CLI 账号无法被本应用实时观测");
    expect(architecture).toContain("官方 CLI 的 argv 可能被同一 OS 用户通过进程列表看到");
    expect(architecture).toContain("prompt、receipt 或本地路径");
});

test("settings route recognizes local-cli as a first-class section", async () => {
    const module = await import("../src/pages/settings");
    const isConfigSection = (module as { isConfigSection?: (value: string | null) => boolean }).isConfigSection;
    expect(typeof isConfigSection).toBe("function");
    if (!isConfigSection) return;

    expect(isConfigSection("local-cli")).toBe(true);
    expect(isConfigSection("local-runtime-token")).toBe(false);
});

test("model settings and Create subscribe to the same effective Runtime catalog after first render", async () => {
    const settingsSource = await Bun.file(new URL("../src/pages/settings/index.tsx", import.meta.url)).text();
    const createSource = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();

    expect(settingsSource).toContain("useEffectiveConfig");
    expect(settingsSource).toContain("<ModelDefaultGrid config={effectiveConfig}");
    expect(createSource).toContain("const config = useEffectiveConfig()");
});

type PresentationInput = {
    connection: string;
    moduleAvailable: boolean;
    dreamina?: {
        provider: "dreamina-cli";
        state: "missing" | "installed" | "login_pending" | "authenticated" | "error";
        installed: boolean;
        authenticated: boolean;
        code?: string;
        message: string;
        version?: string;
        totalCredit?: number;
        accountBinding?: string;
        sessionEpoch?: number;
        creditObservedAt?: string;
    };
};

type PresentationResult = {
    runtime: { label: string; action: string | null; actionLabel?: string };
    dreamina: { label: string; action: string | null; creditLabel?: string; creditObservedAtLabel?: string };
};

declare function presentationContract(input: PresentationInput): PresentationResult;

const compactCopyContract = {
    runtimeTitle: "本机连接",
    runtimeConnected: "本机服务已连接，CLI 状态会自动同步。",
    runtimeDetecting: "正在检测本机服务；请确认已启动当前版本。",
    runtimeReconnect: "重新连接",
    runtimeSafety: "官方 CLI 登录资料保存在本机；本页面不读取或上传 Cookie、浏览器 Profile 或登录令牌。",
    runtimeRefresh: "刷新状态",
    dreaminaDescription: "直接读取当前 Windows 用户的官方即梦 CLI 登录状态。",
    dreaminaDisconnected: "连接本机服务后自动检测",
    dreaminaDisconnectedMessage: "重新连接本机服务后，将自动读取官方 CLI 状态。",
    dreaminaMembership: "账号生成权限：未知。当前页面只确认本机适配器支持与登录状态；具体账号是否可生成，以官方最终结果为准。",
    dreaminaConsistency: "任务状态通过后台轮询最终同步，不是实时推送；关闭页面不会停止已经提交的官方任务。",
    dreaminaCancel: "官方 Dreamina CLI 当前不提供取消命令；官方已接受的任务只能转入后台继续同步，不能伪装成已取消。",
    dreaminaAccountSwitch: "本机任务运行期间，请不要在其他程序中切换 Dreamina CLI 账号；外部换号无法被本页面实时感知。",
    dreaminaRefresh: "刷新状态",
} as const;
