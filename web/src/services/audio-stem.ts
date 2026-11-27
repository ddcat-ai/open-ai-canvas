import { AUDIO_STEM_MAX_BYTES, AUDIO_STEM_MAX_SECONDS, AUDIO_STEM_SAMPLE_RATE, type AudioStemOutput, type AudioStemProgress, type AudioStemSelection, type AudioStemWorkerMessage } from "@/lib/audio-stem/contracts";
import { readAudioStemModel } from "./audio-stem-model";

let busy = false;

export async function decodeAudioStemInput(input: Blob, signal: AbortSignal) {
    signal.throwIfAborted();
    if (!input.size || input.size > AUDIO_STEM_MAX_BYTES) throw new Error("请选择不超过 128 MiB 的非空音频文件");
    const context = new AudioContext({ sampleRate: AUDIO_STEM_SAMPLE_RATE });
    try {
        const decoded = await context.decodeAudioData(await input.arrayBuffer());
        signal.throwIfAborted();
        if (!decoded.length || decoded.duration > AUDIO_STEM_MAX_SECONDS) throw new Error("仅支持 3 分钟以内的音频，请先裁剪后重试");
        let audio = decoded;
        if (audio.sampleRate !== AUDIO_STEM_SAMPLE_RATE) {
            const offline = new OfflineAudioContext(2, Math.ceil(audio.duration * AUDIO_STEM_SAMPLE_RATE), AUDIO_STEM_SAMPLE_RATE);
            const source = offline.createBufferSource();
            source.buffer = audio;
            source.connect(offline.destination);
            source.start();
            audio = await offline.startRendering();
        }
        signal.throwIfAborted();
        return {
            left: new Float32Array(audio.getChannelData(0)),
            right: new Float32Array(audio.getChannelData(audio.numberOfChannels > 1 ? 1 : 0)),
        };
    } finally {
        await context.close().catch(() => undefined);
    }
}

export async function runAudioStemWorker(worker: Worker, request: { model: ArrayBuffer; left: Float32Array; right: Float32Array; selection: AudioStemSelection }, signal: AbortSignal, onProgress: (progress: number) => void): Promise<AudioStemOutput[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
        return await new Promise((resolve, reject) => {
            abort = () => reject(signal.reason || new DOMException("操作已取消", "AbortError"));
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) {
                abort();
                return;
            }
            timer = setTimeout(() => reject(new Error("本机分离超过 15 分钟，请使用更短的音频重试")), 15 * 60_000);
            worker.onerror = () => reject(new Error("本机分离引擎运行失败，请检查浏览器支持或设备内存"));
            worker.onmessageerror = () => reject(new Error("本机分离引擎通信失败"));
            worker.onmessage = (event: MessageEvent<AudioStemWorkerMessage>) => {
                const message = event.data;
                if (message.type === "progress" && Number.isFinite(message.progress)) onProgress(Math.min(1, Math.max(0, message.progress)));
                else if (message.type === "completed") resolve(message.outputs);
                else if (message.type === "failed") reject(new Error(message.error));
            };
            worker.postMessage(request, [request.model, request.left.buffer, request.right.buffer]);
        });
    } finally {
        clearTimeout(timer);
        if (abort) signal.removeEventListener("abort", abort);
        worker.terminate();
    }
}

export async function separateAudioLocally(input: Blob, selection: AudioStemSelection, signal: AbortSignal, onProgress: (progress: AudioStemProgress) => void) {
    if (busy) throw new Error("已有本机音频分离任务，请等待完成或取消后重试");
    if (!window.isSecureContext || !crypto.subtle) throw new Error("本机分离需要 HTTPS 或 localhost 安全环境");
    busy = true;
    try {
        onProgress({ phase: "reading", percent: 0 });
        const channels = await decodeAudioStemInput(input, signal);
        onProgress({ phase: "model", percent: 0 });
        const model = await readAudioStemModel(signal, (percent) => onProgress({ phase: "model", percent }));
        signal.throwIfAborted();
        onProgress({ phase: "inference", percent: 0 });
        const worker = new Worker(new URL("./audio-stem.worker.ts", import.meta.url), { type: "module" });
        return await runAudioStemWorker(worker, { model, ...channels, selection }, signal, (ratio) => onProgress({ phase: "inference", percent: Math.min(99, Math.floor(ratio * 100)) }));
    } finally {
        busy = false;
    }
}
