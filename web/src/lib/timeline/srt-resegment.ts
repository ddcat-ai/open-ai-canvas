import type { SrtEntry } from "@/types/timeline";
import { serializeSrtEntries } from "./srt-parser";

export const DEFAULT_MAX_CHARS_PER_ENTRY = 35;
export const MIN_CHARS_PER_ENTRY = 20;
export const MAX_CHARS_PER_ENTRY_LIMIT = 60;
export const MIN_SEGMENT_DURATION_MS = 300;

const CJK_PUNCTUATION = "，。；！？、：";
const LATIN_PUNCTUATION = ",.;!?:";

/**
 * 在 text 中为 targetLen 附近找最佳断点。
 * 返回切分位置 cut（前段为 text.slice(0, cut)，后段为 text.slice(cut)）。
 * 优先级：中文标点 > 英文标点 > 空格 > 硬切 targetLen。
 * 在同一优先级内选最靠右的位置（靠近 targetLen）。
 */
export function findBestBreakPoint(text: string, targetLen: number): number {
    if (text.length <= targetLen) {
        return text.length;
    }

    const windowStart = Math.max(1, Math.floor(targetLen * 0.6));
    const windowEnd = targetLen;

    // 优先级 1：中文标点 — 从右向左扫描，最靠右优先
    for (let i = windowEnd - 1; i >= windowStart - 1; i -= 1) {
        if (CJK_PUNCTUATION.includes(text[i])) {
            return i + 1;
        }
    }

    // 优先级 2：英文标点
    for (let i = windowEnd - 1; i >= windowStart - 1; i -= 1) {
        if (LATIN_PUNCTUATION.includes(text[i])) {
            return i + 1;
        }
    }

    // 优先级 3：空格
    for (let i = windowEnd - 1; i >= windowStart - 1; i -= 1) {
        if (text[i] === " ") {
            return i + 1;
        }
    }

    // 优先级 4：硬切
    return targetLen;
}

/**
 * 对已切分好的段列表应用最小时长约束（MIN_SEGMENT_DURATION_MS）。
 * 逐段检查：若某段时长不足，将其 endMs 向后推，同时把下一段的 startMs 相应推移。
 * 最后一段的 endMs 始终等于原始 entry.endMs，不做调整。
 * 若总时长本身不足以满足所有段的最小时长，接受违规（不崩溃，不重排）。
 */
function enforceMinDuration(segments: SrtEntry[], originalEndMs: number): SrtEntry[] {
    if (segments.length <= 1) {
        return segments;
    }
    const result = segments.map((s) => ({ ...s }));
    for (let i = 0; i < result.length - 1; i++) {
        const dur = result[i].endMs - result[i].startMs;
        if (dur < MIN_SEGMENT_DURATION_MS) {
            const needed = MIN_SEGMENT_DURATION_MS - dur;
            // 最多能推到下一段结束（即 originalEndMs 对于最后两段），但不超过 originalEndMs
            const cap = Math.min(result[i + 1].endMs, originalEndMs);
            const newEnd = Math.min(result[i].endMs + needed, cap);
            result[i].endMs = newEnd;
            result[i + 1].startMs = newEnd;
        }
    }
    // 确保末段 endMs 不变
    result[result.length - 1].endMs = originalEndMs;
    return result;
}

/**
 * 把一个超长 entry 切成若干不超过 maxChars 的子 entry，递归切分。
 * 时间按字符数等比分配，最终应用 MIN_SEGMENT_DURATION_MS 下限。
 */
export function splitLongEntry(entry: SrtEntry, maxChars: number): SrtEntry[] {
    if (entry.text.length <= maxChars) {
        return [entry];
    }

    const cut = findBestBreakPoint(entry.text, maxChars);
    let frontText = entry.text.slice(0, cut).replace(/\s+$/, "");
    let backText = entry.text.slice(cut).replace(/^\s+/, "");

    if (frontText.length === 0 || backText.length === 0) {
        // 退化情况：空白裁剪后一侧为空，回退到硬切
        frontText = entry.text.slice(0, maxChars);
        backText = entry.text.slice(maxChars);
    }

    const totalLen = frontText.length + backText.length;
    const durationMs = entry.endMs - entry.startMs;
    const frontDuration = Math.round((durationMs * frontText.length) / totalLen);
    const splitPointMs = entry.startMs + frontDuration;

    const frontEntry: SrtEntry = {
        index: entry.index,
        startMs: entry.startMs,
        endMs: splitPointMs,
        text: frontText,
    };
    const backEntry: SrtEntry = {
        index: entry.index,
        startMs: splitPointMs,
        endMs: entry.endMs,
        text: backText,
    };

    const frontSegments = frontText.length > maxChars ? splitLongEntry(frontEntry, maxChars) : [frontEntry];
    const backSegments = backText.length > maxChars ? splitLongEntry(backEntry, maxChars) : [backEntry];

    const segments = [...frontSegments, ...backSegments];
    return enforceMinDuration(segments, entry.endMs);
}

/**
 * 遍历 entries，对每条超长的调用 splitLongEntry，最后重新编号 index 为 1..N。
 */
export function resegmentSrtEntries(entries: SrtEntry[], maxChars: number): SrtEntry[] {
    const split: SrtEntry[] = [];
    for (const entry of entries) {
        split.push(...splitLongEntry(entry, maxChars));
    }
    return split.map((entry, idx) => ({ ...entry, index: idx + 1 }));
}
