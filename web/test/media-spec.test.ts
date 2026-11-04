import { describe, expect, test } from "bun:test";

import { parseAudioSampleRate } from "../src/lib/audio-sample-rate";
import { audioAverageBitrateKbps, formatAudioSampleRate, imageResolutionTierLabel, mediaAspectRatioLabel, mediaFormatLabel, videoResolutionTierLabel } from "../src/lib/media-spec";
import { assetSummary, assetSummaryDetail } from "../src/pages/assets/asset-library-format";
import type { Asset } from "../src/stores/use-asset-store";

describe("media spec labels", () => {
    test("aspect ratio snaps to standard frames and reduces the rest", () => {
        expect(mediaAspectRatioLabel(1080, 1920)).toBe("9:16");
        expect(mediaAspectRatioLabel(1344, 768)).toBe("16:9");
        expect(mediaAspectRatioLabel(768, 1024)).toBe("3:4");
        expect(mediaAspectRatioLabel(2048, 2048)).toBe("1:1");
        expect(mediaAspectRatioLabel(2520, 1080)).toBe("21:9");
        expect(mediaAspectRatioLabel(1000, 371)).toBe("2.70:1");
        expect(mediaAspectRatioLabel(0, 0)).toBe("");
        expect(mediaAspectRatioLabel(1, 1)).toBe("");
    });

    test("image tiers follow total pixels like model 1K / 2K / 4K presets", () => {
        expect(imageResolutionTierLabel(1024, 1024)).toBe("1K");
        expect(imageResolutionTierLabel(1344, 768)).toBe("1K");
        expect(imageResolutionTierLabel(1920, 1080)).toBe("1K");
        expect(imageResolutionTierLabel(2048, 2048)).toBe("2K");
        expect(imageResolutionTierLabel(1440, 2560)).toBe("2K");
        expect(imageResolutionTierLabel(3840, 2160)).toBe("4K");
        expect(imageResolutionTierLabel(768, 768)).toBe("720P");
        expect(imageResolutionTierLabel(512, 512)).toBe("标清");
    });

    test("video tiers follow the short edge in either orientation", () => {
        expect(videoResolutionTierLabel(768, 1366)).toBe("768P");
        expect(videoResolutionTierLabel(1366, 768)).toBe("768P");
        expect(videoResolutionTierLabel(1280, 720)).toBe("720P");
        expect(videoResolutionTierLabel(1080, 1920)).toBe("1080P");
        expect(videoResolutionTierLabel(2560, 1440)).toBe("2K");
        expect(videoResolutionTierLabel(3840, 2160)).toBe("4K");
        expect(videoResolutionTierLabel(0, 0)).toBe("");
    });

    test("audio sample rate, bitrate and format labels", () => {
        expect(formatAudioSampleRate(44100)).toBe("44.1 kHz");
        expect(formatAudioSampleRate(48000)).toBe("48 kHz");
        expect(formatAudioSampleRate(22050)).toBe("22.05 kHz");
        expect(formatAudioSampleRate(192000)).toBe("192 kHz");
        expect(formatAudioSampleRate(undefined)).toBe("");
        expect(audioAverageBitrateKbps(960_000, 60_000)).toBe(128);
        expect(audioAverageBitrateKbps(1000, 0)).toBe(0);
        expect(mediaFormatLabel("image/png")).toBe("PNG");
        expect(mediaFormatLabel("image/jpeg")).toBe("JPG");
        expect(mediaFormatLabel("audio/mpeg")).toBe("MP3");
    });
});

