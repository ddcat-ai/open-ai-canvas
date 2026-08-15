import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import type { DreaminaGenerationResult } from "./dreamina-generation.js";
import type { RuntimeProviderOutput } from "./dreamina-cli-state.js";

type ArtifactBinding = {
    ownerId: string;
    idempotencyKey: string;
    accountBinding?: string;
    fenceEpoch?: number;
    mode: "image" | "video";
};

type ArtifactManifest = {
    version: 1;
    setId: string;
    ownerBinding: string;
    taskBinding: string;
    accountBinding: string | null;
    fenceEpoch: number;
    mode: "image" | "video";
    outputs: Array<{
        outputIndex: number;
        mediaType: "image" | "video";
        mimeType: string;
        bytes: number;
        sha256: string;
    }>;
    createdAt: string;
};

const REF_PATTERN = /^dreamina-provider-artifact:([a-f0-9-]{36}):([0-3])$/;
const SET_PATTERN = /^set-([a-f0-9-]{36})$/;
const TEMP_PATTERN = /^\.tmp-([a-f0-9-]{36})$/;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_OUTPUTS = 4;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1_000;

export class DreaminaProviderArtifactStore {
    private readonly root: string;
    private readonly now: () => Date;
    private readonly statScavengeCandidate: (target: string) => ReturnType<typeof fs.lstat>;

    constructor(options: {
        root: string;
        now?: () => Date;
        statScavengeCandidate?: (target: string) => ReturnType<typeof fs.lstat>;
    }) {
        if (!path.isAbsolute(options.root) || options.root.includes("\0")) throw artifactInvalid();
        this.root = path.resolve(options.root);
        this.now = options.now ?? (() => new Date());
        this.statScavengeCandidate = options.statScavengeCandidate ?? ((target) => fs.lstat(target));
    }

    async persistResult(
        result: DreaminaGenerationResult,
        binding: ArtifactBinding,
    ): Promise<RuntimeProviderOutput[]> {
        validateBinding(binding);
        const media = decodeResult(result, binding.mode);
        await ensurePrivateDirectory(this.root);
        const setId = crypto.randomUUID();
        const temporary = path.join(this.root, `.tmp-${setId}`);
        const destination = path.join(this.root, `set-${setId}`);
        await fs.mkdir(temporary, { mode: 0o700 });
        await fs.chmod(temporary, 0o700);
        try {
            const outputs: ArtifactManifest["outputs"] = [];
            for (const [outputIndex, item] of media.entries()) {
                await writeSynced(path.join(temporary, mediaName(outputIndex)), item.bytes);
                outputs.push({
                    outputIndex,
                    mediaType: binding.mode,
                    mimeType: item.mimeType,
                    bytes: item.bytes.byteLength,
                    sha256: sha256(item.bytes),
                });
            }
            const manifest: ArtifactManifest = {
                version: 1,
                setId,
                ownerBinding: sha256(Buffer.from(binding.ownerId)),
                taskBinding: sha256(Buffer.from(binding.idempotencyKey)),
                accountBinding: binding.accountBinding ?? null,
                fenceEpoch: binding.fenceEpoch ?? 0,
                mode: binding.mode,
                outputs,
                createdAt: this.now().toISOString(),
            };
            await writeSynced(path.join(temporary, "manifest.json"), Buffer.from(JSON.stringify(manifest)));
            await syncDirectory(temporary);
            await fs.rename(temporary, destination);
            await fs.chmod(destination, 0o700);
            await syncDirectory(this.root);
            return outputs.map((output) => ({
                outputIndex: output.outputIndex,
                mediaType: output.mediaType,
                providerArtifactRef: artifactRef(setId, output.outputIndex),
            }));
        } catch (error) {
            await fs.rm(temporary, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        }
    }

    async readResult(
        outputs: readonly RuntimeProviderOutput[],
        binding: ArtifactBinding,
    ): Promise<DreaminaGenerationResult> {
        validateBinding(binding);
        const refs = outputs.map((output) => parseRef(output.providerArtifactRef));
        if (!refs.length || refs.length > MAX_OUTPUTS || refs.some((ref) => ref.setId !== refs[0]!.setId)) throw artifactInvalid();
        const setRoot = path.join(this.root, `set-${refs[0]!.setId}`);
        await assertPrivateDirectory(setRoot);
        const manifest = await readManifest(path.join(setRoot, "manifest.json"));
        if (manifest.setId !== refs[0]!.setId
            || manifest.ownerBinding !== sha256(Buffer.from(binding.ownerId))
            || manifest.taskBinding !== sha256(Buffer.from(binding.idempotencyKey))
            || manifest.accountBinding !== (binding.accountBinding ?? null)
            || manifest.fenceEpoch !== (binding.fenceEpoch ?? 0)
            || manifest.mode !== binding.mode
            || manifest.outputs.length !== outputs.length) throw artifactInvalid();

        const media: Array<{ dataUrl: string; mimeType: string; bytes: number }> = [];
        let totalBytes = 0;
        for (const [position, output] of outputs.entries()) {
            const ref = refs[position]!;
            const metadata = manifest.outputs.find((candidate) => candidate.outputIndex === ref.outputIndex);
            if (!metadata || output.outputIndex !== ref.outputIndex || output.mediaType !== binding.mode
                || metadata.mediaType !== binding.mode) throw artifactInvalid();
            const file = path.join(setRoot, mediaName(ref.outputIndex));
            const stats = await fs.lstat(file);
            if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size !== metadata.bytes) throw artifactInvalid();
            const bytes = await fs.readFile(file);
            totalBytes += bytes.byteLength;
            if (totalBytes > MAX_TOTAL_BYTES || sha256(bytes) !== metadata.sha256
                || !validMedia(bytes, metadata.mimeType, binding.mode)) throw artifactInvalid();
            media.push({
                dataUrl: `data:${metadata.mimeType};base64,${bytes.toString("base64")}`,
                mimeType: metadata.mimeType,
                bytes: bytes.byteLength,
            });
        }
        return binding.mode === "image"
            ? { mode: "image", images: media }
            : { mode: "video", video: media[0] };
    }

