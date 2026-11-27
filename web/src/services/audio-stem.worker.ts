import { DemucsProcessor } from "demucs-web/processor";
import * as ort from "onnxruntime-web/wasm";
import wasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { encodeAudioStemWav, mixAudioStem } from "@/lib/audio-stem/audio";
import type { AudioStem, AudioStemWorkerMessage, AudioStemWorkerRequest } from "@/lib/audio-stem/contracts";

// 使用包内嵌的模块加载器，避免 CDN 将独立 .mjs 按二进制返回后被浏览器拒绝。
// 只覆盖同版本 WASM 地址；单线程不要求站点启用跨源隔离。
ort.env.wasm.wasmPaths = { wasm: wasmUrl };
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
const send = (message: AudioStemWorkerMessage) => self.postMessage(message);
self.onmessage = async (event: MessageEvent<AudioStemWorkerRequest>) => {
    try {
        const processor = new DemucsProcessor({
            ort,
            sessionOptions: { executionProviders: ["wasm"], enableCpuMemArena: false, enableMemPattern: false },
            onProgress: ({ progress }) => send({ type: "progress", progress }),
        });
        await processor.loadModel(event.data.model);
        const result = await processor.separate(event.data.left, event.data.right);
        const stems: AudioStem[] = event.data.selection === "both" ? ["vocals", "instrumental"] : [event.data.selection];
        send({ type: "completed", outputs: stems.map((stem) => ({ stem, blob: encodeAudioStemWav(mixAudioStem(result, stem)) })) });
    } catch (error) {
        send({ type: "failed", error: error instanceof Error ? error.message : "本机音频分离失败" });
    }
};
