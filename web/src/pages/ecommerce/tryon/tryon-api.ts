import { http } from "@/services/api/request";

import { BUILTIN_TRYON_KNOWLEDGE, type TryOnKnowledge } from "./tryon-plan";
import type { TryOnFunction } from "./tryon-kinds";

export type TryOnKnowledgeRequest = { function: TryOnFunction; garment: string; scene: string; platform: string; region: string; language: string; markets: string[] };

type TryOnKnowledgeResponse = { category: string; knowledge: string; entries: Array<{ id: string; domain?: string; title: string; type?: string }> };

/**
 * 读取后台电商知识库里与服饰上身相关的已审核条目（只读、不计费）。
 * 接口不可用（未登录电商、旧版后端、网络中断）时回退到内置知识，Agent 规划照常进行。
 */
export async function fetchTryOnKnowledge(request: TryOnKnowledgeRequest, signal?: AbortSignal): Promise<TryOnKnowledge> {
    try {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 8000);
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort);
        try {
            const response = await http.post<TryOnKnowledgeResponse>("/ecommerce/tryon/knowledge", request, { signal: controller.signal });
            if (!response?.knowledge?.trim()) throw new Error("empty knowledge");
            return {
                knowledge: `${response.knowledge}\n${BUILTIN_TRYON_KNOWLEDGE}`,
                entries: (response.entries || []).slice(0, 24).map((entry) => ({ id: entry.id, title: entry.title, domain: entry.domain })),
                source: "backend",
            };
        } finally {
            window.clearTimeout(timer);
            signal?.removeEventListener("abort", abort);
        }
    } catch {
        return { knowledge: BUILTIN_TRYON_KNOWLEDGE, entries: [], source: "builtin" };
    }
}
