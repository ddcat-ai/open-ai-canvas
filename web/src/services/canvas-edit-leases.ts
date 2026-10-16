import { changeCanvasEditLease, type CanvasEditProof, type CanvasSyncStatus } from "@/services/api/user-data";
import { getActiveUserScope } from "@/lib/user-scope";

type LeaseResponse = Awaited<ReturnType<typeof changeCanvasEditLease>>;
type OwnedEdit = {
    proof: CanvasEditProof;
    version: number;
    savedVersion: number;
    lastInput: number;
    lastRenew: number;
    expires: number;
    pending?: Promise<void>;
    error?: Error;
};
type Dependencies = {
    change: typeof changeCanvasEditLease;
    now: () => number;
    scope: () => string;
    sessionId: () => string;
};

// Presence is transient and separate from document persistence. Only a server
// response grants ownership; local expiry merely permits another acquisition.
export function createCanvasEditLeaseClient(deps: Dependencies) {
    let scope = deps.scope();
    let sessionId = deps.sessionId();
    let revision = 0;
    const own = new Map<string, Map<string, OwnedEdit>>();
    const remote = new Map<string, Map<string, { sessionId: string; expires: number }>>();
    const agents = new Map<string, CanvasSyncStatus["agent"]>();
    const agentObservations = new Map<string, symbol>();
    const observation = (canvasId: string) => {
        let token = agentObservations.get(canvasId);
        if (!token) {
            token = Symbol();
            agentObservations.set(canvasId, token);
        }
        return token;
    };
    const listeners = new Set<() => void>();
    const emit = () => {
        revision++;
        listeners.forEach((listener) => listener());
    };
    const checkScope = () => {
        if (scope === deps.scope()) return;
        scope = deps.scope();
        sessionId = deps.sessionId();
        own.clear();
        remote.clear();
        agents.clear();
        agentObservations.clear();
        emit();
    };
    const valid = (canvasId: string, nodeId: string, entry: OwnedEdit, startedScope: string) => scope === startedScope && scope === deps.scope() && own.get(canvasId)?.get(nodeId) === entry;
    const accept = (entry: OwnedEdit, result: LeaseResponse) => {
        if (!result.lease || !result.token) throw new Error("服务端未授予编辑权限，草稿已保留");
        entry.proof = { ...entry.proof, token: result.token };
        entry.expires = deps.now() + Math.max(0, Date.parse(result.lease.expiresAt) - Date.parse(result.serverTime));
        entry.lastRenew = deps.now();
        entry.error = undefined;
    };
    const acquire = (canvasId: string, nodeId: string, entry: OwnedEdit) => {
        if (entry.pending) return entry.pending;
        const startedScope = scope;
        const pending = deps
            .change(canvasId, entry.proof, "acquire")
            .then((result) => {
                if (!valid(canvasId, nodeId, entry, startedScope)) return;
                accept(entry, result);
            })
            .catch((error: unknown) => {
                if (valid(canvasId, nodeId, entry, startedScope)) entry.error = error instanceof Error ? error : new Error("编辑权限申请失败，草稿已保留");
            })
            .finally(() => {
                if (entry.pending === pending) entry.pending = undefined;
                emit();
            });
        entry.pending = pending;
        return pending;
    };
    const state = (canvasId: string, nodeId: string) => {
        if (scope !== deps.scope())
            return {
                blocked: false,
                remote: false,
                acquiring: false,
                typing: false,
                error: undefined,
            };
        const entry = own.get(canvasId)?.get(nodeId);
        const other = remote.get(canvasId)?.get(nodeId);
        const now = deps.now();
        const remoteOwner = Boolean(other && other.sessionId !== sessionId && other.expires > now);
        const acquiring = Boolean(entry?.pending && entry.expires <= now);
        const expiredDraft = Boolean(entry && entry.version > entry.savedVersion && entry.expires <= now && !acquiring);
        const error = entry?.error?.message || (expiredDraft ? "编辑权限已过期，草稿已保留" : undefined);
        // Pending input remains a local draft; proofs() waits for the server grant.
        return {
            blocked: remoteOwner || Boolean(error),
            remote: remoteOwner,
            acquiring,
            typing: remoteOwner || Boolean(entry && !entry.error && entry.expires > now),
            error,
        };
    };
    return {
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        snapshot: () => revision,
        session: () => sessionId,
        state,
        reset() {
            own.clear();
            remote.clear();
            agents.clear();
            agentObservations.clear();
            scope = deps.scope();
            sessionId = deps.sessionId();
            emit();
        },
        agent(canvasId: string) {
            return scope === deps.scope() ? agents.get(canvasId) : undefined;
        },
        statusToken(canvasId: string) {
            checkScope();
            return observation(canvasId);
        },
        agentRejected(canvasId: string, cause: unknown) {
            const error = cause as {
                reason?: string;
                details?: Record<string, unknown>;
            } | null;
            if (error?.reason !== "canvas_agent_busy" || error.details?.canvasId !== canvasId) return false;
            const activity = error.details.agent as Partial<NonNullable<CanvasSyncStatus["agent"]>> | null;
            if (!activity || typeof activity.runId !== "string" || !activity.runId || typeof activity.status !== "string" || typeof activity.cleanupPending !== "boolean") return false;
            checkScope();
            agents.set(canvasId, {
                runId: activity.runId,
                status: activity.status,
                cleanupPending: activity.cleanupPending,
            });
            agentObservations.set(canvasId, Symbol());
            emit();
            return true;
        },
        input(canvasId: string, nodeId: string) {
            checkScope();
            if (!canvasId || !nodeId || state(canvasId, nodeId).blocked) return false;
            let entries = own.get(canvasId);
            if (!entries) {
                entries = new Map();
                own.set(canvasId, entries);
            }
            let entry = entries.get(nodeId);
            if (!entry) {
                entry = {
                    proof: { nodeId, sessionId, token: "" },
                    version: 0,
                    savedVersion: 0,
                    lastInput: 0,
                    lastRenew: 0,
                    expires: 0,
                };
                entries.set(nodeId, entry);
            }
            entry.version++;
            entry.lastInput = deps.now();
            if (!entry.pending && entry.expires <= deps.now()) void acquire(canvasId, nodeId, entry);
            emit();
            return true;
        },
        async retry(canvasId: string, nodeId: string) {
            checkScope();
            const entry = own.get(canvasId)?.get(nodeId);
            if (!entry || entry.pending || state(canvasId, nodeId).remote) return false;
            entry.lastInput = deps.now();
            const startedScope = scope;
            const pending = acquire(canvasId, nodeId, entry);
            emit();
            await pending;
            return valid(canvasId, nodeId, entry, startedScope) && !entry.error && entry.expires > deps.now();
        },
        versions(canvasId: string) {
            checkScope();
            return Object.fromEntries([...(own.get(canvasId) || [])].map(([nodeId, entry]) => [nodeId, entry.version]));
        },
        async proofs(canvasId: string, nodeIds: ReadonlySet<string>) {
            checkScope();
            const startedScope = scope;
            const result: CanvasEditProof[] = [];
            for (const [nodeId, entry] of own.get(canvasId) || []) {
                if (!nodeIds.has(nodeId)) continue;
                while (entry.pending) await entry.pending;
                if (!valid(canvasId, nodeId, entry, startedScope)) throw new Error("账号已切换，已停止旧会话提交");
                if (entry.error) throw entry.error;
                if (!entry.proof.token) continue;
                // An expired proof is still sent: the server may already have
                // committed this mutation and can return its durable receipt.
                result.push({ ...entry.proof });
            }
            return result;
        },
        acknowledged(canvasId: string, versions: Record<string, number>) {
            checkScope();
            for (const [nodeId, version] of Object.entries(versions)) {
                const entry = own.get(canvasId)?.get(nodeId);
                if (entry) {
                    entry.savedVersion = Math.max(entry.savedVersion, Math.min(entry.version, version));
                    // Initial canvas creation has no parent row to lease yet.
                    if (!entry.proof.token && entry.savedVersion === entry.version) entry.error = undefined;
                }
            }
            emit();
        },
        pending(canvasId: string, nodeId: string) {
            const entry = own.get(canvasId)?.get(nodeId);
            return scope === deps.scope() && Boolean(entry && entry.savedVersion < entry.version);
        },
        status(canvasId: string, status: CanvasSyncStatus, token?: symbol) {
            checkScope();
            // A poll already in flight cannot undo a newer admission verdict.
            if (!token || token === observation(canvasId)) agents.set(canvasId, status.agent ?? null);
            remote.set(
                canvasId,
                new Map(
                    status.leases.map((lease) => [
                        lease.nodeId,
                        {
                            sessionId: lease.sessionId,
                            expires: deps.now() + Math.max(0, Date.parse(lease.expiresAt) - Date.parse(status.serverTime)),
                        },
                    ]),
                ),
            );
            emit();
        },
        async tick(canvasId: string) {
            checkScope();
            const startedScope = scope;
            for (const [nodeId, entry] of own.get(canvasId) || []) {
                const now = deps.now();
                if (entry.pending || entry.error || !entry.proof.token || entry.expires <= now) continue;
                const saved = entry.savedVersion === entry.version;
                const idle = now - entry.lastInput;
                if (!(saved && idle >= 2000) && !(idle < 10000 && now - entry.lastRenew >= 5000)) continue;
                const action = saved && idle >= 2000 ? "release" : "renew";
                const version = entry.version;
                const pending = deps
                    .change(canvasId, entry.proof, action)
                    .then((result) => {
                        if (!valid(canvasId, nodeId, entry, startedScope)) return;
                        if (action === "release") {
                            entry.expires = 0;
                            entry.proof = { ...entry.proof, token: "" };
                            if (remote.get(canvasId)?.get(nodeId)?.sessionId === sessionId) remote.get(canvasId)?.delete(nodeId);
                            // Typing during release gets a fresh server grant before save.
                            if (entry.version !== version) {
                                entry.pending = undefined;
                                void acquire(canvasId, nodeId, entry);
                            }
                        } else accept(entry, result);
                    })
                    .catch((error: unknown) => {
                        if (valid(canvasId, nodeId, entry, startedScope)) entry.error = error instanceof Error ? error : new Error("编辑权限失效，草稿已保留");
                    })
                    .finally(() => {
                        if (entry.pending === pending) entry.pending = undefined;
                        emit();
                    });
                entry.pending = pending;
                await pending;
            }
            emit();
        },
    };
}

export const canvasEditLeases = createCanvasEditLeaseClient({
    change: changeCanvasEditLease,
    now: () => Date.now(),
    scope: getActiveUserScope,
    sessionId: () => crypto.randomUUID(),
});
