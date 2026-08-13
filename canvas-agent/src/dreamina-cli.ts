import crypto from "node:crypto";
import path from "node:path";

import { CONFIG_DIR } from "./config.js";
import { DreaminaCliArbiter, type DreaminaCliInvocationLease, type DreaminaCliSessionSnapshot } from "./dreamina-cli-arbiter.js";
import {
    discoverDreaminaExecutable,
    DreaminaCliError,
    runDreaminaProcess,
    type DreaminaProcessRequest,
    type DreaminaProcessResult,
} from "./dreamina-cli-process.js";

export type { DreaminaProcessRequest, DreaminaProcessResult } from "./dreamina-cli-process.js";

type DreaminaInstallation = { installed: true; executable: string } | { installed: false };
type DreaminaState = "missing" | "installed" | "login_pending" | "authenticated" | "error";
export type DreaminaPublicStatus = {
    provider: "dreamina-cli";
    state: DreaminaState;
    installed: boolean;
    authenticated: boolean;
    version?: string;
    totalCredit?: number;
    accountBinding?: string;
    sessionEpoch?: number;
    creditObservedAt?: string;
    code?: string;
    message: string;
    verificationUri?: string;
    userCode?: string;
    expiresAt?: string;
};

type PrivateLoginFlow = {
    verificationUri: string;
    userCode: string;
    deviceCode: string;
    expiresAt: number;
    version?: string;
};

export type DreaminaCliServiceOptions = {
    ownerId: string;
    env?: Record<string, string | undefined>;
    discover?: (signal?: AbortSignal) => Promise<DreaminaInstallation>;
    runProcess?: (request: DreaminaProcessRequest) => Promise<DreaminaProcessResult>;
    now?: () => Date;
    arbiter?: DreaminaCliArbiter;
    arbiterStateFile?: string;
};

export type DreaminaLifecycleOptions = { signal?: AbortSignal };

export class DreaminaCliService {
    private readonly env: Record<string, string | undefined>;
    private readonly discover: (signal?: AbortSignal) => Promise<DreaminaInstallation>;
    private readonly runProcess: (request: DreaminaProcessRequest) => Promise<DreaminaProcessResult>;
    private readonly now: () => Date;
    private readonly arbiter: DreaminaCliArbiter;
    private flow?: PrivateLoginFlow;
    private epoch = 0;
    private readonly activeControllers = new Set<AbortController>();

    constructor(options: DreaminaCliServiceOptions) {
        if (!/^[A-Za-z0-9._-]{16,120}$/.test(options.ownerId)) {
            throw new Error("Dreamina owner is invalid");
        }
        // ownerId intentionally validates the Runtime ownership boundary only. It never
        // enters CLI argv/env and therefore cannot select an account or CLI home.
        this.env = options.env ?? process.env;
        this.discover = options.discover ?? ((signal) => discoverDreaminaExecutable(this.env, signal));
        this.runProcess = options.runProcess ?? runDreaminaProcess;
        this.now = options.now ?? (() => new Date());
        this.arbiter = options.arbiter ?? new DreaminaCliArbiter({
            stateFile: path.resolve(options.arbiterStateFile ?? path.join(CONFIG_DIR, "dreamina-cli-arbiter.json")),
        });
    }

    status(options: DreaminaLifecycleOptions = {}): Promise<DreaminaPublicStatus> {
        return this.statusWithSession(options).then((result) => scopedPublicStatus(result.status, result.session, this.now()));
    }

    statusWithSession(options: DreaminaLifecycleOptions = {}): Promise<{ status: DreaminaPublicStatus; session: DreaminaCliSessionSnapshot }> {
        return this.readStatus(this.epoch, options.signal);
    }

    login(options: DreaminaLifecycleOptions = {}): Promise<DreaminaPublicStatus> {
        return this.startLogin(this.epoch, options.signal);
    }

    logout(options: DreaminaLifecycleOptions = {}): Promise<DreaminaPublicStatus> {
        const epoch = ++this.epoch;
        this.flow = undefined;
        for (const controller of this.activeControllers) controller.abort();
        return this.finishLogout(epoch, options.signal);
    }

