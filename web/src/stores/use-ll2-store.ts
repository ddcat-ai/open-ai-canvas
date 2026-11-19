import { create } from "zustand";

import { LL2_API_BASE, ll2MergeLiveModels, type LL2LivePricing } from "@/lib/ll2-models";
import { createModelChannel, normalizeConfigSnapshot, useConfigStore } from "@/stores/use-config-store";

/**
 * DMC C 端：不注册、不登录，用户填自己的 DMC API Key 即可使用。
 *
 * Key 只保存在浏览器 localStorage，同时写入影策自带的「用户自定义渠道」
 * （ModelChannel.scope = "user"），复用影策原有的模型选择 / 生成请求 / 任务轮询链路。
 * Key 不写入业务数据库，不经过任何服务端接口。
 *
 * 2026-11-17 21:24：渠道改为全量挂载官网 21 个模型（含实时新增），
 * 但只有 MiniMax-H3 / wan3.0-video 做了协议适配（见 services/ll2/ll2-video-adapters.ts）。
 * 其余模型只是「接上」——可在影策模型选择器里选中并走通用协议，不写专门适配代码。
 */
const STORAGE_KEY = "ll2:api_key:v1";
const CONNECTED_AT_KEY = "ll2:connected_at:v1";
const LIVE_MODELS_KEY = "ll2:live_models:v1";
export const LL2_CHANNEL_ID = "ll2-primary";
export const LL2_TEXT_CHANNEL_ID = "ll2-text";
export const LL2_CHANNEL_NAME = "DMC · 视频";
export const LL2_TEXT_CHANNEL_NAME = "DMC · 文本";

function readStoredKey(): string {
    try {
        return (window.localStorage.getItem(STORAGE_KEY) || "").trim();
    } catch {
        return "";
    }
}

function readConnectedAt(): number {
    try {
        return Number(window.localStorage.getItem(CONNECTED_AT_KEY) || 0) || 0;
    } catch {
        return 0;
    }
}

function readLiveModels(): LL2LivePricing[] {
    try {
        const parsed = JSON.parse(window.localStorage.getItem(LIVE_MODELS_KEY) || "[]");
        return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.model_name === "string") : [];
    } catch {
        return [];
    }
}

/**
 * 把 DMC Key 写进影策的用户渠道，一次挂全量模型。
 * 分两个渠道是因为影策一个渠道只有一个 interfaceType：
 *   视频 / 超分 -> newapi-channel-2（openai-video，/v1/video/generations）
 *   文本        -> interfaceType 留空，走 OpenAI chat completions
 * 混在一个渠道里会让文本模型误走视频端点，这不是「适配」问题，是接入分组问题。
 *
 * 官网 /api/pricing 的实时清单由模型广场刷新后缓存，新增模型自动并入，
 * 不需要再改这份代码。两个渠道都指向 api.ll2.cn，直连白名单对全部模型生效。
 */
function syncChannel(apiKey: string, liveModels: LL2LivePricing[] = []) {
    const store = useConfigStore.getState();
    const config = { ...store.config };
    const groups = ll2MergeLiveModels(liveModels);
    const others = (config.channels || []).filter(
        (channel) => channel.id !== LL2_CHANNEL_ID && channel.id !== LL2_TEXT_CHANNEL_ID,
    );
    const channels = [
        createModelChannel({
            id: LL2_CHANNEL_ID,
            name: LL2_CHANNEL_NAME,
            baseUrl: LL2_API_BASE,
            apiKey,
            apiFormat: "openai",
            interfaceType: "newapi-channel-2",
            scope: "user",
            enabled: true,
            models: groups.video,
        }),
        createModelChannel({
            id: LL2_TEXT_CHANNEL_ID,
            name: LL2_TEXT_CHANNEL_NAME,
            baseUrl: LL2_API_BASE,
            apiKey,
            apiFormat: "openai",
            // 文本模型走标准 /v1/chat/completions；不指定视频协议。
            interfaceType: undefined,
            scope: "user",
            enabled: true,
            models: groups.text,
        }),
    ];
    const next = normalizeConfigSnapshot({
        config: { ...config, channels: apiKey ? [...channels, ...others] : others },
    }).config;
    store.replaceConfig(next);
}

