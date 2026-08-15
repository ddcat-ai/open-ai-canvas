import fs, { type FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";

import type { DreaminaGenerationInput } from "./dreamina-cli-contract.js";
import { DreaminaCliError } from "./dreamina-cli-process.js";
import type { StateLockLease } from "./dreamina-cli-state.js";

type ReferenceKind = "image" | "video" | "audio";
type ReferenceInput = DreaminaGenerationInput & {
    referenceImages?: string[];
    referenceVideos?: string[];
    referenceAudios?: string[];
};
type PreparedReference = { handle: FileHandle; before: Stats; sourcePath: string; canonicalPath: string; extension: string; closed: boolean };

const IMAGE_MAX_BYTES = 32 * 1024 * 1024;
const MEDIA_MAX_BYTES = 512 * 1024 * 1024;
const STAGING_MAX_BYTES = 1024 * 1024 * 1024;
const STAGING_PREFIX = ".dreamina-references-";
const STAGING_DIRECTORY_PATTERN = /^\.dreamina-references-[A-Za-z0-9]{6}$/;
const STAGING_STALE_MS = 24 * 60 * 60 * 1000;

export async function stageReferences(
    input: DreaminaGenerationInput,
    roots: readonly string[],
    ownerStateDirectory: string,
    signal?: AbortSignal,
) {
    throwIfCancelled(signal);
    const source = input as ReferenceInput;
    if (!source.referenceImages?.length && !source.referenceVideos?.length && !source.referenceAudios?.length) {
        return { input, cleanup: async () => undefined };
    }
    const canonicalRoots: string[] = [];
    try {
        for (const root of roots) {
            try {
                const canonical = await fs.realpath(root);
                if (!(await fs.stat(canonical)).isDirectory()) throw new Error("not a directory");
                canonicalRoots.push(canonical);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
        }
    } catch {
        throw referenceInvalid();
    }
    if (!canonicalRoots.length) throw referenceInvalid();

    const prepared: PreparedReference[] = [];
    let stagingDirectory = "";
    try {
        let totalBytes = 0;
        const prepareGroup = async (values: string[] | undefined, kind: ReferenceKind) => {
            if (!values) return undefined;
            const result: PreparedReference[] = [];
            for (const value of values) {
                throwIfCancelled(signal);
                const reference = await prepareReference(value, kind, canonicalRoots);
                prepared.push(reference);
                result.push(reference);
                totalBytes += reference.before.size;
                if (totalBytes > STAGING_MAX_BYTES) throw referenceBudgetExceeded();
            }
            return result;
        };
        const preparedImages = await prepareGroup(source.referenceImages, "image");
        const preparedVideos = await prepareGroup(source.referenceVideos, "video");
        const preparedAudios = await prepareGroup(source.referenceAudios, "audio");
        throwIfCancelled(signal);
        await fs.mkdir(ownerStateDirectory, { recursive: true, mode: 0o700 });
        stagingDirectory = await fs.mkdtemp(path.join(ownerStateDirectory, STAGING_PREFIX));
        await fs.chmod(stagingDirectory, 0o700);
        const stageGroup = async (values: PreparedReference[] | undefined) => {
            if (!values) return undefined;
            const result: string[] = [];
            for (const value of values) {
                result.push(await stagePreparedReference(value, stagingDirectory, signal));
            }
            return result;
        };
        const referenceImages = await stageGroup(preparedImages);
        const referenceVideos = await stageGroup(preparedVideos);
        const referenceAudios = await stageGroup(preparedAudios);
        return {
            input: {
                ...input,
                ...(referenceImages ? { referenceImages } : {}),
                ...(referenceVideos ? { referenceVideos } : {}),
                ...(referenceAudios ? { referenceAudios } : {}),
            } as DreaminaGenerationInput,
            cleanup: () => removeStagingDirectory(stagingDirectory),
        };
    } catch (error) {
        let cleanupFailed = false;
        try { await closePreparedReferences(prepared); } catch { cleanupFailed = true; }
        if (stagingDirectory) {
            try { await fs.rm(stagingDirectory, { recursive: true, force: true }); }
            catch { cleanupFailed = true; }
        }
        if (cleanupFailed) throw referenceCleanupFailed();
        if (error instanceof DreaminaCliError) throw error;
        throw referenceInvalid();
    }
}

async function prepareReference(value: string, kind: ReferenceKind, roots: readonly string[]): Promise<PreparedReference> {
    if (!path.isAbsolute(value) || value.includes("\0") || /^(?:\\\\|\/\/|\\\\[.?]\\)/.test(value)
        || value.split(/[\\/]+/).includes("..")) {
        throw referenceInvalid();
    }
    let handle: FileHandle | undefined;
    try {
        const pathBefore = await fs.lstat(value);
        if (pathBefore.isSymbolicLink()) throw new Error("link");
        const canonical = await fs.realpath(value);
        if (!roots.some((root) => isWithin(root, canonical))) throw new Error("outside root");
        const canonicalBefore = await fs.stat(canonical);
        if (!sameFileSnapshot(pathBefore, canonicalBefore)) throw new Error("reference path changed");
        handle = await fs.open(canonical, "r");
        const before = await handle.stat();
        if (!sameFileSnapshot(pathBefore, before) || !sameFileSnapshot(canonicalBefore, before)) throw new Error("reference path changed");
        const maxBytes = kind === "image" ? IMAGE_MAX_BYTES : MEDIA_MAX_BYTES;
        if (!before.isFile() || before.nlink !== 1 || before.size < 4 || before.size > maxBytes) {
            throw new Error("invalid file");
        }
        const header = Buffer.alloc(16);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const extension = path.extname(canonical).toLowerCase();
        if (!validMedia(kind, extension, header.subarray(0, bytesRead))) throw new Error("invalid media");
        return { handle, before, sourcePath: value, canonicalPath: canonical, extension, closed: false };
    } catch (error) {
        if (handle) {
            try { await handle.close(); } catch { throw referenceCleanupFailed(); }
        }
        if (error instanceof DreaminaCliError) throw error;
        throw referenceInvalid();
    }
}

async function stagePreparedReference(reference: PreparedReference, stagingDirectory: string, signal?: AbortSignal) {
    let stagedPath = "";
    let staged: FileHandle | undefined;
    let failure: unknown;
    try {
        throwIfCancelled(signal);
        stagedPath = path.join(stagingDirectory, `${crypto.randomUUID()}${reference.extension}`);
        staged = await fs.open(stagedPath, "wx", 0o600);
        const buffer = Buffer.allocUnsafe(Math.min(1024 * 1024, reference.before.size));
        let position = 0;
        while (position < reference.before.size) {
            throwIfCancelled(signal);
            const length = Math.min(buffer.length, reference.before.size - position);
            const copied = await reference.handle.read(buffer, 0, length, position);
            if (copied.bytesRead !== length) throw new Error("reference changed");
            let written = 0;
            while (written < copied.bytesRead) {
                throwIfCancelled(signal);
                const result = await staged.write(buffer, written, copied.bytesRead - written, position + written);
                if (result.bytesWritten <= 0 || result.bytesWritten > copied.bytesRead - written) {
                    throw new Error("staged write made no progress");
                }
                written += result.bytesWritten;
            }
            position += copied.bytesRead;
        }
        await staged.sync();
        if ((await staged.stat()).size !== reference.before.size) throw new Error("staged size mismatch");
        const after = await reference.handle.stat();
        const pathAfter = await fs.lstat(reference.sourcePath);
        const canonicalAfter = await fs.realpath(reference.sourcePath);
        if (pathAfter.isSymbolicLink()
            || canonicalAfter !== reference.canonicalPath
            || !sameFileSnapshot(reference.before, after)
            || !sameFileSnapshot(pathAfter, after)) {
            throw new Error("reference changed");
        }
    } catch (error) {
        failure = error;
    }
    let cleanupFailed = false;
    if (staged) {
        try { await staged.close(); } catch { cleanupFailed = true; }
    }
    try { await closePreparedReference(reference); } catch { cleanupFailed = true; }
    if (failure && stagedPath) {
        try { await fs.rm(stagedPath, { force: true }); } catch { cleanupFailed = true; }
    }
    if (cleanupFailed) throw referenceCleanupFailed();
    if (failure instanceof DreaminaCliError) throw failure;
    if (failure) throw referenceInvalid();
    return stagedPath;
}

async function closePreparedReference(reference: PreparedReference) {
    if (reference.closed) return;
    reference.closed = true;
    await reference.handle.close();
}

async function closePreparedReferences(references: readonly PreparedReference[]) {
    let failed = false;
    for (const reference of references) {
        try { await closePreparedReference(reference); } catch { failed = true; }
    }
    if (failed) throw referenceCleanupFailed();
}

async function removeStagingDirectory(directory: string) {
    try { await fs.rm(directory, { recursive: true, force: true }); }
    catch { throw referenceCleanupFailed(); }
}

export async function scavengeStaleStagingDirectories(directory: string, lease: StateLockLease) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw referenceCleanupFailed();
    }
    for (const entry of entries) {
        if (!entry.isDirectory() || !STAGING_DIRECTORY_PATTERN.test(entry.name)) continue;
        const candidate = path.join(directory, entry.name);
        let stats: Stats;
        try { stats = await fs.lstat(candidate); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw referenceCleanupFailed();
        }
        if (!stats.isDirectory() || stats.isSymbolicLink() || Date.now() - stats.mtimeMs <= STAGING_STALE_MS) continue;
        await lease.assertOwned();
        try { await fs.rm(candidate, { recursive: true, force: true }); }
        catch { throw referenceCleanupFailed(); }
    }
}