    private async readStatus(epoch: number, signal?: AbortSignal): Promise<{ status: DreaminaPublicStatus; session: DreaminaCliSessionSnapshot }> {
        const context = await this.prepare(epoch, signal);
        if (!context.installed) return { status: missingStatus(), session: context.session };
        if (context.versionError) {
            return {
                status: publicStatus("error", true, false, context.version, "dreamina_version_failed", "已找到 Dreamina CLI，但版本检测失败"),
                session: context.session,
            };
        }
        if (this.flow && this.flow.expiresAt > this.now().getTime()) {
            const checked = await this.executeInvocation(
                context.executable,
                ["login", "checklogin", `--device_code=${this.flow.deviceCode}`, "--poll=0"],
                15_000,
                epoch,
                signal,
                async (result, lease) => result.exitCode === 0 ? this.ensureAuthenticatedSession(lease) : lease.session,
            );
            if (checked.result.exitCode === 0) {
                this.assertEpoch(epoch);
                this.flow = undefined;
                return {
                    status: publicStatus("authenticated", true, true, context.version, undefined, "Dreamina CLI 已登录"),
                    session: checked.session,
                };
            }
            return { status: this.publicFlow(context.version), session: checked.session };
        }
        this.assertEpoch(epoch);
        this.flow = undefined;
        const auth = await this.executeInvocation(
            context.executable,
            ["user_credit"],
            15_000,
            epoch,
            signal,
            async (result, lease) => {
                if (result.exitCode === 0) return this.ensureAuthenticatedSession(lease);
                return lease.session.accountBinding ? this.arbiter.advanceSession(lease) : lease.session;
            },
        );
        if (auth.result.exitCode === 0) {
            const status = publicStatus("authenticated", true, true, context.version, undefined, "Dreamina CLI 已登录");
            const totalCredit = parseTotalCredit(auth.result.stdout);
            return { status: totalCredit === undefined ? status : { ...status, totalCredit }, session: auth.session };
        }
        return {
            status: publicStatus("installed", true, false, context.version, "dreamina_login_required", "Dreamina CLI 已安装，需要登录"),
            session: auth.session,
        };
    }

    private async finishLogout(epoch: number, signal?: AbortSignal): Promise<DreaminaPublicStatus> {
        this.assertEpoch(epoch);
        assertLifecycleSignal(signal);
        const installation = await this.discover(signal);
        this.assertEpoch(epoch);
        assertLifecycleSignal(signal);
        if (!installation.installed) return missingStatus();
        const executed = await this.executeInvocation(
            installation.executable,
            ["logout"],
            15_000,
            epoch,
            signal,
            async (result, lease) => result.exitCode === 0 ? this.arbiter.advanceSession(lease) : lease.session,
        );
        if (executed.result.exitCode !== 0) {
            throw new DreaminaCliError("dreamina_logout_failed", "Dreamina 退出失败，请重试", 502);
        }
        return publicStatus(
            "installed",
            true,
            false,
            undefined,
            "dreamina_login_required",
            "Dreamina CLI 已退出登录",
        );
    }

    private async startLogin(epoch: number, signal?: AbortSignal) {
        this.assertEpoch(epoch);
        assertLifecycleSignal(signal);
        if (this.flow && this.flow.expiresAt > this.now().getTime()) return this.publicFlow();
        const context = await this.prepare(epoch, signal);
        if (!context.installed) {
            throw new DreaminaCliError("dreamina_missing", "未检测到 Dreamina CLI", 404);
        }
        if (context.versionError) {
            throw new DreaminaCliError("dreamina_version_failed", "Dreamina CLI 版本检测失败", 502);
        }
        const executed = await this.executeInvocation(
            context.executable,
            ["login", "--headless"],
            20_000,
            epoch,
            signal,
            async (result, lease) => result.exitCode === 0 ? this.arbiter.advanceSession(lease) : lease.session,
        );
        if (executed.result.exitCode !== 0) {
            throw new DreaminaCliError("dreamina_login_failed", "无法启动 Dreamina OAuth 登录", 502);
        }
        this.assertEpoch(epoch);
        this.flow = {
            ...parseLoginFlow(executed.result.stdout, this.now().getTime()),
            ...(context.version ? { version: context.version } : {}),
        };
        return this.publicFlow(context.version);
    }

    private async prepare(epoch: number, signal?: AbortSignal) {
        this.assertEpoch(epoch);
        assertLifecycleSignal(signal);
        const installation = await this.discover(signal);
        this.assertEpoch(epoch);
        assertLifecycleSignal(signal);
        if (!installation.installed) return { installed: false as const, session: await this.arbiter.readSession(signal) };
        const version = await this.executeInvocation(installation.executable, ["--version"], 8_000, epoch, signal);
        return {
            installed: true as const,
            executable: installation.executable,
            version: extractVersion(version.result.stdout),
            versionError: version.result.exitCode !== 0,
            session: version.session,
        };
    }

    private async executeInvocation(
        executable: string,
        args: string[],
        timeoutMs: number,
        epoch: number,
        signal?: AbortSignal,
        commit?: (result: DreaminaProcessResult, lease: DreaminaCliInvocationLease) => Promise<DreaminaCliSessionSnapshot>,
    ) {
        this.assertEpoch(epoch);
        assertLifecycleSignal(signal);
        const invocation = await this.arbiter.acquire({ signal });
        const controller = new AbortController();
        const abort = () => controller.abort();
        this.activeControllers.add(controller);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        try {
            const result = await this.runProcess({ executable, args, timeoutMs, signal: controller.signal, env: this.env });
            this.assertEpoch(epoch);
            await invocation.assertCurrent();
            const session = commit ? await commit(result, invocation) : invocation.session;
            await invocation.assertCurrent(session);
            return { result, session };
        } finally {
            signal?.removeEventListener("abort", abort);
            this.activeControllers.delete(controller);
            await invocation.release();
        }
    }

    private async ensureAuthenticatedSession(lease: DreaminaCliInvocationLease) {
        if (lease.session.accountBinding) return lease.session;
        return this.arbiter.commitSession(lease, crypto.randomBytes(32).toString("hex"));
    }

