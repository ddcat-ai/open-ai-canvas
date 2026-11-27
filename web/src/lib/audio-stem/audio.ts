import { AUDIO_STEM_SAMPLE_RATE, type AudioStem, type SeparationResult, type StereoStem } from "./contracts";

export function mixAudioStem(result: SeparationResult, stem: AudioStem): StereoStem {
    if (stem === "vocals") return result.vocals;
    const tracks = [result.drums, result.bass, result.other];
    const length = tracks[0].left.length;
    if (!length || tracks.some((track) => track.left.length !== length || track.right.length !== length)) throw new Error("分离结果声道长度不一致");
    const left = new Float32Array(length);
    const right = new Float32Array(length);
    for (const track of tracks) {
        for (let index = 0; index < length; index++) {
            left[index] += track.left[index];
            right[index] += track.right[index];
        }
    }
    return { left, right };
}

export function encodeAudioStemWav(stem: StereoStem): Blob {
    const length = stem.left.length;
    if (!length || stem.right.length !== length) throw new Error("分离结果没有有效的双声道采样");
    let peak = 0;
    for (let index = 0; index < length; index++) {
        const left = stem.left[index];
        const right = stem.right[index];
        if (!Number.isFinite(left) || !Number.isFinite(right)) throw new Error("分离结果包含无效采样");
        peak = Math.max(peak, Math.abs(left), Math.abs(right));
    }
    // 只衰减过载，不放大安静的人声或背景；无人声的输入允许输出静音轨。
    const gain = peak > 0.98 ? 0.95 / peak : 1;
    const bytes = new ArrayBuffer(44 + length * 4);
    const view = new DataView(bytes);
    const writeText = (offset: number, text: string) => {
        for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + length * 4, true);
    writeText(8, "WAVE");
    writeText(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, AUDIO_STEM_SAMPLE_RATE, true);
    view.setUint32(28, AUDIO_STEM_SAMPLE_RATE * 4, true);
    view.setUint16(32, 4, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, length * 4, true);
    for (let index = 0; index < length; index++) {
        for (let channel = 0; channel < 2; channel++) {
            const sample = (channel ? stem.right[index] : stem.left[index]) * gain;
            view.setInt16(44 + index * 4 + channel * 2, Math.round(sample * (sample < 0 ? 0x8000 : 0x7fff)), true);
        }
    }
    return new Blob([bytes], { type: "audio/wav" });
}
