/**
 * DMC 创作台的本机偏好与灵感目录 —— 纯前端，不依赖登录态后端。
 *
 * 2026-11-17 21:54：学 BeeFTV 工作台后补的功能（灵感广场 / 模型配置 / 参数预设 / 最近画布），
 * 数据全部落浏览器 localStorage，走影策自带的 guest scope 隔离惯例。
 */

import { LL2_DEFAULT_TEXT_MODEL, LL2_TEXT_MODELS } from "@/services/ll2/ll2-text";
import { LL2_CONNECTED_VIDEO_MODELS, ll2PreciseCNY, type LL2ConnectedVideoModel } from "@/lib/ll2-models";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";

// ── 灵感广场 ────────────────────────────────────────────────────────────────

export type LL2InspirationType = "video" | "text";

export type LL2Inspiration = {
    id: string;
    group: "镜头" | "风格" | "故事" | "运镜";
    type: LL2InspirationType;
    title: string;
    prompt: string;
    hint: string;
    /** 视频灵感：推荐模型 / 分辨率 / 秒数，用来把「这一次花多少钱」写在卡片上。 */
    model?: LL2ConnectedVideoModel;
    resolution?: string;
    seconds?: number;
    custom?: boolean;
};

/**
 * 内置灵感目录：照 yingce.tv「灵感大厅」的信息密度，每条都带推荐模型、
 * 分辨率与时长，卡片上直接给出这一次调用的预估价。
 * 不引用影策官方素材库（那需要登录态后端）。
 */