function sameFileSnapshot(left: Stats, right: Stats) {
    return left.isFile() && right.isFile()
        && left.dev === right.dev
        && left.ino === right.ino
        && left.nlink === right.nlink
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
}

function isWithin(root: string, candidate: string) {
    const relative = path.relative(root, candidate);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function validMedia(kind: ReferenceKind, extension: string, header: Buffer) {
    const ascii = header.toString("ascii");
    if (kind === "image") {
        if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return false;
        return (extension === ".png" && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
            || ([".jpg", ".jpeg"].includes(extension) && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff)
            || (extension === ".webp" && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP");
    }
    if (kind === "video") {
        if (![".mp4", ".mov", ".webm"].includes(extension)) return false;
        return ([".mp4", ".mov"].includes(extension) && ascii.slice(4, 8) === "ftyp")
            || (extension === ".webm" && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])));
    }
    if (![".mp3", ".wav", ".m4a", ".aac", ".flac"].includes(extension)) return false;
    return (extension === ".mp3" && (ascii.startsWith("ID3") || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)))
        || (extension === ".wav" && ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE")
        || (extension === ".m4a" && ascii.slice(4, 8) === "ftyp")
        || (extension === ".aac" && header[0] === 0xff && (header[1] & 0xf0) === 0xf0)
        || (extension === ".flac" && ascii.startsWith("fLaC"));
}

function referenceInvalid() { return new DreaminaCliError("dreamina_reference_invalid", "Dreamina reference media is not an allowed owner resource", 400); }
function referenceBudgetExceeded() { return new DreaminaCliError("dreamina_reference_budget_exceeded", "Dreamina reference staging exceeds the request byte limit", 413); }
function referenceCleanupFailed() { return new DreaminaCliError("dreamina_reference_cleanup_failed", "Dreamina reference staging cleanup failed", 503); }
function cancelled() { return new DreaminaCliError("dreamina_cancelled", "Dreamina 操作已取消", 499); }
function throwIfCancelled(signal?: AbortSignal) { if (signal?.aborted) throw cancelled(); }
