// 从音频文件头读取采样率。浏览器的 <audio> 和 Web Audio 都不暴露源文件采样率
// （decodeAudioData 会重采样到 AudioContext 的采样率），只能解析容器头。
// 覆盖 WAV / FLAC / MP3 / ADTS AAC / MP4(M4A) / Ogg(Vorbis, Opus) / WebM；无法识别时返回 undefined。

const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 768_000;

const MPEG_SAMPLE_RATES: Record<number, readonly number[]> = {
    3: [44100, 48000, 32000], // MPEG-1
    2: [22050, 24000, 16000], // MPEG-2
    0: [11025, 12000, 8000], // MPEG-2.5
};
const ADTS_SAMPLE_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function valid(rate: number | undefined) {
    return rate && Number.isFinite(rate) && rate >= MIN_SAMPLE_RATE && rate <= MAX_SAMPLE_RATE ? Math.round(rate) : undefined;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
    if (offset + length > bytes.length) return "";
    let value = "";
    for (let index = 0; index < length; index += 1) value += String.fromCharCode(bytes[offset + index]);
    return value;
}

function view(bytes: Uint8Array) {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** ID3v2 标签（常含封面图）的总长度；MP3 帧在标签之后。 */
export function id3TagLength(bytes: Uint8Array) {
    if (ascii(bytes, 0, 3) !== "ID3" || bytes.length < 10) return 0;
    const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f);
    return 10 + size + (bytes[5] & 0x10 ? 10 : 0);
}

function wavSampleRate(bytes: Uint8Array) {
    const data = view(bytes);
    let offset = 12;
    while (offset + 8 <= bytes.length) {
        const id = ascii(bytes, offset, 4);
        const size = data.getUint32(offset + 4, true);
        if (id === "fmt " && offset + 12 <= bytes.length) return valid(data.getUint32(offset + 12, true));
        offset += 8 + size + (size % 2);
    }
    return undefined;
}

function flacSampleRate(bytes: Uint8Array) {
    // fLaC + 4 字节块头 + STREAMINFO；采样率是 STREAMINFO 第 10 字节起的 20 bit。
    if (bytes.length < 21 || (bytes[4] & 0x7f) !== 0) return undefined;
    return valid((bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4));
}

function frameSyncSampleRate(bytes: Uint8Array, start: number) {
    const limit = Math.min(bytes.length - 4, start + 64 * 1024);
    for (let offset = start; offset <= limit; offset += 1) {
        if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) continue;
        const layer = (bytes[offset + 1] >> 1) & 0x03;
        if (layer === 0) {
            // ADTS（AAC）：12 bit 同步字 + layer 恒为 0。
            if ((bytes[offset + 1] & 0xf6) !== 0xf0) continue;
            const rate = ADTS_SAMPLE_RATES[(bytes[offset + 2] >> 2) & 0x0f];
            if (rate) return rate;
            continue;
        }
        const version = (bytes[offset + 1] >> 3) & 0x03;
        const bitrateIndex = bytes[offset + 2] >> 4;
        const rateIndex = (bytes[offset + 2] >> 2) & 0x03;
        if (version === 1 || bitrateIndex === 0x0f || bitrateIndex === 0 || rateIndex === 3) continue;
        return MPEG_SAMPLE_RATES[version]?.[rateIndex];
    }
    return undefined;
}

function mp4SampleRate(bytes: Uint8Array) {
    const data = view(bytes);
    // 只下钻音频轨需要的容器；mdhd.timescale 就是音频采样率，不受 stsd 16.16 定点数 65535 的上限影响。
    const containers = new Set(["moov", "trak", "mdia"]);
    const walk = (start: number, end: number): number | undefined => {
        let offset = start;
        let handler = "";
        let timescale = 0;
        while (offset + 8 <= end) {
            let size = data.getUint32(offset);
            const type = ascii(bytes, offset + 4, 4);
            let header = 8;
            if (size === 1 && offset + 16 <= end) {
                size = Number(data.getBigUint64(offset + 8));
                header = 16;
            } else if (size === 0) {
                size = end - offset;
            }
            if (size < header) return undefined;
            const boxEnd = Math.min(end, offset + size);
            if (containers.has(type)) {
                const found = walk(offset + header, boxEnd);
                if (found) return found;
            } else if (type === "hdlr" && offset + header + 12 <= boxEnd) {
                handler = ascii(bytes, offset + header + 8, 4);
            } else if (type === "mdhd" && offset + header + 24 <= boxEnd) {
                const version = bytes[offset + header];
                timescale = data.getUint32(offset + header + (version === 1 ? 20 : 12));
            }
            offset += size;
        }
        return handler === "soun" ? valid(timescale) : undefined;
    };
    return walk(0, bytes.length);
}

function oggSampleRate(bytes: Uint8Array) {
    if (bytes.length < 28) return undefined;
    const packet = 27 + bytes[26];
    const data = view(bytes);
    if (ascii(bytes, packet, 7) === "\x01vorbis" && packet + 16 <= bytes.length) return valid(data.getUint32(packet + 12, true));
    // Opus 一律以 48 kHz 解码；头里的 input sample rate 只是编码前的原始采样率。
    if (ascii(bytes, packet, 8) === "OpusHead" && packet + 16 <= bytes.length) return valid(data.getUint32(packet + 12, true)) || 48000;
    return undefined;
}

function matroskaSampleRate(bytes: Uint8Array) {
    // EBML SamplingFrequency（ID 0xB5）以 4 / 8 字节浮点存储；只接受常见采样率，避免误匹配其它字段。
    const data = view(bytes);
    const common = new Set([8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000]);
    for (let offset = 0; offset + 10 <= bytes.length; offset += 1) {
        if (bytes[offset] !== 0xb5) continue;
        const marker = bytes[offset + 1];
        const rate = marker === 0x88 ? data.getFloat64(offset + 2) : marker === 0x84 ? data.getFloat32(offset + 2) : 0;
        if (common.has(rate)) return rate;
    }
    return undefined;
}

export function parseAudioSampleRate(bytes: Uint8Array): number | undefined {
    if (bytes.length < 12) return undefined;
    try {
        if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") return wavSampleRate(bytes);
        if (ascii(bytes, 0, 4) === "fLaC") return flacSampleRate(bytes);
        if (ascii(bytes, 0, 4) === "OggS") return oggSampleRate(bytes);
        if (ascii(bytes, 4, 4) === "ftyp") return mp4SampleRate(bytes);
        if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return matroskaSampleRate(bytes);
        const id3 = id3TagLength(bytes);
        // ID3 之后也可能是 FLAC。
        if (id3 && ascii(bytes, id3, 4) === "fLaC") return flacSampleRate(bytes.subarray(id3));
        return valid(frameSyncSampleRate(bytes, id3));
    } catch {
        // 截断或损坏的文件头只代表未知，不影响素材展示。
        return undefined;
    }
}