export const LL2_INSPIRATIONS: LL2Inspiration[] = [
    { id: "sea-dusk", group: "镜头", type: "video", title: "黄昏海面，镜头缓缓前推", prompt: "黄昏的海面，镜头缓缓向前推进，云在移动，远处有一艘小船，金色反光从画面右下角扫过", hint: "最常用的第一支片子", model: "MiniMax-H3", resolution: "768P", seconds: 5 },
    { id: "rain-neon", group: "镜头", type: "video", title: "雨夜霓虹街角", prompt: "雨夜霓虹街角，一个人撑伞走过，镜头低角度跟拍，地面倒映红蓝招牌，远处车灯拉成光轨", hint: "夜景与光线", model: "MiniMax-H3", resolution: "768P", seconds: 5 },
    { id: "paper-plane", group: "镜头", type: "video", title: "纸飞机飞过晨雾山谷", prompt: "白色纸飞机飞过晨雾中的山谷，阳光穿过云层，镜头从侧面跟随，山谷里有一层薄薄的雾", hint: "明亮通透", model: "wan3.0-video", resolution: "720P", seconds: 5 },
    { id: "film-grain", group: "风格", type: "video", title: "35mm 胶片质感", prompt: "35mm 胶片质感，轻微颗粒与暖色偏色，画面边缘有柔和暗角，一个女孩站在旧书店门口回头", hint: "风格模板 · 可换主体", model: "MiniMax-H3", resolution: "768P", seconds: 5 },
    { id: "ink-wash", group: "风格", type: "video", title: "水墨留白", prompt: "中国水墨风格，大面积留白，远山以淡墨晕开，一叶小舟缓慢划过水面，镜头保持静止", hint: "东方美学 · 静态镜头", model: "MiniMax-H3", resolution: "768P", seconds: 5 },
    { id: "stop-motion", group: "风格", type: "video", title: "定格动画质感", prompt: "定格动画质感，羊毛毡材质的小屋与树木，阳光一格一格移动，镜头轻微平移，色调柔和", hint: "材质与节奏", model: "wan3.0-video", resolution: "1080P", seconds: 6 },
    { id: "one-take", group: "运镜", type: "video", title: "穿过窗户，中间不切镜头", prompt: "一镜到底，镜头从窗外缓慢推进穿过玻璃进入室内，桌上的咖啡冒着热气，窗外下着小雨", hint: "一口气拍完 · 不要切镜头", model: "MiniMax-H3", resolution: "768P", seconds: 10 },
    { id: "crane-up", group: "运镜", type: "video", title: "镜头慢慢抬高，看见整片风景", prompt: "镜头从一片花丛的低角度缓缓升起，越过树梢后露出整座山谷与远处的湖，光线从侧面照来", hint: "由近及远", model: "wan3.0-video", resolution: "720P", seconds: 5 },
    { id: "orbit", group: "运镜", type: "video", title: "绕着人转一圈", prompt: "镜头围绕站在天台的人缓慢环绕一周，城市天际线在背景里连续移动，黄昏光线保持一致", hint: "连续环绕 · 无硬切", model: "wan3.0-video", resolution: "1080P", seconds: 5 },
    { id: "story-first", group: "故事", type: "video", title: "开场：一个人收到信", prompt: "清晨的旧公寓，一个人拆开一封没有署名的信，镜头从手部特写缓缓抬到脸部，窗外光很淡", hint: "故事开篇", model: "MiniMax-H3", resolution: "768P", seconds: 5 },
    { id: "story-turn", group: "故事", type: "video", title: "转折：门被推开", prompt: "昏暗走廊尽头的门被缓缓推开，光从门缝里漫进来，镜头保持不动，空气里有细微浮尘", hint: "情绪转折", model: "MiniMax-H3", resolution: "768P", seconds: 5 },
    { id: "story-end", group: "故事", type: "video", title: "收尾：列车远去", prompt: "站台上的列车缓缓驶离，一个人站在原地没有动，镜头固定，画面慢慢被白色雾气填满", hint: "结尾镜头", model: "MiniMax-H3", resolution: "768P", seconds: 5 },
    { id: "text-storyboard", group: "故事", type: "text", title: "把一句话扩成 4 格分镜", prompt: "把「一个雨夜的街角」拆成 4 格分镜，每格写清画面、镜头运动和光线，输出可直接生成视频的提示词", hint: "交给我们的文本模型" },
    { id: "text-rewrite", group: "风格", type: "text", title: "把提示词改成电影感", prompt: "帮我把下面这段画面描述改写成更有电影感的视频提示词，补上镜头、光线与色调，不要分段：", hint: "交给我们的文本模型" },
    { id: "text-comic-open", group: "故事", type: "text", title: "漫剧第一集怎么开头", prompt: "我想做一个都市奇幻漫剧，第一集要在 30 秒内抓住人。帮我定开场人物、冲突和一个反转，再拆成 4 个画面，每格写清主体、光线和镜头运动", hint: "写漫剧 · 我们的文本模型" },
    { id: "text-drama-hook", group: "故事", type: "text", title: "短剧前三秒怎么抓人", prompt: "帮我写一个甜宠短剧的开场：前三秒出现什么画面、台词怎么说、镜头怎么动，后面 3 个镜头怎么接。给出可以直接出片的画面描述", hint: "写短剧 · 我们的文本模型" },
    { id: "text-prompt-check", group: "风格", type: "text", title: "我的提示词缺了什么", prompt: "我想拍「雨夜的老城，一个人撑伞走过」。请指出这段提示词还缺什么，告诉我该补哪些信息，再给一版改好的完整提示词", hint: "解决创作问题 · 我们的文本模型" },
];

export const LL2_INSPIRATION_GROUPS = ["全部", "镜头", "风格", "故事", "运镜"] as const;
export const LL2_PROMPT_GROUPS = ["镜头", "风格", "故事", "运镜"] as const;
export const LL2_INSPIRATION_TYPES = ["全部", "视频", "文本"] as const;
export const CUSTOM_INSPIRATION_KEY = "ll2:custom_inspirations:v1";

export function ll2ListCustomInspirations(): LL2Inspiration[] {
    try {
        const value = JSON.parse(window.localStorage.getItem(CUSTOM_INSPIRATION_KEY) || "[]");
        return Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && typeof item.prompt === "string") : [];
    } catch {
        return [];
    }
}

