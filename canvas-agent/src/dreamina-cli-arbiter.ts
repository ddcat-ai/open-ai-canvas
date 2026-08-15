import crypto from "node:crypto";
import fs, { type FileHandle } from "node:fs/promises";
import path from "node:path";

import { DreaminaCliError } from "./dreamina-cli-process.js";
import { acquireStateLock } from "./dreamina-cli-state.js";

export type DreaminaCliSessionSnapshot = {
    sessionEpoch: number;
    accountBinding?: string;
};

export type DreaminaCliInvocationLease = {
    fenceEpoch: number;
    session: DreaminaCliSessionSnapshot;
    assertCurrent(expectedSession?: DreaminaCliSessionSnapshot): Promise<void>;
    release(): Promise<void>;
};

type ArbiterQueueEntry = {
    requestId: string;
    ticket: number;
    expiresAt: number;
};

type ArbiterActiveLease = {
    requestId: string;
    fenceEpoch: number;
    expiresAt: number;
};

type ArbiterDiskState = {
    version: 1;
    revision: number;
    nextTicket: number;
    nextFenceEpoch: number;
    sessionEpoch: number;
    accountBinding?: string;
    queue: ArbiterQueueEntry[];
    active?: ArbiterActiveLease;
};

export type DreaminaCliArbiterOptions = {
    stateFile: string;
    now?: () => number;
    leaseMs?: number;
    waitTimeoutMs?: number;
    pollMs?: number;
    heartbeatMs?: number;
};

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_WAIT_TIMEOUT_MS = 70_000;
const DEFAULT_POLL_MS = 10;
const MAX_QUEUE = 1_000;
const BACKUP_SUFFIX = ".replace-backup";
const REPLACE_DENIED_CODES = new Set(["EACCES", "EEXIST", "ENOTEMPTY", "EPERM"]);
const TEMP_UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";

export class DreaminaCliArbiter {
    private readonly stateFile: string;
    private readonly now: () => number;
    private readonly leaseMs: number;
    private readonly waitTimeoutMs: number;
    private readonly pollMs: number;
    private readonly heartbeatMs: number;

    constructor(options: DreaminaCliArbiterOptions) {
        this.stateFile = path.resolve(options.stateFile);
        this.now = options.now ?? (() => Date.now());
        this.leaseMs = bounded(options.leaseMs, 100, 300_000, DEFAULT_LEASE_MS);
        this.waitTimeoutMs = bounded(options.waitTimeoutMs, 100, 300_000, DEFAULT_WAIT_TIMEOUT_MS);
        this.pollMs = bounded(options.pollMs, 1, 1_000, DEFAULT_POLL_MS);
        this.heartbeatMs = options.heartbeatMs === 0
            ? 0
            : bounded(options.heartbeatMs, 25, this.leaseMs, Math.max(25, Math.floor(this.leaseMs / 3)));
    }

    async acquire(options: { signal?: AbortSignal; expectedSession?: DreaminaCliSessionSnapshot } = {}): Promise<DreaminaCliInvocationLease> {
        throwIfCancelled(options.signal);
        const requestId = crypto.randomUUID();
        const deadline = this.now() + this.waitTimeoutMs;
        const ticket = await this.mutate((state) => {
            pruneExpired(state, this.now());
            if (state.queue.length >= MAX_QUEUE) throw busy();
            const next = state.nextTicket;
            state.nextTicket += 1;
            state.queue.push({ requestId, ticket: next, expiresAt: deadline });
            return next;
        }, options.signal);
        try {
            while (true) {
                throwIfCancelled(options.signal);
                const granted = await this.mutate((state) => {
                    const now = this.now();
                    pruneExpired(state, now);
                    const queued = state.queue.find((entry) => entry.requestId === requestId && entry.ticket === ticket);
                    if (!queued) throw busy();
                    const first = state.queue.reduce<ArbiterQueueEntry | undefined>((best, entry) => (
                        !best || entry.ticket < best.ticket ? entry : best
                    ), undefined);
                    if (state.active || first?.requestId !== requestId) return undefined;
                    assertExpectedSession(state, options.expectedSession);
                    const fenceEpoch = state.nextFenceEpoch;
                    state.nextFenceEpoch += 1;
                    state.queue = state.queue.filter((entry) => entry.requestId !== requestId);
                    state.active = { requestId, fenceEpoch, expiresAt: now + this.leaseMs };
                    return {
                        fenceEpoch,
                        session: snapshotSession(state),
                    };
                }, options.signal);
                if (granted) return this.createLease(requestId, granted.fenceEpoch, granted.session, options.expectedSession);
                if (this.now() >= deadline) throw busy();
                await delay(this.pollMs, options.signal);
            }
        } catch (error) {
            await this.removeQueued(requestId).catch(() => undefined);
            throw error;
        }
    }

