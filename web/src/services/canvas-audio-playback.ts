import { cacheResourceObjectUrl } from "@/services/resource-blob-cache";
import { resourceIdFromStorageKey } from "@/services/api/resources";

export type CanvasAudioSource = {
    nodeId: string;
    content: string;
    storageKey?: string;
    mimeType?: string;
    durationMs?: number;
};

export type CanvasAudioPlaybackPhase = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export type CanvasAudioPlaybackSnapshot = {
    nodeId: string | null;
    phase: CanvasAudioPlaybackPhase;
    currentTimeMs: number;
    durationMs: number;
    error?: string;
};

type Listener = () => void;

const EMPTY_SNAPSHOT = (nodeId: string): CanvasAudioPlaybackSnapshot => ({
    nodeId,
    phase: "idle",
    currentTimeMs: 0,
    durationMs: 0,
});

class CanvasAudioPlaybackController {
    private audio: HTMLAudioElement | null = null;
    private activeSource: CanvasAudioSource | null = null;
    private generation = 0;
    private pendingSeekMs: number | null = null;
    private autoplayToken: number | null = null;
    private readonly snapshots = new Map<string, CanvasAudioPlaybackSnapshot>();
    private readonly listeners = new Map<string, Set<Listener>>();

    getSnapshot(nodeId: string) {
        const existing = this.snapshots.get(nodeId);
        if (existing) return existing;
        const snapshot = EMPTY_SNAPSHOT(nodeId);
        this.snapshots.set(nodeId, snapshot);
        return snapshot;
    }

    subscribeNode(nodeId: string, listener: Listener) {
        const nodeListeners = this.listeners.get(nodeId) || new Set<Listener>();
        nodeListeners.add(listener);
        this.listeners.set(nodeId, nodeListeners);
        return () => {
            nodeListeners.delete(listener);
            if (!nodeListeners.size) this.listeners.delete(nodeId);
        };
    }

    async toggle(source: CanvasAudioSource) {
        const active = this.activeSource;
        const snapshot = this.getSnapshot(source.nodeId);
        if (active && active.nodeId === source.nodeId && sameSource(active, source)) {
            if (snapshot.phase === "playing") {
                this.audio?.pause();
                return;
            }
            if (snapshot.phase === "loading") {
                if (this.autoplayToken === null) {
                    this.autoplayToken = this.generation;
                    await this.playActive(source.nodeId);
                } else {
                    this.stop(source.nodeId);
                }
                return;
            }
            if (snapshot.phase === "paused" && this.audio?.src) {
                await this.resume(source.nodeId);
                return;
            }
        }

        if (this.activeSource) this.stop(this.activeSource.nodeId);
        return this.begin(source);
    }

    pause(nodeId?: string) {
        if (!this.activeSource || (nodeId && this.activeSource.nodeId !== nodeId)) return;
        this.audio?.pause();
    }

    stop(nodeId?: string) {
        if (!this.activeSource || (nodeId && this.activeSource.nodeId !== nodeId)) return;
        const previous = this.activeSource;
        this.generation += 1;
        this.activeSource = null;
        this.pendingSeekMs = null;
        this.autoplayToken = null;
        if (this.audio) {
            this.audio.pause();
            this.audio.removeAttribute("src");
            this.audio.load();
        }
        const previousSnapshot = this.getSnapshot(previous.nodeId);
        this.update(previous.nodeId, {
            phase: "idle",
            currentTimeMs: 0,
            durationMs: previousSnapshot.durationMs || previous.durationMs || 0,
            error: undefined,
        });
    }

    async seek(nodeId: string, timeMs: number, source?: CanvasAudioSource) {
        if (!this.activeSource || this.activeSource.nodeId !== nodeId) {
            if (source) {
                // A seek on another node changes the single shared audio instance.
                // Reset the previous node first so its control does not remain in
                // the playing state after ownership moves to the target node.
                if (this.activeSource) this.stop(this.activeSource.nodeId);
                await this.begin(source, false, timeMs);
            }
            return;
        }
        const durationMs = Number.isFinite(this.audio?.duration) && (this.audio?.duration || 0) > 0 ? (this.audio?.duration || 0) * 1000 : this.getSnapshot(nodeId).durationMs;
        const nextTimeMs = Math.max(0, Math.min(Math.max(0, durationMs), Number.isFinite(timeMs) ? timeMs : 0));
        if (!this.audio?.src || this.getSnapshot(nodeId).phase === "loading") {
            this.pendingSeekMs = nextTimeMs;
            this.update(nodeId, { currentTimeMs: nextTimeMs });
            return;
        }
        try {
            this.audio.currentTime = nextTimeMs / 1000;
        } catch {
            return;
        }
        const wasEnded = this.getSnapshot(nodeId).phase === "ended";
        this.update(nodeId, wasEnded ? { currentTimeMs: nextTimeMs, phase: "paused" } : { currentTimeMs: nextTimeMs });
    }

    private async begin(source: CanvasAudioSource, autoplay = true, seekTimeMs?: number) {
        const token = ++this.generation;
        this.activeSource = source;
        this.pendingSeekMs = seekTimeMs == null ? null : Math.max(0, seekTimeMs);
        this.autoplayToken = autoplay ? token : null;
        this.update(source.nodeId, {
            phase: "loading",
            currentTimeMs: this.pendingSeekMs || 0,
            durationMs: source.durationMs || 0,
            error: undefined,
        });

        const url = await resolveAudioSource(source);
        if (!this.isCurrent(source, token)) return;
        if (!url) {
            this.update(source.nodeId, { phase: "error", error: "音频资源不可用" });
            return;
        }

        const audio = this.ensureAudio();
        audio.preload = "metadata";
        audio.src = url;
        audio.load();
        if (!autoplay && this.autoplayToken !== token) return;
        return this.playActive(source.nodeId, token);
    }

