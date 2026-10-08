/**
 * 灵感库的本地管理状态：用户的增删改、收藏与隐藏。
 *
 * 内置目录（public/inspirations 与 lib/inspirations/highlights）始终只读，
 * 这里只保存叠加层，重新导入外部目录后用户的改动仍然对得上 id。
 * 落盘走 localforage 的用户作用域，切换账号不会串数据；理由见 AGENTS 第 4 节。
 */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { catalogIdOf, type CreationInspiration, type InspirationSourceId } from "@/lib/inspirations/catalog";
import { CUSTOM_ID_PREFIX, isCustomInspiration, type InspirationOverride } from "@/lib/inspirations/resolve";
import { localForageStorageForScope } from "@/lib/localforage-storage";

export const INSPIRATION_STORE_KEY = "open_ai_canvas:inspirations";
/** 导入导出文件的格式版本，字段变化时递增并在这里做迁移。 */
export const INSPIRATION_PAYLOAD_VERSION = 1;

/** 用户可以自己填的部分；id、来源和署名由系统生成。 */
export type InspirationDraft = {
    title: string;
    description: string;
    image: string;
    mode: CreationInspiration["mode"];
    prompt: string;
    promptZh?: string;
    category?: string;
    tags?: string[];
    ratio?: string;
};

export type InspirationPayload = {
    version: number;
    exportedAt: string;
    custom: CreationInspiration[];
    overrides: Record<string, InspirationOverride>;
    hidden: string[];
    favorites: string[];
};

export type InspirationImportResult = {
    created: number;
    updated: number;
    skipped: number;
};

type InspirationStore = {
    hydrated: boolean;
    custom: CreationInspiration[];
    overrides: Record<string, InspirationOverride>;
    hidden: string[];
    favorites: string[];
    createEntry: (draft: InspirationDraft) => string;
    updateEntry: (id: string, patch: InspirationOverride) => void;
    /** 自建条目真删，内置条目转为隐藏——内置数据来自外部目录，删了下次同步还会回来。 */
    removeEntry: (id: string) => void;
    restoreEntry: (id: string) => void;
    toggleFavorite: (id: string) => void;
    exportPayload: () => string;
    importPayload: (text: string) => InspirationImportResult;
    resetCustomizations: () => void;
    /** 持久化回填完成；页面据此决定要不要显示骨架态。 */
    markHydrated: () => void;
};

function nonEmpty(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`缺少必填字段 ${field}`);
    return value.trim();
}

function asStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim());
    return items.length ? items : undefined;
}

/** 编辑器传来的草稿先按同一套规则收敛，不做「空字符串也写进去」的兜底。 */
export function normalizeDraft(input: unknown): InspirationDraft {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("灵感内容格式不正确");
    const raw = input as Record<string, unknown>;
    if (raw.mode !== "text" && raw.mode !== "image" && raw.mode !== "video") throw new Error("创作类型只能是 text、image 或 video");
    return {
        title: nonEmpty(raw.title, "标题"),
        description: typeof raw.description === "string" ? raw.description.trim() : "",
        image: nonEmpty(raw.image, "封面地址"),
        mode: raw.mode,
        prompt: nonEmpty(raw.prompt, "提示词正文"),
        ...(typeof raw.promptZh === "string" && raw.promptZh.trim() ? { promptZh: raw.promptZh.trim() } : {}),
        ...(typeof raw.category === "string" && raw.category.trim() ? { category: raw.category.trim() } : {}),
        ...(asStringArray(raw.tags) ? { tags: asStringArray(raw.tags) } : {}),
        ...(typeof raw.ratio === "string" && raw.ratio.trim() ? { ratio: raw.ratio.trim() } : {}),
    };
}

/** 导入的外部条目同样要过一遍校验：来源不明的文件不能直接写进本地库。 */
function normalizeImportedEntry(input: unknown): CreationInspiration | null {
    try {
        const draft = normalizeDraft(input);
        const raw = input as Record<string, unknown>;
        const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : `${CUSTOM_ID_PREFIX}${crypto.randomUUID()}`;
        return {
            ...draft,
            id: id.startsWith(CUSTOM_ID_PREFIX) ? id : `${CUSTOM_ID_PREFIX}${id}`,
            sourceId: (typeof raw.sourceId === "string" ? raw.sourceId : "original") as InspirationSourceId,
            ...(typeof raw.credit === "string" && raw.credit.trim() ? { credit: raw.credit.trim() } : {}),
            ...(typeof raw.sourceUrl === "string" && raw.sourceUrl.trim() ? { sourceUrl: raw.sourceUrl.trim() } : {}),
        };
    } catch {
        return null;
    }
}

