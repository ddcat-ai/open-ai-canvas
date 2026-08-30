import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { canvasAudioPlayback, getCanvasAudioPlaybackSnapshot, seekCanvasAudio, subscribeCanvasAudioNode, toggleCanvasAudio } from "../src/services/canvas-audio-playback";

type AudioEventName = "loadedmetadata" | "timeupdate" | "playing" | "pause" | "ended" | "error" | "durationchange";

class FakeAudio {
    static instances: FakeAudio[] = [];
    currentTime = 0;
    duration = 3;
    preload = "";
    src = "";
    private readonly handlers = new Map<AudioEventName, Set<() => void>>();

    constructor() {
        FakeAudio.instances.push(this);
    }

    addEventListener(type: AudioEventName, listener: () => void) {
        const listeners = this.handlers.get(type) || new Set<() => void>();
        listeners.add(listener);
        this.handlers.set(type, listeners);
    }

    removeAttribute(name: string) {
        if (name === "src") this.src = "";
    }

    load() {
        if (this.src) this.emit("loadedmetadata");
    }

    async play() {
        this.emit("playing");
    }

    pause() {
        this.emit("pause");
    }

    emit(type: AudioEventName) {
        this.handlers.get(type)?.forEach((listener) => listener());
    }
}

const originalAudio = globalThis.Audio;

beforeAll(() => {
    globalThis.Audio = FakeAudio as unknown as typeof Audio;
});

afterAll(() => {
    canvasAudioPlayback.stop();
    FakeAudio.instances = [];
    globalThis.Audio = originalAudio;
});

describe("canvas audio playback", () => {
    test("creates the audio element only after play and reuses one instance", async () => {
        expect(FakeAudio.instances).toHaveLength(0);
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("idle");

        await toggleCanvasAudio({ nodeId: "audio-a", content: "data:audio/mpeg;base64,a" });

        expect(FakeAudio.instances).toHaveLength(1);
        expect(FakeAudio.instances[0]?.src).toContain("data:audio/mpeg");
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("playing");

        await toggleCanvasAudio({ nodeId: "audio-b", content: "data:audio/mpeg;base64,b" });

        expect(FakeAudio.instances).toHaveLength(1);
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("idle");
        expect(getCanvasAudioPlaybackSnapshot("audio-b").phase).toBe("playing");
    });

    test("notifies only the active node for playback progress", async () => {
        canvasAudioPlayback.stop();
        let audioUpdates = 0;
        let otherUpdates = 0;
        const unsubscribeAudio = subscribeCanvasAudioNode("audio-a", () => {
            audioUpdates += 1;
        });
        const unsubscribeOther = subscribeCanvasAudioNode("audio-b", () => {
            otherUpdates += 1;
        });

        await toggleCanvasAudio({ nodeId: "audio-a", content: "data:audio/mpeg;base64,a" });
        const fakeAudio = FakeAudio.instances[0];
        if (!fakeAudio) throw new Error("fake audio was not created");
        const updatesBeforeProgress = audioUpdates;
        fakeAudio.currentTime = 1.25;
        fakeAudio.emit("timeupdate");

        expect(audioUpdates).toBeGreaterThan(updatesBeforeProgress);
        expect(otherUpdates).toBe(0);
        expect(getCanvasAudioPlaybackSnapshot("audio-a").currentTimeMs).toBe(1250);

        unsubscribeAudio();
        unsubscribeOther();
    });

    test("allows seeking before the first play without autoplaying", async () => {
        canvasAudioPlayback.stop();
        const instancesBeforeSeek = FakeAudio.instances.length;

        await seekCanvasAudio("audio-seek", 1200, { nodeId: "audio-seek", content: "data:audio/mpeg;base64,seek", durationMs: 3000 });

        expect(FakeAudio.instances).toHaveLength(instancesBeforeSeek);
        expect(FakeAudio.instances.at(-1)?.currentTime).toBe(1.2);
        expect(getCanvasAudioPlaybackSnapshot("audio-seek").phase).toBe("paused");
        expect(getCanvasAudioPlaybackSnapshot("audio-seek").currentTimeMs).toBe(1200);
    });

    test("supports pause, seek, and replay after ending", async () => {
        canvasAudioPlayback.stop();
        await toggleCanvasAudio({ nodeId: "audio-a", content: "data:audio/mpeg;base64,a" });
        const fakeAudio = FakeAudio.instances[0];
        if (!fakeAudio) throw new Error("fake audio was not created");

        await toggleCanvasAudio({ nodeId: "audio-a", content: "data:audio/mpeg;base64,a" });
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("paused");

        await toggleCanvasAudio({ nodeId: "audio-a", content: "data:audio/mpeg;base64,a" });
        seekCanvasAudio("audio-a", 1500);
        expect(getCanvasAudioPlaybackSnapshot("audio-a").currentTimeMs).toBe(1500);

        fakeAudio.emit("ended");
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("ended");

        await seekCanvasAudio("audio-a", 1200);
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("paused");
        expect(getCanvasAudioPlaybackSnapshot("audio-a").currentTimeMs).toBe(1200);

        await toggleCanvasAudio({ nodeId: "audio-a", content: "data:audio/mpeg;base64,a" });
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("playing");
        expect(getCanvasAudioPlaybackSnapshot("audio-a").currentTimeMs).toBe(1200);
    });

    test("resets the previous node when seeking another audio", async () => {
        canvasAudioPlayback.stop();
        await toggleCanvasAudio({ nodeId: "audio-a", content: "data:audio/mpeg;base64,a" });
        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("playing");

        await seekCanvasAudio("audio-b", 800, { nodeId: "audio-b", content: "data:audio/mpeg;base64,b", durationMs: 3000 });

        expect(getCanvasAudioPlaybackSnapshot("audio-a").phase).toBe("idle");
        expect(getCanvasAudioPlaybackSnapshot("audio-b").phase).toBe("paused");
        expect(getCanvasAudioPlaybackSnapshot("audio-b").currentTimeMs).toBe(800);
        expect(FakeAudio.instances).toHaveLength(1);
    });
});