    private async playActive(nodeId: string, token = this.generation) {
        if (!this.audio || !this.activeSource || this.activeSource.nodeId !== nodeId || token !== this.generation) return;
        try {
            await this.audio.play();
            if (this.activeSource?.nodeId === nodeId && token === this.generation) this.update(nodeId, { phase: "playing", error: undefined });
        } catch (error) {
            if (this.activeSource?.nodeId === nodeId && token === this.generation) this.update(nodeId, { phase: "error", error: mediaErrorMessage(error) });
        }
    }

    private async resume(nodeId: string) {
        if (!this.audio || !this.activeSource || this.activeSource.nodeId !== nodeId) return;
        try {
            await this.audio.play();
            if (this.activeSource?.nodeId === nodeId) this.update(nodeId, { phase: "playing", error: undefined });
        } catch (error) {
            this.update(nodeId, { phase: "error", error: mediaErrorMessage(error) });
        }
    }

    private ensureAudio() {
        if (this.audio) return this.audio;
        if (typeof Audio === "undefined") throw new Error("当前环境不支持音频播放");
        const audio = new Audio();
        audio.preload = "metadata";
        audio.addEventListener("loadedmetadata", () => {
            const active = this.activeSource;
            if (!active) return;
            const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : active.durationMs || 0;
            const pendingSeekMs = this.pendingSeekMs;
            this.pendingSeekMs = null;
            if (pendingSeekMs != null) {
                const nextTimeMs = Math.max(0, Math.min(Math.max(0, durationMs), pendingSeekMs));
                try {
                    audio.currentTime = nextTimeMs / 1000;
                } catch {
                    // Some browsers defer currentTime assignment until metadata is ready.
                }
                this.update(active.nodeId, this.autoplayToken === null ? { currentTimeMs: nextTimeMs, durationMs, phase: "paused" } : { currentTimeMs: nextTimeMs, durationMs });
                return;
            }
            this.update(active.nodeId, { durationMs });
        });
        audio.addEventListener("durationchange", () => {
            const active = this.activeSource;
            if (!active || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
            this.update(active.nodeId, { durationMs: Math.round(audio.duration * 1000) });
        });
        audio.addEventListener("timeupdate", () => {
            const active = this.activeSource;
            if (!active) return;
            this.update(active.nodeId, { currentTimeMs: Math.round(Math.max(0, audio.currentTime) * 1000) });
        });
        audio.addEventListener("playing", () => {
            const active = this.activeSource;
            if (active) this.update(active.nodeId, { phase: "playing", error: undefined });
        });
        audio.addEventListener("pause", () => {
            const active = this.activeSource;
            if (active && this.getSnapshot(active.nodeId).phase !== "ended") this.update(active.nodeId, { phase: "paused" });
        });
        audio.addEventListener("ended", () => {
            const active = this.activeSource;
            if (!active) return;
            const durationMs = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : this.getSnapshot(active.nodeId).durationMs;
            this.update(active.nodeId, { phase: "ended", currentTimeMs: durationMs, durationMs });
        });
        audio.addEventListener("error", () => {
            const active = this.activeSource;
            if (active) this.update(active.nodeId, { phase: "error", error: "音频加载失败" });
        });
        this.audio = audio;
        return audio;
    }

    private isCurrent(source: CanvasAudioSource, token: number) {
        return token === this.generation && this.activeSource?.nodeId === source.nodeId && sameSource(this.activeSource, source);
    }

    private update(nodeId: string, patch: Partial<CanvasAudioPlaybackSnapshot>) {
        const previous = this.getSnapshot(nodeId);
        const next: CanvasAudioPlaybackSnapshot = { ...previous, ...patch, nodeId };
        if (snapshotEqual(previous, next)) return;
        this.snapshots.set(nodeId, next);
        this.listeners.get(nodeId)?.forEach((listener) => listener());
    }
}

function sameSource(left: CanvasAudioSource, right: CanvasAudioSource) {
    return left.content === right.content && left.storageKey === right.storageKey && left.mimeType === right.mimeType;
}

async function resolveAudioSource(source: CanvasAudioSource) {
    if (source.storageKey && resourceIdFromStorageKey(source.storageKey)) {
        const cached = await cacheResourceObjectUrl(source.storageKey).catch(() => "");
        return cached || source.content;
    }
    return source.content;
}

function snapshotEqual(left: CanvasAudioPlaybackSnapshot, right: CanvasAudioPlaybackSnapshot) {
    return left.phase === right.phase && left.currentTimeMs === right.currentTimeMs && left.durationMs === right.durationMs && left.error === right.error;
}

function mediaErrorMessage(error: unknown) {
    if (error instanceof Error && error.message.trim()) return error.message;
    return "音频播放失败";
}

export const canvasAudioPlayback = new CanvasAudioPlaybackController();

export const getCanvasAudioPlaybackSnapshot = (nodeId: string) => canvasAudioPlayback.getSnapshot(nodeId);
export const subscribeCanvasAudioNode = (nodeId: string, listener: Listener) => canvasAudioPlayback.subscribeNode(nodeId, listener);
export const toggleCanvasAudio = (source: CanvasAudioSource) => canvasAudioPlayback.toggle(source);
export const pauseCanvasAudio = (nodeId?: string) => canvasAudioPlayback.pause(nodeId);
export const stopCanvasAudio = (nodeId?: string) => canvasAudioPlayback.stop(nodeId);
export const seekCanvasAudio = (nodeId: string, timeMs: number, source?: CanvasAudioSource) => canvasAudioPlayback.seek(nodeId, timeMs, source);
