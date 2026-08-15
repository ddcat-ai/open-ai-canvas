import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
    dreaminaCliInputSchema,
    type DreaminaGenerationInput,
} from "./dreamina-cli-contract.js";
import type { DreaminaPublicGenerationTask } from "./dreamina-cli-runtime.js";
import type { DreaminaTaskContext } from "./dreamina-task-contract.js";
import type { DreaminaModelDescriptor, DreaminaModelOperation } from "./local-runtime-contract.js";

const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 30;
const MAX_REFERENCE_VIDEOS = 10;
const MAX_REFERENCE_AUDIOS = 10;
const DEFAULT_CONCURRENCY = 5;
const MAX_RESULT_FILES = 4;
const MAX_RESULT_BYTES = 256 * 1024 * 1024;
const imageExtensions = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"]]);
const videoExtensions = new Map([[".mp4", "video/mp4"], [".mov", "video/quicktime"], [".webm", "video/webm"]]);

export type DreaminaGenerationRequest = {
    idempotencyKey: string;
    clientOperationId: string;
    context: DreaminaTaskContext;
    operation: DreaminaModelOperation;
    model: string;
    prompt: string;
    settings: { aspect?: string; resolution?: string; duration?: number; count?: number };
    references: unknown[];
};

export type DreaminaGenerationResult = {
    mode: "image" | "video";
    images?: Array<{ dataUrl: string; mimeType: string; bytes: number }>;
    video?: { dataUrl: string; mimeType: string; bytes: number };
};

export class LocalDreaminaGenerationError extends Error {
    constructor(readonly code: string, message: string, readonly statusCode = 500) {
        super(message);
        this.name = "LocalDreaminaGenerationError";
    }
}

type DreaminaGenerationAdapterOptions = {
    root: string;
    models: readonly DreaminaModelDescriptor[];
    coordinator?: DreaminaGenerationCoordinator;
    runtime: {
        generateToResult(input: DreaminaGenerationInput, options?: { signal?: AbortSignal; requestFingerprint?: string; clientOperationId?: string; taskContext?: DreaminaTaskContext }): Promise<DreaminaGenerationResult>;
        enqueue?(input: DreaminaGenerationInput, options?: { signal?: AbortSignal; requestFingerprint?: string; clientOperationId?: string; taskContext?: DreaminaTaskContext }): Promise<DreaminaPublicGenerationTask>;
        waitForTask?(idempotencyKey: string, mode: "image" | "video", options?: { signal?: AbortSignal }): Promise<DreaminaGenerationResult>;
    };
};

type InFlightGeneration = {
    fingerprint: string;
    controller: AbortController;
    promise: Promise<DreaminaGenerationResult>;
    waiters: number;
};

// A bounded process-local queue prevents simultaneous CLI execution bursts without changing durable receipts.
export class DreaminaGenerationCoordinator {
    private active = 0;
    private readonly waiting: Array<() => void> = [];

    constructor(private readonly limit = DEFAULT_CONCURRENCY) {
        if (!Number.isInteger(limit) || limit < 1 || limit > 32) throw new Error("Dreamina generation concurrency is invalid");
    }

    async run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        throwIfCancelled(signal);
        await this.acquire(signal);
        try {
            throwIfCancelled(signal);
            return await action();
        } finally {
            this.active -= 1;
            this.drain();
        }
    }

    private acquire(signal?: AbortSignal): Promise<void> {
        if (this.active < this.limit) {
            this.active += 1;
            return Promise.resolve();
        }
        return new Promise<void>((resolve, reject) => {
            const start = () => {
                signal?.removeEventListener("abort", cancel);
                this.active += 1;
                resolve();
            };
            const cancel = () => {
                const index = this.waiting.indexOf(start);
                if (index >= 0) this.waiting.splice(index, 1);
                reject(cancelled());
            };
            signal?.addEventListener("abort", cancel, { once: true });
            this.waiting.push(start);
        });
    }

    private drain() {
        while (this.active < this.limit && this.waiting.length) this.waiting.shift()!();
    }
}

const processCoordinator = new DreaminaGenerationCoordinator();

