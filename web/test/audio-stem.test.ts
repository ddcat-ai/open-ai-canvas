import { describe, expect, test } from "bun:test";
import { encodeAudioStemWav, mixAudioStem } from "@/lib/audio-stem/audio";
import type { AudioStemWorkerMessage, SeparationResult, StereoStem } from "@/lib/audio-stem/contracts";
import { runAudioStemWorker, decodeAudioStemInput } from "@/services/audio-stem";

const stereo = (values: number[]): StereoStem => ({ left: new Float32Array(values), right: new Float32Array(values.map((value) => -value)) });

describe("音频分离与 WAV 输出", () => {
    test("人声选轨、伴奏混合不修改原轨道，左右声道独立保留", () => {
        const result: SeparationResult = { vocals: stereo([0.1, 0.2]), drums: stereo([0.2, 0.3]), bass: stereo([0.1, 0.4]), other: stereo([0.3, 0.5]) };
        expect(mixAudioStem(result, "vocals")).toBe(result.vocals);
        const mix = mixAudioStem(result, "instrumental");
        expect(mix.left[0]).toBeCloseTo(0.6);
        expect(mix.right[1]).toBeCloseTo(-1.2);
        expect(result.drums.left[0]).toBeCloseTo(0.2);
    });

    test("输出标准双声道 44.1kHz PCM WAV，过载整体衰减且不放大低电平", async () => {
        const view = new DataView(await encodeAudioStemWav(stereo([2, 1, 0])).arrayBuffer());
        expect(new TextDecoder().decode(new Uint8Array(view.buffer, 0, 4))).toBe("RIFF");
        expect(view.getUint32(4, true)).toBe(view.byteLength - 8);
        expect(view.getUint16(22, true)).toBe(2);
        expect(view.getUint32(24, true)).toBe(44_100);
        expect(view.getUint16(34, true)).toBe(16);
        expect(view.getUint32(40, true)).toBe(12);
        expect(view.getInt16(44, true)).toBe(Math.round(0.95 * 32767));
        expect(view.getInt16(46, true)).toBe(Math.round(-0.95 * 32768));
        expect(view.getInt16(48, true)).toBe(Math.round(0.475 * 32767));
        const quiet = new DataView(await encodeAudioStemWav(stereo([0.001])).arrayBuffer());
        expect(quiet.getInt16(44, true)).toBe(33);
    });

    test("拒绝损坏或不等长轨道，允许无声片段", () => {
        expect(() => encodeAudioStemWav(stereo([]))).toThrow();
        expect(() => encodeAudioStemWav(stereo([NaN]))).toThrow();
        expect(() => encodeAudioStemWav({ left: new Float32Array(2), right: new Float32Array(1) })).toThrow();
        expect(encodeAudioStemWav(stereo([0])).size).toBe(48);
        const result: SeparationResult = { vocals: stereo([0]), drums: stereo([0]), bass: stereo([]), other: stereo([0]) };
        expect(() => mixAudioStem(result, "instrumental")).toThrow();
    });
});

class FakeWorker {
    onmessage: ((event: MessageEvent<AudioStemWorkerMessage>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    sent = false;
    postMessage() {
        this.sent = true;
    }
    terminate() {
        this.terminated = true;
    }
    emit(message: AudioStemWorkerMessage) {
        this.onmessage?.({ data: message } as MessageEvent<AudioStemWorkerMessage>);
    }
}
const request = () => ({ model: new ArrayBuffer(8), ...stereo([0]), selection: "both" as const });

describe("分离 Worker 生命周期", () => {
    test("一次推理返回两轨并释放 Worker，进度限制在有效区间", async () => {
        const worker = new FakeWorker();
        const progress: number[] = [];
        const promise = runAudioStemWorker(worker as unknown as Worker, request(), new AbortController().signal, (value) => progress.push(value));
        worker.emit({ type: "progress", progress: 4 });
        worker.emit({ type: "progress", progress: NaN });
        worker.emit({
            type: "completed",
            outputs: [
                { stem: "vocals", blob: new Blob() },
                { stem: "instrumental", blob: new Blob() },
            ],
        });
        expect((await promise).map((output) => output.stem)).toEqual(["vocals", "instrumental"]);
        expect(progress).toEqual([1]);
        expect(worker.terminated).toBe(true);
    });

    test("运行中取消立即终止 Worker", async () => {
        const worker = new FakeWorker();
        const controller = new AbortController();
        const promise = runAudioStemWorker(worker as unknown as Worker, request(), controller.signal, () => {});
        controller.abort();
        await expect(promise).rejects.toHaveProperty("name", "AbortError");
        expect(worker.terminated).toBe(true);
    });

    test("预先取消不发送模型，失败与通信异常均释放 Worker", async () => {
        const controller = new AbortController();
        controller.abort();
        const cancelled = new FakeWorker();
        await expect(runAudioStemWorker(cancelled as unknown as Worker, request(), controller.signal, () => {})).rejects.toHaveProperty("name", "AbortError");
        expect(cancelled.sent).toBe(false);
        expect(cancelled.terminated).toBe(true);
        for (const kind of ["failed", "onerror", "onmessageerror"] as const) {
            const worker = new FakeWorker();
            const promise = runAudioStemWorker(worker as unknown as Worker, request(), new AbortController().signal, () => {});
            if (kind === "failed") worker.emit({ type: "failed", error: "模型加载失败" });
            else worker[kind]?.();
            await expect(promise).rejects.toBeInstanceOf(Error);
            expect(worker.terminated).toBe(true);
        }
    });

    test("空文件在创建音频解码器之前拒绝，已取消请求不解码", async () => {
        await expect(decodeAudioStemInput(new Blob(), new AbortController().signal)).rejects.toThrow("非空");
        const controller = new AbortController();
        controller.abort();
        await expect(decodeAudioStemInput(new Blob(["audio"]), controller.signal)).rejects.toHaveProperty("name", "AbortError");
    });

    test("单声道复制为独立左右声道，超长和解码失败均关闭 AudioContext", async () => {
        const previous = globalThis.AudioContext;
        let closed = 0;
        let duration = 1;
        let fail = false;
        const original = new Float32Array([0.1, 0.2]);
        class Decoder {
            async decodeAudioData() {
                if (fail) throw new Error("无效音频");
                return { sampleRate: 44_100, duration, length: original.length, numberOfChannels: 1, getChannelData: () => original };
            }
            async close() {
                closed++;
            }
        }
        globalThis.AudioContext = Decoder as unknown as typeof AudioContext;
        try {
            const channels = await decodeAudioStemInput(new Blob(["audio"]), new AbortController().signal);
            expect(channels.left).toEqual(original);
            expect(channels.right).toEqual(original);
            expect(channels.left).not.toBe(channels.right);
            channels.left[0] = 0;
            expect(channels.right[0]).toBeCloseTo(0.1);
            duration = 181;
            await expect(decodeAudioStemInput(new Blob(["audio"]), new AbortController().signal)).rejects.toThrow("3 分钟");
            duration = 180;
            await expect(decodeAudioStemInput(new Blob(["audio"]), new AbortController().signal)).resolves.toBeDefined();
            fail = true;
            await expect(decodeAudioStemInput(new Blob(["audio"]), new AbortController().signal)).rejects.toThrow("无效音频");
            expect(closed).toBe(4);
        } finally {
            globalThis.AudioContext = previous;
        }
    });
});