export function ll2AddCustomInspiration(input: { title: string; prompt: string; group: LL2Inspiration["group"]; type: LL2InspirationType }): LL2Inspiration[] {
    const item: LL2Inspiration = {
        id: `custom-${Date.now().toString(36)}`,
        title: input.title.trim() || "我的灵感",
        prompt: input.prompt.trim(),
        hint: "自己存下来的想法",
        group: input.group,
        type: input.type,
        custom: true,
        model: input.type === "video" ? "MiniMax-H3" : undefined,
        resolution: input.type === "video" ? "768P" : undefined,
        seconds: input.type === "video" ? 5 : undefined,
    };
    const next = [item, ...ll2ListCustomInspirations()];
    try {
        window.localStorage.setItem(CUSTOM_INSPIRATION_KEY, JSON.stringify(next));
    } catch {
        // 隐私模式：本次会话仍可用。
    }
    return next;
}

export function ll2RemoveCustomInspiration(id: string): LL2Inspiration[] {
    const next = ll2ListCustomInspirations().filter((item) => item.id !== id);
    try {
        window.localStorage.setItem(CUSTOM_INSPIRATION_KEY, JSON.stringify(next));
    } catch {
        // 同上
    }
    return next;
}

/** 卡片上的「这一次大概花多少钱」；文本灵感按 Token，没有固定单价。 */
export function ll2InspirationCost(item: LL2Inspiration): { label: string; basis: string } | null {
    if (item.type !== "video" || !item.model || !item.resolution || !item.seconds) return null;
    const estimate = ll2PreciseCNY(item.model, item.seconds, item.resolution);
    return { label: estimate.label, basis: estimate.basis };
}

/** 灵感广场「用这个」：视频回首页出片，文本回首页并打开文本助手。 */
export function ll2InspirationUseUrl(item: LL2Inspiration): string {
    return ll2PromptUrl(item.prompt, item.type === "text" ? { mode: "text" } : { resolution: item.resolution || "", seconds: String(item.seconds || 5), model: item.model || "" });
}

const FAV_KEY = "ll2:inspiration_favorites:v1";

