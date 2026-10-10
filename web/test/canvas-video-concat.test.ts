import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { concatVideoFiles, type VideoConcatEngine } from "../src/lib/canvas/canvas-video-concat";

const require = createRequire(import.meta.url);

async function engine() {
    const previousSelf = Object.getOwnPropertyDescriptor(globalThis, "self");
    Object.defineProperty(globalThis, "self", { configurable: true, value: { location: { href: "file:///ffmpeg-core.js" } } });
    let core;
    try {
        core = await require("@ffmpeg/core")({ wasmBinary: await readFile(require.resolve("@ffmpeg/core/wasm")) });
    } finally {
        if (previousSelf) Object.defineProperty(globalThis, "self", previousSelf);
        else Reflect.deleteProperty(globalThis, "self");
    }
    const adapter: VideoConcatEngine = {
        async exec(args) {
            core.exec(...args);
            const code = core.ret;
            core.reset();
            return code;
        },
        async ffprobe(args) {
            core.ffprobe(...args);
            const code = core.ret;
            core.reset();
            return code;
        },
        async writeFile(name, data) {
            core.FS.writeFile(name, data);
            return true;
        },
        async readFile(name) {
            return core.FS.readFile(name);
        },
        async deleteFile(name) {
            core.FS.unlink(name);
            return true;
        },
    };
    return adapter;
}

async function source(ffmpeg: VideoConcatEngine, name: string, sampleRate: number | null, timeScale = 15360, size = "64x36", color = "blue") {
    const args = ["-f", "lavfi", "-i", `color=c=${color}:s=${size}:r=30:d=15`];
    if (sampleRate) args.push("-f", "lavfi", "-i", `sine=frequency=440:sample_rate=${sampleRate}:duration=15`);
    args.push("-t", "15", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-video_track_timescale", String(timeScale));
    if (sampleRate) args.push("-c:a", "aac");
    args.push(name);
    expect(await ffmpeg.exec(args)).toBe(0);
}

async function probe(ffmpeg: VideoConcatEngine, name: string) {
    await ffmpeg.ffprobe(["-v", "error", "-show_entries", "format=duration:stream=codec_type,duration,width,height,sample_rate", "-of", "json", "-o", "test-probe.json", name]);
    const bytes = await ffmpeg.readFile("test-probe.json");
    return JSON.parse(new TextDecoder().decode(bytes as Uint8Array)) as { streams: { codec_type: string; duration: string; width?: number; height?: number; sample_rate?: string }[]; format: { duration: string } };
}

describe("canvas video concat with the shipped FFmpeg core", () => {
    test("three 15s clips keep 45s of video AND audio across sample-rate and time-base changes", async () => {
        const ffmpeg = await engine();
        await source(ffmpeg, "one.mp4", 44100, 15360, "64x36", "red");
        await source(ffmpeg, "two.mp4", 44100, 15360, "64x36", "green");
        await source(ffmpeg, "three.mp4", 32000, 10240);
        const output = await concatVideoFiles(ffmpeg, ["one.mp4", "two.mp4", "three.mp4"]);
        await ffmpeg.writeFile("result.mp4", output);
        const result = await probe(ffmpeg, "result.mp4");
        expect(result.streams.map((stream) => stream.codec_type)).toEqual(["video", "audio"]);
        for (const stream of result.streams) expect(Math.abs(Number(stream.duration) - 45)).toBeLessThan(0.15);
        expect(await ffmpeg.exec(["-v", "error", "-xerror", "-i", "result.mp4", "-f", "null", "-"])).toBe(0);
        expect(await ffmpeg.exec(["-ss", "40", "-i", "result.mp4", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "tail.rgb"])).toBe(0);
        const tail = (await ffmpeg.readFile("tail.rgb")) as Uint8Array;
        expect(tail.length).toBe(64 * 36 * 3);
        expect(tail[2]).toBeGreaterThan(240);
        expect(tail[0]).toBeLessThan(10);
    }, 20000);

    test("a silent portrait clip preserves its place between clips with sound", async () => {
        const ffmpeg = await engine();
        await source(ffmpeg, "one.mp4", 44100);
        await source(ffmpeg, "silent.mp4", null, 12800, "36x64");
        await source(ffmpeg, "three.mp4", 32000);
        await ffmpeg.writeFile("result.mp4", await concatVideoFiles(ffmpeg, ["one.mp4", "silent.mp4", "three.mp4"]));
        const result = await probe(ffmpeg, "result.mp4");
        expect(result.streams[0]).toMatchObject({ width: 64, height: 36 });
        expect(result.streams[1].sample_rate).toBe("48000");
        for (const stream of result.streams) expect(Math.abs(Number(stream.duration) - 45)).toBeLessThan(0.15);
    }, 20000);

    test("audio that starts after the picture retains its delay in each clip", async () => {
        const ffmpeg = await engine();
        expect(
            await ffmpeg.exec([
                "-f",
                "lavfi",
                "-i",
                "color=c=blue:s=64x36:r=30:d=2",
                "-itsoffset",
                "1",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:sample_rate=48000:duration=1",
                "-t",
                "2",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-c:a",
                "aac",
                "delayed.mp4",
            ]),
        ).toBe(0);
        await ffmpeg.writeFile("result.mp4", await concatVideoFiles(ffmpeg, ["delayed.mp4", "delayed.mp4"]));
        const result = await probe(ffmpeg, "result.mp4");
        for (const stream of result.streams) expect(Math.abs(Number(stream.duration) - 4)).toBeLessThan(0.15);
        expect(await ffmpeg.exec(["-i", "result.mp4", "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "audio.pcm"])).toBe(0);
        const bytes = (await ffmpeg.readFile("audio.pcm")) as Uint8Array;
        const samples = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const rms = (start: number) => {
            const first = Math.round(start * 48000);
            const count = 19200;
            let energy = 0;
            for (let index = first; index < first + count; index++) energy += samples.getInt16(index * 2, true) ** 2;
            return Math.sqrt(energy / count);
        };
        for (const start of [0.1, 2.1]) expect(rms(start)).toBeLessThan(10);
        for (const start of [1.2, 3.2]) expect(rms(start)).toBeGreaterThan(1000);
    }, 20000);

    test("invalid media is rejected instead of returning a partial merged video", async () => {
        const ffmpeg = await engine();
        await source(ffmpeg, "one.mp4", 44100);
        await ffmpeg.writeFile("broken.mp4", new Uint8Array([1, 2, 3]));
        await expect(concatVideoFiles(ffmpeg, ["one.mp4", "broken.mp4"])).rejects.toThrow();
    }, 20000);
});