function bytes(...parts: Array<string | number[]>) {
    const values: number[] = [];
    for (const part of parts) {
        if (typeof part === "string") for (const char of part) values.push(char.charCodeAt(0));
        else values.push(...part);
    }
    return new Uint8Array(values);
}
const u32le = (value: number) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
const u32be = (value: number) => [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
const box = (type: string, ...payload: number[][]) => {
    const body = payload.flat();
    return [...u32be(8 + body.length), ...[...type].map((char) => char.charCodeAt(0)), ...body];
};

describe("audio sample rate parser", () => {
    test("WAV fmt chunk", () => {
        const wav = bytes("RIFF", u32le(36), "WAVE", "fmt ", u32le(16), [1, 0, 2, 0], u32le(96000), u32le(0), [4, 0, 24, 0]);
        expect(parseAudioSampleRate(wav)).toBe(96000);
    });

    test("FLAC STREAMINFO", () => {
        // 192000 = 0x2EE00 → 20 bit: 0x2E 0xE0 0x0? (高 4 bit)
        const streamInfo = [0, 16, 0, 16, 0, 0, 0, 0, 0, 0, 0x2e, 0xe0, 0x00, 0, 0, 0, 0, 0];
        const flac = bytes("fLaC", [0x80, 0, 0, 34], streamInfo);
        expect(parseAudioSampleRate(flac)).toBe(192000);
    });

    test("MP3 frame after an ID3 tag, and ADTS AAC", () => {
        const id3 = [0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0];
        // MPEG-1 Layer III, 128 kbps, 48 kHz.
        expect(parseAudioSampleRate(bytes(id3, [0xff, 0xfb, 0x94, 0x00], new Array(8).fill(0)))).toBe(48000);
        // ADTS, sampling index 4 = 44.1 kHz.
        expect(parseAudioSampleRate(bytes([0xff, 0xf1, 0x50, 0x80], new Array(12).fill(0)))).toBe(44100);
    });

    test("MP4 audio track timescale", () => {
        const hdlr = box(
            "hdlr",
            [0, 0, 0, 0],
            [0, 0, 0, 0],
            [..."soun"].map((char) => char.charCodeAt(0)),
            new Array(12).fill(0),
        );
        const mdhd = box("mdhd", [0, 0, 0, 0], u32be(0), u32be(0), u32be(48000), u32be(0), [0, 0, 0, 0]);
        const mp4 = new Uint8Array([
            ...box(
                "ftyp",
                [..."M4A "].map((char) => char.charCodeAt(0)),
                u32be(0),
            ),
            ...box("moov", box("trak", box("mdia", hdlr, mdhd))),
        ]);
        expect(parseAudioSampleRate(mp4)).toBe(48000);
    });

    test("unknown or truncated data is undefined", () => {
        expect(parseAudioSampleRate(new Uint8Array(4))).toBeUndefined();
        expect(parseAudioSampleRate(bytes("RIFF", u32le(36), "WAVE"))).toBeUndefined();
    });
});

describe("asset card summary", () => {
    const base = { id: "a", title: "素材", coverUrl: "", tags: ["人物"], createdAt: "2026-10-01", updatedAt: "2026-10-01" };

    test("image and video cards show resolution and frame instead of format", () => {
        const image = { ...base, kind: "image", data: { dataUrl: "x", width: 1440, height: 2560, bytes: 1_048_576, mimeType: "image/png" } } as Asset;
        expect(assetSummary(image)).toBe("2K · 9:16");
        expect(assetSummary(image)).not.toContain("png");
        expect(assetSummaryDetail(image)).toBe("1440x2560 · 1.0 MB · PNG");
        const video = { ...base, kind: "video", data: { url: "v", width: 768, height: 1366, durationMs: 6000, bytes: 1, mimeType: "video/mp4" } } as Asset;
        expect(assetSummary(video)).toBe("768P · 9:16");
    });

    test("audio cards show duration and sample rate once known", () => {
        const audio = { ...base, kind: "audio", data: { url: "a", durationMs: 60_000, bytes: 960_000, mimeType: "audio/mpeg" } } as Asset;
        expect(assetSummary(audio)).toBe("1:00");
        expect(assetSummary(audio, 48000)).toBe("1:00 · 48 kHz");
        expect(assetSummaryDetail(audio, 48000)).toContain("128 kbps");
    });
});