export class DreaminaGenerationAdapter {
    private readonly root: string;
    private readonly models: DreaminaModelDescriptor[];
    private readonly runtime: DreaminaGenerationAdapterOptions["runtime"];
    private readonly coordinator: DreaminaGenerationCoordinator;
    private readonly inFlight = new Map<string, InFlightGeneration>();

    constructor(options: DreaminaGenerationAdapterOptions) {
        if (!path.isAbsolute(options.root) || options.root.includes("\0")) throw new Error("Dreamina generation root is invalid");
        this.root = path.resolve(options.root);
        this.models = options.models.map((model) => ({ ...model, operations: [...model.operations], settings: { ...model.settings } }));
        this.runtime = options.runtime;
        this.coordinator = options.coordinator ?? processCoordinator;
    }

    run(value: unknown, options: { signal?: AbortSignal } = {}): Promise<DreaminaGenerationResult> {
        try {
            throwIfCancelled(options.signal);
            const input = parseRequest(value);
            const references = parseInlineReferences(input.references);
            validateRequestAgainstCatalog(input, references, this.models);
            const fingerprint = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
            const existing = this.inFlight.get(input.idempotencyKey);
            if (existing) {
                if (existing.fingerprint !== fingerprint) return Promise.reject(idempotencyConflict());
                return subscribe(existing, options.signal);
            }
            const controller = new AbortController();
            const record: InFlightGeneration = {
                fingerprint,
                controller,
                waiters: 0,
                promise: this.runtime.enqueue && this.runtime.waitForTask
                    ? this.execute(input, references, fingerprint, controller.signal)
                    : this.coordinator.run(() => this.execute(input, references, fingerprint, controller.signal), controller.signal),
            };
            this.inFlight.set(input.idempotencyKey, record);
            void record.promise.finally(() => {
                if (this.inFlight.get(input.idempotencyKey) === record) this.inFlight.delete(input.idempotencyKey);
            }).catch(() => undefined);
            return subscribe(record, options.signal);
        } catch (error) {
            return Promise.reject(error);
        }
    }

    async submit(value: unknown, options: { signal?: AbortSignal } = {}): Promise<DreaminaPublicGenerationTask> {
        throwIfCancelled(options.signal);
        if (!this.runtime.enqueue) throw new LocalDreaminaGenerationError("local_generation_async_unavailable", "Dreamina async generation is unavailable", 503);
        const input = parseRequest(value);
        const references = parseInlineReferences(input.references);
        validateRequestAgainstCatalog(input, references, this.models);
        const fingerprint = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        const runRoot = await fs.mkdtemp(path.join(this.root, "run-"));
        const inputRoot = path.join(runRoot, "input");
        await fs.mkdir(inputRoot, { mode: 0o700 });
        try {
            const referencePaths = await writeInlineReferences(references, inputRoot);
            return await this.runtime.enqueue(toDreaminaInput(input, referencePaths), {
                signal: options.signal,
                requestFingerprint: fingerprint,
                clientOperationId: input.clientOperationId,
                taskContext: input.context,
            });
        } finally {
            await fs.rm(runRoot, { recursive: true, force: true });
        }
    }

    private async execute(
        input: DreaminaGenerationRequest,
        references: InlineReference[],
        requestFingerprint: string,
        signal: AbortSignal,
    ) {
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        const runRoot = await fs.mkdtemp(path.join(this.root, "run-"));
        const inputRoot = path.join(runRoot, "input");
        await fs.mkdir(inputRoot, { mode: 0o700 });
        try {
            const referencePaths = await writeInlineReferences(references, inputRoot);
            const cliInput = toDreaminaInput(input, referencePaths);
            if (this.runtime.enqueue && this.runtime.waitForTask) {
                await this.runtime.enqueue(cliInput, { signal, requestFingerprint, clientOperationId: input.clientOperationId, taskContext: input.context });
                return await this.runtime.waitForTask(input.idempotencyKey, input.operation.endsWith("image") ? "image" : "video", { signal });
            }
            return await this.runtime.generateToResult(cliInput, { signal, requestFingerprint, clientOperationId: input.clientOperationId, taskContext: input.context });
        } finally {
            await fs.rm(runRoot, { recursive: true, force: true });
        }
    }
}

