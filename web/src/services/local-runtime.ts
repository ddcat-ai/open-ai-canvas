import { LocalRuntimeClientError } from "@/services/local-runtime-session";

export type LocalRuntimeModuleId = "canvas-agent" | "dreamina" | "portrait-clearance";
export type LocalRuntimeScope = "runtime:status" | "runtime:revoke" | "canvas:connect" | "dreamina:status" | "dreamina:login" | "dreamina:logout" | "dreamina:run" | "dreamina:models" | "dreamina:generate" | "portrait:status" | "portrait:model" | "portrait:run" | "portrait:read";

export type LocalRuntimeModuleDescriptor = {
    id: LocalRuntimeModuleId;
    displayName: string;
    apiVersion: 1;
    scopes: LocalRuntimeScope[];
};

export type LocalRuntimeStatus = {
    runtime: {
        id: "framefield-local-runtime";
        version: string;
        apiVersion: 2;
    };
    modules: LocalRuntimeModuleDescriptor[];
};

export type LocalRuntimeTransport = {
    request(pathAndQuery: string, init?: RequestInit): Promise<Response>;
};

const MAX_RESPONSE_BYTES = 64 * 1024;
const MODULE_SCOPES: Record<LocalRuntimeModuleId, ReadonlySet<LocalRuntimeScope>> = {
    "canvas-agent": new Set(["canvas:connect"]),
    dreamina: new Set(["dreamina:status", "dreamina:login", "dreamina:logout", "dreamina:run", "dreamina:models", "dreamina:generate"]),
    "portrait-clearance": new Set(["portrait:status", "portrait:model", "portrait:run", "portrait:read"]),
};

export async function readLocalRuntimeStatus(client: LocalRuntimeTransport, signal?: AbortSignal): Promise<LocalRuntimeStatus> {
    const response = await client.request("/runtime/status", { method: "GET", signal });
    if (response.redirected || response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        throw invalidResponse(response.status);
    }
    const body = await readBoundedJson(response);
    if (!response.ok) {
        const code = response.status === 401 ? "session_required" : response.status === 403 ? "scope_denied" : "runtime_request_failed";
        throw new LocalRuntimeClientError(code, publicRequestError(code), response.status);
    }
    return parseRuntimeStatus(body, response.status);
}

async function readBoundedJson(response: Response): Promise<unknown> {
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
        throw invalidResponse(response.status);
    }
    if (!response.body) throw invalidResponse(response.status);

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const item = await reader.read();
            if (item.done) break;
            total += item.value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw invalidResponse(response.status);
            }
            chunks.push(item.value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
        throw invalidResponse(response.status);
    }
}

function parseRuntimeStatus(value: unknown, status: number): LocalRuntimeStatus {
    if (!isRecord(value) || !hasExactKeys(value, ["modules", "ok", "runtime"]) || value.ok !== true || !isRecord(value.runtime) || !Array.isArray(value.modules)) {
        throw invalidResponse(status);
    }
    const runtime = value.runtime;
    if (!hasExactKeys(runtime, ["apiVersion", "id", "version"]) || runtime.id !== "framefield-local-runtime" || runtime.apiVersion !== 2 || typeof runtime.version !== "string" || !/^[A-Za-z0-9._+:-]{1,80}$/.test(runtime.version)) {
        throw invalidResponse(status);
    }

    const ids = new Set<LocalRuntimeModuleId>();
    const modules = value.modules.map((item) => {
        if (
            !isRecord(item) ||
            !hasExactKeys(item, ["apiVersion", "displayName", "id", "scopes"]) ||
            !isModuleId(item.id) ||
            ids.has(item.id) ||
            item.apiVersion !== 1 ||
            typeof item.displayName !== "string" ||
            item.displayName.trim() !== item.displayName ||
            item.displayName.length < 1 ||
            item.displayName.length > 80 ||
            !Array.isArray(item.scopes)
        ) {
            throw invalidResponse(status);
        }
        const scopes = item.scopes as unknown[];
        const allowedScopes = MODULE_SCOPES[item.id];
        if (scopes.some((scope) => typeof scope !== "string" || !allowedScopes.has(scope as LocalRuntimeScope)) || new Set(scopes).size !== scopes.length) {
            throw invalidResponse(status);
        }
        ids.add(item.id);
        return {
            id: item.id,
            displayName: item.displayName,
            apiVersion: 1 as const,
            scopes: [...scopes] as LocalRuntimeScope[],
        };
    });

    return {
        runtime: { id: "framefield-local-runtime", version: runtime.version, apiVersion: 2 },
        modules,
    };
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
    const keys = Object.keys(value).sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isModuleId(value: unknown): value is LocalRuntimeModuleId {
    return value === "canvas-agent" || value === "dreamina" || value === "portrait-clearance";
}

function invalidResponse(status: number) {
    return new LocalRuntimeClientError("runtime_response_invalid", "本机运行时响应无效", status);
}

function publicRequestError(code: string) {
    if (code === "session_required") return "本机会话已失效，请重新连接";
    if (code === "scope_denied") return "本机会话权限不足";
    return "本机运行时请求失败";
}
