import { audioMimeType, normalizeAudioFormatForConfig, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceForConfig, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { createChannelTransport } from "@/services/api/channel-transport";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { buildApiUrl, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";

type RequestOptions = { signal?: AbortSignal };

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function audioTransport(config: AiConfig) {
    return createChannelTransport(config, "audio");
}

export async function requestAudioGeneration(config: AiConfig, prompt: string, options?: RequestOptions): Promise<Blob> {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.audioModel);
    const model = requestConfig.model.trim();
    assertAudioConfig(requestConfig, model);
    if (requestConfig.interfaceType === "minimax-speech") {
        return requestMiniMaxSpeech(requestConfig, model, prompt, options);
    }
    if (requestConfig.interfaceType === "evolink-seed-audio" || requestConfig.interfaceType === "evolink-qwen-audio-tts") {
        return requestEvoLinkAudio(requestConfig, model, prompt, requestConfig.interfaceType === "evolink-qwen-audio-tts", options);
    }
    const format = normalizeAudioFormatValue(config.audioFormat);
    const instructions = config.audioInstructions.trim();
    const payload = {
        model,
        input: prompt,
        voice: normalizeAudioVoiceValue(config.audioVoice),
        response_format: format,
        speed: Number(normalizeAudioSpeedValue(config.audioSpeed)),
        ...(instructions ? { instructions } : {}),
    };

    try {
        if (requestConfig.interfaceType === "async-audio") {
            return await requestAsyncAudioGeneration(requestConfig, payload, format, options);
        }
        const blob = await audioTransport(requestConfig).postBlob(aiApiUrl(requestConfig, "/audio/speech"), payload, { signal: options?.signal });
        await assertAudioBlob(blob);
        return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    } catch (error) {
        throw new Error(readAxiosError(error, "音频生成失败"));
    }
}

async function requestMiniMaxSpeech(config: AiConfig, model: string, text: string, options?: RequestOptions): Promise<Blob> {
    const format = normalizeAudioFormatForConfig(config, config.audioFormat);
    const speed = Math.max(0.5, Math.min(2, Number(normalizeAudioSpeedValue(config.audioSpeed))));
    try {
        const response = await audioTransport(config).postJson<{ base_resp?: { status_code?: number; status_msg?: string }; data?: { audio?: string } }>(
            aiApiUrl(config, "/t2a_v2"),
            {
                model,
                text,
                stream: false,
                output_format: "hex",
                voice_setting: { voice_id: normalizeAudioVoiceForConfig(config, config.audioVoice), speed },
                audio_setting: { format },
            },
            options,
        );
        if (response.base_resp?.status_code !== 0) throw new Error(response.base_resp?.status_msg || "MiniMax 语音合成失败");
        const hex = response.data?.audio;
        if (!hex || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("MiniMax 未返回有效音频");
        const bytes = new Uint8Array(hex.length / 2);
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
        return new Blob([bytes], { type: audioMimeType(format) });
    } catch (error) {
        throw new Error(readAxiosError(error, "MiniMax 语音合成失败"));
    }
}

async function requestEvoLinkAudio(config: AiConfig, model: string, prompt: string, qwenTTS: boolean, options?: RequestOptions): Promise<Blob> {
    const format = normalizeAudioFormatForConfig(config, config.audioFormat);
    const speed = Math.max(0.5, Math.min(2, Number(normalizeAudioSpeedValue(config.audioSpeed))));
    const instructions = config.audioInstructions.trim();
    const payload = qwenTTS
        ? {
              model,
              prompt,
              voice: normalizeAudioVoiceForConfig(config, config.audioVoice),
              response_format: format,
              speech_rate: speed,
              sample_rate: 24000,
              ...(instructions ? { instruction: instructions } : {}),
          }
        : { model, prompt, format, speech_rate: speed };
    try {
        const created = await audioTransport(config).postJson<Record<string, unknown>>(aiApiUrl(config, "/audios/generations"), payload, options);
        const taskId = asyncAudioTaskId(created);
        if (!taskId) throw new Error("EvoLink 未返回任务 ID");
        for (let attempt = 0; attempt < 120; attempt += 1) {
            await waitForAudioPoll(options?.signal);
            const state = await audioTransport(config).get<Record<string, unknown>>(aiApiUrl(config, `/tasks/${encodeURIComponent(taskId)}`), options);
            if (asyncAudioSucceeded(state)) {
                if (!asyncAudioResultUrl(state)) throw new Error("EvoLink 已完成任务，但未返回音频地址");
                return downloadAsyncAudio(config, taskId, state, format, options);
            }
            if (["failed", "cancelled", "canceled", "expired", "error"].includes(String(state.status || "").toLowerCase())) {
                throw new Error(asyncAudioError(state));
            }
        }
        throw new Error(`EvoLink 音频生成超时（任务 ${taskId}）`);
    } catch (error) {
        throw new Error(readAxiosError(error, "EvoLink 音频生成失败"));
    }
}

async function requestAsyncAudioGeneration(config: AiConfig, payload: Record<string, unknown>, format: string, options?: RequestOptions) {
    const created = await audioTransport(config).postJson<Record<string, unknown>>(aiApiUrl(config, "/audio/tasks"), payload, options);
    let state = asyncAudioPayload(created);
    const taskId = asyncAudioTaskId(state);
    if (!taskId) throw new Error("异步音频接口没有返回任务 ID");
    for (let attempt = 0; attempt < 120; attempt += 1) {
        if (asyncAudioSucceeded(state)) return downloadAsyncAudio(config, taskId, state, format, options);
        const status = String(state.status || "").toLowerCase();
        if (["failed", "cancelled", "canceled", "expired", "error"].includes(status)) {
            throw new Error(asyncAudioError(state));
        }
        await waitForAudioPoll(options?.signal);
        const polled = await audioTransport(config).get<Record<string, unknown>>(aiApiUrl(config, `/audio/tasks/${encodeURIComponent(taskId)}`), options);
        state = asyncAudioPayload(polled);
    }
    throw new Error(`异步音频生成超时（任务 ${taskId}）`);
}

function asyncAudioPayload(payload: Record<string, unknown>): Record<string, unknown> {
    for (const key of ["data", "result", "output"]) {
        const nested = payload[key];
        if (nested && typeof nested === "object" && !Array.isArray(nested)) return { ...payload, ...(nested as Record<string, unknown>) };
    }
    return payload;
}

function asyncAudioTaskId(payload: Record<string, unknown>) {
    for (const value of [payload.id, payload.task_id, payload.request_id]) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
}

function asyncAudioSucceeded(payload: Record<string, unknown>) {
    const status = String(payload.status || "").toLowerCase();
    return payload.done === true || ["completed", "succeeded", "success", "done"].includes(status) || (!status && Boolean(asyncAudioResultUrl(payload)));
}

function asyncAudioResultUrl(payload: Record<string, unknown>): string {
    for (const key of ["audio_url", "audioUrl", "result_url", "resultUrl", "output_url", "outputUrl", "url", "data"]) {
        const value = payload[key];
        if (typeof value === "string" && (/^https?:\/\//i.test(value) || value.startsWith("data:audio/"))) return value;
    }
    for (const key of ["result_data", "results"]) {
        const value = payload[key];
        if (Array.isArray(value)) {
            for (const item of value) {
                if (typeof item === "string" && /^https?:\/\//i.test(item)) return item;
                if (item && typeof item === "object" && !Array.isArray(item)) {
                    const nested = asyncAudioResultUrl(item as Record<string, unknown>);
                    if (nested) return nested;
                }
            }
        }
    }
    for (const key of ["audio", "data", "result", "output"]) {
        const value = payload[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const nested = asyncAudioResultUrl(value as Record<string, unknown>);
            if (nested) return nested;
        }
    }
    return "";
}

async function downloadAsyncAudio(config: AiConfig, taskId: string, state: Record<string, unknown>, format: string, options?: RequestOptions) {
    const resultUrl = asyncAudioResultUrl(state);
    let blob: Blob;
    if (resultUrl.startsWith("data:audio/")) {
        blob = await (await fetch(resultUrl, { signal: options?.signal })).blob();
    } else if (/^https?:\/\//i.test(resultUrl)) {
        blob = await audioTransport(config).getExternalBlob(resultUrl, undefined, options);
    } else {
        blob = await audioTransport(config).getBlob(aiApiUrl(config, `/audio/tasks/${encodeURIComponent(taskId)}/content`), options);
    }
    await assertAudioBlob(blob);
    return blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
}

function asyncAudioError(payload: Record<string, unknown>) {
    const error = payload.error;
    if (typeof error === "string" && error.trim()) return error;
    if (error && typeof error === "object" && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === "string" && message.trim()) return message;
    }
    return typeof payload.message === "string" && payload.message.trim() ? payload.message : "异步音频生成失败";
}

function waitForAudioPoll(signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const onAbort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = window.setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, 2500);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export async function storeGeneratedAudio(blob: Blob, format = "mp3"): Promise<UploadedFile> {
    const audio = blob.type.startsWith("audio/") ? blob : new Blob([blob], { type: audioMimeType(format) });
    return uploadMediaFile(audio, "audio");
}

function assertAudioConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置音频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持音频生成，请使用 OpenAI 格式渠道");
}

async function assertAudioBlob(blob: Blob) {
    const mimeType = blob.type.toLowerCase();
    if (mimeType.startsWith("image/") || mimeType.startsWith("video/") || mimeType.startsWith("text/")) throw new Error(`上游返回了非音频内容：${mimeType}`);
    if (!mimeType.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "音频生成失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

function readAxiosError(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}