function subscribe(record: InFlightGeneration, signal?: AbortSignal): Promise<DreaminaGenerationResult> {
    try { throwIfCancelled(signal); } catch (error) { return Promise.reject(error); }
    record.waiters += 1;
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = () => {
            if (settled) return false;
            settled = true;
            signal?.removeEventListener("abort", cancel);
            record.waiters -= 1;
            return true;
        };
        const cancel = () => {
            if (!finish()) return;
            if (record.waiters === 0) record.controller.abort();
            reject(cancelled());
        };
        signal?.addEventListener("abort", cancel, { once: true });
        record.promise.then(
            (result) => { if (finish()) resolve(cloneResult(result)); },
            (error) => { if (finish()) reject(error); },
        );
        if (signal?.aborted) cancel();
    });
}

function parseRequest(value: unknown): DreaminaGenerationRequest {
    const source = record(value);
    const allowed = new Set(["idempotencyKey", "clientOperationId", "context", "operation", "model", "prompt", "settings", "references"]);
    if (Object.keys(source).some((key) => !allowed.has(key))) throw requestInvalid();
    const settings = record(source.settings);
    const settingKeys = new Set(["aspect", "resolution", "duration", "count"]);
    if (Object.keys(settings).some((key) => !settingKeys.has(key))) throw requestInvalid();
    const operation = safeString(source.operation, /^(?:text-to-image|image-to-image|text-to-video|image-to-video|reference-to-video)$/) as DreaminaModelOperation;
    const duration = settings.duration === undefined ? undefined : boundedInteger(settings.duration, 1, 60);
    const count = settings.count === undefined ? undefined : boundedInteger(settings.count, 1, 4);
    if (operation.endsWith("video") && count !== undefined && count !== 1) throw requestInvalid();
    if (operation.endsWith("image") && duration !== undefined) throw requestInvalid();
    const idempotencyKey = safeString(source.idempotencyKey, /^[A-Za-z0-9._:-]{16,120}$/);
    return {
        idempotencyKey,
        clientOperationId: source.clientOperationId === undefined
            ? idempotencyKey
            : safeString(source.clientOperationId, /^[A-Za-z0-9._:-]{16,120}$/),
        context: source.context === undefined ? { scope: "legacy_unscoped" } : parseTaskContext(source.context),
        operation,
        model: safeString(source.model, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/),
        prompt: nonBlankPrompt(source.prompt),
        settings: {
            ...(settings.aspect === undefined ? {} : { aspect: safeString(settings.aspect, /^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$/) }),
            ...(settings.resolution === undefined ? {} : { resolution: safeString(settings.resolution, /^(?:auto|1k|2k|4k|480|720|1080|2160|480p|720p|1080p)$/) }),
            ...(duration === undefined ? {} : { duration }),
            ...(count === undefined ? {} : { count }),
        },
        references: Array.isArray(source.references) ? source.references : [],
    };
}

type InlineReference =
    | { kind: "image"; mimeType: "image/png" | "image/jpeg" | "image/webp"; contentBase64: string; metadata?: Record<string, string | number> }
    | { kind: "video"; mimeType: "video/mp4" | "video/quicktime" | "video/webm"; contentBase64: string; metadata?: Record<string, string | number> }
    | { kind: "audio"; mimeType: "audio/mpeg" | "audio/wav" | "audio/mp4" | "audio/aac" | "audio/flac"; contentBase64: string; metadata?: Record<string, string | number> };

