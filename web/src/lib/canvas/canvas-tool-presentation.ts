import type { ToolScope } from "@/services/api/tools";
// 各子 Tab 的独立标签集，与 backend internal/tools/seed/tools.json 的 tags 对齐
export const SUB_TAB_TAGS: Record<"style" | "motion", Array<{ id: string; label: string }>> = {
    style: [
        { id: "period", label: "古装" },
        { id: "city", label: "都市" },
        { id: "decade", label: "年代" },
        { id: "life", label: "生活" },
        { id: "science_fiction", label: "科幻" },
        { id: "type", label: "类型" },
        { id: "poetic", label: "写意" },
        { id: "animation", label: "动画" },
        { id: "drawing", label: "绘画" },
        { id: "myth", label: "神话" },
    ],
    motion: [
        { id: "basic", label: "基础控制" },
        { id: "follow", label: "人物跟拍" },
        { id: "reveal", label: "揭示转场" },
        { id: "emotion", label: "情绪强化" },
        { id: "aerial", label: "空间航拍" },
    ],
};

type FeedTab = ToolScope;

export const FEED_TABS: Array<{ id: FeedTab; label: string }> = [
    { id: "public", label: "公共" },
    { id: "favorites", label: "收藏" },
    { id: "custom", label: "自定义" },
];

export function toAbsoluteUrl(value?: string) {
    const text = (value || "").trim();
    if (/^https?:\/\//i.test(text)) return text;
    if (text.startsWith("/") && !text.startsWith("//")) return new URL(text, window.location.origin).href;
    return "";
}
