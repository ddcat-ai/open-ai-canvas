import type { LocalRuntimeTransport } from "@/services/local-runtime";
import { LocalRuntimeClientError } from "@/services/local-runtime-session";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type DreaminaLocalModel = {
    provider: "dreamina-cli";
    id: string;
    displayName: string;
    modality: "image" | "video";
    adapterSupported: boolean;
    accountEntitlement: "yes" | "no" | "unknown";
    currentlyObservedAvailable: "yes" | "no" | "unknown";
    operations: Array<"text-to-image" | "image-to-image" | "text-to-video" | "image-to-video" | "reference-to-video" | "multi-frame-to-video">;
    settings: { aliases: string[]; aspects: string[]; maxReferenceImages: number; minDuration?: number; maxDuration?: number; tiers?: string[] };
    source: "runtime-execution-contract";
};

export class DreaminaModelCatalogError extends Error {
    constructor(
        readonly code: "session_required" | "scope_denied" | "catalog_unavailable",
        readonly status: number,
    ) {
        super("Dreamina model catalog is unavailable");
        this.name = "DreaminaModelCatalogError";
    }
}

type RecoverableSessionTransport = LocalRuntimeTransport & {
    connect(signal?: AbortSignal): Promise<{ state: string }>;
    revokeLocalSession(): void;
};

export async function getDreaminaModelCatalog(client: LocalRuntimeTransport, signal?: AbortSignal): Promise<DreaminaLocalModel[]> {
    return (await getDreaminaModelCatalogSnapshot(client, signal)).models;
}

export async function getDreaminaModelCatalogSnapshot(client: LocalRuntimeTransport, signal?: AbortSignal) {
    const response = await client.request("/dreamina/models", { method: "GET", signal });
    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new DreaminaModelCatalogError(response.status === 401 ? "session_required" : response.status === 403 ? "scope_denied" : "catalog_unavailable", response.status);
    }
    const value = await readBoundedJson(response);
    return parseCatalogSnapshot(value);
}

export async function getDreaminaModelCatalogWithSessionRecovery(client: RecoverableSessionTransport, signal?: AbortSignal): Promise<DreaminaLocalModel[]> {
    return (await getDreaminaModelCatalogSnapshotWithSessionRecovery(client, signal)).models;
}

export async function getDreaminaModelCatalogSnapshotWithSessionRecovery(client: RecoverableSessionTransport, signal?: AbortSignal) {
    try {
        return await getDreaminaModelCatalogSnapshot(client, signal);
    } catch (error) {
        if (signal?.aborted || !isRecoverableSessionFailure(error)) throw error;
        client.revokeLocalSession();
        const connection = await client.connect(signal);
        if (connection.state !== "connected") throw error;
        return await getDreaminaModelCatalogSnapshot(client, signal);
    }
}

function isRecoverableSessionFailure(error: unknown) {
    return (error instanceof DreaminaModelCatalogError && (error.code === "session_required" || error.code === "scope_denied")) || (error instanceof LocalRuntimeClientError && error.code === "session_required");
}

async function readBoundedJson(response: Response): Promise<unknown> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("Dreamina model catalog is invalid");
    if (!response.body) throw new Error("Dreamina model catalog is invalid");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > MAX_RESPONSE_BYTES) {
                await reader.cancel();
                throw new Error("Dreamina model catalog is invalid");
            }
            chunks.push(part.value);
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
        throw new Error("Dreamina model catalog is invalid");
    }
}

function parseCatalog(value: unknown): DreaminaLocalModel[] {
    return parseCatalogSnapshot(value).models;
}

function parseCatalogSnapshot(value: unknown) {
    const root = record(value);
    if (
        !root ||
        root.ok !== true ||
        root.provider !== "dreamina-cli" ||
        typeof root.accountBinding !== "string" ||
        !/^[A-Za-z0-9._:-]{8,160}$/.test(root.accountBinding) ||
        !Number.isSafeInteger(root.sessionEpoch) ||
        (root.sessionEpoch as number) < 0 ||
        !Array.isArray(root.models) ||
        root.models.length > 128
    )
        throw new Error("Dreamina model catalog is invalid");
    return { accountBinding: root.accountBinding, sessionEpoch: root.sessionEpoch as number, models: root.models.map(parseModel) };
}

function parseModel(value: unknown): DreaminaLocalModel {
    const model = record(value);
    const settings = model && record(model.settings);
    const maxReferenceImages = settings?.maxReferenceImages;
    const minDuration = settings?.minDuration;
    const maxDuration = settings?.maxDuration;
    if (
        !model ||
        !settings ||
        model.provider !== "dreamina-cli" ||
        model.source !== "runtime-execution-contract" ||
        typeof model.id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(model.id) ||
        typeof model.displayName !== "string" ||
        model.displayName !== model.displayName.trim() ||
        (model.modality !== "image" && model.modality !== "video") ||
        typeof model.adapterSupported !== "boolean" ||
        !["yes", "no", "unknown"].includes(String(model.accountEntitlement)) ||
        !["yes", "no", "unknown"].includes(String(model.currentlyObservedAvailable)) ||
        !Array.isArray(model.operations) ||
        !Array.isArray(settings.aliases) ||
        !Array.isArray(settings.aspects) ||
        !Number.isInteger(maxReferenceImages) ||
        (maxReferenceImages as number) < 0 ||
        (maxReferenceImages as number) > 30 ||
        (minDuration !== undefined && (!Number.isInteger(minDuration) || (minDuration as number) < 1)) ||
        (maxDuration !== undefined && (!Number.isInteger(maxDuration) || (maxDuration as number) < ((minDuration as number) ?? 1))) ||
        (model.modality === "video" && (minDuration === undefined || maxDuration === undefined))
    )
        throw new Error("Dreamina model catalog is invalid");
    const allowed = model.modality === "image" ? ["text-to-image", "image-to-image"] : ["text-to-video", "image-to-video", "reference-to-video", "multi-frame-to-video"];
    if (!model.operations.length || model.operations.some((operation) => typeof operation !== "string" || !allowed.includes(operation))) throw new Error("Dreamina model catalog is invalid");
    return {
        provider: "dreamina-cli",
        id: model.id,
        displayName: model.displayName,
        modality: model.modality,
        adapterSupported: model.adapterSupported,
        accountEntitlement: model.accountEntitlement as DreaminaLocalModel["accountEntitlement"],
        currentlyObservedAvailable: model.currentlyObservedAvailable as DreaminaLocalModel["currentlyObservedAvailable"],
        operations: [...model.operations] as DreaminaLocalModel["operations"],
        settings: {
            aliases: [...settings.aliases] as string[],
            aspects: [...settings.aspects] as string[],
            maxReferenceImages: maxReferenceImages as number,
            ...(minDuration === undefined ? {} : { minDuration: minDuration as number }),
            ...(maxDuration === undefined ? {} : { maxDuration: maxDuration as number }),
            ...(settings.tiers === undefined ? {} : { tiers: Array.isArray(settings.tiers) ? ([...settings.tiers] as string[]) : invalid() }),
        },
        source: "runtime-execution-contract",
    };
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}
function invalid(): never {
    throw new Error("Dreamina model catalog is invalid");
}
