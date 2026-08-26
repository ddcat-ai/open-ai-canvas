import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MODEL_PACK = "buffalo_l";
const MODEL_FILES = {
    detector: {
        fileName: "det_10g.onnx",
        sha256: "5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91",
        url: "https://modelscope.cn/models/deepghs/insightface/resolve/master/buffalo_l/det_10g.onnx",
    },
    embedding: {
        fileName: "w600k_r50.onnx",
        sha256: "4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43",
        url: "https://modelscope.cn/models/deepghs/insightface/resolve/master/buffalo_l/w600k_r50.onnx",
    },
} as const;
const MODEL_DOWNLOAD_MAX_REDIRECTS = 3;
const verificationCache = new Map<string, { size: number; mtimeMs: number; valid: boolean }>();
const activeInstalls = new Map<string, Promise<Awaited<ReturnType<typeof performPortraitModelInstall>>>>();

export type PortraitModelStatus = {
    modelPack: typeof MODEL_PACK;
    root: string;
    detector: { fileName: string; installed: boolean; sha256: string };
    embedding: { fileName: string; installed: boolean; sha256: string };
    ready: boolean;
};

export function portraitModelDirectory(root: string) {
    return path.join(root, "models", MODEL_PACK);
}

export async function portraitModelStatus(root: string): Promise<PortraitModelStatus> {
    const directory = portraitModelDirectory(root);
    const detector = await installedFileStatus(directory, MODEL_FILES.detector);
    const embedding = await installedFileStatus(directory, MODEL_FILES.embedding);
    return {
        modelPack: MODEL_PACK,
        root: path.resolve(root),
        detector,
        embedding,
        ready: detector.installed && embedding.installed,
    };
}

export async function installPortraitModels(root: string, options: { signal?: AbortSignal; fetch?: typeof fetch } = {}) {
    const key = path.resolve(root);
    const active = activeInstalls.get(key);
    if (active) return active;
    const install = performPortraitModelInstall(root, options).finally(() => {
        if (activeInstalls.get(key) === install) activeInstalls.delete(key);
    });
    activeInstalls.set(key, install);
    return install;
}

async function performPortraitModelInstall(root: string, options: { signal?: AbortSignal; fetch?: typeof fetch } = {}) {
    const fetchImpl = options.fetch ?? fetch;
    const current = await portraitModelStatus(root);
    if (current.ready) return { ...current, downloaded: false };

    const parent = path.dirname(portraitModelDirectory(root));
    await fs.mkdir(parent, { recursive: true });
    const temporaryDirectory = await fs.mkdtemp(path.join(parent, `.install-${process.pid}-`));
    try {
        for (const item of Object.values(MODEL_FILES)) {
            if (options.signal?.aborted) throw abortError();
            const response = await fetchModelResponse(fetchImpl, item.url, options.signal);
            if (!response.ok || !response.body) throw new Error(`portrait_model_download_failed:${response.status}`);
            const filePath = path.join(temporaryDirectory, item.fileName);
            const output = await fs.open(filePath, "wx");
            const digest = crypto.createHash("sha256");
            try {
                const reader = response.body.getReader();
                let bytes = 0;
                while (true) {
                    if (options.signal?.aborted) throw abortError();
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    const value = Buffer.from(chunk.value);
                    bytes += value.byteLength;
                    if (bytes > 1_000_000_000) throw new Error("portrait_model_too_large");
                    digest.update(value);
                    await output.write(value);
                }
            } finally {
                await output.close();
            }
            if (digest.digest("hex") !== item.sha256) throw new Error(`portrait_model_checksum_failed:${item.fileName}`);
        }

        const targetDirectory = portraitModelDirectory(root);
        const backupDirectory = `${targetDirectory}.previous-${Date.now()}`;
        let movedOld = false;
        try {
            await fs.rename(targetDirectory, backupDirectory);
            movedOld = true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
            await fs.rename(temporaryDirectory, targetDirectory);
        } catch (error) {
            if (movedOld) await fs.rename(backupDirectory, targetDirectory).catch(() => undefined);
            throw error;
        }
        if (movedOld) await fs.rm(backupDirectory, { recursive: true, force: true });
        return { ...(await portraitModelStatus(root)), downloaded: true };
    } catch (error) {
        await fs.rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
    }
}

async function fetchModelResponse(fetchImpl: typeof fetch, sourceUrl: string, signal?: AbortSignal) {
    let currentUrl = new URL(sourceUrl);
    for (let redirectCount = 0; redirectCount <= MODEL_DOWNLOAD_MAX_REDIRECTS; redirectCount += 1) {
        assertAllowedModelDownloadUrl(currentUrl);
        const response = await fetchImpl(currentUrl, {
            signal,
            redirect: "manual",
            headers: { "user-agent": "open-ai-canvas-portrait-clearance/1.0" },
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) return response;
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location || redirectCount === MODEL_DOWNLOAD_MAX_REDIRECTS) throw new Error("portrait_model_redirect_invalid");
        currentUrl = new URL(location, currentUrl);
    }
    throw new Error("portrait_model_redirect_invalid");
}

function assertAllowedModelDownloadUrl(url: URL) {
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || (hostname !== "modelscope.cn" && !hostname.endsWith(".modelscope.cn"))) {
        throw new Error("portrait_model_redirect_invalid");
    }
}

async function installedFileStatus(directory: string, item: (typeof MODEL_FILES)[keyof typeof MODEL_FILES]) {
    const filePath = path.join(directory, item.fileName);
    let installed = false;
    try {
        const stat = await fs.stat(filePath);
        if (stat.isFile() && stat.size > 0) {
            const cached = verificationCache.get(filePath);
            if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) installed = cached.valid;
            else {
                installed = await sha256File(filePath) === item.sha256;
                verificationCache.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs, valid: installed });
            }
        }
    } catch {
        installed = false;
    }
    return { fileName: item.fileName, installed, sha256: item.sha256 };
}

async function sha256File(filePath: string) {
    const digest = crypto.createHash("sha256");
    const file = await fs.open(filePath, "r");
    try {
        for await (const chunk of file.readableWebStream()) digest.update(Buffer.from(chunk));
    } finally {
        await file.close();
    }
    return digest.digest("hex");
}

function abortError() {
    return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

export function defaultPortraitModelRoot(configDir: string) {
    return path.join(configDir, "portrait-clearance");
}

export function defaultPortraitConfigRoot() {
    return path.join(os.homedir(), ".infinite-canvas", "portrait-clearance");
}