    async readSession(signal?: AbortSignal): Promise<DreaminaCliSessionSnapshot> {
        return this.inspect((state) => snapshotSession(state), signal);
    }

    async commitSession(lease: DreaminaCliInvocationLease, accountBinding: string | undefined): Promise<DreaminaCliSessionSnapshot> {
        validateBinding(accountBinding);
        return this.mutate((state) => {
            assertLeaseState(state, lease.fenceEpoch, this.now());
            if (state.accountBinding !== accountBinding) {
                state.sessionEpoch += 1;
                if (accountBinding === undefined) delete state.accountBinding;
                else state.accountBinding = accountBinding;
            }
            return snapshotSession(state);
        });
    }

    async advanceSession(lease: DreaminaCliInvocationLease): Promise<DreaminaCliSessionSnapshot> {
        return this.mutate((state) => {
            assertLeaseState(state, lease.fenceEpoch, this.now());
            state.sessionEpoch += 1;
            delete state.accountBinding;
            return snapshotSession(state);
        });
    }

    private createLease(
        requestId: string,
        fenceEpoch: number,
        session: DreaminaCliSessionSnapshot,
        expectedSession?: DreaminaCliSessionSnapshot,
    ): DreaminaCliInvocationLease {
        let released = false;
        let lost = false;
        let refresh = Promise.resolve();
        let timer: NodeJS.Timeout | undefined;
        const refreshLease = async () => {
            if (released || lost) return;
            await this.mutate((state) => {
                const active = state.active;
                if (!active || active.requestId !== requestId || active.fenceEpoch !== fenceEpoch) {
                    throw fenced();
                }
                assertExpectedSession(state, expectedSession);
                active.expiresAt = this.now() + this.leaseMs;
            });
        };
        if (this.heartbeatMs > 0) {
            timer = setInterval(() => {
                refresh = refresh.then(refreshLease).catch(() => {
                    lost = true;
                    if (timer) clearInterval(timer);
                });
            }, this.heartbeatMs);
            timer.unref();
        }
        const assertCurrent = async (expected = expectedSession) => {
            await refresh;
            if (released || lost) throw fenced();
            await this.inspect((state) => {
                const active = state.active;
                if (!active || active.requestId !== requestId || active.fenceEpoch !== fenceEpoch || active.expiresAt <= this.now()) {
                    throw fenced();
                }
                assertExpectedSession(state, expected);
            });
        };
        const release = async () => {
            if (released) return;
            released = true;
            if (timer) clearInterval(timer);
            await refresh;
            await this.mutate((state) => {
                if (state.active?.requestId === requestId && state.active.fenceEpoch === fenceEpoch) delete state.active;
            });
        };
        return { fenceEpoch, session, assertCurrent, release };
    }

    private async removeQueued(requestId: string) {
        await this.mutate((state) => {
            state.queue = state.queue.filter((entry) => entry.requestId !== requestId);
        });
    }

    private async inspect<T>(read: (state: ArbiterDiskState) => T, signal?: AbortSignal): Promise<T> {
        const release = await acquireStateLock(this.stateFile, signal);
        try {
            await recoverArbiterReplacement(this.stateFile);
            await scavengeArbiterTemporaries(this.stateFile);
            const state = await readState(this.stateFile);
            return read(state);
        } finally {
            await release();
        }
    }

    private async mutate<T>(update: (state: ArbiterDiskState) => T, signal?: AbortSignal): Promise<T> {
        const release = await acquireStateLock(this.stateFile, signal);
        try {
            await recoverArbiterReplacement(this.stateFile);
            await scavengeArbiterTemporaries(this.stateFile);
            const state = await readState(this.stateFile);
            const result = update(state);
            state.revision += 1;
            await persistState(this.stateFile, state);
            return result;
        } finally {
            await release();
        }
    }
}

function emptyState(): ArbiterDiskState {
    return { version: 1, revision: 0, nextTicket: 1, nextFenceEpoch: 1, sessionEpoch: 0, queue: [] };
}

