/** MiniMax T2A 后端接口调用（后端代理，规避浏览器 CORS + 集中管理渠道 API key）。 */

import type { T2AAudioSetting, T2AModel, T2AVoiceSetting } from "./contracts";

async function t2aRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/minimax-t2a${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
    });
    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body ? body.slice(0, 300) : `T2A 请求失败：${response.status}`);
    }
    const json = (await response.json()) as { code?: number; data?: T; msg?: string };
    if (json.code !== undefined && json.code !== 0) {
        throw new Error(json.msg || `T2A 请求失败：${json.code}`);
    }
    return (json.data ?? json) as T;
}

export type T2ASynthesizeResponse = { storageKey: string; url: string; mimeType: string; durationMs: number };
export type T2AVoiceDesignResponse = { voiceId: string; trialAudio: { storageKey: string; url: string; mimeType: string } };
export type T2AVoiceCloneResponse = { voiceId: string };
export type T2AVoicesResponse = { voices: Array<{ voiceId: string; name: string }> };

/** 语音合成。 */
export async function synthesizeT2A(params: {
    text: string;
    model: T2AModel;
    voice: T2AVoiceSetting;
    audio: T2AAudioSetting;
}): Promise<T2ASynthesizeResponse> {
    return t2aRequest<T2ASynthesizeResponse>("/synthesize", { method: "POST", body: JSON.stringify(params) });
}

/** 音色设计。 */
export async function designVoice(params: { prompt: string; previewText: string }): Promise<T2AVoiceDesignResponse> {
    return t2aRequest<T2AVoiceDesignResponse>("/voice-design", { method: "POST", body: JSON.stringify(params) });
}

/** 音色克隆（sampleBase64 为样本音频 base64）。 */
export async function cloneVoice(params: {
    sampleBase64: string;
    sampleName: string;
    text: string;
    voiceId: string;
    model: T2AModel;
}): Promise<T2AVoiceCloneResponse> {
    return t2aRequest<T2AVoiceCloneResponse>("/voice-clone", { method: "POST", body: JSON.stringify(params) });
}

/** 克隆音色列表。 */
export async function listVoices(): Promise<Array<{ voiceId: string; name: string }>> {
    const data = await t2aRequest<T2AVoicesResponse>("/voices");
    return data.voices ?? [];
}

/** 删除克隆音色。 */
export async function deleteVoice(voiceId: string): Promise<void> {
    await t2aRequest(`/voices/${encodeURIComponent(voiceId)}`, { method: "DELETE" });
}

/** File → base64（用于音色克隆上传）。 */
export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = typeof reader.result === "string" ? reader.result : "";
            const comma = result.indexOf(",");
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error("读取音频文件失败"));
        reader.readAsDataURL(file);
    });
}
