import crypto from "node:crypto";

import { canonicalize } from "json-canonicalize";

export const LOCAL_RUNTIME_ENDPOINT = "http://127.0.0.1:17371";
export const LOCAL_RUNTIME_ID = "framefield-local-runtime";
export const LOCAL_RUNTIME_API_VERSION = 2;

export type LocalRuntimeModuleId = "canvas-agent" | "dreamina" | "portrait-clearance";
export type LocalRuntimeScope =
    | "runtime:status"
    | "runtime:revoke"
    | "canvas:connect"
    | "dreamina:status"
    | "dreamina:login"
    | "dreamina:logout"
    | "dreamina:run"
    | "dreamina:models"
    | "dreamina:generate"
    | "portrait:status"
    | "portrait:model"
    | "portrait:run"
    | "portrait:read";

export type DreaminaModelOperation =
    | "text-to-image"
    | "image-to-image"
    | "text-to-video"
    | "image-to-video"
    | "reference-to-video";

export type DreaminaModelDescriptor = {
    provider: "dreamina-cli";
    id: string;
    displayName: string;
    modality: "image" | "video";
    adapterSupported: boolean;
    accountEntitlement: "yes" | "no" | "unknown";
    currentlyObservedAvailable: "yes" | "no" | "unknown";
    operations: DreaminaModelOperation[];
    settings: {
        aliases: string[];
        aspects: string[];
        minDuration?: number;
        maxDuration?: number;
        maxReferenceImages: number;
        tiers?: string[];
    };
    source: "runtime-execution-contract";
};

export type LocalRuntimeModuleDescriptor = {
    id: LocalRuntimeModuleId;
    displayName: string;
    apiVersion: 1;
    scopes: readonly LocalRuntimeScope[];
};

export type RuntimeSessionChallengePayload = {
    protocol: "framefield-runtime-session-v1";
    challengeId: string;
    nonce: string;
    origin: string;
    endpoint: string;
    runtimeInstanceId: string;
    expiresAt: string;
};

export type RuntimeRequestPayload = {
    protocol: "framefield-runtime-request-v1";
    sessionId: string;
    keyId: string;
    method: string;
    pathAndQuery: string;
    bodySha256: string;
    lastEventId: string | null;
    origin: string;
    endpoint: string;
    runtimeInstanceId: string;
    requestNonce: string;
    timestamp: number;
    sessionExpiresAt: string;
};

export function canonicalRuntimeJson(value: unknown) {
    return canonicalize(value);
}

export function sha256Base64Url(value: string | Uint8Array) {
    return crypto.createHash("sha256").update(value).digest("base64url");
}

export function createRuntimeRequestPayload(
    value: Omit<RuntimeRequestPayload, "protocol">,
): RuntimeRequestPayload {
    return { protocol: "framefield-runtime-request-v1", ...value };
}
