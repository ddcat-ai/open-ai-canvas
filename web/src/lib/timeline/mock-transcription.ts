// Mock 转写（M3.6）：M4 后端转写任务未就绪前，用确定性伪转写模拟 ASR 结果。
// 同一 title + durationMs 永远生成相同的 SrtEntry[]，便于测试与回归；
// M4 接真实任务客户端后本模块移除，UI 契约（SrtEntry[] 落字幕轨道）不变。

import type { SrtEntry } from "@/types/timeline";

const MOCK_CHUNK_MS = 1800;
const MOCK_GAP_MS = 200;

/** 从标题确定性生成一组模拟字幕条目（基于字符串 hash 稳定切分）。 */
export function mockTranscriptionEntries(title: string, durationMs: number): SrtEntry[] {
    const text = title.trim() || "未命名素材";
    const chunks = splitStable(text, 6);
    const usable = Math.max(1, Math.floor(durationMs / (MOCK_CHUNK_MS + MOCK_GAP_MS)));
    const count = Math.min(chunks.length, usable);
    const step = durationMs / count;

    const entries: SrtEntry[] = [];
    for (let i = 0; i < count; i += 1) {
        const startMs = Math.round(i * step);
        const endMs = Math.min(durationMs, Math.round(startMs + MOCK_CHUNK_MS));
        if (endMs <= startMs) break;
        entries.push({ index: i, startMs, endMs, text: chunks[i % chunks.length] });
    }
    return entries;
}

/** 稳定切分：按可打印字符逐段取满 maxLen，确定性无随机。 */
function splitStable(text: string, maxLen: number): string[] {
    const chars = Array.from(text);
    const chunks: string[] = [];
    for (let i = 0; i < chars.length; i += maxLen) {
        chunks.push(chars.slice(i, i + maxLen).join(""));
    }
    return chunks;
}