    async scavenge(liveOutputs: readonly RuntimeProviderOutput[]) {
        await ensurePrivateDirectory(this.root);
        const liveSets = new Set(liveOutputs.map((output) => parseRef(output.providerArtifactRef).setId));
        const cutoff = this.now().getTime() - ORPHAN_GRACE_MS;
        for (const entry of await fs.readdir(this.root, { withFileTypes: true })) {
            const temporary = TEMP_PATTERN.exec(entry.name);
            const stored = SET_PATTERN.exec(entry.name);
            if ((!temporary && !stored) || !entry.isDirectory()) continue;
            if (stored && liveSets.has(stored[1]!)) continue;
            const target = path.join(this.root, entry.name);
            let stats: Awaited<ReturnType<typeof fs.lstat>>;
            try {
                stats = await this.statScavengeCandidate(target);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
                throw error;
            }
            if (stats.isSymbolicLink() || stats.mtimeMs > cutoff) continue;
            await fs.rm(target, { recursive: true, force: true });
        }
    }
}

function decodeResult(result: DreaminaGenerationResult, mode: "image" | "video") {
    if (result.mode !== mode) throw artifactInvalid();
    const source = mode === "image" ? result.images : result.video ? [result.video] : [];
    if (!source?.length || source.length > MAX_OUTPUTS || (mode === "video" && source.length !== 1)) throw artifactInvalid();
    let totalBytes = 0;
    return source.map((item) => {
        if (!item || typeof item.mimeType !== "string" || typeof item.dataUrl !== "string"
            || !Number.isSafeInteger(item.bytes) || item.bytes <= 0) throw artifactInvalid();
        const prefix = `data:${item.mimeType};base64,`;
        if (!item.dataUrl.startsWith(prefix)) throw artifactInvalid();
        const encoded = item.dataUrl.slice(prefix.length);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw artifactInvalid();
        const bytes = Buffer.from(encoded, "base64");
        totalBytes += bytes.byteLength;
        if (bytes.byteLength !== item.bytes || bytes.toString("base64") !== encoded
            || totalBytes > MAX_TOTAL_BYTES || !validMedia(bytes, item.mimeType, mode)) throw artifactInvalid();
        return { bytes, mimeType: item.mimeType };
    });
}