function parseInlineReferences(value: unknown): InlineReference[] {
    if (!Array.isArray(value) || value.length > MAX_REFERENCE_IMAGES + MAX_REFERENCE_VIDEOS + MAX_REFERENCE_AUDIOS) throw requestInvalid();
    let bytes = 0;
    const counts = { image: 0, video: 0, audio: 0 };
    return value.map((item) => {
        const source = record(item);
        const kind = safeString(source.kind, /^(?:image|video|audio)$/) as InlineReference["kind"];
        counts[kind] += 1;
        if (counts.image > MAX_REFERENCE_IMAGES || counts.video > MAX_REFERENCE_VIDEOS || counts.audio > MAX_REFERENCE_AUDIOS) throw requestInvalid();
        const allowedMimeTypes = kind === "image"
            ? ["image/png", "image/jpeg", "image/webp"]
            : kind === "video"
                ? ["video/mp4", "video/quicktime", "video/webm"]
                : ["audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/flac"];
        if (Object.keys(source).some((key) => !["kind", "mimeType", "contentBase64", "metadata"].includes(key))
            || !allowedMimeTypes.includes(String(source.mimeType))
            || typeof source.contentBase64 !== "string"
            || !/^[A-Za-z0-9+/]+={0,2}$/.test(source.contentBase64)) throw requestInvalid();
        const buffer = Buffer.from(source.contentBase64, "base64");
        if (!buffer.byteLength || buffer.toString("base64") !== source.contentBase64
            || !hasExpectedMediaSignature(buffer, String(source.mimeType))) throw requestInvalid();
        bytes += buffer.byteLength;
        if (bytes > MAX_REFERENCE_BYTES) throw requestInvalid();
        const metadata = parseReferenceMetadata(source.metadata, kind);
        return {
            kind,
            mimeType: source.mimeType,
            contentBase64: source.contentBase64,
            ...(metadata ? { metadata } : {}),
        } as InlineReference;
    });
}

function validateRequestAgainstCatalog(
    input: DreaminaGenerationRequest,
    references: InlineReference[],
    models: readonly DreaminaModelDescriptor[],
) {
    const imageCount = references.filter((reference) => reference.kind === "image").length;
    const referenceCount = references.length;
    const model = models.find((candidate) => candidate.id === input.model);
    const expectedModality = input.operation === "text-to-image" || input.operation === "image-to-image" ? "image" : "video";
    if (!model || model.modality !== expectedModality || !model.operations.includes(input.operation)) throw modelUnavailable();
    if (input.settings.aspect && !model.settings.aspects.includes(input.settings.aspect)) throw modelUnavailable();
    if (imageCount > model.settings.maxReferenceImages) throw modelUnavailable();
    if ((input.operation === "text-to-image" || input.operation === "text-to-video") && referenceCount !== 0) throw requestInvalid();
    if (input.operation !== "text-to-image" && input.operation !== "text-to-video" && referenceCount < 1) throw requestInvalid();
    if (input.settings.duration !== undefined && (
        model.settings.minDuration === undefined
        || model.settings.maxDuration === undefined
        || input.settings.duration < model.settings.minDuration
        || input.settings.duration > model.settings.maxDuration
    )) throw modelUnavailable();
}

type StagedInlineReferences = { images: string[]; videos: string[]; audios: string[] };

function toDreaminaInput(input: DreaminaGenerationRequest, referencePaths: StagedInlineReferences): DreaminaGenerationInput {
    const common = { idempotencyKey: input.idempotencyKey, prompt: input.prompt, modelVersion: input.model };
    const candidate: unknown = input.operation === "text-to-image"
        ? { operation: "text2image", ...common, ratio: input.settings.aspect, resolutionType: imageResolution(input.settings.resolution), generateNum: input.settings.count }
        : input.operation === "image-to-image"
            ? { operation: "image2image", ...common, ratio: input.settings.aspect, resolutionType: imageResolution(input.settings.resolution), generateNum: input.settings.count, referenceImages: referencePaths.images }
            : input.operation === "text-to-video"
                ? { operation: "text2video", ...common, ratio: input.settings.aspect, videoResolution: videoResolution(input.settings.resolution), duration: input.settings.duration }
                : input.operation === "image-to-video" && referencePaths.images.length <= 2 && !referencePaths.videos.length && !referencePaths.audios.length
                    ? { operation: referencePaths.images.length === 2 ? "frames2video" : "image2video", ...common, videoResolution: videoResolution(input.settings.resolution), duration: input.settings.duration, referenceImages: referencePaths.images }
                    : {
                        operation: "multimodal2video",
                        ...common,
                        ratio: input.settings.aspect,
                        videoResolution: videoResolution(input.settings.resolution),
                        duration: input.settings.duration,
                        referenceImages: referencePaths.images,
                        referenceVideos: referencePaths.videos,
                        referenceAudios: referencePaths.audios,
                    };
    const parsed = dreaminaCliInputSchema.safeParse(removeUndefined(candidate));
    if (!parsed.success || parsed.data.operation === "query_result") throw requestInvalid();
    return parsed.data;
}