export function ll2ListFavoriteInspirations(): string[] {
    try {
        const value = JSON.parse(window.localStorage.getItem(FAV_KEY) || "[]");
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

export function ll2ToggleFavoriteInspiration(id: string): string[] {
    const current = ll2ListFavoriteInspirations();
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    try {
        window.localStorage.setItem(FAV_KEY, JSON.stringify(next));
    } catch {
        // 隐私模式下本次会话仍可切换。
    }
    return next;
}

/** 灵感广场点「用这个」后把提示词带到一句话成片，首页从 ?prompt= 读取。 */
export function ll2PromptUrl(prompt: string, extra?: Record<string, string>) {
    const params = new URLSearchParams({ prompt });
    for (const [key, value] of Object.entries(extra || {})) params.set(key, value);
    return `/?${params.toString()}`;
}

// ── 模型配置 / 参数预设 ──────────────────────────────────────────────────────

export type LL2WorkspaceSettings = {
    videoModel: LL2ConnectedVideoModel;
    resolution: string;
    seconds: number;
    ratio: string;
    textModel: string;
    /** 仅 H3 支持：让网关先把提示词整理成官方格式再生成。默认关。 */
    promptOptimizer: boolean;
};

export const LL2_SETTINGS_KEY = "ll2:workspace_settings:v1";

export const LL2_DEFAULT_SETTINGS: LL2WorkspaceSettings = {
    videoModel: "MiniMax-H3",
    resolution: "768P",
    seconds: 5,
    ratio: "16:9",
    textModel: LL2_DEFAULT_TEXT_MODEL,
    promptOptimizer: false,
};

export function ll2ReadSettings(): LL2WorkspaceSettings {
    try {
        const raw = window.localStorage.getItem(LL2_SETTINGS_KEY);
        if (!raw) return { ...LL2_DEFAULT_SETTINGS };
        const value = JSON.parse(raw) as Partial<LL2WorkspaceSettings>;
        const textModel = typeof value.textModel === "string" && LL2_TEXT_MODELS.some((model) => model.id === value.textModel) ? value.textModel : LL2_DEFAULT_TEXT_MODEL;
        const connectedModels = LL2_CONNECTED_VIDEO_MODELS as readonly string[];
        return {
            // 14 个视频模型都能被记住，不再只认 H3 / wan3。
            videoModel: typeof value.videoModel === "string" && connectedModels.includes(value.videoModel)
                ? (value.videoModel as LL2ConnectedVideoModel)
                : LL2_DEFAULT_SETTINGS.videoModel,
            resolution: typeof value.resolution === "string" && value.resolution ? value.resolution : LL2_DEFAULT_SETTINGS.resolution,
            seconds: Number.isFinite(value.seconds) ? Math.min(30, Math.max(1, Number(value.seconds))) : LL2_DEFAULT_SETTINGS.seconds,
            ratio: typeof value.ratio === "string" && value.ratio ? value.ratio : LL2_DEFAULT_SETTINGS.ratio,
            textModel,
            promptOptimizer: value.promptOptimizer === true,
        };
    } catch {
        return { ...LL2_DEFAULT_SETTINGS };
    }
}

export function ll2WriteSettings(settings: LL2WorkspaceSettings): LL2WorkspaceSettings {
    const next = { ...LL2_DEFAULT_SETTINGS, ...settings };
    try {
        window.localStorage.setItem(LL2_SETTINGS_KEY, JSON.stringify(next));
    } catch {
        // 隐私模式：本次会话仍生效。
    }
    return next;
}

// ── 画布 Agent 会话（本机） ─────────────────────────────────────────────────

export type LL2AgentMessage = {
    id: string;
    role: "user" | "assistant";
    text: string;
    model?: string;
    costLabel?: string;
    costBasis?: string;
    createdAt: number;
};

const AGENT_KEY = "ll2:agent_messages:v1";

export function ll2ReadAgentMessages(): LL2AgentMessage[] {
    try {
        const value = JSON.parse(window.localStorage.getItem(AGENT_KEY) || "[]");
        return Array.isArray(value) ? value.filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string") : [];
    } catch {
        return [];
    }
}

export function ll2WriteAgentMessages(messages: LL2AgentMessage[]): LL2AgentMessage[] {
    const next = messages.slice(-40);
    try {
        window.localStorage.setItem(AGENT_KEY, JSON.stringify(next));
    } catch {
        // 同上
    }
    return next;
}

/** 从 /canvas/:id 里取出当前画布 id，供 Agent「插入画布」用。 */
export function ll2CurrentCanvasId(pathname: string): string | null {
    const match = pathname.match(/^\/canvas\/([^/]+)/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * C 端免登录：新建一张真正落本机的画布，而不是只存在内存里的 draft。
 * 影策的 persist 只保存 projects、不保存 drafts，用 createDraftProject 建的
 * 画布一刷新就没了；这里 createProject + 主动 flush，保证刷新 /canvas/:id 还在。
 */
/** 新建画布的默认名：不用「自由画布 1」，和侧栏统一叫「无限画布」。 */
export function ll2NewCanvasName(existingCount = 0): string {
    const now = new Date();
    const date = `${now.getMonth() + 1}月${now.getDate()}日`;
    return existingCount > 0 ? `无限画布 · ${date}（${existingCount + 1}）` : `无限画布 · ${date}`;
}

export async function ll2CreateLocalCanvas(title?: string): Promise<string> {
    const store = useCanvasStore.getState();
    const id = store.createProject(title || ll2NewCanvasName(store.projects.length));
    await flushCanvasStorePersistence();
    return id;
}