async function readManifest(file: string): Promise<ArtifactManifest> {
    const stats = await fs.lstat(file);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size <= 0 || stats.size > 16_384) throw artifactInvalid();
    let value: unknown;
    try { value = JSON.parse(await fs.readFile(file, "utf8")); } catch { throw artifactInvalid(); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw artifactInvalid();
    const manifest = value as Partial<ArtifactManifest>;
    if (Object.keys(value).some((key) => !["version", "setId", "ownerBinding", "taskBinding", "accountBinding", "fenceEpoch", "mode", "outputs", "createdAt"].includes(key))
        || manifest.version !== 1 || !UUID_PATTERN.test(manifest.setId ?? "")
        || !/^[a-f0-9]{64}$/.test(manifest.ownerBinding ?? "")
        || !/^[a-f0-9]{64}$/.test(manifest.taskBinding ?? "")
        || (manifest.accountBinding !== null && !/^[a-f0-9]{64}$/.test(manifest.accountBinding ?? ""))
        || !Number.isSafeInteger(manifest.fenceEpoch) || (manifest.fenceEpoch ?? -1) < 0
        || (manifest.mode !== "image" && manifest.mode !== "video")
        || typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))
        || !Array.isArray(manifest.outputs) || !manifest.outputs.length || manifest.outputs.length > MAX_OUTPUTS
        || manifest.outputs.some((output) => !validManifestOutput(output))) throw artifactInvalid();
    const indexes = new Set(manifest.outputs.map((output) => output.outputIndex));
    if (indexes.size !== manifest.outputs.length) throw artifactInvalid();
    return manifest as ArtifactManifest;
}

function validManifestOutput(value: unknown): value is ArtifactManifest["outputs"][number] {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const output = value as Partial<ArtifactManifest["outputs"][number]>;
    return Object.keys(value).every((key) => ["outputIndex", "mediaType", "mimeType", "bytes", "sha256"].includes(key))
        && Number.isSafeInteger(output.outputIndex) && (output.outputIndex ?? -1) >= 0 && (output.outputIndex ?? 4) < MAX_OUTPUTS
        && (output.mediaType === "image" || output.mediaType === "video")
        && typeof output.mimeType === "string"
        && Number.isSafeInteger(output.bytes) && (output.bytes ?? 0) > 0 && (output.bytes ?? 0) <= MAX_TOTAL_BYTES
        && /^[a-f0-9]{64}$/.test(output.sha256 ?? "");
}

function validMedia(bytes: Buffer, mimeType: string, mode: "image" | "video") {
    if (mode === "image") {
        if (mimeType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
        if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
        return mimeType === "image/webp" && bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    }
    if (mimeType === "video/mp4" || mimeType === "video/quicktime") return bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp";
    return mimeType === "video/webm" && bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
}

function validateBinding(binding: ArtifactBinding) {
    if (!/^[A-Za-z0-9._-]{16,120}$/.test(binding.ownerId)
        || !/^[A-Za-z0-9._:-]{8,160}$/.test(binding.idempotencyKey)
        || (binding.accountBinding !== undefined && !/^[a-f0-9]{64}$/.test(binding.accountBinding))
        || (binding.fenceEpoch !== undefined && (!Number.isSafeInteger(binding.fenceEpoch) || binding.fenceEpoch < 1))
        || (binding.mode !== "image" && binding.mode !== "video")) throw artifactInvalid();
}

function artifactRef(setId: string, outputIndex: number) {
    return `dreamina-provider-artifact:${setId}:${outputIndex}`;
}

function parseRef(value: string) {
    const match = REF_PATTERN.exec(value);
    if (!match || !UUID_PATTERN.test(match[1]!)) throw artifactInvalid();
    return { setId: match[1]!, outputIndex: Number(match[2]) };
}

function mediaName(outputIndex: number) {
    return `${String(outputIndex).padStart(3, "0")}.media`;
}

async function writeSynced(file: string, bytes: Buffer) {
    const handle = await fs.open(file, "wx", 0o600);
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    } finally {
        await handle.close();
    }
    await fs.chmod(file, 0o600);
}

async function ensurePrivateDirectory(directory: string) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
}

async function assertPrivateDirectory(directory: string) {
    const stats = await fs.lstat(directory);
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw artifactInvalid();
}

async function syncDirectory(directory: string) {
    if (process.platform === "win32") return;
    const handle = await fs.open(directory, "r");
    try { await handle.sync(); } finally { await handle.close(); }
}

function sha256(value: Buffer) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function artifactInvalid() {
    return new Error("Dreamina provider artifact is invalid");
}
