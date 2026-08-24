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
        runtime: { label: "settings:not-checked-yet", action: "refresh" },
        dreamina: { label: "settings:detected-automatically-once-the-local-service-connects", action: null },
    });

    const reconnect = present({
        connection: "origin_not_trusted",
        moduleAvailable: false,
        dreamina: undefined,
    });
    expect(reconnect).toMatchObject({
        runtime: { label: "settings:reconnect-required", action: "refresh", actionLabel: "settings:reconnect" },
        dreamina: { label: "settings:detected-automatically-once-the-local-service-connects", action: null },
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
        runtime: { label: "settings:connected", action: "refresh" },
        dreamina: { label: "settings:not-signed-in", action: "login" },
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
        label: "settings:signed-in",
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
    expect(authenticated.dreamina.creditObservedAtLabel).toBe("settings:credits-last-refreshed-param");

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
    expect(source.match(/official-cli-credentials-stay-on-this-machine-this-page-never-reads-or-u/g)).toHaveLength(1);
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
    runtimeTitle: "settings:local-connection",
    runtimeConnected: "settings:local-service-connected-cli-status-syncs-automatically",
    runtimeDetecting: "settings:detecting-local-service-make-sure-the-current-version-is-running",
    runtimeReconnect: "settings:reconnect",
    runtimeSafety: "settings:official-cli-credentials-stay-on-this-machine-this-page-never-reads-or-u",
    runtimeRefresh: "settings:refresh-status",
    dreaminaDescription: "settings:reads-the-official-dreamina-cli-sign-in-status-for-the-current-windows-u",
    dreaminaDisconnected: "settings:detected-automatically-once-the-local-service-connects",
    dreaminaDisconnectedMessage: "settings:the-official-cli-status-is-read-automatically-after-reconnecting-the-loc",
    dreaminaMembership: "settings:account-generation-permission-unknown-this-page-only-verifies-adapter-su",
    dreaminaConsistency: "settings:task-states-are-synced-by-backend-polling-not-pushed-in-real-time-closin",
    dreaminaCancel: "settings:the-official-dreamina-cli-offers-no-cancel-command-accepted-tasks-keep-s",
    dreaminaAccountSwitch: "settings:do-not-switch-dreamina-cli-accounts-in-other-apps-while-local-tasks-run",
    dreaminaRefresh: "settings:refresh-status",
} as const;