async function readState(stateFile: string): Promise<ArbiterDiskState> {
    let value: unknown;
    try {
        value = JSON.parse(await fs.readFile(stateFile, "utf8"));
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
        throw invalid();
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
    const normalized = { revision: 0, ...(value as Record<string, unknown>) };
    if (!validState(normalized)) throw invalid();
    return normalized;
}

async function persistState(stateFile: string, state: ArbiterDiskState) {
    if (!validState(state)) throw invalid();
    await fs.mkdir(path.dirname(stateFile), { recursive: true, mode: 0o700 });
    const temporary = `${stateFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
    let handle: FileHandle | undefined;
    try {
        handle = await fs.open(temporary, "wx", 0o600);
        await handle.writeFile(JSON.stringify(state), "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await replaceArbiterState(temporary, stateFile);
    } catch (error) {
        await handle?.close().catch(() => undefined);
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        if (error instanceof DreaminaCliError) throw error;
        throw invalid();
    }
}

async function replaceArbiterState(temporary: string, stateFile: string) {
    try {
        await fs.rename(temporary, stateFile);
        await syncParentDirectory(stateFile);
        return;
    } catch (error) {
        if (!REPLACE_DENIED_CODES.has((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
    const backup = `${stateFile}${BACKUP_SUFFIX}`;
    if (await isRegularFile(backup)) throw invalid();
    try {
        if (await isRegularFile(stateFile)) {
            await fs.rename(stateFile, backup);
            await syncParentDirectory(stateFile);
        }
        await fs.rename(temporary, stateFile);
        await syncParentDirectory(stateFile);
    } catch (error) {
        await restoreArbiterBackup(stateFile, backup);
        throw error;
    }
    try {
        await fs.rm(backup, { force: true });
        await syncParentDirectory(stateFile);
    } catch {
        // The new primary is already durable. Keep the older backup as recovery evidence;
        // the next state-lock owner will validate revision progression and clean it safely.
    }
}

async function recoverArbiterReplacement(stateFile: string) {
    const backup = `${stateFile}${BACKUP_SUFFIX}`;
    if (!(await isRegularFile(backup))) return;
    const previous = await readState(backup);
    if (!(await isRegularFile(stateFile))) {
        await fs.rename(backup, stateFile);
        await syncParentDirectory(stateFile);
        return;
    }
    const current = await readState(stateFile);
    if (current.revision < previous.revision) throw invalid();
    if (current.revision === previous.revision) {
        if (!sameArbiterState(previous, current)) throw invalid();
    } else {
        assertArbiterProgression(previous, current);
    }
    await fs.rm(backup, { force: true });
    await syncParentDirectory(stateFile);
}

function assertArbiterProgression(previous: ArbiterDiskState, current: ArbiterDiskState) {
    if (current.nextTicket < previous.nextTicket
        || current.nextFenceEpoch < previous.nextFenceEpoch
        || current.sessionEpoch < previous.sessionEpoch
        || (current.sessionEpoch === previous.sessionEpoch && current.accountBinding !== previous.accountBinding)) throw invalid();
}

function sameArbiterState(left: ArbiterDiskState, right: ArbiterDiskState) {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function scavengeArbiterTemporaries(stateFile: string) {
    const directory = path.dirname(stateFile);
    const pattern = new RegExp(`^${escapeRegExp(path.basename(stateFile))}\\.[0-9]+\\.${TEMP_UUID}\\.tmp$`);
    let entries;
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw invalid();
    }
    for (const entry of entries) {
        if (!entry.isFile() || !pattern.test(entry.name)) continue;
        try {
            await fs.rm(path.join(directory, entry.name), { force: true });
        } catch {
            throw invalid();
        }
    }
}

async function restoreArbiterBackup(stateFile: string, backup: string) {
    try {
        if (await isRegularFile(stateFile)) return;
        if (!(await isRegularFile(backup))) return;
        await fs.rename(backup, stateFile);
        await syncParentDirectory(stateFile);
    } catch {
        // Keep the recoverable backup for the next state-lock owner.
    }
}

async function isRegularFile(candidate: string) {
    try {
        const stats = await fs.lstat(candidate);
        if (!stats.isFile() || stats.isSymbolicLink()) throw invalid();
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
}

async function syncParentDirectory(stateFile: string) {
    if (process.platform === "win32") return;
    const directory = await fs.open(path.dirname(stateFile), "r");
    try { await directory.sync(); } finally { await directory.close(); }
}

function validState(value: unknown): value is ArbiterDiskState {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const state = value as Partial<ArbiterDiskState>;
    if (Object.keys(value).some((key) => !["version", "revision", "nextTicket", "nextFenceEpoch", "sessionEpoch", "accountBinding", "queue", "active"].includes(key))) return false;
    if (state.version !== 1
        || !nonNegativeInteger(state.revision)
        || !positiveInteger(state.nextTicket)
        || !positiveInteger(state.nextFenceEpoch)
        || !nonNegativeInteger(state.sessionEpoch)
        || !Array.isArray(state.queue)
        || state.queue.length > MAX_QUEUE) return false;
    if (state.accountBinding !== undefined && !safeBinding(state.accountBinding)) return false;
    const requestIds = new Set<string>();
    const tickets = new Set<number>();
    for (const entry of state.queue) {
        if (!validQueueEntry(entry) || requestIds.has(entry.requestId) || tickets.has(entry.ticket)) return false;
        requestIds.add(entry.requestId);
        tickets.add(entry.ticket);
    }
    return state.active === undefined || validActive(state.active);
}

function validQueueEntry(value: unknown): value is ArbiterQueueEntry {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const entry = value as Partial<ArbiterQueueEntry>;
    return Object.keys(value).every((key) => ["requestId", "ticket", "expiresAt"].includes(key))
        && uuid(entry.requestId)
        && positiveInteger(entry.ticket)
        && Number.isFinite(entry.expiresAt);
}

function validActive(value: unknown): value is ArbiterActiveLease {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const active = value as Partial<ArbiterActiveLease>;
    return Object.keys(value).every((key) => ["requestId", "fenceEpoch", "expiresAt"].includes(key))
        && uuid(active.requestId)
        && positiveInteger(active.fenceEpoch)
        && Number.isFinite(active.expiresAt);
}

function pruneExpired(state: ArbiterDiskState, now: number) {
    state.queue = state.queue.filter((entry) => entry.expiresAt > now);
    if (state.active && state.active.expiresAt <= now) delete state.active;
}

function assertExpectedSession(state: ArbiterDiskState, expected?: DreaminaCliSessionSnapshot) {
    if (!expected) return;
    if (state.sessionEpoch !== expected.sessionEpoch || state.accountBinding !== expected.accountBinding) throw accountChanged();
}

function assertLeaseState(state: ArbiterDiskState, fenceEpoch: number, now: number) {
    if (!state.active || state.active.fenceEpoch !== fenceEpoch || state.active.expiresAt <= now) throw fenced();
}

function snapshotSession(state: ArbiterDiskState): DreaminaCliSessionSnapshot {
    return {
        sessionEpoch: state.sessionEpoch,
        ...(state.accountBinding ? { accountBinding: state.accountBinding } : {}),
    };
}

function validateBinding(value: string | undefined) {
    if (value !== undefined && !safeBinding(value)) throw invalid();
}

function safeBinding(value: string) { return /^[a-f0-9]{64}$/.test(value); }
function uuid(value: unknown): value is string { return typeof value === "string" && /^[a-f0-9-]{36}$/.test(value); }
function positiveInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 1; }
function nonNegativeInteger(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function bounded(value: number | undefined, min: number, max: number, fallback: number) {
    return value === undefined ? fallback : Math.min(max, Math.max(min, Math.trunc(value)));
}

function delay(ms: number, signal?: AbortSignal) {
    if (!signal) return new Promise<void>((resolve) => setTimeout(resolve, ms));
    throwIfCancelled(signal);
    return new Promise<void>((resolve, reject) => {
        const onAbort = () => { clearTimeout(timer); reject(cancelled()); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, ms);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
    });
}

function throwIfCancelled(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }
function cancelled() { return new DreaminaCliError("dreamina_cancelled", "Dreamina 操作已取消", 499); }
function busy() { return new DreaminaCliError("dreamina_cli_busy", "Dreamina CLI 正在由另一个本机进程使用", 503); }
function fenced() { return new DreaminaCliError("dreamina_cli_fenced", "Dreamina CLI invocation lease 已失效", 409); }
function accountChanged() { return new DreaminaCliError("dreamina_account_session_changed", "Dreamina 账号会话已变化", 409); }
function invalid() { return new DreaminaCliError("dreamina_arbiter_state_invalid", "Dreamina CLI arbiter 状态无效", 503); }
