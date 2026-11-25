import { http } from "./request";

export type RequestProtocolOperation = {
    method: string;
    path: string;
    contentType?: string;
    headers?: Record<string, unknown>;
    body?: unknown;
    [key: string]: unknown;
};

export type RequestProtocolProvider = {
    id: string;
    label: string;
    capabilities: string[];
    scopes: string[];
    auth: { type: string; field: string; header?: string; query?: string; prefix?: string; [key: string]: unknown };
    create: RequestProtocolOperation;
    poll?: RequestProtocolOperation;
    result?: RequestProtocolOperation;
    response: Record<string, unknown>;
    [key: string]: unknown;
};

export type RequestProtocolManifest = {
    apiVersion: string;
    id: string;
    name: string;
    version: string;
    author?: string;
    description?: string;
    permissions?: string[];
    runtime?: Record<string, string>;
    contributes: { providers: RequestProtocolProvider[]; [key: string]: unknown };
    [key: string]: unknown;
};

export type RequestProtocolBinding = {
    channelId: string;
    modelId: string;
    modelKey: string;
    protocolRelease?: string;
};

export type RequestProtocolRelease = {
    version: string;
    sha256: string;
    current: boolean;
    manifest: RequestProtocolManifest;
    bindings: RequestProtocolBinding[];
};

export type RequestProtocol = {
    id: string;
    providerId: string;
    version: string;
    sha256: string;
    source: string;
    readOnly: boolean;
    enabled: boolean;
    updatedAt: string;
    manifest: RequestProtocolManifest;
    bindings: RequestProtocolBinding[];
    releases: RequestProtocolRelease[];
};

export type RequestProtocolCheck = {
    manifest: RequestProtocolManifest;
    request: Record<string, unknown>;
    response: unknown;
    phase: "create" | "poll";
    taskId: string;
};

export type RequestProtocolCheckResult = {
    create: RequestProtocolOperation;
    poll?: RequestProtocolOperation;
    download?: RequestProtocolOperation;
    parsed?: unknown;
    warnings: string[];
};

export async function listRequestProtocols() {
    return (await http.get<{ protocols: RequestProtocol[] }>("/admin/request-protocols")).protocols;
}

export function checkRequestProtocol(input: RequestProtocolCheck) {
    return http.post<RequestProtocolCheckResult>("/admin/request-protocols/check", input);
}

export async function publishRequestProtocol(id: string, expectedSha256: string, check: RequestProtocolCheck) {
    return (await http.post<{ protocol: RequestProtocol }>("/admin/request-protocols", { id, expectedSha256, check })).protocol;
}