function parseTaskContext(value: unknown): DreaminaTaskContext {
    const context = record(value);
    if (context.scope === "legacy_unscoped") {
        if (Object.keys(context).some((key) => key !== "scope")) throw requestInvalid();
        return { scope: "legacy_unscoped" };
    }
    if (context.scope !== "scoped") throw requestInvalid();
    const allowed = ["scope", "projectId", "nodeId", "conversationId", "messageId", "batchIndex", "batchCount", "retryOf", "attemptGroupId"];
    if (Object.keys(context).some((key) => !allowed.includes(key))) throw requestInvalid();
    const result: Extract<DreaminaTaskContext, { scope: "scoped" }> = { scope: "scoped" };
    for (const key of ["projectId", "nodeId", "conversationId", "messageId", "retryOf", "attemptGroupId"] as const) {
        if (context[key] === undefined) continue;
        result[key] = safeString(context[key], /^[^\u0000-\u001f\u007f]{1,200}$/);
    }
    if (context.batchIndex !== undefined) result.batchIndex = boundedInteger(context.batchIndex, 0, 1_000_000);
    if (context.batchCount !== undefined) result.batchCount = boundedInteger(context.batchCount, 1, 1_000_000);
    return result;
}

function parseReferenceMetadata(value: unknown, kind: InlineReference["kind"]) {
    if (value === undefined) return undefined;
    const metadata = record(value);
    const allowed = kind === "image" ? ["name", "width", "height"]
        : kind === "video" ? ["name", "width", "height", "durationMs"]
            : ["name", "durationMs"];
    if (Object.keys(metadata).some((key) => !allowed.includes(key))) throw requestInvalid();
    const result: Record<string, string | number> = {};
    if (metadata.name !== undefined) result.name = safeString(metadata.name, /^[^\u0000-\u001f\u007f]{1,200}$/);
    for (const key of ["width", "height", "durationMs"]) {
        if (metadata[key] !== undefined) result[key] = boundedInteger(metadata[key], 1, 2_147_483_647);
    }
    return result;
}

function imageResolution(value: string | undefined) {
    return value === undefined || value === "auto" ? "2k" : value;
}

function videoResolution(value: string | undefined) {
    if (value === undefined) return "720p";
    return ({
        "480": "480p",
        "720": "720p",
        "1080": "1080p",
        "2160": "4k",
    } as const)[value as "480" | "720" | "1080" | "2160"] ?? value;
}

async function writeInlineReferences(references: InlineReference[], root: string): Promise<StagedInlineReferences> {
    const files: StagedInlineReferences = { images: [], videos: [], audios: [] };
    const counters = { image: 0, video: 0, audio: 0 };
    for (const reference of references) {
        const index = ++counters[reference.kind];
        const extension = referenceExtension(reference.mimeType);
        const file = path.join(root, `${reference.kind}-${String(index).padStart(2, "0")}${extension}`);
        await fs.writeFile(file, Buffer.from(reference.contentBase64, "base64"), { flag: "wx", mode: 0o600 });
        files[reference.kind === "image" ? "images" : reference.kind === "video" ? "videos" : "audios"].push(file);
    }
    return files;
}

function referenceExtension(mimeType: InlineReference["mimeType"]) {
    return ({
        "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
        "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
        "audio/mpeg": ".mp3", "audio/wav": ".wav", "audio/mp4": ".m4a", "audio/aac": ".aac", "audio/flac": ".flac",
    } as const)[mimeType];
}

function cloneResult(result: DreaminaGenerationResult): DreaminaGenerationResult {
    return result.mode === "image"
        ? { mode: "image", images: result.images?.map((image) => ({ ...image })) }
        : { mode: "video", video: result.video ? { ...result.video } : undefined };
}

