export type AudioStem = "vocals" | "instrumental";
export type AudioStemSelection = AudioStem | "both";
export type StereoStem = { left: Float32Array; right: Float32Array };
export type SeparationResult = Record<"vocals" | "drums" | "bass" | "other", StereoStem>;
export type AudioStemProgress = { phase: "reading" | "model" | "inference" | "saving"; percent: number };
export type AudioStemOutput = { stem: AudioStem; blob: Blob };

export const AUDIO_STEM_LABELS: Record<AudioStem, string> = { vocals: "人声", instrumental: "伴奏" };
export const AUDIO_STEM_SAMPLE_RATE = 44_100;
export const AUDIO_STEM_MAX_BYTES = 128 * 1024 * 1024;
export const AUDIO_STEM_MAX_SECONDS = 180;

// 固定上游提交和可信摘要，避免 main 更新后误用旧缓存或加载不同权重。
export const AUDIO_STEM_MODEL = {
    revision: "92e33df61cfc9eb820272aaa62d2ef6dcf4d950d",
    bytes: 180_534_758,
    sha256: "e5e425c17683f163a472462eb5f5a4ffcd11c31858d57fbd0833b012d8b88077",
    path: "timcsy/demucs-web-onnx/resolve/92e33df61cfc9eb820272aaa62d2ef6dcf4d950d/htdemucs_embedded.onnx",
} as const;

export type AudioStemWorkerRequest = { model: ArrayBuffer; left: Float32Array; right: Float32Array; selection: AudioStemSelection };
export type AudioStemWorkerMessage = { type: "progress"; progress: number } | { type: "completed"; outputs: AudioStemOutput[] } | { type: "failed"; error: string };