export const useInspirationStore = create<InspirationStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            custom: [],
            overrides: {},
            hidden: [],
            favorites: [],

            createEntry: (draft) => {
                const id = `${CUSTOM_ID_PREFIX}${crypto.randomUUID()}`;
                const entry: CreationInspiration = { ...normalizeDraft(draft), id, sourceId: "original" };
                set((state) => ({ custom: [entry, ...state.custom] }));
                return id;
            },

            updateEntry: (id, patch) => {
                if (!id) throw new Error("缺少要修改的灵感 ID");
                const sanitized = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined && value !== ""));
                if (!Object.keys(sanitized).length) return;
                if (isCustomInspiration(id)) {
                    set((state) => ({ custom: state.custom.map((item) => (catalogIdOf(item) === id ? { ...item, ...sanitized } : item)) }));
                    return;
                }
                set((state) => ({ overrides: { ...state.overrides, [id]: { ...state.overrides[id], ...sanitized } } }));
            },

            removeEntry: (id) => {
                if (!id) throw new Error("缺少要删除的灵感 ID");
                if (isCustomInspiration(id)) {
                    set((state) => ({
                        custom: state.custom.filter((item) => catalogIdOf(item) !== id),
                        favorites: state.favorites.filter((item) => item !== id),
                    }));
                    return;
                }
                set((state) => ({
                    hidden: state.hidden.includes(id) ? state.hidden : [...state.hidden, id],
                    favorites: state.favorites.filter((item) => item !== id),
                    overrides: Object.fromEntries(Object.entries(state.overrides).filter(([key]) => key !== id)),
                }));
            },

            restoreEntry: (id) => set((state) => ({ hidden: state.hidden.filter((item) => item !== id) })),

            toggleFavorite: (id) => {
                if (!id) throw new Error("缺少要收藏的灵感 ID");
                set((state) => ({ favorites: state.favorites.includes(id) ? state.favorites.filter((item) => item !== id) : [id, ...state.favorites] }));
            },

            exportPayload: () => {
                const state = get();
                const payload: InspirationPayload = {
                    version: INSPIRATION_PAYLOAD_VERSION,
                    exportedAt: new Date().toISOString(),
                    custom: state.custom,
                    overrides: state.overrides,
                    hidden: state.hidden,
                    favorites: state.favorites,
                };
                return JSON.stringify(payload, null, 2);
            },

            importPayload: (text) => {
                let parsed: unknown;
                try {
                    parsed = JSON.parse(text);
                } catch {
                    throw new Error("文件不是合法的 JSON");
                }
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("文件结构不是灵感导出格式");
                const raw = parsed as Record<string, unknown>;
                if (raw.version !== INSPIRATION_PAYLOAD_VERSION) throw new Error(`不支持的文件版本：${String(raw.version)}，当前支持 ${INSPIRATION_PAYLOAD_VERSION}`);
                if (!Array.isArray(raw.custom)) throw new Error("文件缺少 custom 列表");

                const incoming = raw.custom.map(normalizeImportedEntry);
                const entries = incoming.filter((item): item is CreationInspiration => item !== null);
                const skipped = incoming.length - entries.length;
                const existing = new Map(get().custom.map((item) => [catalogIdOf(item), item]));
                let created = 0;
                let updated = 0;
                for (const entry of entries) {
                    if (existing.has(entry.id!)) updated += 1;
                    else created += 1;
                }

                const overrides = raw.overrides && typeof raw.overrides === "object" && !Array.isArray(raw.overrides) ? (raw.overrides as Record<string, InspirationOverride>) : {};
                const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
                const favorites = Array.isArray(raw.favorites) ? raw.favorites.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];

                set((state) => ({
                    custom: [...entries, ...state.custom.filter((item) => !entries.some((incomingItem) => incomingItem.id === catalogIdOf(item)))],
                    overrides: { ...state.overrides, ...overrides },
                    hidden: Array.from(new Set([...state.hidden, ...hidden])),
                    favorites: Array.from(new Set([...state.favorites, ...favorites])),
                }));
                return { created, updated, skipped };
            },

            resetCustomizations: () => set({ custom: [], overrides: {}, hidden: [], favorites: [] }),

            markHydrated: () => set({ hydrated: true }),
        }),
        {
            name: INSPIRATION_STORE_KEY,
            storage: createJSONStorage(() => localForageStorageForScope()),
            partialize: (state) => ({ custom: state.custom, overrides: state.overrides, hidden: state.hidden, favorites: state.favorites }),
            onRehydrateStorage: () => (state) => {
                state?.markHydrated();
            },
        },
    ),
);