    private assertEpoch(epoch: number) {
        if (epoch !== this.epoch) {
            throw new DreaminaCliError("dreamina_cancelled", "Dreamina 操作已取消", 499);
        }
    }

    private publicFlow(version = this.flow?.version): DreaminaPublicStatus {
        if (!this.flow) {
            return publicStatus(
                "installed",
                true,
                false,
                version,
                "dreamina_login_required",
                "Dreamina CLI 需要登录",
            );
        }
        return {
            ...publicStatus(
                "login_pending",
                true,
                false,
                version,
                "dreamina_login_pending",
                "请在官方页面确认 Dreamina 登录",
            ),
            verificationUri: this.flow.verificationUri,
            userCode: this.flow.userCode,
            expiresAt: new Date(this.flow.expiresAt).toISOString(),
        };
    }
}

function assertLifecycleSignal(signal?: AbortSignal) {
    if (signal?.aborted) {
        throw new DreaminaCliError("dreamina_cancelled", "Dreamina 操作已取消", 499);
    }
}

function parseLoginFlow(stdout: string, now: number): PrivateLoginFlow {
    let payload: Record<string, unknown> | undefined;
    try {
        const start = stdout.indexOf("{");
        const end = stdout.lastIndexOf("}");
        if (start >= 0 && end > start) {
            payload = JSON.parse(stdout.slice(start, end + 1)) as Record<string, unknown>;
        }
    } catch {
        payload = undefined;
    }
    const verificationUri = stringValue(payload, "verification_uri")
        || matchValue(stdout, /verification_uri\s*[:=]\s*(https?:\/\/\S+)/i);
    const userCode = stringValue(payload, "user_code")
        || matchValue(stdout, /user_code\s*[:=]\s*([A-Za-z0-9-]+)/i);
    const deviceCode = stringValue(payload, "device_code")
        || matchValue(stdout, /device_code\s*[:=]\s*([^\s]+)/i);
    const expiresIn = Math.min(1_800, Math.max(60, Number(payload?.expires_in) || 600));
    if (!isOfficialVerificationUri(verificationUri)
        || !userCode
        || !/^[A-Za-z0-9-]{4,32}$/.test(userCode)
        || !deviceCode
        || deviceCode.length > 2_048) {
        throw new DreaminaCliError(
            "dreamina_login_response_invalid",
            "Dreamina 登录响应无法识别，请升级 CLI",
            502,
        );
    }
    return { verificationUri, userCode, deviceCode, expiresAt: now + expiresIn * 1_000 };
}

function isOfficialVerificationUri(value: string) {
    if (!value || value.length > 2_048) return false;
    try {
        const url = new URL(value);
        return url.protocol === "https:"
            && url.hostname === "jimeng.jianying.com"
            && url.pathname === "/ai-tool/cli-auth"
            && !url.username
            && !url.password;
    } catch {
        return false;
    }
}

function stringValue(payload: Record<string, unknown> | undefined, key: string) {
    const value = payload?.[key];
    return typeof value === "string" ? value.trim() : "";
}

function matchValue(value: string, pattern: RegExp) {
    return pattern.exec(value)?.[1]?.replace(/[",]+$/, "") || "";
}

function extractVersion(stdout: string) {
    try {
        const parsed = JSON.parse(stdout) as { version?: unknown };
        if (typeof parsed.version === "string"
            && /^[A-Za-z0-9._+:-]{1,120}$/.test(parsed.version)) {
            return parsed.version;
        }
    } catch {
        // Fall through to the bounded plain-text marker.
    }
    return /(?:\bversion\s*[:=]?\s*|\bv)([0-9][A-Za-z0-9._+:-]{0,119})\b/i.exec(stdout)?.[1];
}

function parseTotalCredit(stdout: string) {
    try {
        const parsed = JSON.parse(stdout) as Record<string, unknown>;
        const value = parsed.total_credit;
        return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1_000_000_000
            ? value as number
            : undefined;
    } catch {
        return undefined;
    }
}

function scopedPublicStatus(status: DreaminaPublicStatus, session: DreaminaCliSessionSnapshot, observedAt: Date): DreaminaPublicStatus {
    if (!status.authenticated || !session.accountBinding) return status;
    return {
        ...status,
        accountBinding: session.accountBinding,
        sessionEpoch: session.sessionEpoch,
        ...(status.totalCredit === undefined ? {} : { creditObservedAt: observedAt.toISOString() }),
    };
}

function publicStatus(
    state: DreaminaState,
    installed: boolean,
    authenticated: boolean,
    version: string | undefined,
    code: string | undefined,
    message: string,
): DreaminaPublicStatus {
    return {
        provider: "dreamina-cli",
        state,
        installed,
        authenticated,
        ...(version ? { version } : {}),
        ...(code ? { code } : {}),
        message,
    };
}

function missingStatus(): DreaminaPublicStatus {
    return publicStatus(
        "missing",
        false,
        false,
        undefined,
        "dreamina_missing",
        "未检测到 Dreamina CLI，请先完成本机安装",
    );
}