export async function collectDreaminaGenerationResult(root: string, mode: "image" | "video"): Promise<DreaminaGenerationResult> {
    if (!path.isAbsolute(root) || root.includes("\0")) throw resultInvalid();
    const resolvedRoot = path.resolve(root);
    const extensions = mode === "image" ? imageExtensions : videoExtensions;
    const files = (await collectRegularMediaFiles(resolvedRoot, resolvedRoot))
        .filter((file) => extensions.has(path.extname(file).toLowerCase()));
    if (!files.length || files.length > MAX_RESULT_FILES || (mode === "video" && files.length !== 1)) throw resultInvalid();
    const media = await Promise.all(files.map(async (file) => {
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_RESULT_BYTES) throw resultInvalid();
        const buffer = await fs.readFile(file);
        const mimeType = extensions.get(path.extname(file).toLowerCase())!;
        if (!hasExpectedMediaSignature(buffer, mimeType)) throw resultInvalid();
        return { dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`, mimeType, bytes: buffer.byteLength };
    }));
    if (media.reduce((sum, item) => sum + item.bytes, 0) > MAX_RESULT_BYTES) throw resultInvalid();
    return mode === "image" ? { mode, images: media } : { mode, video: media[0] };
}

async function collectRegularMediaFiles(root: string, directory: string, depth = 0): Promise<string[]> {
    if (depth > 4) throw resultInvalid();
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const result: string[] = [];
    for (const entry of entries) {
        if (entry.isSymbolicLink()) throw resultInvalid();
        const child = safeChild(root, path.join(directory, entry.name));
        if (entry.isDirectory()) result.push(...await collectRegularMediaFiles(root, child, depth + 1));
        else if (entry.isFile()) result.push(child);
        if (result.length > MAX_RESULT_FILES * 4) throw resultInvalid();
    }
    return result.sort();
}

function safeChild(root: string, child: string) {
    const resolved = path.resolve(child);
    const relative = path.relative(root, resolved);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw resultInvalid();
    return resolved;
}

function hasExpectedMediaSignature(buffer: Buffer, mimeType: string) {
    if (mimeType === "image/png") return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (mimeType === "image/jpeg") return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    if (mimeType === "image/webp") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") return buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp";
    if (mimeType === "video/webm") return buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (mimeType === "audio/mpeg") return buffer.length >= 3 && (buffer.toString("ascii", 0, 3) === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0));
    if (mimeType === "audio/wav") return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE";
    if (mimeType === "audio/mp4") return buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp";
    if (mimeType === "audio/aac") return buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0;
    if (mimeType === "audio/flac") return buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "fLaC";
    return false;
}

function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw requestInvalid();
    return value as Record<string, unknown>;
}

function safeString(value: unknown, pattern: RegExp) {
    if (typeof value !== "string" || !pattern.test(value)) throw requestInvalid();
    return value;
}

function nonBlankPrompt(value: unknown) {
    const prompt = safeString(value, /^[\s\S]{1,20000}$/).trim();
    if (!prompt) throw requestInvalid();
    return prompt;
}

function boundedInteger(value: unknown, min: number, max: number) {
    if (!Number.isInteger(value) || typeof value !== "number" || value < min || value > max) throw requestInvalid();
    return value;
}

function removeUndefined(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(removeUndefined);
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => child === undefined ? [] : [[key, removeUndefined(child)]]));
}

function throwIfCancelled(signal?: AbortSignal) {
    if (signal?.aborted) throw cancelled();
}

function cancelled() { return new LocalDreaminaGenerationError("local_generation_cancelled", "本机生成已取消", 499); }
function idempotencyConflict() { return new LocalDreaminaGenerationError("local_generation_idempotency_conflict", "同一幂等键不能用于不同本机生成请求", 409); }
function modelUnavailable() { return new LocalDreaminaGenerationError("local_generation_model_unavailable", "所选本机模型或操作不可用", 409); }
function requestInvalid() { return new LocalDreaminaGenerationError("local_generation_request_invalid", "本机生成请求无效", 400); }
export function unknownGenerationResult() { return new LocalDreaminaGenerationError("local_generation_unknown", "本机生成结果未确认，已禁止自动重试", 409); }
function resultInvalid() { return new LocalDreaminaGenerationError("local_generation_result_invalid", "本机生成结果无法识别", 502); }