export type LL2Store = {
    apiKey: string;
    connectedAt: number;
    /** 官网 /api/pricing 的最近一次实时清单，用于把新上架模型也接入渠道。 */
    liveModels: LL2LivePricing[];
    /** 是否展示过首次连接引导（用户可手动收起，不再反复弹）。 */
    noticeDismissed: boolean;
    /**
     * 全局唯一的「填 Key」弹窗开关。
     * 2026-11-18：首页、顶栏、侧栏、模型配置、高级生成曾各自内嵌一份 LL2KeyPanel，
     * 于是「开始创作 + 右上角连接」会同时冒出两个一模一样的输入框。
     * 现在所有入口只改这一个状态，输入框只在 UserLayout 里挂载一次。
     */
    keyDialogOpen: boolean;
    openKeyDialog: () => void;
    closeKeyDialog: () => void;
    connect: (key: string) => void;
    disconnect: () => void;
    setLiveModels: (models: LL2LivePricing[]) => void;
    dismissNotice: () => void;
    isConnected: () => boolean;
    /** 当前渠道里已接入的模型名（含官网新增），供 UI / 自检读取。 */
    connectedModels: () => string[];
};

export const useLL2Store = create<LL2Store>((set, get) => ({
    apiKey: readStoredKey(),
    connectedAt: readConnectedAt(),
    liveModels: readLiveModels(),
    noticeDismissed: false,
    keyDialogOpen: false,

    openKeyDialog: () => set({ keyDialogOpen: true }),
    closeKeyDialog: () => set({ keyDialogOpen: false }),

    connect: (key) => {
        const trimmed = key.trim();
        try {
            if (trimmed) {
                window.localStorage.setItem(STORAGE_KEY, trimmed);
                window.localStorage.setItem(CONNECTED_AT_KEY, String(Date.now()));
            } else {
                window.localStorage.removeItem(STORAGE_KEY);
                window.localStorage.removeItem(CONNECTED_AT_KEY);
            }
        } catch {
            // 隐私模式下 localStorage 不可写：内存态仍生效，刷新后需重填。
        }
        syncChannel(trimmed, get().liveModels);
        set({ apiKey: trimmed, connectedAt: trimmed ? Date.now() : 0, noticeDismissed: true, keyDialogOpen: false });
    },

    disconnect: () => {
        try {
            window.localStorage.removeItem(STORAGE_KEY);
            window.localStorage.removeItem(CONNECTED_AT_KEY);
        } catch {
            // 同上
        }
        syncChannel("", get().liveModels);
        set({ apiKey: "", connectedAt: 0 });
    },

    setLiveModels: (models) => {
        const list = Array.isArray(models) ? models : [];
        try {
            window.localStorage.setItem(LIVE_MODELS_KEY, JSON.stringify(list));
        } catch {
            // 存储不可写时仅保留内存态，本次会话仍然生效。
        }
        set({ liveModels: list });
        // 已连接时立刻把新增模型补进渠道，不用重新填 Key。
        if (get().apiKey.trim()) syncChannel(get().apiKey, list);
    },

    dismissNotice: () => set({ noticeDismissed: true }),

    isConnected: () => Boolean(get().apiKey.trim()),

    connectedModels: () => ll2MergeLiveModels(get().liveModels).all,
}));

/** 非 React 环境读取连接状态。 */
export function ll2IsConnected() {
    return Boolean(useLL2Store.getState().apiKey.trim());
}

/** 任意位置打开全局唯一的填 Key 弹窗（不新增第二份输入框）。 */
export function ll2OpenKeyDialog() {
    useLL2Store.getState().openKeyDialog();
}

/** Key 脱敏显示：只保留前 6 位和后 4 位。 */
export function ll2MaskedKey(key: string) {
    const value = key.trim();
    if (value.length <= 12) return value ? "••••••••" : "";
    return `${value.slice(0, 6)}••••${value.slice(-4)}`;
}
